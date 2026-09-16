import { flagBool, flagString, type Args } from '../cli.js';
import { inRoot, loadConfig, type Config } from '../config.js';
import { Board, normalizeLane } from '../core/board.js';
import { Claims } from '../core/claims.js';
import { Register } from '../core/register.js';
import { renderNext, renderStatus } from '../core/render.js';
import { readTextOrNull } from '../util/fs.js';
import { CliError, out } from '../util/log.js';

/** Loads the register from the configured backlog, plus a decisions source when declared. */
export function loadRegister(root: string, config: Config): Register {
  if (!config.backlog) return Register.empty();
  const backlog = readTextOrNull(inRoot(root, config.backlog));
  if (backlog === null) {
    throw new CliError(
      `The configured backlog ${config.backlog} does not exist, so there is no board to read.`,
      1,
      'Create it, or set `backlog:` in collab-swarm.yml to the file holding the feature register.',
    );
  }
  const decisionsSource = config.sources.decisions;
  const decisions = decisionsSource
    ? (decisionsSource.paths
        .map((path) => readTextOrNull(inRoot(root, path)))
        .find((text) => text !== null) ?? '')
    : '';
  return Register.parse(backlog, decisions);
}

export function buildBoard(root: string, config: Config, options: { fetch?: boolean } = {}): Board {
  const register = loadRegister(root, config);
  const claims = new Claims(root, config.git, config.plans).read(options);
  return Board.build(register, claims, config.git.defaultBranch);
}

export async function run(args: Args): Promise<number> {
  const { config, root } = loadConfig();
  const board = buildBoard(root, config, { fetch: !flagBool(args, 'no-fetch') });
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
            blockers: row.blockers,
          })),
          proposals: board.proposals({ lane, count }).map((row) => row.row.slug),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  const options = { lane, count, claimCommand: 'npx collab-swarm claim <slug>' };
  out('');
  out(args.command === 'status' ? renderStatus(board, options) : renderNext(board, options));
  out('');
  return 0;
}
