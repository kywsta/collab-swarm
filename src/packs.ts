import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  matches,
  optionVars,
  readOptions,
  readPackages,
  renderText,
  resolveSelections,
  selectedPackages,
  type OptionPackage,
  type OptionVars,
  type PackOption,
  type Selections,
} from './options.js';
import { exists, listDirs, readTextOrNull } from './util/fs.js';
import { CliError } from './util/log.js';
import { asDict, asString, asStringList, isSlug, readFrontMatter } from './util/yaml.js';

const here = dirname(fileURLToPath(import.meta.url));

/** The bundled assets directory, whether running from dist/ or src/. */
export const assetsDir = (() => {
  for (const candidate of [join(here, '..', 'assets'), join(here, '..', '..', 'assets')]) {
    if (exists(candidate)) return resolve(candidate);
  }
  throw new CliError('collab-swarm assets are missing from the installed package.');
})();

/** Default packs shipped inside collab-swarm, added by their bare name. */
export const bundledDir = join(assetsDir, 'packs');

export const MANIFEST_FILE = 'collab-swarm-pack.json';

/**
 * How a skill may be reached.
 *
 * - `coordinator` owns a feature end to end;
 * - `stage` runs one stage of the workflow;
 * - `router` reads a ticket and selects the concern skills its slice needs;
 * - `ticket` implements a concern and may be listed in a ticket's `skills`;
 * - `review` reviews one surface a pack owns, during feature review;
 * - `reference` is consulted for vocabulary and never scheduled.
 *
 * Only `ticket` may appear in a ticket's `skills`. A router is reached by
 * `implement`, a review skill by `deliver-change`, and a reference skill by
 * being read — so a plan that schedules one of them is a mistake the
 * validator catches.
 */
export type SkillRole = 'coordinator' | 'stage' | 'router' | 'ticket' | 'review' | 'reference';
export const SKILL_ROLES: SkillRole[] = [
  'coordinator',
  'stage',
  'router',
  'ticket',
  'review',
  'reference',
];

/** How a role is named to a human, in `packs` and `steps`. */
export const ROLE_LABEL: Record<SkillRole, string> = {
  coordinator: 'coordinates a feature',
  stage: 'runs one stage',
  router: 'routes a ticket to its concerns',
  ticket: 'implements a ticket',
  review: 'reviews one surface',
  reference: 'consulted, never scheduled',
};

export interface SkillEntry {
  name: string;
  role: SkillRole;
  description: string;
  /** Absolute path of the skill's directory. */
  dir: string;
  /** Name of the pack the skill came from. */
  pack: string;
  /** The pack's resolved option answers, applied when its files are read. */
  selections: Selections;
  vars: OptionVars;
}

export interface RuleEntry {
  /** File name, such as `api-integration.md`. */
  file: string;
  /** Absolute source path. */
  path: string;
  /** Globs that scope the rule; empty means always applicable. */
  paths: string[];
  description: string;
  pack: string;
  selections: Selections;
  vars: OptionVars;
}

export interface PackCheck {
  name: string;
  run: string;
  focus?: string;
  ci?: string;
  when?: string;
}

/** What a pack says about the stack it implements, for the always-loaded block. */
export interface PackStack {
  /** One paragraph: the architecture in a sentence. */
  summary: string;
  /** The project layout, as the lines of a tree. */
  layout: string[];
  /** Conventions that are true everywhere, not scoped to one concern. */
  conventions: string[];
  /** Libraries the stack is built on, including those a choice brought in. */
  packages: OptionPackage[];
}

export interface Pack {
  name: string;
  title: string;
  description: string;
  /** Absolute path of the pack root. */
  dir: string;
  /** npm specifier, bundled name, or repository-relative path this pack came from. */
  spec: string;
  skills: SkillEntry[];
  rules: RuleEntry[];
  /** Checks a project is offered when the pack is added. */
  checks: PackCheck[];
  /**
   * Files whose presence in a repository suggests this pack.
   *
   * Only a suggestion: `init` puts the matching default pack first in the list
   * it offers, and never attaches one the project did not choose.
   */
  detect: string[];
  /** Questions the pack asks before it is installed. */
  options: PackOption[];
  /** The answer to each, recorded or defaulted. */
  selections: Selections;
  /** Those answers flattened into the variables its files interpolate. */
  vars: OptionVars;
  /** The stack it documents, or null when it documents none. */
  stack: PackStack | null;
  /** True for the pack shipped inside collab-swarm itself. */
  core: boolean;
  /** True for a default pack bundled with collab-swarm. */
  bundled: boolean;
}

