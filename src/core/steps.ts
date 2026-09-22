/**
 * The execution map of the installed skills.
 *
 * A skill that runs is written as a numbered sequence, each step closing on the
 * condition that finishes it. This module reads that shape back out, so a
 * developer can see what an agent will do, in what order, which other skills a
 * step hands work to, and which rules are in force while it runs.
 *
 * It is derived entirely from the payload already on disk. Nothing is recorded
 * and nothing is written: the workflow keeps no event log, by design, so the
 * map answers what an agent is instructed to do, not what one did.
 */

import { join } from 'node:path';
import { readPackFile, type PackSet, type RuleEntry, type SkillEntry, type SkillRole } from '../packs.js';
import { listFiles } from '../util/fs.js';
import { firstMatch } from '../util/glob.js';
import { readFrontMatter } from '../util/yaml.js';

/** Stands in for the feature slug a real run fills in. */
export const FEATURE = '<feature>';

/**
 * Why a rule is in force.
 *
 * - `always` — the rule carries no path scope, so it applies everywhere;
 * - `skill` — the rule itself points at this skill, so it governs every step;
 * - `path` — one of the step's artifacts falls inside the rule's globs.
 */
export type RuleReason = 'always' | 'skill' | 'path';

export interface AppliedRule {
  file: string;
  description: string;
  pack: string;
  /** The globs the rule scopes, empty when it applies everywhere. */
  paths: string[];
  reason: RuleReason;
  /** The artifact that matched, for `path`. */
  match: string | null;
  /** The glob that matched it, for `path`. */
  pattern: string | null;
}

export interface Step {
  number: number;
  title: string;
  /** The completion condition, with the words that introduce it removed. */
  doneWhen: string | null;
  /** Skills the step is told to use or hand off to. */
  calls: string[];
  /** Reference skills the step consults. */
  reads: string[];
  /** Skills the step mentions without handing work to them, such as a handback. */
  names: string[];
  /** `npx collab-swarm` commands the step involves. */
  commands: string[];
  /** Files the step reads or writes, as repository paths. */
  artifacts: string[];
  /** Documents the step links to, as the skill writes them. */
  documents: string[];
  /** Rules this step brings into force beyond the skill's own. */
  rules: AppliedRule[];
  /** The step's prose, normalised. */
  body: string;
}

export interface SkillMap {
  name: string;
  role: SkillRole;
  pack: string;
  description: string;
  /** The skill's `#` heading. */
  heading: string;
  /** Prose before the first step: what the skill reads and what it owns. */
  preamble: string;
  steps: Step[];
  /** Headings of a skill written as flat reference rather than as a sequence. */
  topics: string[];
  /** Rules in force for every step of this skill. */
  rules: AppliedRule[];
  /** Files beside SKILL.md, such as a format reference. */
  companions: string[];
}

export interface RuleSite {
  skill: string;
  /** Null when the rule governs the whole skill rather than one step. */
  step: number | null;
  stepTitle: string | null;
  reason: RuleReason;
  match: string | null;
}

export interface RuleCoverage {
  file: string;
  description: string;
  pack: string;
  paths: string[];
  /** Everywhere the rule applies, as whole-skill or per-step sites. */
  sites: RuleSite[];
}

export interface StepMap {
  skills: SkillMap[];
  rules: RuleCoverage[];
}

// ---------------------------------------------------------------------------
// Reading the shape of one skill
// ---------------------------------------------------------------------------

interface Section {
  /** Heading depth; 0 for an item of a top-level ordered list. */
  level: number;
  number: number | null;
  title: string;
  body: string;
}

const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*$/;
const NUMBERED = /^(\d+)[.)][ \t]+(.+)$/;

/**
 * Splits a skill body at its headings.
 *
 * Fenced code is skipped: an example block's shell comment starts with `#` and
 * would otherwise open a phantom section.
 */
function split(body: string): { heading: string; preamble: string; sections: Section[] } {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const sections: Section[] = [];
  const preamble: string[] = [];
  let heading = '';
  let current: Section | null = null;
  let buffer: string[] = [];
  let fenced = false;

  const close = () => {
    if (current) sections.push({ ...current, body: buffer.join('\n').trim() });
    buffer = [];
  };

  for (const line of lines) {
    if (line.startsWith('```')) fenced = !fenced;
    const match = fenced ? null : HEADING.exec(line);

    if (match) {
      const level = match[1]!.length;
      const text = match[2]!;
      if (level === 1 && heading === '') {
        heading = text;
        continue;
      }
      if (level >= 2) {
        close();
        const numbered = NUMBERED.exec(text);
        current = numbered
          ? { level, number: Number(numbered[1]), title: numbered[2]!, body: '' }
          : { level, number: null, title: text, body: '' };
        continue;
      }
    }

    if (current) buffer.push(line);
    else preamble.push(line);
  }
  close();

  return { heading, preamble: preamble.join('\n').trim(), sections };
}

