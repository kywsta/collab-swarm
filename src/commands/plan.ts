import { join } from 'node:path';
import { flagString, type Args } from '../cli.js';
import { PROGRAM } from '../util/program.js';
import { inRoot, loadConfig } from '../config.js';
import { newPlan, serializePlan } from '../core/plan.js';
import { exists, writeText } from '../util/fs.js';
import { CliError, ok, out, style } from '../util/log.js';
import { isSlug, slugify } from '../util/yaml.js';

/**
 * Opens a plan by hand.
 *
 * It writes the same skeleton `claim` pushes — a lone `plan.yml` at the
 * requirements stage — and nothing else. Copying the document templates here
 * would hand the user a package that fails validation until an agent rewrites
 * every section; the coordinator creates each document as it fills it.
 */
export async function run(args: Args): Promise<number> {
  const raw = args.positional[0];
  if (!raw) {
    throw new CliError(
      'Name the feature.',
      64,
      `Usage: ${PROGRAM} plan <slug> [--title "Feature title"]`,
    );
  }
  const slug = isSlug(raw) ? raw : slugify(raw);
  if (!isSlug(slug)) {
    throw new CliError(`"${raw}" does not reduce to a kebab-case slug.`, 64);
  }

  const { config, root } = loadConfig();
  const dir = join(inRoot(root, config.plans), slug);
  if (exists(join(dir, 'plan.yml'))) {
    throw new CliError(
      `A plan already exists at ${config.plans}/${slug}/.`,
      1,
      'Ask your agent to resume it rather than starting a second plan for the same outcome.',
    );
  }

  const title =
    flagString(args, 'title') ?? slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
  writeText(join(dir, 'plan.yml'), serializePlan(newPlan(slug, title)));

  ok(`Opened ${config.plans}/${slug}/plan.yml at the requirements stage`);
  out('');
  out(`${style.bold('Next')}: ask your agent to ${style.cyan(`"Make a plan to implement ${title}"`)}.`);
  out(
    style.dim(
      `  It writes the requirements, specification and tickets from your sources, then stops for your review.`,
    ),
  );
  if (config.backlog) {
    out(
      style.dim(
        `  Working from the board instead? "npx collab-swarm claim ${slug}" also pushes the branch that tells everyone else the row is taken.`,
      ),
    );
  }
  return 0;
}
