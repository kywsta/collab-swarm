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
  /** A source the agent must consult before planning, when present. */
  required?: boolean;
}

export interface CheckConfig {
  name: string;
  /** Shell command run from the repository root. */
  run: string;
  /** Variant used by `check --focus <path>`; `{path}` is substituted. */
  focus?: string;
  /** Variant used by `check --ci` (verify instead of rewrite). */
  ci?: string;
  /** Skipped unless the named file or directory exists. */
  when?: string;
}

export interface GitConfig {
  remote: string;
  defaultBranch: string;
  branchPrefix: string;
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

export function parseConfig(text: string): Config {
  const raw = asDict(parseYaml(text));
  if (!raw) throw new CliError(`${CONFIG_FILE} must contain a YAML mapping.`);
  const git = asDict(raw.git) ?? {};
  return {
    version: typeof raw.version === 'number' ? raw.version : CONFIG_VERSION,
    project: asString(raw.project) ?? DEFAULT_CONFIG.project,
    targets: asStringList(raw.targets).length ? asStringList(raw.targets) : DEFAULT_CONFIG.targets,
    plans: asString(raw.plans) ?? DEFAULT_CONFIG.plans,
    backlog: raw.backlog === null ? null : (asString(raw.backlog) ?? DEFAULT_CONFIG.backlog),
    lanes: asStringList(raw.lanes),
    sources: parseSources(raw.sources),
    checks: parseChecks(raw.checks),
    git: {
      remote: asString(git.remote) ?? DEFAULT_CONFIG.git.remote,
      defaultBranch: asString(git.defaultBranch) ?? DEFAULT_CONFIG.git.defaultBranch,
      branchPrefix: asString(git.branchPrefix) ?? DEFAULT_CONFIG.git.branchPrefix,
    },
    packs: asStringList(raw.packs),
    packOptions: parsePackOptions(raw.packOptions),
  };
}

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
        ...(source.required ? { required: true } : {}),
      },
    ]),
  );
  body.checks = config.checks.map((check) => ({
    name: check.name,
    run: check.run,
    ...(check.focus ? { focus: check.focus } : {}),
    ...(check.ci ? { ci: check.ci } : {}),
    ...(check.when ? { when: check.when } : {}),
  }));
  body.git = config.git;
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
