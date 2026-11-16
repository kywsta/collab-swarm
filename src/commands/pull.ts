import { flagBool, type Args } from '../cli.js';
import { loadConfig } from '../config.js';
import { Git } from '../core/git.js';
import { pullRepository, pullRoot, type PullOutcome } from '../core/pull.js';
import { out, style } from '../util/log.js';
import { boardConfig } from './board.js';

const MARK: Record<PullOutcome['state'], string> = {
  updated: style.green('✓'),
  current: style.green('✓'),
  kept: style.yellow('!'),
  unavailable: style.yellow('!'),
  failed: style.red('✗'),
};

/**
 * Code repositories now at a commit other than the one this hub records for
 * them. That is expected after a pull: the board measures each one against its
 * own default branch, and the hub's record moves only when someone commits it.
 */
function unrecorded(root: string, outcomes: PullOutcome[]): string[] {
  const hub = new Git(root);
  return outcomes
    .filter((outcome) => outcome.repository !== null && (outcome.state === 'updated' || outcome.state === 'current'))
    .filter((outcome) => {
      const recorded = hub.maybe(['rev-parse', '--verify', '--quiet', `HEAD:${outcome.path}`]);
      const actual = new Git(`${root}/${outcome.path}`).maybe(['rev-parse', 'HEAD']);
      return recorded !== null && actual !== null && recorded.trim() !== actual.trim();
    })
    .map((outcome) => outcome.repository!);
}

/**
 * Brings this checkout, and in a hub every code repository checked out here,
 * up to its remote default branch — wherever that is a fast-forward and no
 * work in progress is in the way — so what an agent reads from disk matches
 * the board. Never commits, merges, rebases, stashes or switches a branch with
 * work on it.
 */
export async function run(args: Args): Promise<number> {
  const { config: local, root } = loadConfig();
  const fetch = !flagBool(args, 'no-fetch');

  const outcomes: PullOutcome[] = [pullRoot(root, local.git.remote, local.git.defaultBranch, { fetch })];
  // After the fetch: a repository added on the default branch is pulled too.
  const { config } = boardConfig(root, local);
  for (const repository of Object.values(config.repositories)) {
    outcomes.push(pullRepository(root, repository, { fetch }));
  }
  const pointers = unrecorded(root, outcomes);

  if (flagBool(args, 'json')) {
    out(JSON.stringify({ checkouts: outcomes, unrecorded: pointers }, null, 2));
    return 0;
  }

  out('');
  out(style.bold('Pull · latest from each default branch'));
  for (const outcome of outcomes) {
    const name = outcome.repository ?? config.project ?? 'this repository';
    out(`  ${MARK[outcome.state]} ${name}: ${outcome.detail}`);
  }
  if (pointers.length > 0) {
    out('');
    out(
      style.dim(
        `  ${pointers.join(', ')} ${pointers.length === 1 ? 'is' : 'are'} ahead of the commit this hub records; ` +
          'git status shows that as a change. Commit the pointer only when you mean to.',
      ),
    );
  }
  out('');
  return 0;
}
