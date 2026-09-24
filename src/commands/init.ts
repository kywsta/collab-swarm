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
import { askOptions, describePack, offerChecks, record } from '../attach.js';
import { parseSelections } from '../options.js';
import { bundledPacks, corePack, resolvePack, type Pack } from '../packs.js';
import { applySync, planSync } from '../sync.js';
import { TARGETS, targetIds } from '../targets/index.js';
import { exists, readTextOrNull, writeText } from '../util/fs.js';
import { CliError, heading, info, ok, out, style, warn } from '../util/log.js';
import { confirm, input, interactive, multiSelect, select } from '../util/prompt.js';
import { PACKS_ROOT, scaffoldPack, type Planned } from './pack.js';
import { isSlug, slugify } from '../util/yaml.js';

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
    await askOwnership(sources, args, assumeYes);
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
 * How this project gets skills for its own stack.
 *
 * The workflow plans and reviews without knowing the stack, and implements
 * badly without it: with no pack attached, every agent writes from its own
 * priors and the codebase drifts a little further apart with each ticket. So
 * this is asked at `init` rather than left for later, with three honest
 * answers — a default pack, a pack written from this repository, or not yet.
 */
type StackChoice = { kind: 'default' } | { kind: 'custom'; dir: string; router: string } | { kind: 'none' };

const CUSTOM = 'custom';
const LATER = 'later';

async function chooseStackSkills(
  root: string,
  config: Config,
  args: Args,
  assumeYes: boolean,
): Promise<StackChoice> {
  const available = bundledPacks();
  // A pack whose marker files are in this repository is almost always the
  // right answer, so it is offered first and highlighted as the default.
  const ranked = [...available].sort(
    (a, b) => Number(suits(b, root)) - Number(suits(a, root)),
  );
  const suggested = ranked.find((pack) => suits(pack, root));

  // `--pack flutter|custom|none` makes the choice scriptable, which is also
  // the only way a run with no terminal reaches anything but "not now".
  const requested = flagString(args, 'pack');
  const asking = !requested && !assumeYes;
  if (asking || requested) heading('Skills for this stack');
  if (asking) {
    out(
      style.dim(
        'The workflow knows how to plan, build test-first and review. It knows nothing about your\n' +
          'framework: which HTTP client, which state container, where a route belongs. A pack supplies\n' +
          'that — concern skills, path-scoped rules, the architecture, and the checks they need.',
      ),
    );
  }

  const answer = requested
    ? requested
    : assumeYes
    ? LATER
    : await select(
        'Which skills should agents implement with?',
        [
          ...ranked.map((pack) => ({
            value: pack.name,
            label: pack.title,
            hint: `· default pack${suits(pack, root) ? ' · matches this repository' : ''}`,
          })),
          {
            value: CUSTOM,
            label: "Write skills from this project's own stack",
            hint: '· scaffolds a pack here for your agent to fill in',
          },
          { value: LATER, label: 'Not now', hint: '· npx collab-swarm add <pack> whenever you like' },
        ],
        suggested?.name ?? CUSTOM,
      );

  if (answer === LATER || answer === 'none') return { kind: 'none' };
  if (answer === CUSTOM) return scaffoldCustomPack(root, config, assumeYes);

  const preset = parseSelections(flagString(args, 'options') ?? '');
  const answers = await askOptions(resolvePack(answer, root), {
    preset,
    ...(assumeYes ? { assumeYes } : {}),
  });
  const pack = resolvePack(answer, root, answers);
  if (asking) out('');
  describePack(pack);
  record(config, answer, pack, answers);
  config.checks.push(...(await offerChecks(config, pack, assumeYes)));
  return { kind: 'default' };
}

/** True when the repository holds one of the files a pack says it is for. */
const suits = (pack: Pack, root: string) => pack.detect.some((file) => exists(join(root, file)));

/**
 * Interviews the project about its stack and scaffolds a pack for it.
 *
 * The CLI cannot write the skills — that takes reading the codebase — so it
 * writes what it can know: the shape, the roles, and a brief holding the
 * answers. `to-pack` reads the brief and fills the stubs. The pack is left
 * unattached, because publishing empty skills into every agent target would
 * give an agent something to open and nothing to learn.
 */
