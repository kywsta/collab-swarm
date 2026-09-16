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
  type SourceConfig,
} from '../config.js';
import { Git } from '../core/git.js';
import { corePack } from '../packs.js';
import { applySync, planSync } from '../sync.js';
import { TARGETS, targetIds } from '../targets/index.js';
import { exists, readTextOrNull, writeText } from '../util/fs.js';
import { CliError, heading, info, ok, out, style, warn } from '../util/log.js';
import { confirm, input, interactive, multiSelect } from '../util/prompt.js';

/** Check suggestions per ecosystem, used only to prefill the config. */
const ECOSYSTEMS: { when: string; name: string; checks: CheckConfig[] }[] = [
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

/** Source suggestions, offered only when the repository already has the files. */
const SOURCE_CANDIDATES: { key: string; label: string; use: string; globs: string[] }[] = [
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
  },
  {
    key: 'api',
    label: 'API contract',
    use: 'The operations, payloads and error cases a feature may use',
    globs: ['openapi.yaml', 'openapi.json', 'docs/api', 'api', 'schema.graphql'],
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
    if (exists(join(root, ecosystem.when))) return { name: ecosystem.name, checks: ecosystem.checks };
  }
  return null;
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
  if (checks.length === 0) {
    info('No checks configured yet. Add them under `checks:` in collab-swarm.yml — every agent will run them.');
  }

  const sources = detectSources(root);
  if (Object.keys(sources).length > 0) {
    out('');
    info(
      `Found sources of truth: ${Object.values(sources)
        .map((source) => source.label)
        .join(', ')}. Agents will ground plans in them.`,
    );
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
      defaultBranch: git.available ? detectDefaultBranch(git) : 'main',
      branchPrefix: 'feat/',
    },
  };

  writeText(configPath, serializeConfig(config));
  ok(`Wrote ${CONFIG_FILE}`);

  if (wantBacklog && !exists(join(root, backlogPath))) {
    writeText(join(root, backlogPath), backlogSeed(config));
    ok(`Wrote ${backlogPath} — fill in the feature register and the swarm has a board`);
  }

  return applyAndReport(root, config, args, true);
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

function applyAndReport(root: string, config: Config, _args: Args, fresh = false): number {
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
  out(style.dim(`  Add a framework pack later: npx swarm add <pack>`));
  return 0;
}

function backlogSeed(config: Config): string {
  const core = corePack();
  const template = join(core.dir, 'workflow', 'templates', 'backlog.md');
  const text = readTextOrNull(template);
  if (text === null) return `# ${config.project} delivery plan\n`;
  return text
    .replaceAll('{{project}}', config.project)
    .replaceAll('{{branchPrefix}}', config.git.branchPrefix)
    .replaceAll('{{remote}}', config.git.remote)
    .replaceAll('{{defaultBranch}}', config.git.defaultBranch)
    .replaceAll('{{plans}}', config.plans);
}
