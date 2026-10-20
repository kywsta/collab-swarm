import { join } from 'node:path';
import { VERSION, flagBool, flagString, type Args } from '../cli.js';
import {
  CONFIG_FILE,
  DEFAULT_CONFIG,
  findRoot,
  parseConfig,
  serializeConfig,
  type CheckConfig,
  type Config,
  type RepositoryConfig,
  type SourceConfig,
} from '../config.js';
import { Git } from '../core/git.js';
import { askOptions, describePack, offerChecks, record } from '../attach.js';
import { parseSelections } from '../options.js';
import { bundledPacks, corePack, resolvePack, type Pack } from '../packs.js';
import { applySync, planSync } from '../sync.js';
import { TARGETS, targetIds } from '../targets/index.js';
import { exists, readTextOrNull, writeText } from '../util/fs.js';
import { CliError, heading, info, ok, out, style, warn } from '../util/log.js';
import { confirm, input, interactive, multiSelect, select } from '../util/prompt.js';
import { ROOT_SCOPE } from '../core/rulesets.js';
import { loadWorkspace } from '../workspace.js';
import { isSlug, slugify } from '../util/yaml.js';

/** Check suggestions per ecosystem, used only to prefill the config. */
const ECOSYSTEMS: { when: string; name: string; checks: CheckConfig[] }[] = [
  {
    // Before Node: a Laravel application carries a package.json for its assets.
    when: 'artisan',
    name: 'Laravel',
    checks: [
      { name: 'format', run: 'vendor/bin/pint', ci: 'vendor/bin/pint --test' },
      { name: 'test', run: 'php artisan test', focus: 'php artisan test {path}' },
    ],
  },
  {
    when: 'package.json',
    name: 'Node',
    checks: [
      { name: 'format', run: 'npm run format --if-present', ci: 'npm run format:check --if-present' },
      { name: 'lint', run: 'npm run lint --if-present' },
      { name: 'typecheck', run: 'npm run typecheck --if-present' },
      { name: 'test', run: 'npm test', focus: 'npm test -- {path}' },
    ],
  },
  {
    when: 'pubspec.yaml',
    name: 'Flutter or Dart',
    checks: [
      { name: 'format', run: 'dart format .', ci: 'dart format --output=none --set-exit-if-changed .' },
      { name: 'analyze', run: 'flutter analyze' },
      { name: 'test', run: 'flutter test', focus: 'flutter test {path}' },
    ],
  },
  {
    when: 'pyproject.toml',
    name: 'Python',
    checks: [
      { name: 'format', run: 'ruff format .', ci: 'ruff format --check .' },
      { name: 'lint', run: 'ruff check .' },
      { name: 'test', run: 'pytest', focus: 'pytest {path}' },
    ],
  },
  {
    when: 'go.mod',
    name: 'Go',
    checks: [
      { name: 'format', run: 'gofmt -w .', ci: 'test -z "$(gofmt -l .)"' },
      { name: 'vet', run: 'go vet ./...' },
      { name: 'test', run: 'go test ./...', focus: 'go test {path}' },
    ],
  },
  {
    when: 'Cargo.toml',
    name: 'Rust',
    checks: [
      { name: 'format', run: 'cargo fmt', ci: 'cargo fmt --check' },
      { name: 'clippy', run: 'cargo clippy -- -D warnings' },
      { name: 'test', run: 'cargo test', focus: 'cargo test {path}' },
    ],
  },
];

/**
 * Whether a contract source is defined here or consumed from elsewhere.
 *
 * The same contract reads in opposite directions on each side of the wire, so
 * the answer decides whether a gap in it is a gate another team closes or the
 * work this project is about to do.
 */
interface Ownership {
  question: string;
  defines: string;
  consumes: string;
  /** The `use:` line written when this repository defines it. */
  use: string;
}

