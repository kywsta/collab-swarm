/**
 * Everything the agents of this repository are given, from every source.
 *
 * The core workflow, then for this repository and each one it coordinates:
 * the packs its rules start from, if any, and the rule set researched for it.
 * A rule set's rule or skill replaces its own baseline pack's of the same name
 * — that is what building on a baseline means. Any other clash is reported
 * rather than settled by load order, because whichever copy lost would vanish
 * from every agent without anyone deciding it should.
 */

import { join } from 'node:path';
import type { Config } from './config.js';
import {
  MANIFEST_FILE,
  corePack,
  loadPack,
  locatePack,
  packName,
  type Pack,
  type PackSet,
  type RuleEntry,
  type SkillEntry,
} from './packs.js';
import {
  ROOT_SCOPE,
  loadRuleSet,
  scopeRule,
  scopes,
  type RuleSet,
  type Scope,
} from './core/rulesets.js';
import { describeStack } from './targets/memory.js';

export interface Workspace extends PackSet {
  ruleSets: RuleSet[];
  /** This repository's own stack profile, for the always-loaded block. */
  profile: string | null;
  /** Two sources publishing the same skill or rule, neither one a baseline the other builds on. */
  conflicts: string[];
}

function loadScopedPack(root: string, spec: string, scope: Scope): Pack {
  const { dir, bundled } = locatePack(spec, root);
  const pack = loadPack(dir, spec, { bundled, selections: scope.packOptions[packName(dir)] ?? {} });
  if (scope.name === ROOT_SCOPE) return pack;
  return { ...pack, repository: scope.name, rules: pack.rules.map((rule) => scopeRule(rule, scope)) };
}

/** A coordinated repository's stack, published as a rule that loads only for its files. */
function stackRule(set: RuleSet, packs: Pack[]): RuleEntry | null {
  const { scope } = set;
  const baselines = packs.filter((pack) => pack.stack !== null);
  if (set.stack === null && baselines.length === 0) return null;
  const lines = [`# The ${scope.name} stack`, '', `\`${scope.path}\` is its own repository. What it is built with, and what holds everywhere in it.`, ''];
  if (set.stack !== null) lines.push(set.stack.body, '');
  for (const pack of baselines) lines.push(`## Baseline: ${pack.title}`, '', ...describeStack(pack));
  return scopeRule(
    {
      file: 'stack.md',
      path: set.stack?.path ?? join(baselines[0]!.dir, MANIFEST_FILE),
      paths: [],
      description:
        set.stack?.description ||
        `What ${scope.name} is built with and the conventions that hold everywhere in it`,
      pack: `rules:${scope.name}`,
      selections: {},
      vars: {},
      content: `${lines.join('\n').trimEnd()}\n`,
    },
    scope,
  );
}

const sameSkill = (a: SkillEntry, b: SkillEntry) =>
  a.dir === b.dir && JSON.stringify(a.selections) === JSON.stringify(b.selections);

export function loadWorkspace(root: string, config: Config): Workspace {
  const conflicts: string[] = [];
  const skills = new Map<string, SkillEntry>();
  const rules = new Map<string, RuleEntry>();
  const allPacks: Pack[] = [corePack()];
  const ruleSets: RuleSet[] = [];
  let profile: string | null = null;

  // Skills share one namespace, so a pack attached to two repositories
  // publishes its skills once. Replacing one is then only safe when no other
  // repository relies on it.
  const users = new Map<string, Set<string>>();
  const addSkill = (skill: SkillEntry, baseline: Set<string>, scope: string) => {
    const current = skills.get(skill.name);
    const using = users.get(skill.name) ?? new Set<string>();
    if (current && sameSkill(current, skill)) {
      using.add(scope);
      users.set(skill.name, using);
      return;
    }
    const replaceable =
      current === undefined ||
      current.pack === corePackName ||
      (baseline.has(current.pack) && [...using].every((name) => name === scope));
    if (!replaceable) {
      conflicts.push(`skill "${skill.name}" comes from both ${current!.pack} and ${skill.pack}; rename one`);
      return;
    }
    skills.set(skill.name, skill);
    users.set(skill.name, new Set([scope]));
  };
  const addRule = (rule: RuleEntry, baseline: Set<string>) => {
    const current = rules.get(rule.file);
    if (current && current.path !== rule.path && !baseline.has(current.pack)) {
      conflicts.push(`rule "${rule.file}" comes from both ${current.pack} and ${rule.pack}; rename one`);
      return;
    }
    rules.set(rule.file, rule);
  };

  // The core's names are the workflow's own; a pack may still replace one, as
  // it always could, so the core counts as a baseline for every scope.
  const corePackName = allPacks[0]!.name;
  for (const skill of allPacks[0]!.skills) skills.set(skill.name, skill);
  for (const rule of allPacks[0]!.rules) rules.set(rule.file, rule);
  const core = new Set([corePackName]);

  for (const scope of scopes(config)) {
    const packs = scope.packs.map((spec) => loadScopedPack(root, spec, scope));
    allPacks.push(...packs);
    const baseline = new Set([...core]);
    for (const pack of packs) {
      for (const skill of pack.skills) addSkill(skill, baseline, scope.name);
      for (const rule of pack.rules) addRule(rule, baseline);
      baseline.add(pack.name);
    }

    const set = loadRuleSet(root, scope);
    ruleSets.push(set);
    for (const skill of set.skills) addSkill(skill, baseline, scope.name);
    for (const rule of set.rules) addRule(scopeRule(rule, scope), baseline);

    if (scope.name === ROOT_SCOPE) {
      profile = set.stack?.body ?? null;
    } else {
      const stack = stackRule(set, packs);
      if (stack) addRule(stack, baseline);
    }
  }

  return {
    packs: allPacks,
    skills: [...skills.values()],
    rules: [...rules.values()],
    ruleSets,
    profile,
    conflicts,
  };
}
