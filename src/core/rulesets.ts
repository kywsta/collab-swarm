/**
 * Rule sets: the rules each repository is built by, kept in this one.
 *
 * A rule set is researched from the repository it governs — its language,
 * framework, tools and libraries, the conventions its code already holds, and
 * best practice for the versions it uses — and lives at
 * `.collab-swarm/rules/<name>/`, where `<name>` is a repository under
 * `repositories:` or `root` for this repository itself. Keeping every rule set
 * here is what makes the hub the one place the team's knowledge lives.
 *
 * A pack, where one exists for the stack, is the baseline a rule set starts
 * from; a rule in the set with the same file name replaces the pack's. Paths
 * inside a rule set are relative to the repository it governs, and are scoped
 * to it when published, so a session started here loads a repository's rules
 * only for that repository's files.
 *
 * `research.json` records what the repository depended on when the set was
 * last researched. Comparing it with the repository now is what says, without
 * an agent's judgement, that the set has fallen behind.
 */

import { join } from 'node:path';
import type { Config } from '../config.js';
import type { Selections } from '../options.js';
import type { RuleEntry, SkillEntry, SkillRole } from '../packs.js';
import { SKILL_ROLES, bundledPacks } from '../packs.js';
import { exists, listDirs, listFiles, readTextOrNull, writeText } from '../util/fs.js';
import { matchesGlob } from '../util/glob.js';
import { asDict, asString, asStringList, parseYaml, readFrontMatter } from '../util/yaml.js';
import { Git } from './git.js';
import { Repository } from './repositories.js';

export const RULES_ROOT = '.collab-swarm/rules';
/** The rule set of this repository itself, as opposed to a coordinated one. */
export const ROOT_SCOPE = 'root';
export const STACK_FILE = 'STACK.md';
export const RESEARCH_FILE = 'research.json';

/** Who wrote a rule, so a later research pass knows which ones it may revise. */
export const RULE_ORIGINS = ['research', 'team'] as const;
export type RuleOrigin = (typeof RULE_ORIGINS)[number];

/** Where a rule set applies: this repository, or one it coordinates. */
export interface Scope {
  /** `root`, or the repository's name. */
  name: string;
  /** Directory relative to this repository's root; `''` for this repository. */
  path: string;
  packs: string[];
  packOptions: Record<string, Selections>;
}

export function scopes(config: Config): Scope[] {
  return [
    { name: ROOT_SCOPE, path: '', packs: config.packs, packOptions: config.packOptions },
    ...Object.values(config.repositories).map((repository) => ({
      name: repository.name,
      path: repository.path,
      packs: repository.packs,
      packOptions: repository.packOptions,
    })),
  ];
}

export const ruleSetDir = (root: string, name: string) => join(root, RULES_ROOT, name);

export interface Fingerprint {
  /** Dependency manifests found at the repository's root. */
  manifests: string[];
  /** `<ecosystem>:<package>` → the version it declares. */
  dependencies: Record<string, string>;
}

export interface ResearchRecord extends Fingerprint {
  recordedAt: string;
}

export interface RuleSet {
  scope: Scope;
  dir: string;
  exists: boolean;
  /** The repository's stack profile, when the set has one. */
  stack: { path: string; description: string; body: string } | null;
  /** Rules as written, with paths relative to the repository. */
  rules: (RuleEntry & { origin: string })[];
  skills: SkillEntry[];
  research: ResearchRecord | null;
}

const NO_ANSWERS = { selections: {}, vars: {} };