const filesIn = (dir: string): string[] =>
  exists(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort()
    : [];

/**
 * Reads a file belonging to a pack, resolved against that pack's answers.
 *
 * Every read of a skill or rule body goes through here — publishing, the
 * execution map, the validator — so what an agent sees on disk is what every
 * command reports.
 */
export function readPackFile(
  owner: { selections: Selections; vars: OptionVars },
  path: string,
): string | null {
  const text = readTextOrNull(path);
  return text === null ? null : renderText(text, owner.selections, owner.vars);
}

function readSkill(
  dir: string,
  name: string,
  pack: Pick<Pack, 'name' | 'selections' | 'vars'>,
  role: SkillRole,
): SkillEntry | null {
  const text = readPackFile(pack, join(dir, 'SKILL.md'));
  if (text === null) return null;
  const front = readFrontMatter(text);
  return {
    name,
    role,
    description: asString(front?.data.description) ?? '',
    dir,
    pack: pack.name,
    selections: pack.selections,
    vars: pack.vars,
  };
}

function readRule(
  path: string,
  file: string,
  pack: Pick<Pack, 'name' | 'selections' | 'vars'>,
): RuleEntry | null {
  const text = readPackFile(pack, path);
  if (text === null) return null;
  const front = readFrontMatter(text);
  // A rule may gate itself: the persistence rule is noise in a project that
  // chose no local database.
  if (!matches(asString(front?.data.if) ?? undefined, pack.selections)) return null;
  return {
    file,
    path,
    paths: asStringList(front?.data.paths),
    description: asString(front?.data.description) ?? '',
    pack: pack.name,
    selections: pack.selections,
    vars: pack.vars,
  };
}

function readChecks(raw: unknown, selections: Selections): PackCheck[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => asDict(item))
    .filter((item): item is Record<string, unknown> => item !== null)
    .filter((item) => matches(asString(item.if) ?? undefined, selections))
    .map((item) => ({
      name: asString(item.name) ?? 'check',
      run: asString(item.run) ?? '',
      ...(asString(item.focus) ? { focus: asString(item.focus)! } : {}),
      ...(asString(item.ci) ? { ci: asString(item.ci)! } : {}),
      ...(asString(item.when) ? { when: asString(item.when)! } : {}),
    }))
    .filter((check) => check.run !== '');
}

function readStack(raw: unknown, selections: Selections, options: PackOption[]): PackStack | null {
  const dict = asDict(raw);
  if (!dict) return null;
  const declared = readPackages(dict.packages).filter((pkg) => matches(pkg.if, selections));
  // Two choices may need the same package — Crashlytics and FCM both need
  // `firebase_core` — and the stack table is a shopping list, not a tally.
  const packages = new Map<string, OptionPackage>();
  for (const pkg of [...declared, ...selectedPackages(options, selections)]) {
    if (!packages.has(pkg.name)) packages.set(pkg.name, pkg);
  }
  return {
    summary: asString(dict.summary) ?? '',
    layout: asStringList(dict.layout),
    conventions: asStringList(dict.conventions),
    packages: [...packages.values()],
  };
}

export function loadPack(
  dir: string,
  spec: string,
  options: { core?: boolean; bundled?: boolean; selections?: Selections } = {},
): Pack {
  const manifestPath = join(dir, MANIFEST_FILE);
  if (!exists(manifestPath)) {
    throw new CliError(
      `${spec} is not a collab-swarm pack: no ${MANIFEST_FILE} in ${dir}.`,
      1,
      'A pack is a directory with a manifest, a skills/ folder, and optional rules/.',
    );
  }

  let manifest: Record<string, unknown> | null;
  try {
    manifest = asDict(JSON.parse(readTextOrNull(manifestPath) ?? 'null'));
  } catch (error) {
    throw new CliError(`${manifestPath} is not valid JSON: ${(error as Error).message}`);
  }
  if (!manifest) throw new CliError(`${manifestPath} must contain a JSON object.`);

  const name = asString(manifest.name) ?? 'unnamed';
  const declaredOptions = readOptions(manifest.options);
  const selections = resolveSelections(declaredOptions, options.selections ?? {});
  const vars = optionVars(declaredOptions, selections);
  const owner = { name, selections, vars };

  const roles = new Map<string, SkillRole>();
  // A skill an answer ruled out is not installed at all: an uninstalled skill
  // cannot be routed to, named by a ticket, or read by mistake. A skill the
  // manifest never mentions is still a ticket skill, as it always was.
  const ruledOut = new Set<string>();
  for (const item of Array.isArray(manifest.skills) ? manifest.skills : []) {
    const entry = asDict(item);
    const skillName = entry && asString(entry.name);
    if (!entry || !skillName) continue;
    if (!matches(asString(entry.if) ?? undefined, selections)) {
      ruledOut.add(skillName);
      continue;
    }
    const role = asString(entry.role) as SkillRole | null;
    roles.set(skillName, role && SKILL_ROLES.includes(role) ? role : 'ticket');
  }

  const skillsRoot = join(dir, 'skills');
  const skills = listDirs(skillsRoot)
    .filter((skill) => !ruledOut.has(skill))
    .map((skill) => readSkill(join(skillsRoot, skill), skill, owner, roles.get(skill) ?? 'ticket'))
    .filter((skill): skill is SkillEntry => skill !== null);

  const rulesRoot = join(dir, 'rules');
  const rules = filesIn(rulesRoot)
    .filter((file) => file.endsWith('.md'))
    .map((file) => readRule(join(rulesRoot, file), file, owner))
    .filter((rule): rule is RuleEntry => rule !== null);

  return {
    name,
    title: asString(manifest.title) ?? name,
    description: asString(manifest.description) ?? '',
    dir,
    spec,
    skills,
    rules,
    checks: readChecks(manifest.checks, selections),
    detect: asStringList(manifest.detect),
    options: declaredOptions,
    selections,
    vars,
    stack: readStack(manifest.stack, selections, declaredOptions),
    core: options.core === true,
    bundled: options.bundled === true,
  };
}

