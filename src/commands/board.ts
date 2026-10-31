import { isAbsolute } from 'node:path';
import { flagBool, flagString, type Args } from '../cli.js';
import { CONFIG_FILE, inRoot, loadConfig, parseConfig, type Config } from '../config.js';
import { Board, normalizeLane } from '../core/board.js';
import { Claims } from '../core/claims.js';
import { notices, type Freshness } from '../core/freshness.js';
import { Git } from '../core/git.js';
import { historyPath } from '../core/history.js';
import { Register } from '../core/register.js';
import { renderNext, renderStatus } from '../core/render.js';
import { readTextOrNull } from '../util/fs.js';
import { CliError, out, style } from '../util/log.js';

export interface LoadedRegister {
  register: Register;
  /** The ref the files were read from, or null when they were read from this checkout. */
  ref: string | null;
  /** The working tree's backlog is not the one the register was read from. */
  backlogDiffers: boolean;
}

const sameText = (a: string, b: string) => a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');

export interface RegisterOptions {
  /** Read this checkout's files even when the default branch has them: for checking a draft. */
  workingTree?: boolean;
}

/**
 * Loads the register from the configured backlog, plus a decisions source when
 * declared, plus the questions the delivery history records as settled — a
 * question retired from the backlog stays answered for any row still citing it.
 *
 * All three are read from the default branch on the remote, as claims are and
 * as a claim's branch is cut: a checkout behind it, or one drafting backlog
 * edits, would otherwise offer rows nobody else can see. Only outside Git,
 * with no such remote branch, or when asked for a draft, is this checkout's
 * copy the register.
 */
export function loadRegister(root: string, config: Config, options: RegisterOptions = {}): LoadedRegister {
  if (!config.backlog) return { register: Register.empty(), ref: null, backlogDiffers: false };
  const git = new Git(root);
  const main = `${config.git.remote}/${config.git.defaultBranch}`;
  const ref = !options.workingTree && git.available && git.hasCommit(main) ? main : null;
  const fromDisk = (path: string) => readTextOrNull(inRoot(root, path));
  // `./` resolves the path from the root, which need not be the top of the repository.
  const read = (path: string) => (ref === null || isAbsolute(path) ? fromDisk(path) : git.show(ref, `./${path}`));

  const backlog = read(config.backlog);
  if (backlog === null) {
    throw new CliError(
      ref === null
        ? `The configured backlog ${config.backlog} does not exist, so there is no board to read.`
        : `The configured backlog ${config.backlog} is not on ${ref}, so there is no board to read.`,
      1,
      ref === null
        ? 'Create it, or set `backlog:` in collab-swarm.yml to the file holding the feature register.'
        : `Merge it into ${config.git.defaultBranch}: the board, and every claim, reads it from there.`,
    );
  }
  const decisionsSource = config.sources.decisions;
  const decisions = decisionsSource
    ? (decisionsSource.paths.map((path) => read(path)).find((text) => text !== null) ?? '')
    : '';
  const history = read(historyPath(config.plans)) ?? '';
  const local = ref === null ? null : fromDisk(config.backlog);
  return {
    register: Register.parse(backlog, `${decisions}\n\n${history}`),
    ref,
    backlogDiffers: local !== null && !sameText(local, backlog),
  };
}

/** What the board takes from the configuration: where its files are, and how claims are named. */
const boardSettings = (config: Config) => ({
  backlog: config.backlog,
  plans: config.plans,
  sources: config.sources,
  repositories: config.repositories,
  branchPrefix: config.git.branchPrefix,
});

/**
 * The configuration the board runs on. Its settings come from the default
 * branch's collab-swarm.yml, like the files they name, so a checkout behind a
 * restructure reads the board that branch describes. The remote and the
 * default branch, which say where to look, are this checkout's.
 */