export function loadRuleSet(root: string, scope: Scope): RuleSet {
  const dir = ruleSetDir(root, scope.name);
  const owner = `rules:${scope.name}`;

  const stackText = readTextOrNull(join(dir, STACK_FILE));
  const stackFront = stackText === null ? null : readFrontMatter(stackText);
  const stack =
    stackText === null
      ? null
      : {
          path: join(dir, STACK_FILE),
          description: asString(stackFront?.data.description) ?? '',
          body: (stackFront ? stackFront.body : stackText).trim(),
        };

  const rulesDir = join(dir, 'rules');
  const rules = listFiles(rulesDir)
    .filter((file) => file.endsWith('.md') && !file.includes('/'))
    .map((file) => {
      const path = join(rulesDir, file);
      const front = readFrontMatter(readTextOrNull(path) ?? '');
      return {
        file,
        path,
        paths: asStringList(front?.data.paths),
        description: asString(front?.data.description) ?? '',
        origin: asString(front?.data.origin) ?? 'team',
        pack: owner,
        ...NO_ANSWERS,
      };
    });

  const skillsDir = join(dir, 'skills');
  const skills: SkillEntry[] = [];
  for (const name of listDirs(skillsDir)) {
    const text = readTextOrNull(join(skillsDir, name, 'SKILL.md'));
    if (text === null) continue;
    const front = readFrontMatter(text);
    const role = asString(front?.data.role) as SkillRole | null;
    skills.push({
      name,
      role: role && SKILL_ROLES.includes(role) ? role : 'ticket',
      description: asString(front?.data.description) ?? '',
      dir: join(skillsDir, name),
      pack: owner,
      ...NO_ANSWERS,
    });
  }

  return {
    scope,
    dir,
    exists: exists(dir),
    stack,
    rules,
    skills,
    research: readResearch(dir),
  };
}

/** A glob relative to a repository, made relative to this one. */
export const scopeGlob = (prefix: string, glob: string): string => {
  const clean = glob.replace(/^\.\//, '').replace(/^\/+/, '');
  return prefix === '' ? clean : `${prefix}/${clean}`;
};

/**
 * A rule as this repository publishes it. A coordinated repository's rule is
 * renamed after it, so two repositories may each keep an `error-handling.md`,
 * and its globs gain the repository's path. A rule with no globs applies to the
 * whole repository it belongs to — never to every file in the hub.
 */
export function scopeRule<T extends RuleEntry>(rule: T, scope: Scope): T {
  if (scope.path === '') return rule;
  return {
    ...rule,
    file: `${scope.name}-${rule.file}`,
    paths: rule.paths.length > 0 ? rule.paths.map((glob) => scopeGlob(scope.path, glob)) : [`${scope.path}/**`],
    repository: scope.name,
  };
}

// ---------------------------------------------------------------------------
// Fingerprint: what the repository depends on, read from its manifests
// ---------------------------------------------------------------------------

type Collect = (deps: Record<string, string>, text: string) => void;

const fromMaps = (ecosystem: string, maps: unknown[], deps: Record<string, string>) => {
  for (const map of maps) {
    const dict = asDict(map);
    if (!dict) continue;
    for (const [name, value] of Object.entries(dict)) {
      const spec =
        typeof value === 'string'
          ? value
          : typeof value === 'number'
            ? String(value)
            : (asString(asDict(value)?.version) ?? (asDict(value)?.sdk ? 'sdk' : asDict(value)?.path ? 'path' : 'git'));
      deps[`${ecosystem}:${name}`] = spec;
    }
  }
};

/** `[section]` blocks of a TOML file, as their `key = value` lines. */
function tomlSections(text: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current = '';
  for (const line of text.split('\n')) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header) {
      current = header[1]!.trim();
      continue;
    }
    if (!sections.has(current)) sections.set(current, []);
    sections.get(current)!.push(line);
  }
  return sections;
}

const tomlTable = (lines: string[], ecosystem: string, deps: Record<string, string>) => {
  for (const line of lines) {
    const match = /^\s*([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line);
    if (!match) continue;
    const value = match[2]!.trim();
    const version = /^"([^"]*)"/.exec(value)?.[1] ?? /version\s*=\s*"([^"]*)"/.exec(value)?.[1] ?? 'path';
    deps[`${ecosystem}:${match[1]}`] = version;
  }
};

/**
 * The body of a TOML array, up to its closing bracket. Found by walking it,
 * since a requirement such as `pydantic[email]` carries brackets of its own.
 */
function tomlArray(text: string, key: string): string {
  const start = new RegExp(`^\\s*${key}\\s*=\\s*\\[`, 'm').exec(text);
  if (!start) return '';
  let quote: string | null = null;
  for (let index = start.index + start[0].length; index < text.length; index++) {
    const char = text[index]!;
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ']') {
      return text.slice(start.index + start[0].length, index);
    }
  }
  return '';
}

