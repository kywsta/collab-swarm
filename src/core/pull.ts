/**
 * Bringing checkouts up to their remote default branches, where nothing is lost.
 *
 * The board reads the default branch on the remote, but the agent presenting
 * it reads this checkout: the backlog for a row's wording, the plans for what
 * was decided, the code for what exists. A checkout left behind by work merged
 * from other branches shows finished rows as open. Pulling first gives every
 * reader the same state the board describes.
 *
 * Only a fast-forward is ever made, and only where it cannot disturb work in
 * progress: a checkout on a feature branch, with uncommitted changes, or with
 * commits of its own stays exactly as it is. Its local default branch is still
 * moved when that is a fast-forward, since nothing has it checked out.
 */

import type { RepositoryConfig } from '../config.js';
import { Git } from './git.js';
import { Repository } from './repositories.js';

/**
 * - `updated`: moved forward to the remote default branch.
 * - `current`: already there.
 * - `kept`: left as it is, because moving it could disturb work in progress.
 * - `unavailable`: there is nothing here to pull: not checked out, no remote, no default branch.
 * - `failed`: the fetch or the fast-forward failed.
 */
export type PullState = 'updated' | 'current' | 'kept' | 'unavailable' | 'failed';

export interface PullOutcome {
  /** The code repository, or null for this one. */
  repository: string | null;
  path: string;
  state: PullState;
  /** The branch checked out afterwards, or null on a detached HEAD or when unavailable. */
  branch: string | null;
  /** Commits the checkout moved forward by. */
  commits: number;
  /** One line a reader can act on. */
  detail: string;
}

