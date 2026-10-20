import { flagBool, type Args } from '../cli.js';
import { PROGRAM } from '../util/program.js';
import { loadConfig } from '../config.js';
import { Claims } from '../core/claims.js';
import { CliError, ok, out, style } from '../util/log.js';
import { buildBoard } from './board.js';

export async function run(args: Args): Promise<number> {
  const slug = args.positional[0];
  if (!slug) {
    throw new CliError('Name the row to claim.', 64, `Usage: ${PROGRAM} claim <slug>`);
  }

  const { config, root } = loadConfig();
  const fetch = !flagBool(args, 'no-fetch');
  const board = buildBoard(root, config, { fetch });

  const row = board.register.row(slug);
  const reason = board.whyNotAvailable(slug);
  if (reason) {
    const suggestion = board.proposals({ count: 1 })[0];
    throw new CliError(
      reason,
      1,
      suggestion ? `Available now: ${suggestion.row.slug} — ${suggestion.row.title}` : undefined,
    );
  }

  const title = row?.title || slug.replace(/-/g, ' ');
  const claims = new Claims(root, config.git, config.plans, config.repositories);
  // The board already fetched; a second fetch would only slow the claim down.
  const result = claims.claim(slug, title, { fetch: false, repositories: row?.repositories ?? [] });

  if (!result.ok) {
    throw new CliError(result.message, 1);
  }

  ok(result.message);
  for (const line of result.repositories ?? []) out(`  ${style.dim('·')} ${line}`);
  out('');
  out(`${style.bold('Next')}: ask your agent to`);
  out(
    `  ${style.cyan(`"Make a plan to implement ${title}"`)}` +
      (row?.sources ? ` ${style.dim(`— its sources: ${row.sources}`)}` : ''),
  );
  out(style.dim('  The claim already created the plan skeleton; the coordinator resumes it.'));
  return 0;
}
