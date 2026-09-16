import { spawnSync } from 'node:child_process';

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

  /** Tracked changes only: untracked plan drafts must not block a claim. */
  get isDirty(): boolean {
    return this.text(['status', '--porcelain', '--untracked-files=no']).trim() !== '';
  }

  fetch(remote: string): boolean {
    return this.run(['fetch', '--prune', '--quiet', remote]).ok;
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

  /** Merge base of HEAD and a ref, for a standalone review base. */
  mergeBase(ref: string): string | null {
    const sha = this.maybe(['merge-base', 'HEAD', ref]);
    return sha === null ? null : sha.trim();
  }
}