export function boardConfig(
  root: string,
  config: Config,
  options: RegisterOptions = {},
): { config: Config; differs: string[] } {
  const unchanged = { config, differs: [] };
  if (options.workingTree) return unchanged;
  const git = new Git(root);
  const main = `${config.git.remote}/${config.git.defaultBranch}`;
  if (!git.available || !git.hasCommit(main)) return unchanged;
  const text = git.show(main, `./${CONFIG_FILE}`);
  if (text === null) return unchanged;
  let theirs: Config;
  try {
    theirs = parseConfig(text);
  } catch {
    // A broken file there is `validate`'s to report; the board still has this checkout's.
    return unchanged;
  }
  const effective: Config = {
    ...config,
    backlog: theirs.backlog,
    plans: theirs.plans,
    sources: theirs.sources,
    repositories: theirs.repositories,
    git: { ...config.git, branchPrefix: theirs.git.branchPrefix },
  };
  const mine = boardSettings(config);
  const followed = boardSettings(effective);
  const differs = (Object.keys(mine) as (keyof typeof mine)[]).filter(
    (key) => JSON.stringify(mine[key]) !== JSON.stringify(followed[key]),
  );
  return { config: effective, differs };
}

export interface BoardRead {
  board: Board;
  freshness: Freshness;
  /** The configuration the board was read with: see `boardConfig`. */
  config: Config;
}

/** The board, and how current it is. */
export function readBoard(
  root: string,
  config: Config,
  options: { fetch?: boolean } & RegisterOptions = {},
): BoardRead {
  const fetch = options.fetch !== false;
  // Fetch first: the configuration and the register are read from the remote's default branch too.
  const own = fetch ? new Claims(root, config.git, config.plans).fetchOwn() : null;
  const settings = boardConfig(root, config, options);
  const claims = new Claims(root, settings.config.git, settings.config.plans, settings.config.repositories);
  const fetchFailures = [...(own === null ? [] : [own]), ...(fetch ? claims.fetchRepositories() : [])];
  const loaded = loadRegister(root, settings.config, options);
  const board = Board.build(loaded.register, claims.read({ fetch: false }), config.git.defaultBranch);
  const behind = loaded.ref === null ? 0 : (new Git(root).countAhead('HEAD', loaded.ref) ?? 0);
  return {
    board,
    config: settings.config,
    freshness: {
      ref: loaded.ref,
      workingTree: options.workingTree === true,
      behind,
      configDiffers: settings.differs,
      backlogDiffers: loaded.backlogDiffers,
      fetchFailures,
    },
  };
}

export function buildBoard(root: string, config: Config, options: { fetch?: boolean } = {}): Board {
  return readBoard(root, config, options).board;
}

export async function run(args: Args): Promise<number> {
  const { config, root } = loadConfig();
  const read = readBoard(root, config, {
    fetch: !flagBool(args, 'no-fetch'),
    workingTree: flagBool(args, 'working-tree'),
  });
  const { board, freshness } = read;
  const warnings = notices(freshness, read.config.backlog);
  const lane = normalizeLane(flagString(args, 'lane'), board.register);
  const count = Number.parseInt(flagString(args, 'count') ?? '3', 10) || 3;

  if (flagBool(args, 'json')) {
    out(
      JSON.stringify(
        {
          milestone: board.currentMilestone,
          rows: board.rows.map((row) => ({
            slug: row.row.slug,
            title: row.row.title,
            state: row.state,
            lane: row.row.lane,
            size: row.row.size,
            milestone: row.row.milestone,
            holder: row.claim?.holder ?? null,
            ref: row.claim?.ref ?? null,
            stage: row.claim?.stage ?? null,
            repositories: row.claim?.repositories ?? [],
            blockers: row.blockers,
          })),
          proposals: board.proposals({ lane, count }).map((row) => row.row.slug),
          source: {
            ref: freshness.ref,
            workingTree: freshness.workingTree,
            behind: freshness.behind,
            configDiffers: freshness.configDiffers,
            backlogDiffers: freshness.backlogDiffers,
          },
          fetchFailures: freshness.fetchFailures.map((failure) => ({
            repository: failure.repository,
            remote: failure.remote,
            lastFetchedAt: failure.lastFetchedAt?.toISOString() ?? null,
          })),
          notices: warnings,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  const options = { lane, count, claimCommand: 'npx collab-swarm claim <slug>' };
  out('');
  for (const warning of warnings) out(`${style.yellow('!')} ${warning}`);
  if (warnings.length > 0) out('');
  out(args.command === 'status' ? renderStatus(board, options) : renderNext(board, options));
  out('');
  return 0;
}