/** Source suggestions, offered only when the repository already has the files. */
const SOURCE_CANDIDATES: {
  key: string;
  label: string;
  use: string;
  globs: string[];
  owns?: Ownership;
}[] = [
  {
    key: 'product',
    label: 'Product requirements',
    use: 'What the feature must do, and how it is judged',
    globs: ['docs/prd', 'docs/product', 'docs/specs', 'docs/requirements'],
  },
  {
    key: 'design',
    label: 'Design index',
    use: 'Which screens and components a surface must match',
    globs: ['docs/design', 'docs/ui', 'design'],
    owns: {
      question: 'The design specs: are they defined in this repository, or in a design tool?',
      defines: 'This repository defines them',
      consumes: 'They come from a design tool',
      use: 'The surfaces this project defines, and the states each must render',
    },
  },
  {
    key: 'api',
    label: 'API contract',
    use: 'The operations, payloads and error cases a feature may use',
    globs: ['openapi.yaml', 'openapi.json', 'docs/api', 'api', 'schema.graphql'],
    owns: {
      question: 'The API contract: does this repository define it, or consume one?',
      defines: 'This repository defines it',
      consumes: 'It is defined elsewhere and consumed here',
      use: 'The operations, payloads and error cases this project defines for its consumers',
    },
  },
  {
    key: 'domain',
    label: 'Domain vocabulary',
    use: 'The words to use in code, tests and plans',
    globs: ['CONTEXT.md', 'GLOSSARY.md', 'docs/domain.md'],
  },
  {
    key: 'decisions',
    label: 'Decisions register',
    use: 'Open product questions and the working assumptions behind them',
    globs: ['docs/decisions.md', 'docs/adr', 'docs/prd/decisions.md'],
  },
];

function detectChecks(root: string): { name: string; checks: CheckConfig[] } | null {
  for (const ecosystem of ECOSYSTEMS) {
    if (!exists(join(root, ecosystem.when))) continue;
    return { name: ecosystem.name, checks: ecosystem.name === 'Node' ? nodeChecks(root, ecosystem.checks) : ecosystem.checks };
  }
  return null;
}

/**
 * `npm test` fails outright when there is no test script, unlike the
 * `--if-present` runs around it, so it is offered only to a package that has one.
 */
function nodeChecks(root: string, checks: CheckConfig[]): CheckConfig[] {
  let scripts: Record<string, unknown> = {};
  try {
    scripts = JSON.parse(readTextOrNull(join(root, 'package.json')) ?? '{}').scripts ?? {};
  } catch {
    return checks;
  }
  return checks.filter((check) => check.name !== 'test' || typeof scripts.test === 'string');
}

function detectSources(root: string): Record<string, SourceConfig> {
  const sources: Record<string, SourceConfig> = {};
  for (const candidate of SOURCE_CANDIDATES) {
    const hit = candidate.globs.find((path) => exists(join(root, path)));
    if (!hit) continue;
    const isDirectory = !hit.includes('.');
    sources[candidate.key] = {
      label: candidate.label,
      paths: [isDirectory ? `${hit}/**/*.md` : hit],
      use: candidate.use,
    };
  }
  return sources;
}

/**
 * Asks which contracts this repository defines rather than consumes.
 *
 * Only contract sources are asked about, and only when the repository has one:
 * the answer changes what a planning agent does with a gap in that contract, so
 * leaving it unasked is what sends a service off to wait for its own endpoint.
 * `--owns api,design` answers it where there is no terminal.
 */
async function askOwnership(
  sources: Record<string, SourceConfig>,
  args: Args,
  assumeYes: boolean,
): Promise<void> {
  const flagged = flagString(args, 'owns');
  const named =
    flagged === null
      ? null
      : new Set(
          flagged
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        );

  for (const candidate of SOURCE_CANDIDATES) {
    const source = sources[candidate.key];
    if (!source || !candidate.owns) continue;
    const owns = candidate.owns;
    const owned = named
      ? named.has(candidate.key)
      : assumeYes
        ? false
        : (await select(
            `\n${owns.question}`,
            [
              {
                value: 'consumes',
                label: owns.consumes,
                hint: '· a gap in it is a gate another team closes',
              },
              {
                value: 'defines',
                label: owns.defines,
                hint: "· a gap in it is this project's work",
              },
            ],
            'consumes',
          )) === 'defines';
    if (!owned) continue;
    source.owned = true;
    source.use = owns.use;
  }
}