async function scaffoldCustomPack(
  root: string,
  config: Config,
  assumeYes: boolean,
): Promise<StackChoice> {
  if (!assumeYes) {
    out('');
    info('A few questions now, so your agent starts from your answers instead of guessing.');
  }

  const fallbackName = slugify(readProjectName(root) ?? 'stack') || 'stack';
  const raw = await input('\nName for this pack', fallbackName);
  const name = isSlug(raw) ? raw : slugify(raw) || fallbackName;

  const summary = await input('The stack in one line (language, framework, architecture)', '');
  const libraries = await input('Load-bearing libraries and tools, comma separated', '');
  const concerns = await input(
    'Concerns that each deserve their own skill, comma separated (blank: let the agent propose them)',
    '',
  );

  const split = (value: string) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

  const router = `${name}-dev`;
  const skills: Planned[] = [
    { name: router, role: 'router' },
    ...split(concerns)
      .map((concern) => slugify(concern))
      .filter(Boolean)
      .map((concern) => ({
        name: concern.startsWith(`${name}-`) ? concern : `${name}-${concern}`,
        role: 'ticket' as const,
      })),
  ];
  const dir = `${PACKS_ROOT}/${name}`;
  scaffoldPack({
    dir: join(root, dir),
    name,
    title: summary ? summary.split(',')[0]!.trim() : name,
    description: summary,
    skills,
    rules: skills.filter((skill) => skill.role === 'ticket').map((skill) => skill.name.replace(`${name}-`, '')),
    brief: brief(config.project, summary, split(libraries), skills),
  });

  ok(`Scaffolded ${dir} — every file a stub, so an unwritten skill is visible rather than convincing`);
  return { kind: 'custom', dir, router };
}

/** What the project said, in the file `to-pack` reads before it researches. */
function brief(project: string, summary: string, libraries: string[], skills: Planned[]): string {
  return [
    `# Stack brief — ${project}`,
    '',
    'Written by `npx collab-swarm init` from what the project said. The `to-pack` skill reads this first,',
    'then verifies every line against the repository: an answer here is a starting point, and the',
    'code is the authority. Correct anything the code contradicts rather than preserving it.',
    '',
    '## The stack',
    '',
    summary || '_Not stated. Read the dependency manifest and the build config._',
    '',
    '## Load-bearing libraries',
    '',
    ...(libraries.length > 0
      ? libraries.map(
          (library) =>
            `- **${library}** — what this project uses it for, which directories, and the convention it is held to: _to fill in from the code._`,
        )
      : ['_Not stated. Take them from the dependency manifest and its lockfile._']),
    '',
    '## Proposed concerns',
    '',
    ...(skills.filter((skill) => skill.role === 'ticket').length > 0
      ? skills
          .filter((skill) => skill.role === 'ticket')
          .map((skill) => `- \`${skill.name}\` — invariants, files and failure modes of its own: _to confirm._`)
      : ['_Not stated. Propose them from the code and confirm the list before writing any prose._']),
    '',
    '## Still to settle',
    '',
    '- Which third-party integrations are decided, and which are still open.',
    '- Where the same thing is done two ways, and which way is current.',
    '',
  ].join('\n');
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
  if (stack.kind === 'custom') {
    out(
      `  Fill in the pack: ${style.bold('"Write the skills for this project\'s stack"')} ` +
        style.dim(`(the \`to-pack\` skill reads ${stack.dir}/BRIEF.md, researches the code, and writes them)`),
    );
    out(style.dim(`  Then: npx collab-swarm add ${stack.dir} && npx collab-swarm steps ${stack.router}`));
    out('');
  }
  out(`  Ask your agent: ${style.bold('"What\'s next?"')} or ${style.bold('"Make a plan to implement <feature>"')}`);
  if (stack.kind !== 'custom' && plan.packs.packs.every((pack) => pack.core)) {
    const available = bundledPacks();
    if (available.length > 0) {
      out(
        `  Give it skills for this stack: ${style.dim(`npx collab-swarm add ${available.map((pack) => pack.name).join('|')}`)}`,
      );
    }
    out(
      `  Or from this repository's own code: ${style.bold('"Write the skills for this project\'s stack"')} ` +
        style.dim('(the `to-pack` skill researches it and writes them)'),
    );
  }
  if (stack.kind === 'default') {
    out(style.dim('  Change what the pack asked: npx collab-swarm pack options <pack>'));
  }
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