/**
 * The sequence among a skill's sections.
 *
 * Numbering may sit at any depth — a skill that groups its steps under one
 * heading numbers them a level down — so the shallowest numbered level is the
 * sequence and anything below it is detail within a step.
 */
function sequence(sections: Section[]): Section[] {
  const numbered = sections.filter((section) => section.number !== null);
  if (numbered.length === 0) return [];
  const level = Math.min(...numbered.map((section) => section.level));
  return numbered
    .filter((section) => section.level === level)
    .sort((a, b) => a.number! - b.number!);
}

const stripEmphasis = (text: string) => text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/[*_`]/g, '');

/** A list item's own title: its bold opening, or its first sentence. */
function itemTitle(text: string): string {
  const bold = /^\*\*(.+?)\*\*/.exec(text);
  if (bold) return bold[1]!.replace(/[.:]\s*$/, '');
  const sentence = /^(.+?\.)(?:\s|$)/.exec(stripEmphasis(text));
  return (sentence ? sentence[1]! : stripEmphasis(text)).replace(/\.$/, '');
}

/**
 * A sequence written as a plain ordered list rather than as headings.
 *
 * Only ever read from the prose before the first heading, so an illustrative
 * list inside a reference section is not mistaken for the document's steps.
 */
function orderedList(preamble: string): { steps: Section[]; before: string } {
  const lines = preamble.split('\n');
  const found: Section[] = [];
  const before: string[] = [];
  let current: Section | null = null;
  let buffer: string[] = [];
  let fenced = false;

  const close = () => {
    if (current) found.push({ ...current, body: buffer.join('\n').trim() });
    buffer = [];
  };

  for (const line of lines) {
    if (line.startsWith('```')) fenced = !fenced;
    const item = fenced ? null : NUMBERED.exec(line);
    if (item) {
      close();
      current = { level: 0, number: Number(item[1]), title: itemTitle(item[2]!), body: '' };
      buffer = [item[2]!];
      continue;
    }
    if (current) buffer.push(line);
    else before.push(line);
  }
  close();

  // A sequence, not a two-item aside: numbered from one, more than one step.
  if (found.length < 2 || found[0]!.number !== 1) return { steps: [], before: preamble };
  return { steps: found, before: before.join('\n').trim() };
}

const paragraphs = (body: string) =>
  body
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

/** Accepts `Done when …` and the emphasised `**Done when:**` both appear in. */
const DONE = /^\*{0,2}Done when\b:?\*{0,2}[ \t]*/i;

function doneWhen(body: string): string | null {
  const found = paragraphs(body).find((part) => DONE.test(part));
  if (!found) return null;
  return found
    .replace(DONE, '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\.$/, '');
}

const INLINE_CODE = /`([^`\n]+)`/g;
const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;
// A leading `.` is allowed only when a word character follows it, so a path
// argument is captured whole while a sentence's closing period is not.
// Every bin the CLI installs, longest first so `collab-swarm` is never read as
// the `swarm` inside it. The `npx` prefix is required: without it, the word
// "swarm" in ordinary prose would be picked up as a command.
const COMMAND =
  /npx[ \t]+(?:collab-swarm|cswarm|swarm)(?:[ \t]+(?:--?[a-z][a-z-]*|<[^>\n]+>|"[^"\n]*"|\.[\w./<>-]+|[A-Za-z][\w./-]*))*/g;
const EXTENSION = /\.(?:md|ya?ml|json|txt|sh)$/;

/**
 * A step hands work to a skill when it is told to use, run, or hand off to it.
 *
 * Skills name each other for other reasons — reporting a result back up, or
 * saying which skill will act on what this one wrote — and calling those
 * delegations would draw a call graph the workflow does not have. The window
 * stops at the previous sentence or code span, so only the clause that
 * introduces the name is read.
 */
const DELEGATES =
  /\b(?:use|uses|using|run|runs|running|apply|applying|invoke|invoking|hand(?:s|ed)?(?:\s+off)?\s+to)\b[^.`]*$/i;

const unique = (values: string[]) => [...new Set(values)];

const codeTokens = (body: string) => [...body.matchAll(INLINE_CODE)].map((match) => match[1]!.trim());

