import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { Selections } from './options.js';
import { exists, readText } from './util/fs.js';
import { CliError } from './util/log.js';
import { asDict, asString, asStringList, parseYaml, toYaml, type Dict } from './util/yaml.js';

export const CONFIG_FILE = 'collab-swarm.yml';
export const CONFIG_VERSION = 1;

/**
 * A source is a kind of ground truth a plan is written from. Kinds are open:
 * a project declares whichever it has. `to-requirements` reads the labels and
 * paths, so a project with no design tool simply omits `design`.
 */
export interface SourceConfig {
  /** How the source is named to a human: "PRD", "OpenAPI contract". */
  label: string;
  /** Globs, relative to the repository root. */
  paths: string[];
  /** One line telling the agent what to take from it. */
  use?: string;
  /**
   * A contract this repository *defines* rather than consumes.
   *
   * The same `api:` source means opposite things on each side of the wire: an
   * app reads the contract, so an operation it lacks is a gate another team
   * must close; a service defines it, so the same gap is the work itself. The
   * flag is what tells a planning agent which reading applies.
   */
  owned?: boolean;
  /** A source the agent must consult before planning, when present. */
  required?: boolean;
}

export interface CheckConfig {
  name: string;
  /** Shell command run from the repository root, or a coordinated repository's own directory. */
  run: string;
  /** Variant used by `check --focus <path>`; `{path}` is substituted, relative to where it runs. */
  focus?: string;
  /** Variant used by `check --ci` (verify instead of rewrite). */
  ci?: string;
  /** Skipped unless the named file or directory exists where it runs. */
  when?: string;
}

export interface GitConfig {
  remote: string;
  defaultBranch: string;
  branchPrefix: string;
}

/**
 * A code repository this one coordinates: a submodule, or a sibling checkout.
 *
 * Used when this repository is a hub — it holds the knowledge, the backlog and
 * the plans, while the code lands in repositories of its own. A feature's
 * branch carries the same name in the hub and in every repository its plan
 * touches, so one slug finds all of them.
 */
export interface RepositoryConfig {
  /** Short kebab-case name plans and tickets use: `api`, `participant`. */
  name: string;
  /** Checkout directory, relative to this repository's root. */
  path: string;
  /** The remote its branches are pushed to; the hub's remote when unset. */
  remote: string;
  /** Where its features merge: often `develop` rather than the hub's `main`. */
  defaultBranch: string;
  /** Its own checks, run from its own directory. */
  checks: CheckConfig[];
  /**
   * Packs this repository's rule set starts from. Optional and empty by
   * default: a pack is a baseline where one exists for the stack, and the
   * researched rule set in `.collab-swarm/rules/<name>/` builds on it.
   */
  packs: string[];
  /** Answers to those packs' questions, for this repository alone. */
  packOptions: Record<string, Selections>;
}

export interface Config {
  version: number;
  project: string;
  /** Agent targets `init`/`sync` write for. */
  targets: string[];
  /** Directory holding one folder per feature plan. */
  plans: string;
  /** Markdown file holding the feature register, gate tracker and decisions. */
  backlog: string | null;
  /** Owner lanes used by the board ("Dev 1", "Backend", "Ana"). */
  lanes: string[];
  sources: Record<string, SourceConfig>;
  checks: CheckConfig[];
  git: GitConfig;
  /** Code repositories this hub coordinates, keyed by name; empty for a single repository. */
  repositories: Record<string, RepositoryConfig>;
  /** Extra skill packs, as bundled names, npm package names, or paths relative to the root. */
  packs: string[];
  /**
   * Answers to the questions a pack asks, keyed by pack name then option id.
   *
   * Recorded rather than asked again, so `sync` on a teammate's checkout
   * produces the same skills, rules and prose without another interview.
   */
  packOptions: Record<string, Selections>;
}