/**
 * The submodules of a hub, offered as the code repositories it coordinates.
 *
 * Each gets the checks its own ecosystem suggests and the default branch its
 * remote advertises, so a hub whose apps integrate on `develop` while the hub
 * itself uses `main` is configured correctly without being asked.
 */
function detectRepositories(root: string, hubBranch: string): RepositoryConfig[] {
  if (!exists(join(root, '.gitmodules'))) return [];
  const listing = new Git(root).text([
    'config',
    '--file',
    '.gitmodules',
    '--get-regexp',
    '^submodule\\..*\\.path$',
  ]);
  const taken = new Set<string>();
  const repositories: RepositoryConfig[] = [];
  for (const line of listing.split('\n')) {
    const path = line.trim().split(/\s+/)[1];
    if (!path) continue;
    let name = slugify(path.split('/').pop() ?? path) || 'repository';
    while (taken.has(name)) name = `${name}-${taken.size + 1}`;
    taken.add(name);
    const dir = join(root, path);
    const git = new Git(dir);
    const own = exists(join(dir, '.git'));
    repositories.push({
      name,
      path,
      remote: 'origin',
      defaultBranch: own ? detectDefaultBranch(git) : hubBranch,
      checks: detectChecks(dir)?.checks ?? [],
      packs: [],
      packOptions: {},
    });
  }
  return repositories;
}