/**
 * True for a code token that names a file or directory.
 *
 * Anything with a space is prose or a shell command (`git diff <base>`), and a
 * bare identifier is a field name (`implementation_base_sha`) or a status word.
 */
function isArtifact(token: string): boolean {
  if (token.includes(' ') || token.startsWith('npx ') || token.startsWith('git ')) return false;
  return EXTENSION.test(token) || token.includes('/');
}

/** Files that live inside a feature plan package, wherever it is configured. */
const PLAN_FILES = new Set(['plan.yml', 'requirements.md', 'specification.md']);

/**
 * Turns a path as a skill writes it into a repository path.
 *
 * Skills name plan files two ways: the full `<plans>/<feature-slug>/…` form and
 * the bare `requirements.md`. Both resolve against the configured plans
 * directory, so a rule scoped to `.docs/changes/**` can be matched against them.
 */
export function resolveArtifact(token: string, plansDir: string): string {
  const path = token
    .replace(/^<plans>/, plansDir)
    .replaceAll('<feature-slug>', FEATURE)
    .replace(/^\.\//, '');
  if (PLAN_FILES.has(path) || path.startsWith('tickets/')) {
    return `${plansDir}/${FEATURE}/${path}`;
  }
  return path;
}

/** A directory stands for the files inside it when matched against a glob. */
const forMatching = (path: string) => (path.endsWith('/') ? `${path}*` : path);

interface SkillContext {
  name: string;
  /** This skill's own role, which changes how it names another skill. */
  role: SkillRole;
  plansDir: string;
  /** Every installed skill's role, for telling a delegation from a citation. */
  roles: Map<string, SkillRole>;
  rules: RuleEntry[];
  /** Rules already in force skill-wide, which a step does not repeat. */
  covered: Set<string>;
}

/** The installed skills a step names, split by how it names them. */
function namedSkills(body: string, context: SkillContext) {
  const calls: string[] = [];
  const reads: string[] = [];
  const names: string[] = [];

  for (const match of body.matchAll(INLINE_CODE)) {
    const token = match[1]!.trim();
    const role = context.roles.get(token);
    if (!role || token === context.name) continue;
    if (role === 'reference') {
      reads.push(token);
      continue;
    }
    // A router names concern skills in a table, where the verb that would mark
    // a delegation lives in a column header rows away. Routing to a concern is
    // a delegation by definition, so the table needs no verb to prove it.
    const routed = context.role === 'router' && role === 'ticket';
    (routed || DELEGATES.test(body.slice(0, match.index)) ? calls : names).push(token);
  }

  const called = new Set(calls);
  return {
    calls: unique(calls),
    reads: unique(reads),
    names: unique(names.filter((name) => !called.has(name))),
  };
}

function readStep(section: Section, context: SkillContext): Step {
  const { body } = section;
  const artifacts = unique(codeTokens(body).filter(isArtifact)).map((token) =>
    resolveArtifact(token, context.plansDir),
  );

  return {
    number: section.number!,
    title: section.title,
    doneWhen: doneWhen(body),
    ...namedSkills(body, context),
    commands: unique([...body.matchAll(COMMAND)].map((match) => match[0]!.trim())),
    artifacts,
    documents: unique(
      [...body.matchAll(LINK)].map((match) => match[1]!).filter((href) => !/^[a-z]+:/i.test(href)),
    ),
    rules: pathRules(artifacts, context),
    body,
  };
}

const describe = (rule: RuleEntry) => ({
  file: rule.file,
  description: rule.description,
  pack: rule.pack,
  paths: rule.paths,
});

/** Rules the step brings into force by touching a file inside their scope. */
function pathRules(artifacts: string[], context: SkillContext): AppliedRule[] {
  const applied: AppliedRule[] = [];
  for (const rule of context.rules) {
    if (rule.paths.length === 0 || context.covered.has(rule.file)) continue;
    for (const artifact of artifacts) {
      const pattern = firstMatch(forMatching(artifact), rule.paths);
      if (pattern === null) continue;
      applied.push({ ...describe(rule), reason: 'path', match: artifact, pattern });
      break;
    }
  }
  return applied;
}

/**
 * Rules in force for a whole skill: those with no path scope, and those that
 * point at the skill themselves — a pack's rule links to the recipe that
 * satisfies it, which is what ties an endpoint rule to the endpoint skill.
 */
function skillRules(
  name: string,
  rules: RuleEntry[],
  pointedAt: Map<string, Set<string>>,
): AppliedRule[] {
  const applied: AppliedRule[] = [];
  for (const rule of rules) {
    if (rule.paths.length === 0) {
      applied.push({ ...describe(rule), reason: 'always', match: null, pattern: null });
      continue;
    }
    if (pointedAt.get(rule.file)?.has(name)) {
      applied.push({ ...describe(rule), reason: 'skill', match: null, pattern: null });
    }
  }
  return applied;
}

/** For each rule, the skills its body links to as the recipe that satisfies it. */
function skillsPointedAt(rules: RuleEntry[], skills: SkillEntry[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const rule of rules) {
    const text = readPackFile(rule, rule.path) ?? '';
    const named = skills.filter((skill) => text.includes(`skills/${skill.name}/SKILL.md`));
    map.set(rule.file, new Set(named.map((skill) => skill.name)));
  }
  return map;
}

export interface StepMapOptions {
  /** The configured plans directory, used to resolve plan artifacts. */
  plansDir: string;
}

export function readSkillMap(
  skill: SkillEntry,
  packs: PackSet,
  options: StepMapOptions,
  pointedAt = skillsPointedAt(packs.rules, packs.skills),
): SkillMap {
  const text = readPackFile(skill, join(skill.dir, 'SKILL.md')) ?? '';
  const front = readFrontMatter(text);
  const { heading, preamble, sections } = split(front ? front.body : text);

  let steps = sequence(sections);
  let intro = preamble;
  if (steps.length === 0) {
    const list = orderedList(preamble);
    steps = list.steps;
    intro = list.before;
  }

  const rules = skillRules(skill.name, packs.rules, pointedAt);
  const context: SkillContext = {
    name: skill.name,
    role: skill.role,
    plansDir: options.plansDir,
    roles: new Map(packs.skills.map((entry) => [entry.name, entry.role])),
    rules: packs.rules,
    covered: new Set(rules.map((rule) => rule.file)),
  };

  return {
    name: skill.name,
    role: skill.role,
    pack: skill.pack,
    description: skill.description,
    heading: heading || skill.name,
    preamble: intro,
    steps: steps.map((section) => readStep(section, context)),
    topics: sections
      .filter((section) => section.number === null && section.level === 2)
      .map((section) => section.title),
    rules,
    companions: listFiles(skill.dir).filter((file) => file !== 'SKILL.md'),
  };
}

/**
 * Workflow order: each coordinator, then the skills it hands work to in the
 * order it names them, then whatever is left, by role. A reader going down the
 * list follows the delegation itself.
 */
function inWorkflowOrder(maps: SkillMap[]): SkillMap[] {
  const byName = new Map(maps.map((map) => [map.name, map]));
  const ordered: SkillMap[] = [];
  const seen = new Set<string>();

  const take = (map: SkillMap | undefined) => {
    if (!map || seen.has(map.name)) return;
    seen.add(map.name);
    ordered.push(map);
    for (const step of map.steps) for (const next of step.calls) take(byName.get(next));
  };

  const roles: SkillRole[] = ['coordinator', 'stage', 'router', 'ticket', 'review', 'reference'];
  for (const role of roles) for (const map of maps.filter((map) => map.role === role)) take(map);
  return ordered;
}

/** Every rule, with the skills and steps it governs. */
function coverage(rules: RuleEntry[], skills: SkillMap[]): RuleCoverage[] {
  return rules.map((rule) => {
    const sites: RuleSite[] = [];
    for (const skill of skills) {
      for (const applied of skill.rules) {
        if (applied.file !== rule.file) continue;
        sites.push({
          skill: skill.name,
          step: null,
          stepTitle: null,
          reason: applied.reason,
          match: applied.match,
        });
      }
      for (const step of skill.steps) {
        for (const applied of step.rules) {
          if (applied.file !== rule.file) continue;
          sites.push({
            skill: skill.name,
            step: step.number,
            stepTitle: step.title,
            reason: applied.reason,
            match: applied.match,
          });
        }
      }
    }
    return { file: rule.file, description: rule.description, pack: rule.pack, paths: rule.paths, sites };
  });
}

export function buildStepMap(packs: PackSet, options: StepMapOptions): StepMap {
  const pointedAt = skillsPointedAt(packs.rules, packs.skills);
  const skills = inWorkflowOrder(
    [...packs.skills]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((skill) => readSkillMap(skill, packs, options, pointedAt)),
  );
  return { skills, rules: coverage(packs.rules, skills) };
}

/** Every rule in force at a step: the skill's own, plus the step's. */
export const rulesAtStep = (skill: SkillMap, step: Step): AppliedRule[] => [
  ...skill.rules,
  ...step.rules,
];