export interface LoadedConfig {
  config: Config;
  /** Repository root: the directory holding collab-swarm.yml. */
  root: string;
  /** Absolute path of the config file. */
  file: string;
}

export const DEFAULT_CONFIG: Config = {
  version: CONFIG_VERSION,
  project: 'This project',
  targets: ['claude'],
  plans: '.docs/changes',
  backlog: 'docs/delivery-plan.md',
  lanes: [],
  sources: {},
  checks: [],
  git: { remote: 'origin', defaultBranch: 'main', branchPrefix: 'feat/' },
  repositories: {},
  packs: [],
  packOptions: {},
};

function parsePackOptions(raw: unknown): Record<string, Selections> {
  const dict = asDict(raw);
  if (!dict) return {};
  const answers: Record<string, Selections> = {};
  for (const [pack, value] of Object.entries(dict)) {
    const entry = asDict(value);
    if (!entry) continue;
    const selections: Selections = {};
    for (const [option, choice] of Object.entries(entry)) {
      const id = asString(choice);
      if (id) selections[option] = id;
    }
    if (Object.keys(selections).length > 0) answers[pack] = selections;
  }
  return answers;
}

function parseSources(raw: unknown): Record<string, SourceConfig> {
  const dict = asDict(raw);
  if (!dict) return {};
  const sources: Record<string, SourceConfig> = {};
  for (const [key, value] of Object.entries(dict)) {
    const entry = asDict(value);
    if (!entry) continue;
    const paths = asStringList(entry.paths);
    const single = asString(entry.path);
    const label = asString(entry.label) ?? key;
    const all = single ? [...paths, single] : paths;
    if (all.length === 0) continue;
    sources[key] = {
      label,
      paths: all,
      ...(asString(entry.use) ? { use: asString(entry.use)! } : {}),
      ...(entry.owned === true ? { owned: true } : {}),
      ...(entry.required === true ? { required: true } : {}),
    };
  }
  return sources;
}

function parseChecks(raw: unknown): CheckConfig[] {
  if (!Array.isArray(raw)) return [];
  const checks: CheckConfig[] = [];
  for (const item of raw) {
    const entry = asDict(item);
    if (!entry) continue;
    const run = asString(entry.run);
    if (!run) continue;
    checks.push({
      name: asString(entry.name) ?? `check-${checks.length + 1}`,
      run,
      ...(asString(entry.focus) ? { focus: asString(entry.focus)! } : {}),
      ...(asString(entry.ci) ? { ci: asString(entry.ci)! } : {}),
      ...(asString(entry.when) ? { when: asString(entry.when)! } : {}),
    });
  }
  return checks;
}

function parseRepositories(raw: unknown, git: GitConfig): Record<string, RepositoryConfig> {
  const dict = asDict(raw);
  if (!dict) return {};
  const repositories: Record<string, RepositoryConfig> = {};
  for (const [name, value] of Object.entries(dict)) {
    const entry = asDict(value);
    const path = entry ? asString(entry.path) : null;
    if (!entry || !path) continue;
    repositories[name] = {
      name,
      path: path.replace(/\/+$/, ''),
      remote: asString(entry.remote) ?? git.remote,
      defaultBranch: asString(entry.defaultBranch) ?? git.defaultBranch,
      checks: parseChecks(entry.checks),
      packs: asStringList(entry.packs),
      packOptions: parsePackOptions(entry.packOptions),
    };
  }
  return repositories;
}