interface Target {
  git: Git;
  repository: string | null;
  path: string;
  remote: string;
  defaultBranch: string;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** The full SHA a ref names, or null. */
const sha = (git: Git, ref: string): string | null => {
  const out = git.maybe(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  return out === null ? null : out.trim();
};

const isAncestor = (git: Git, ancestor: string, descendant: string) =>
  git.run(['merge-base', '--is-ancestor', ancestor, descendant]).ok;

/** Whether another worktree has the branch checked out; moving it would leave that worktree's files behind. */
const checkedOutElsewhere = (git: Git, branch: string): boolean => {
  const listing = git.text(['worktree', 'list', '--porcelain']);
  const own = git.maybe(['rev-parse', '--show-toplevel'])?.trim() ?? '';
  let path = '';
  for (const line of listing.split('\n')) {
    if (line.startsWith('worktree ')) path = line.slice('worktree '.length);
    else if (line === `branch refs/heads/${branch}` && path !== own) return true;
  }
  return false;
};

/**
 * Moves the local default branch to the remote's when nothing has it checked
 * out and it has no commits of its own. Returns a clause for the outcome's
 * detail, or an empty string when there was nothing to say.
 */
function moveDefaultPointer(target: Target, remoteSha: string): string {
  const { git, defaultBranch } = target;
  const local = sha(git, `refs/heads/${defaultBranch}`);
  if (local === null || local === remoteSha) return '';
  if (!isAncestor(git, local, remoteSha)) {
    return `; its ${defaultBranch} has commits ${target.remote} does not, so it was not moved`;
  }
  if (checkedOutElsewhere(git, defaultBranch)) {
    return `; its ${defaultBranch} is checked out in another worktree, so it was not moved`;
  }
  const moved = git.run(['update-ref', `refs/heads/${defaultBranch}`, remoteSha, local]).ok;
  return moved ? `; moved its ${defaultBranch} to ${target.remote}/${defaultBranch}` : '';
}

function pullCheckout(target: Target, options: { fetch: boolean }): PullOutcome {
  const { git, remote, defaultBranch } = target;
  const outcome = (state: PullState, detail: string, commits = 0): PullOutcome => ({
    repository: target.repository,
    path: target.path,
    state,
    branch: git.currentBranch || null,
    commits,
    detail,
  });
  const upstream = `${remote}/${defaultBranch}`;

  if (!git.hasRemote(remote)) return outcome('unavailable', `no "${remote}" remote to pull from`);
  if (options.fetch && !git.fetch(remote)) return outcome('failed', `could not fetch ${remote}; left as it is`);
  const remoteSha = sha(git, upstream);
  if (remoteSha === null) return outcome('unavailable', `${upstream} does not exist here`);

  const branch = git.currentBranch;
  const head = sha(git, 'HEAD');

  if (branch !== '' && branch !== defaultBranch) {
    return outcome('kept', `on ${branch}, a branch of its own; left as it is${moveDefaultPointer(target, remoteSha)}`);
  }
  if (git.isDirty) {
    return outcome('kept', `uncommitted changes on ${branch || 'a detached HEAD'}; left as it is`);
  }
  if (head !== null && !isAncestor(git, head, remoteSha)) {
    const where = branch === '' ? 'a detached HEAD' : branch;
    const ahead = git.countAhead(upstream, 'HEAD') ?? 0;
    return outcome(
      'kept',
      `${where} has ${plural(ahead, 'commit')} ${upstream} does not; left as it is` +
        (branch === '' ? moveDefaultPointer(target, remoteSha) : ''),
    );
  }

  const behind = head === null ? 0 : (git.countAhead('HEAD', upstream) ?? 0);

  if (branch === defaultBranch) {
    if (behind === 0) return outcome('current', `at ${upstream}`);
    const merged = git.run(['merge', '--ff-only', '--quiet', upstream]);
    if (!merged.ok) return outcome('failed', `could not fast-forward to ${upstream}: ${merged.stderr.trim()}`);
    return outcome('updated', `fast-forwarded ${plural(behind, 'commit')} to ${upstream}`, behind);
  }

  // A detached HEAD the default branch already contains — a submodule at the
  // commit its hub records, typically. Nothing would be lost by putting it on
  // the default branch at the remote's tip.
  const local = sha(git, `refs/heads/${defaultBranch}`);
  if (local !== null && !isAncestor(git, local, remoteSha)) {
    return outcome('kept', `detached, and its ${defaultBranch} has commits ${upstream} does not; left as it is`);
  }
  if (local !== null && checkedOutElsewhere(git, defaultBranch)) {
    return outcome('kept', `detached, and its ${defaultBranch} is checked out in another worktree; left as it is`);
  }
  const switched =
    local === null
      ? git.run(['switch', '--quiet', '-c', defaultBranch, '--track', upstream])
      : git.run(['update-ref', `refs/heads/${defaultBranch}`, remoteSha, local]).ok
        ? git.run(['switch', '--quiet', defaultBranch])
        : { ok: false, stdout: '', stderr: `could not move ${defaultBranch}` };
  if (!switched.ok) return outcome('failed', `could not switch to ${defaultBranch}: ${switched.stderr.trim()}`);
  return behind === 0
    ? outcome('updated', `was detached at ${upstream}; now on ${defaultBranch}`)
    : outcome('updated', `was detached ${plural(behind, 'commit')} behind; now on ${defaultBranch} at ${upstream}`, behind);
}

/** This checkout: the hub, or the only repository there is. */
export function pullRoot(
  root: string,
  remote: string,
  defaultBranch: string,
  options: { fetch?: boolean } = {},
): PullOutcome {
  const git = new Git(root);
  if (!git.available) {
    return {
      repository: null,
      path: '.',
      state: 'unavailable',
      branch: null,
      commits: 0,
      detail: 'not a Git repository',
    };
  }
  return pullCheckout({ git, repository: null, path: '.', remote, defaultBranch }, { fetch: options.fetch !== false });
}

/** A code repository the hub coordinates, onto its own default branch. */
export function pullRepository(
  root: string,
  config: RepositoryConfig,
  options: { fetch?: boolean } = {},
): PullOutcome {
  const repository = new Repository(root, config);
  if (!repository.checkedOut) {
    return {
      repository: config.name,
      path: config.path,
      state: 'unavailable',
      branch: null,
      commits: 0,
      detail: `not checked out: git submodule update --init ${config.path}`,
    };
  }
  return pullCheckout(
    {
      git: repository.git,
      repository: config.name,
      path: config.path,
      remote: config.remote,
      defaultBranch: config.defaultBranch,
    },
    { fetch: options.fetch !== false },
  );
}
