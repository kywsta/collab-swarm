/**
 * The code repositories a hub coordinates, read and written through Git alone.
 *
 * In a hub the plans live here and the code lands elsewhere: a submodule, or a
 * sibling checkout, each with its own remote and its own default branch. A
 * feature's branch has the same name in all of them, so the hub's claim and
 * the code it governs are found by one slug. A feature is delivered when its
 * plan is complete here *and* that branch has merged in every repository the
 * plan names — the plan alone cannot say the code reached anyone.
 */

import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RepositoryConfig } from '../config.js';
import { exists } from '../util/fs.js';
import { Git } from './git.js';

/**
 * - `merged`: the branch's commits are in the repository's default branch.
 * - `open`: the branch exists and has not merged, or has no commits yet.
 * - `missing`: no such branch, and nothing in the default branch says it merged.
 * - `unavailable`: the repository cannot be read from this checkout.
 */
export type MergeState = 'merged' | 'open' | 'missing' | 'unavailable';

export interface RepositoryProgress {
  name: string;
  state: MergeState;
  /** Commits on the feature branch that the default branch does not have. */
  ahead: number;
  /** One line a reader can act on. */
  detail: string;
}

export interface OpenOutcome {
  ok: boolean;
  /** Whether this call pushed the branch, rather than finding it already there. */
  created: boolean;
  /** The default-branch commit the branch starts from: the repository's review base. */
  baseSha: string | null;
  message: string;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class Repository {
  readonly git: Git;
  readonly dir: string;

  constructor(
    root: string,
    readonly config: RepositoryConfig,
  ) {
    this.dir = resolve(root, config.path);
    this.git = new Git(this.dir);
  }

  get name(): string {
    return this.config.name;
  }

  /**
   * True when the directory is a checkout of its own. An uninitialised
   * submodule is an empty directory, and Git run inside it would silently
   * answer for the hub around it.
   */
  get checkedOut(): boolean {
    if (!exists(this.dir)) return false;
    const top = this.git.maybe(['rev-parse', '--show-toplevel']);
    if (top === null) return false;
    try {
      return realpathSync(top.trim()) === realpathSync(this.dir);
    } catch {
      return false;
    }
  }

  /** How to make it readable, for a message that stops on it. */
  get checkoutHint(): string {
    return `${this.config.path} is not checked out here: git submodule update --init ${this.config.path}`;
  }

  get defaultRef(): string {
    return `${this.config.remote}/${this.config.defaultBranch}`;
  }

  remoteRef(branch: string): string {
    return `${this.config.remote}/${branch}`;
  }

  /** Fetches its remote. False only when it has one and the fetch failed. */
  fetch(): boolean {
    return !this.git.hasRemote(this.config.remote) || this.git.fetch(this.config.remote);
  }

  /** The full SHA a ref or abbreviation names, or null. */
  sha(ref: string): string | null {
    const out = this.git.maybe(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return out === null ? null : out.trim();
  }

  /** Where a feature branch stands against the repository's default branch. */
  progress(branch: string, baseSha: string | null): RepositoryProgress {
    const report = (state: MergeState, detail: string, ahead = 0): RepositoryProgress => ({
      name: this.name,
      state,
      ahead,
      detail,
    });
    if (!this.checkedOut) return report('unavailable', this.checkoutHint);

    const target = this.config.defaultBranch;
    if (this.sha(this.defaultRef) === null) {
      return report(
        'unavailable',
        `${this.defaultRef} does not exist here; fetch it, or correct defaultBranch for "${this.name}"`,
      );
    }

    const tip = this.sha(this.remoteRef(branch));
    if (tip !== null) {
      const ahead = Number.parseInt(
        this.git.text(['rev-list', '--count', `${this.defaultRef}..${tip}`]).trim(),
        10,
      ) || 0;
      if (ahead > 0) {
        return report('open', `${ahead} commit${ahead === 1 ? '' : 's'} not yet in ${target}`, ahead);
      }
      // Every commit on the branch is already in the default branch. That is a
      // merge only if the branch ever had commits of its own: one just cut from
      // the default branch is trivially contained in it.
      const base = baseSha === null ? null : this.sha(baseSha);
      if (base !== null && base !== tip) return report('merged', `merged into ${target}`);
      if (base === null && this.mergeEvidence(branch, null)) return report('merged', `merged into ${target}`);
      return report('open', 'no commits yet');
    }

    if (this.mergeEvidence(branch, baseSha === null ? null : this.sha(baseSha))) {
      return report('merged', `merged into ${target}; the branch has since been deleted`);
    }
    return report('missing', `no branch ${this.remoteRef(branch)}`);
  }

  /**
   * Whether the default branch records merging `branch`.
   *
   * A merged branch is often deleted, which takes the ancestry evidence with
   * it. What survives is the merge commit's message: GitLab writes
   * "Merge branch 'feat/x' into 'develop'", GitHub "Merge pull request #5 from
   * owner/feat/x". A squash merge keeps the branch name only when the squash
   * template includes it.
   */
  private mergeEvidence(branch: string, baseSha: string | null): boolean {
    const range = baseSha === null ? this.defaultRef : `${baseSha}..${this.defaultRef}`;
    const messages = this.git.text(['log', '--format=%B%x00', '--fixed-strings', `--grep=${branch}`, range]);
    if (messages.trim() === '') return false;
    const named = new RegExp(`(^|[^A-Za-z0-9._-])${escapeRegExp(branch)}($|[^A-Za-z0-9._/-])`, 'm');
    return messages.split('\0').some((message) => named.test(message));
  }

  /**
   * Pushes `branch` to the remote at the tip of the default branch, without
   * touching the working tree: the repository may be mid-way through someone
   * else's work, and a branch on the remote is all a claim needs.
   *
   * A branch already on the remote is kept, and its fork point becomes the
   * base, so opening is safe to repeat.
   */
  open(branch: string, options: { fetch?: boolean } = {}): OpenOutcome {
    const fail = (message: string): OpenOutcome => ({
      ok: false,
      created: false,
      baseSha: null,
      message: `${this.name}: ${message}`,
    });
    if (!this.checkedOut) return fail(this.checkoutHint);
    const remote = this.config.remote;
    if (!this.git.hasRemote(remote)) return fail(`${this.config.path} has no "${remote}" remote`);
    if (options.fetch !== false) this.git.fetch(remote);

    const tip = this.sha(this.defaultRef);
    if (tip === null) {
      return fail(`${this.defaultRef} does not exist in ${this.config.path}; correct defaultBranch for "${this.name}"`);
    }

    const existing = (): OpenOutcome | null => {
      const at = this.sha(this.remoteRef(branch));
      if (at === null) return null;
      const base = this.git.maybe(['merge-base', at, this.defaultRef]);
      return {
        ok: true,
        created: false,
        baseSha: base === null ? null : base.trim(),
        message: `${this.name}: ${this.remoteRef(branch)} already exists`,
      };
    };

    const found = existing();
    if (found) return found;

    const pushed = this.git.run(['push', '--quiet', remote, `${tip}:refs/heads/${branch}`]);
    if (!pushed.ok) {
      // Somebody pushed the same branch first. Same name, same feature: use it.
      this.git.fetch(remote);
      const raced = existing();
      if (raced) return raced;
      return fail(`could not push ${branch}: ${pushed.stderr.trim()}`);
    }
    // Some Git versions leave the remote-tracking ref for a refspec push alone.
    this.git.run(['update-ref', `refs/remotes/${this.remoteRef(branch)}`, tip]);
    return {
      ok: true,
      created: true,
      baseSha: tip,
      message: `${this.name}: opened ${this.remoteRef(branch)} from ${this.config.defaultBranch}`,
    };
  }
}

/** One handle per configured repository, by name. */
export function repositoryHandles(
  root: string,
  repositories: Record<string, RepositoryConfig>,
): Map<string, Repository> {
  return new Map(
    Object.values(repositories).map((config) => [config.name, new Repository(root, config)]),
  );
}

/** A repository the plan names but the configuration does not. */
export const unknownRepository = (name: string): RepositoryProgress => ({
  name,
  state: 'unavailable',
  ahead: 0,
  detail: `"${name}" is not under repositories: in collab-swarm.yml`,
});

/** `api (3 commits not yet in develop)`, for a board line. */
export const describeProgress = (progress: RepositoryProgress) =>
  `${progress.name} ${progress.state === 'merged' ? 'merged' : `(${progress.detail})`}`;
