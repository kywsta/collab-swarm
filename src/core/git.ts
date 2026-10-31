import { spawnSync } from 'node:child_process';
import { readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export class Git {
  constructor(private readonly cwd: string) {}

  run(args: string[]): GitResult {
    const result = spawnSync('git', args, { cwd: this.cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return {
      ok: result.status === 0,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? (result.error ? String(result.error.message) : ''),
    };
  }

  /** Output, or null when the command failed. Used for "does this ref exist". */
  maybe(args: string[]): string | null {
    const result = this.run(args);
    return result.ok ? result.stdout : null;
  }

  /** Output, or an empty string when the command failed. */
  text(args: string[]): string {
    return this.maybe(args) ?? '';
  }

  get available(): boolean {
    return this.maybe(['rev-parse', '--git-dir']) !== null;
  }

  get userName(): string {
    return this.text(['config', 'user.name']).trim() || 'you';
  }

  get currentBranch(): string {
    return this.text(['branch', '--show-current']).trim();
  }

  get headSha(): string | null {
    const sha = this.maybe(['rev-parse', 'HEAD']);
    return sha === null ? null : sha.trim();
  }

  /**
   * Tracked changes only: untracked plan drafts must not block a claim. A
   * submodule checked out at another commit is not a change either — in a hub
   * that is simply a code repository on its feature branch, and a claim
   * commits nothing but its own plan.
   */
  get isDirty(): boolean {
    return (
      this.text(['status', '--porcelain', '--untracked-files=no', '--ignore-submodules=all']).trim() !== ''
    );
  }

  /**
   * A failed fetch still empties `FETCH_HEAD`, which would lose when the last
   * one succeeded, so it is put back as it was.
   */
  fetch(remote: string): boolean {
    const head = this.fetchHead();
    let saved: { text: Buffer; atime: Date; mtime: Date } | null = null;
    try {
      if (head !== null) {
        const { atime, mtime } = statSync(head);
        saved = { text: readFileSync(head), atime, mtime };
      }
    } catch {
      /* never fetched */
    }
    const fetched = this.run(['fetch', '--prune', '--quiet', remote]).ok;
    if (!fetched && head !== null && saved !== null && saved.text.length > 0) {
      try {
        writeFileSync(head, saved.text);
        utimesSync(head, saved.atime, saved.mtime);
      } catch {
        /* the time is a courtesy; the failure is still reported */
      }
    }
    return fetched;
  }

  private fetchHead(): string | null {
    const path = this.maybe(['rev-parse', '--git-path', 'FETCH_HEAD']);
    return path === null ? null : resolve(this.cwd, path.trim());
  }

  /** When this checkout last fetched something, from `FETCH_HEAD`, or null when it never has. */
  fetchedAt(): Date | null {
    const head = this.fetchHead();
    if (head === null) return null;
    try {
      const stat = statSync(head);
      return stat.size > 0 ? stat.mtime : null;
    } catch {
      return null;
    }
  }

  hasRemote(remote: string): boolean {
    return this.text(['remote'])
      .split('\n')
      .map((line) => line.trim())
      .includes(remote);
  }

  /** File content at a ref, or null when the path does not exist there. */
  show(ref: string, path: string): string | null {
    return this.maybe(['show', `${ref}:${path}`]);
  }

  /** Whether a ref names a commit here. */
  hasCommit(ref: string): boolean {
    return this.maybe(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) !== null;
  }

  /** Commits in `tip` that `base` does not have, or null when either does not exist. */
  countAhead(base: string, tip: string): number | null {
    const count = this.maybe(['rev-list', '--count', `${base}..${tip}`]);
    return count === null ? null : Number.parseInt(count.trim(), 10) || 0;
  }

  /** Merge base of HEAD and a ref, for a standalone review base. */
  mergeBase(ref: string): string | null {
    const sha = this.maybe(['merge-base', 'HEAD', ref]);
    return sha === null ? null : sha.trim();
  }
}