/** `name>=1.2` → [`name`, `>=1.2`], for requirement strings. */
const splitRequirement = (requirement: string): [string, string] => {
  const match = /^\s*([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?\s*(.*)$/.exec(requirement.split(';')[0] ?? '');
  return match ? [match[1]!, match[2]!.trim() || '*'] : [requirement.trim(), '*'];
};

const MANIFESTS: Record<string, Collect> = {
  'package.json': (deps, text) => {
    const json = JSON.parse(text);
    fromMaps('npm', [json.dependencies, json.devDependencies], deps);
  },
  'composer.json': (deps, text) => {
    const json = JSON.parse(text);
    fromMaps('composer', [json.require, json['require-dev']], deps);
  },
  'pubspec.yaml': (deps, text) => {
    const yaml = asDict(parseYaml(text)) ?? {};
    fromMaps('pub', [yaml.dependencies, yaml.dev_dependencies], deps);
  },
  'go.mod': (deps, text) => {
    const go = /^go\s+(\S+)/m.exec(text)?.[1];
    if (go) deps['go:go'] = go;
    for (const match of text.matchAll(/^\s*(?:require\s+)?([a-z0-9.-]+\.[a-z]+\/\S+)\s+(v\S+)/gm)) {
      deps[`go:${match[1]}`] = match[2]!;
    }
  },
  'Cargo.toml': (deps, text) => {
    const sections = tomlSections(text);
    for (const name of ['dependencies', 'dev-dependencies']) tomlTable(sections.get(name) ?? [], 'cargo', deps);
  },
  'pyproject.toml': (deps, text) => {
    const sections = tomlSections(text);
    const project = (sections.get('project') ?? []).join('\n');
    for (const match of tomlArray(project, 'dependencies').matchAll(/["']([^"']+)["']/g)) {
      const [name, spec] = splitRequirement(match[1]!);
      deps[`pypi:${name}`] = spec;
    }
    tomlTable(sections.get('tool.poetry.dependencies') ?? [], 'pypi', deps);
  },
  'requirements.txt': (deps, text) => {
    for (const line of text.split('\n')) {
      const clean = line.replace(/#.*/, '').trim();
      if (clean === '' || clean.startsWith('-')) continue;
      const [name, spec] = splitRequirement(clean);
      deps[`pypi:${name}`] = spec;
    }
  },
  Gemfile: (deps, text) => {
    for (const match of text.matchAll(/^\s*gem\s+["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?/gm)) {
      deps[`gem:${match[1]}`] = match[2] ?? '*';
    }
  },
};

/** What a repository depends on right now, from the manifests at its root. */
export function fingerprint(dir: string): Fingerprint {
  const manifests: string[] = [];
  const dependencies: Record<string, string> = {};
  for (const [file, collect] of Object.entries(MANIFESTS)) {
    const text = readTextOrNull(join(dir, file));
    if (text === null) continue;
    manifests.push(file);
    try {
      collect(dependencies, text);
    } catch {
      /* an unparseable manifest still counts as present */
    }
  }
  return {
    manifests: manifests.sort(),
    dependencies: Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b))),
  };
}

function readResearch(dir: string): ResearchRecord | null {
  const text = readTextOrNull(join(dir, RESEARCH_FILE));
  if (text === null) return null;
  try {
    const raw = JSON.parse(text);
    return {
      recordedAt: typeof raw.recordedAt === 'string' ? raw.recordedAt : '',
      manifests: Array.isArray(raw.manifests) ? raw.manifests : [],
      dependencies: typeof raw.dependencies === 'object' && raw.dependencies ? raw.dependencies : {},
    };
  } catch {
    return null;
  }
}

export function writeResearch(dir: string, print: Fingerprint, at: Date = new Date()): ResearchRecord {
  const record: ResearchRecord = { recordedAt: at.toISOString().slice(0, 10), ...print };
  writeText(join(dir, RESEARCH_FILE), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

/** The major version a spec pins, when it pins one: `^4.0.0` → 4, `~> 3.2` → 3. */
export const majorOf = (spec: string): number | null => {
  const match = /(\d+)/.exec(spec);
  return match ? Number.parseInt(match[1]!, 10) : null;
};

export interface Drift {
  added: string[];
  removed: string[];
  /** A major version moved: the rules may describe an API that changed. */
  upgraded: { name: string; from: string; to: string }[];
  manifests: { added: string[]; removed: string[] };
}

export const noDrift = (drift: Drift) =>
  drift.added.length + drift.removed.length + drift.upgraded.length +
    drift.manifests.added.length + drift.manifests.removed.length === 0;

/**
 * What changed since the research was recorded. Minor and patch moves are
 * left out on purpose: they rarely change what a rule should say, and a list
 * that always has something in it stops being read.
 */
export function drift(recorded: Fingerprint, current: Fingerprint): Drift {
  const before = recorded.dependencies;
  const now = current.dependencies;
  return {
    added: Object.keys(now).filter((name) => !(name in before)),
    removed: Object.keys(before).filter((name) => !(name in now)),
    upgraded: Object.keys(now)
      .filter((name) => name in before)
      .filter((name) => {
        const from = majorOf(before[name]!);
        const to = majorOf(now[name]!);
        return from !== null && to !== null && from !== to;
      })
      .map((name) => ({ name, from: before[name]!, to: now[name]! })),
    manifests: {
      added: current.manifests.filter((file) => !recorded.manifests.includes(file)),
      removed: recorded.manifests.filter((file) => !current.manifests.includes(file)),
    },
  };
}

/** Files Git tracks in a repository, for checking that a rule's globs still match something. */
export const trackedFiles = (dir: string): string[] =>
  new Git(dir)
    .text(['ls-files'])
    .split('\n')
    .filter((line) => line !== '');

/** Rules, as written, whose globs match none of the given files. */
export const deadRules = (rules: RuleEntry[], files: string[]): string[] =>
  rules
    .filter((rule) => rule.paths.length > 0)
    .filter((rule) => !files.some((file) => rule.paths.some((glob) => matchesGlob(file, scopeGlob('', glob)))))
    .map((rule) => rule.file);

export type RuleSetVerdict = 'none' | 'baseline' | 'unrecorded' | 'stale' | 'current' | 'unavailable';

export interface RuleSetStatus {
  name: string;
  path: string;
  verdict: RuleSetVerdict;
  /** Packs the set starts from. */
  packs: string[];
  rules: number;
  skills: number;
  /** Rule counts by who wrote them. */
  origins: Record<string, number>;
  hasStack: boolean;
  recordedAt: string | null;
  drift: Drift | null;
  /** Rule files whose globs match nothing in the repository. */
  dead: string[];
  /** Why the repository could not be read, when it could not. */
  detail: string | null;
  /** Default packs whose marker files the repository holds: possible baselines, never attached unasked. */
  fits: string[];
}

/**
 * Where one rule set stands:
 *
 * - `none`: no rule set and no pack — the repository is built from priors.
 * - `baseline`: a pack and nothing researched on top of it yet.
 * - `unrecorded`: written, but nobody recorded what it was researched against.
 * - `stale`: the repository's dependencies moved, or a rule matches no file.
 * - `current`: nothing changed since the research was recorded.
 * - `unavailable`: the repository is not checked out here.
 */
export function ruleSetStatus(root: string, config: Config, scope: Scope): RuleSetStatus {
  const set = loadRuleSet(root, scope);
  const origins: Record<string, number> = {};
  for (const rule of set.rules) origins[rule.origin] = (origins[rule.origin] ?? 0) + 1;
  const base: Omit<RuleSetStatus, 'verdict' | 'drift' | 'dead' | 'detail' | 'fits'> = {
    name: scope.name,
    path: scope.path,
    packs: scope.packs,
    rules: set.rules.length,
    skills: set.skills.length,
    origins,
    hasStack: set.stack !== null,
    recordedAt: set.research?.recordedAt ?? null,
  };

  const repository = config.repositories[scope.name];
  const handle = repository ? new Repository(root, repository) : null;
  if (handle && !handle.checkedOut) {
    return { ...base, verdict: 'unavailable', drift: null, dead: [], detail: handle.checkoutHint, fits: [] };
  }
  const dir = handle ? handle.dir : root;
  const written = set.rules.length + set.skills.length > 0 || set.stack !== null;
  if (!written) {
    const fits =
      scope.packs.length > 0
        ? []
        : bundledPacks()
            .filter((pack) => pack.detect.some((file) => exists(join(dir, file))))
            .map((pack) => pack.name);
    return { ...base, verdict: scope.packs.length > 0 ? 'baseline' : 'none', drift: null, dead: [], detail: null, fits };
  }

  const dead = deadRules(set.rules, trackedFiles(dir));
  if (set.research === null) {
    return { ...base, verdict: 'unrecorded', drift: null, dead, detail: null, fits: [] };
  }
  const moved = drift(set.research, fingerprint(dir));
  const verdict = noDrift(moved) && dead.length === 0 ? 'current' : 'stale';
  return { ...base, verdict, drift: moved, dead, detail: null, fits: [] };
}