function detectDefaultBranch(git: Git): string {
  const head = git.text(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']).trim();
  if (head.includes('/')) return head.split('/').pop()!;
  const current = git.currentBranch;
  return current === '' ? 'main' : current;
}

export async function run(args: Args): Promise<number> {
  const root = flagString(args, 'root') ?? process.cwd();
  const assumeYes = flagBool(args, 'yes') || flagBool(args, 'y') || !interactive();
  const force = flagBool(args, 'force');

  const configPath = join(root, CONFIG_FILE);
  const existing = readTextOrNull(configPath);
  if (existing && !force) {
    const nested = findRoot(root);
    if (nested === root) {
      info(`${CONFIG_FILE} already exists. Applying it instead of starting over.`);
      return applyAndReport(root, parseConfig(existing), args);
    }
  }

  const git = new Git(root);
  if (!git.available) {
    warn('This directory is not a Git repository. The delivery board needs Git to record claims.');
  }

  heading('collab-swarm');
  out(
    style.dim(
      'One feature is one plan: requirements, specification, tickets, then implementation and review.\n' +
        'Humans and agents share the same board, and Git is the only tracker.',
    ),
  );

  const projectName = await input(
    '\nProject name',
    readProjectName(root) ?? DEFAULT_CONFIG.project,
  );

  const chosenTargets = args.flags.has('target')
    ? String(flagString(args, 'target') ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    : await multiSelect(
        'Which coding agents work on this repository?',
        TARGETS.map((target) => ({
          value: target.id,
          label: target.label,
          hint: `· ${target.hint}`,
          preselected: target.id === 'claude' || target.id === 'agents',
        })),
      );
  if (chosenTargets.length === 0) {
    throw new CliError('No agent target chosen, so there is nothing to install.', 64, `Known targets: ${targetIds().join(', ')}.`);
  }

  const detected = detectChecks(root);
  let checks: CheckConfig[] = [];
  if (detected) {
    const accept =
      assumeYes || (await confirm(`\nDetected a ${detected.name} project. Use its usual checks?`, true));
    if (accept) checks = detected.checks;
  }

  const sources = detectSources(root);
  if (Object.keys(sources).length > 0) {
    out('');
    info(
      `Found sources of truth: ${Object.values(sources)
        .map((source) => source.label)
        .join(', ')}. Agents will ground plans in them.`,
    );
    await askOwnership(sources, args, assumeYes);
  }

  const hubBranch = git.available ? detectDefaultBranch(git) : 'main';
  const found = detectRepositories(root, hubBranch);
  let repositories: RepositoryConfig[] = [];
  if (found.length > 0) {
    out('');
    info(
      `Found ${found.length} submodule${found.length === 1 ? '' : 's'}: ` +
        found.map((repository) => `${repository.path} (${repository.defaultBranch})`).join(', ') +
        '.',
    );
    const coordinate =
      assumeYes ||
      (await confirm(
        'Is this a hub — sources and plans here, code in the submodules? Coordinate them as its code repositories?',
        true,
      ));
    if (coordinate) {
      repositories = found;
      for (const repository of repositories.filter((candidate) => candidate.checks.length === 0)) {
        info(`No checks detected for ${repository.name}; add them under repositories.${repository.name}.checks.`);
      }
      // A hub holds documents and plans; checking them is its whole check set
      // until the team adds more.
      if (checks.length === 0) checks = [{ name: 'validate', run: 'npx collab-swarm validate' }];
    }
  }

  if (checks.length === 0) {
    info('No checks configured yet. Add them under `checks:` in collab-swarm.yml — every agent will run them.');
  }

  const backlogPath = 'docs/delivery-plan.md';
  const wantBacklog =
    exists(join(root, backlogPath)) ||
    assumeYes ||
    (await confirm(`\nCreate a delivery board backlog at ${backlogPath}?`, true));

  const config: Config = {
    ...DEFAULT_CONFIG,
    project: projectName,
    targets: chosenTargets,
    backlog: wantBacklog ? backlogPath : null,
    sources,
    checks,
    git: {
      remote: 'origin',
      defaultBranch: hubBranch,
      branchPrefix: 'feat/',
    },
    repositories: Object.fromEntries(repositories.map((repository) => [repository.name, repository])),
  };

  const stack = await chooseStackSkills(root, config, args, assumeYes);

  writeText(configPath, serializeConfig(config));
  ok(`Wrote ${CONFIG_FILE}`);

  if (wantBacklog && !exists(join(root, backlogPath))) {
    writeText(join(root, backlogPath), backlogSeed(config));
    ok(`Wrote ${backlogPath} — fill in the feature register and the swarm has a board`);
  }

  return applyAndReport(root, config, args, true, stack);
}

/**
 * A pack, only when one is asked for.
 *
 * The workflow plans, builds test-first and reviews without knowing the stack.
 * What it knows about a stack comes from each repository's rule set, which an
 * agent researches from the code (`to-rules`); a default pack is a baseline
 * for that where one exists, never a prerequisite. So `init` attaches nothing
 * unless `--pack <name>` names a default pack.
 */
type StackChoice = { kind: 'default'; name: string } | { kind: 'none' };

async function chooseStackSkills(
  root: string,
  config: Config,
  args: Args,
  assumeYes: boolean,
): Promise<StackChoice> {
  const requested = flagString(args, 'pack');
  if (!requested || requested === 'none') return { kind: 'none' };
  if (requested === 'custom') {
    throw new CliError(
      '`--pack custom` is gone: a project\'s own rules are researched, not scaffolded.',
      64,
      'Run init without it, then ask your agent to "research the rule set" (the `to-rules` skill).',
    );
  }

  heading('Baseline pack');
  const preset = parseSelections(flagString(args, 'options') ?? '');
  const answers = await askOptions(resolvePack(requested, root), {
    preset,
    ...(assumeYes ? { assumeYes } : {}),
  });
  const pack = resolvePack(requested, root, answers);
  describePack(pack);
  record(config, requested, pack, answers);
  config.checks.push(...(await offerChecks(config, pack, assumeYes)));
  return { kind: 'default', name: pack.name };
}

function readProjectName(root: string): string | null {
  const packageJson = readTextOrNull(join(root, 'package.json'));
  if (packageJson) {
    try {
      const name = JSON.parse(packageJson).name;
      if (typeof name === 'string' && name.trim()) return name;
    } catch {
      /* fall through */
    }
  }
  const readme = readTextOrNull(join(root, 'README.md'));
  const title = readme ? /^#\s+(.+)$/m.exec(readme)?.[1] : null;
  return title?.trim() ?? null;
}

function applyAndReport(
  root: string,
  config: Config,
  _args: Args,
  fresh = false,
  stack: StackChoice = { kind: 'none' },
): number {
  const plan = planSync(root, config, VERSION);
  const result = applySync(root, plan, config, VERSION);

  heading('Installed');
  for (const target of plan.targets) {
    out(`  ${style.green('•')} ${target.label} ${style.dim(target.hint)}`);
  }
  out(
    `  ${style.dim(`${plan.packs.skills.length} skills, ${plan.packs.rules.length} rules, ` + `${result.written.length} files written`)}`,
  );
  if (result.kept.length > 0) {
    out(`  ${style.dim(`${result.kept.length} existing file(s) left alone: ${result.kept.join(', ')}`)}`);
  }

  heading('Next');
  if (fresh) {
    out('  1. Open collab-swarm.yml and check the `checks:` commands run in this repository.');
    out(`  2. Fill in the feature register${config.backlog ? ` in ${config.backlog}` : ''}, one row per feature.`);
    out('  3. Commit the generated files so every teammate and agent shares them.');
    out('');
  }
  out(`  Ask your agent: ${style.bold('"What\'s next?"')} or ${style.bold('"Make a plan to implement <feature>"')}`);

  // A hub's own rule set matters only when it holds code; its repositories' always do.
  const hub = Object.keys(config.repositories).length > 0;
  const unresearched = loadWorkspace(root, config).ruleSets.filter(
    (set) => !set.exists && (set.scope.name !== ROOT_SCOPE || !hub),
  );
  if (unresearched.length > 0) {
    const first = unresearched[0]!.scope.name;
    out(
      `  Give agents the rules this code is built by: ` +
        style.bold(`"Research the rule set for ${first === ROOT_SCOPE ? 'this repository' : first}"`) +
        style.dim(' (the `to-rules` skill; run it again as the code grows)'),
    );
    const available = bundledPacks();
    if (available.length > 0) {
      out(
        style.dim(
          `  Where a default pack fits, it can be the baseline: npx collab-swarm add ` +
            `${available.map((pack) => pack.name).join('|')}${hub ? ' --repo <name>' : ''}`,
        ),
      );
    }
  }
  if (stack.kind === 'default') {
    out(style.dim(`  Change what the pack asked: npx collab-swarm pack options ${stack.name}`));
  }
  return 0;
}

function backlogSeed(config: Config): string {
  const core = corePack();
  const template = join(core.dir, 'workflow', 'templates', 'backlog.md');
  const text = readTextOrNull(template);
  if (text === null) return `# ${config.project} delivery plan\n`;
  const seeded = text
    .replaceAll('{{project}}', config.project)
    .replaceAll('{{branchPrefix}}', config.git.branchPrefix)
    .replaceAll('{{remote}}', config.git.remote)
    .replaceAll('{{defaultBranch}}', config.git.defaultBranch)
    .replaceAll('{{plans}}', config.plans);
  const names = Object.keys(config.repositories);
  return names.length > 0 ? withRepositories(seeded, names) : seeded;
}

/**
 * A hub's backlog says where each row's code lands, so its claim can open the
 * branches at once, and says that done waits for that code to merge.
 */
function withRepositories(backlog: string, names: string[]): string {
  const lines: string[] = [];
  let inRegister = false;
  for (const line of backlog.split('\n')) {
    if (/^\| Slug \| Title \|/.test(line)) {
      inRegister = true;
      lines.push(`${line} Repositories |`);
      continue;
    }
    if (inRegister && line.startsWith('|')) {
      lines.push(/^\|[\s|-]+\|$/.test(line) ? `${line} --- |` : `${line} \`${names[0]}\` |`);
      continue;
    }
    inRegister = false;
    lines.push(line.startsWith('- A row is **done** when')
      ? `${line.replace(/\.$/, '')}, and its branch has merged in every code repository its plan names.`
      : line);
  }
  return lines.join('\n');
}
