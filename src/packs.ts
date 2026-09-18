import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exists, listDirs, readTextOrNull } from './util/fs.js';
import { CliError } from './util/log.js';
import { asDict, asString, asStringList, readFrontMatter } from './util/yaml.js';

const here = dirname(fileURLToPath(import.meta.url));

/** The bundled assets directory, whether running from dist/ or src/. */
export const assetsDir = (() => {
  for (const candidate of [join(here, '..', 'assets'), join(here, '..', '..', 'assets')]) {
    if (exists(candidate)) return resolve(candidate);
  }
  throw new CliError('collab-swarm assets are missing from the installed package.');
})();

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
}

export interface PackCheck {
  name: string;
  run: string;
  focus?: string;
  ci?: string;
  when?: string;
}

export interface Pack {
  name: string;
  title: string;
  description: string;
  /** Absolute path of the pack root. */
  dir: string;
  /** npm specifier or repository-relative path this pack was resolved from. */
  spec: string;
  skills: SkillEntry[];
  rules: RuleEntry[];
  /** Checks a project is offered when the pack is added. */
  checks: PackCheck[];
  /** True for the pack shipped inside collab-swarm itself. */
  core: boolean;
}

const filesIn = (dir: string): string[] =>
  exists(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort()
    : [];

function readSkill(dir: string, name: string, pack: string, role: SkillRole): SkillEntry | null {
  const text = readTextOrNull(join(dir, 'SKILL.md'));
  if (text === null) return null;
  const front = readFrontMatter(text);
  return { name, role, description: asString(front?.data.description) ?? '', dir, pack };
}

function readRule(path: string, file: string, pack: string): RuleEntry | null {
  const text = readTextOrNull(path);
  if (text === null) return null;
  const front = readFrontMatter(text);
  return {
    file,
    path,
    paths: asStringList(front?.data.paths),
    description: asString(front?.data.description) ?? '',
    pack,
  };
}

function readChecks(raw: unknown): PackCheck[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => asDict(item))
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((item) => ({
      name: asString(item.name) ?? 'check',
      run: asString(item.run) ?? '',
      ...(asString(item.focus) ? { focus: asString(item.focus)! } : {}),
      ...(asString(item.ci) ? { ci: asString(item.ci)! } : {}),
      ...(asString(item.when) ? { when: asString(item.when)! } : {}),
    }))
    .filter((check) => check.run !== '');
}

export function loadPack(dir: string, spec: string, core = false): Pack {
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
  const roles = new Map<string, SkillRole>();
  for (const item of Array.isArray(manifest.skills) ? manifest.skills : []) {
    const entry = asDict(item);
    const skillName = entry && asString(entry.name);
    if (!entry || !skillName) continue;
    const role = asString(entry.role) as SkillRole | null;
    roles.set(skillName, role && SKILL_ROLES.includes(role) ? role : 'ticket');
  }

  const skillsRoot = join(dir, 'skills');
  const skills = listDirs(skillsRoot)
    .map((skill) => readSkill(join(skillsRoot, skill), skill, name, roles.get(skill) ?? 'ticket'))
    .filter((skill): skill is SkillEntry => skill !== null);

  const rulesRoot = join(dir, 'rules');
  const rules = filesIn(rulesRoot)
    .filter((file) => file.endsWith('.md'))
    .map((file) => readRule(join(rulesRoot, file), file, name))
    .filter((rule): rule is RuleEntry => rule !== null);

  return {
    name,
    title: asString(manifest.title) ?? name,
    description: asString(manifest.description) ?? '',
    dir,
    spec,
    skills,
    rules,
    checks: readChecks(manifest.checks),
    core,
  };
}

/** The pack shipped inside collab-swarm. Always present. */
export const corePack = (): Pack => loadPack(assetsDir, 'collab-swarm', true);

/**
 * Resolves a pack spec: a path relative to the repository root, an absolute
 * path, or an installed npm package whose root or `collab-swarm` subpath holds
 * the manifest.
 */
export function resolvePack(spec: string, root: string): Pack {
  const asPath = isAbsolute(spec) ? spec : join(root, spec);
  if (exists(join(asPath, MANIFEST_FILE))) return loadPack(asPath, spec);

  const nodeRequire = createRequire(join(root, 'noop.js'));
  for (const attempt of [`${spec}/${MANIFEST_FILE}`, `${spec}/package.json`]) {
    try {
      const resolved = dirname(nodeRequire.resolve(attempt));
      if (exists(join(resolved, MANIFEST_FILE))) return loadPack(resolved, spec);
    } catch {
      /* try the next shape */
    }
  }
  throw new CliError(
    `Cannot find the skill pack "${spec}".`,
    1,
    `Install it (npm install -D ${spec}) or point at a directory in this repository.`,
  );
}

export interface PackSet {
  packs: Pack[];
  skills: SkillEntry[];
  rules: RuleEntry[];
}

/** The core pack plus every pack the config attaches; a later pack wins a name clash. */
export function loadPacks(root: string, specs: string[]): PackSet {
  const packs = [corePack(), ...specs.map((spec) => resolvePack(spec, root))];
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