/** The pack shipped inside collab-swarm. Always present. */
export const corePack = (): Pack => loadPack(assetsDir, 'collab-swarm', { core: true });

/** Default packs shipped with collab-swarm, in name order. */
export const bundledPackNames = (): string[] =>
  listDirs(bundledDir).filter((name) => exists(join(bundledDir, name, MANIFEST_FILE)));

/** Every default pack, loaded with its defaults, for listing and detection. */
export const bundledPacks = (): Pack[] =>
  bundledPackNames().map((name) => loadPack(join(bundledDir, name), name, { bundled: true }));

/**
 * Finds the directory a pack spec names: the bare name of a bundled default
 * pack, a path relative to the repository root, an absolute path, or an
 * installed npm package whose root or `collab-swarm` subpath holds the
 * manifest.
 */
export function locatePack(spec: string, root: string): { dir: string; bundled: boolean } {
  if (isSlug(spec) && exists(join(bundledDir, spec, MANIFEST_FILE))) {
    return { dir: join(bundledDir, spec), bundled: true };
  }

  const asPath = isAbsolute(spec) ? spec : join(root, spec);
  if (exists(join(asPath, MANIFEST_FILE))) return { dir: asPath, bundled: false };

  const nodeRequire = createRequire(join(root, 'noop.js'));
  for (const attempt of [`${spec}/${MANIFEST_FILE}`, `${spec}/package.json`]) {
    try {
      const resolved = dirname(nodeRequire.resolve(attempt));
      if (exists(join(resolved, MANIFEST_FILE))) return { dir: resolved, bundled: false };
    } catch {
      /* try the next shape */
    }
  }
  const available = bundledPackNames();
  throw new CliError(
    `Cannot find the skill pack "${spec}".`,
    1,
    available.length > 0
      ? `Default packs: ${available.join(', ')}. Otherwise install it (npm install -D ${spec}) or point at a directory in this repository.`
      : `Install it (npm install -D ${spec}) or point at a directory in this repository.`,
  );
}

/** The name a pack declares, read without loading its skills. */
export function packName(dir: string): string {
  try {
    return asString(asDict(JSON.parse(readTextOrNull(join(dir, MANIFEST_FILE)) ?? 'null'))?.name) ?? 'unnamed';
  } catch {
    return 'unnamed';
  }
}

/** Loads the pack a spec names, with the answers a project recorded for it. */
export function resolvePack(spec: string, root: string, selections: Selections = {}): Pack {
  const { dir, bundled } = locatePack(spec, root);
  return loadPack(dir, spec, { bundled, selections });
}

export interface PackSet {
  packs: Pack[];
  skills: SkillEntry[];
  rules: RuleEntry[];
}

/** The core pack plus every pack the config attaches; a later pack wins a name clash. */
export function loadPacks(
  root: string,
  specs: string[],
  packOptions: Record<string, Selections> = {},
): PackSet {
  const packs = [corePack()];
  for (const spec of specs) {
    // Answers are recorded under the pack's own name, so moving a pack from a
    // path to a published package keeps them.
    const { dir, bundled } = locatePack(spec, root);
    packs.push(loadPack(dir, spec, { bundled, selections: packOptions[packName(dir)] ?? {} }));
  }

  const skills = new Map<string, SkillEntry>();
  const rules = new Map<string, RuleEntry>();
  for (const pack of packs) {
    for (const skill of pack.skills) skills.set(skill.name, skill);
    for (const rule of pack.rules) rules.set(rule.file, rule);
  }
  return { packs, skills: [...skills.values()], rules: [...rules.values()] };
}

export const skillNames = (set: PackSet) => set.skills.map((skill) => skill.name).sort();

/** Skills a ticket's `skills` list may name. */
export const ticketSkills = (set: PackSet) =>
  set.skills
    .filter((skill) => skill.role === 'ticket')
    .map((skill) => skill.name)
    .sort();