export function parseConfig(text: string): Config {
  const raw = asDict(parseYaml(text));
  if (!raw) throw new CliError(`${CONFIG_FILE} must contain a YAML mapping.`);
  const git = asDict(raw.git) ?? {};
  const gitConfig: GitConfig = {
    remote: asString(git.remote) ?? DEFAULT_CONFIG.git.remote,
    defaultBranch: asString(git.defaultBranch) ?? DEFAULT_CONFIG.git.defaultBranch,
    branchPrefix: asString(git.branchPrefix) ?? DEFAULT_CONFIG.git.branchPrefix,
  };
  return {
    version: typeof raw.version === 'number' ? raw.version : CONFIG_VERSION,
    project: asString(raw.project) ?? DEFAULT_CONFIG.project,
    targets: asStringList(raw.targets).length ? asStringList(raw.targets) : DEFAULT_CONFIG.targets,
    plans: asString(raw.plans) ?? DEFAULT_CONFIG.plans,
    backlog: raw.backlog === null ? null : (asString(raw.backlog) ?? DEFAULT_CONFIG.backlog),
    lanes: asStringList(raw.lanes),
    sources: parseSources(raw.sources),
    checks: parseChecks(raw.checks),
    git: gitConfig,
    repositories: parseRepositories(raw.repositories, gitConfig),
    packs: asStringList(raw.packs),
    packOptions: parsePackOptions(raw.packOptions),
  };
}

const serializeCheck = (check: CheckConfig): Dict => ({
  name: check.name,
  run: check.run,
  ...(check.focus ? { focus: check.focus } : {}),
  ...(check.ci ? { ci: check.ci } : {}),
  ...(check.when ? { when: check.when } : {}),
});

export function serializeConfig(config: Config): string {
  const body: Dict = {
    version: config.version,
    project: config.project,
    targets: config.targets,
    plans: config.plans,
  };
  if (config.backlog) body.backlog = config.backlog;
  if (config.lanes.length) body.lanes = config.lanes;
  body.sources = Object.fromEntries(
    Object.entries(config.sources).map(([key, source]) => [
      key,
      {
        label: source.label,
        paths: source.paths,
        ...(source.use ? { use: source.use } : {}),
        ...(source.owned ? { owned: true } : {}),
        ...(source.required ? { required: true } : {}),
      },
    ]),
  );
  body.checks = config.checks.map(serializeCheck);
  body.git = config.git;
  const repositories = Object.values(config.repositories);
  if (repositories.length) {
    body.repositories = Object.fromEntries(
      repositories.map((repository) => [
        repository.name,
        {
          path: repository.path,
          ...(repository.remote !== config.git.remote ? { remote: repository.remote } : {}),
          defaultBranch: repository.defaultBranch,
          checks: repository.checks.map(serializeCheck),
          ...(repository.packs.length ? { packs: repository.packs } : {}),
          ...(Object.keys(repository.packOptions).length ? { packOptions: repository.packOptions } : {}),
        },
      ]),
    );
  }
  if (config.packs.length) body.packs = config.packs;
  if (Object.keys(config.packOptions).length) body.packOptions = config.packOptions;

  return [
    '# collab-swarm — how humans and agents deliver features in this repository.',
    '# Regenerate the agent files after editing: npx collab-swarm sync',
    '',
    toYaml(body).trimEnd(),
    '',
  ].join('\n');
}

/** Nearest ancestor directory holding a config file, starting at `from`. */
export function findRoot(from = process.cwd()): string | null {
  let dir = resolve(from);
  for (;;) {
    if (exists(join(dir, CONFIG_FILE))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadConfig(from = process.cwd()): LoadedConfig {
  const root = findRoot(from);
  if (!root) {
    throw new CliError(
      `No ${CONFIG_FILE} found in this directory or any parent.`,
      1,
      'Run `npx collab-swarm init` in the repository root.',
    );
  }
  const file = join(root, CONFIG_FILE);
  const config = parseConfig(readText(file));
  if (config.version > CONFIG_VERSION) {
    throw new CliError(
      `${CONFIG_FILE} declares version ${config.version}, but this collab-swarm understands ${CONFIG_VERSION}.`,
      1,
      'Upgrade the CLI: npm install -D collab-swarm@latest',
    );
  }
  return { config, root, file };
}

export const inRoot = (root: string, path: string) => (isAbsolute(path) ? path : join(root, path));
