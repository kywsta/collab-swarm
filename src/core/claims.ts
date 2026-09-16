/**
 * Delivery claims, read and written through Git alone.
 *
 * A claim is the branch `<prefix><slug>` on the remote carrying
 * `<plans>/<slug>/plan.yml`. Done is that plan complete on the default branch.
 * No tracker outside Git is consulted or written, so every developer and every
 * agent sees the same board after one fetch.
 */

import { join } from 'node:path';
import type { GitConfig } from '../config.js';
import { exists, listDirs, readText, writeText } from '../util/fs.js';
import { asDict, asString, isSlug, parseYaml } from '../util/yaml.js';
import { Git } from './git.js';
import { newPlan, serializePlan } from './plan.js';

export interface Claim {
  slug: string;
  /** Author of the claim's last commit, or the local Git user for an unpushed plan. */
  holder: string;
  /** `origin/feat/<slug>`, `origin/main`, or `local`. */
  ref: string;
  stage: string | null;
  status: string | null;
  lastCommitAt: Date | null;
  isPushed: boolean;
}

export const isComplete = (claim: Claim) => claim.status === 'complete';

export interface ClaimOutcome {
  ok: boolean;
  message: string;
  branch?: string;
}

export class Claims {
  private readonly git: Git;

  constructor(
    private readonly root: string,
    private readonly git_config: GitConfig,
    private readonly plansDir: string,
  ) {
    this.git = new Git(root);
  }

  private planPath(slug: string) {
    return `${this.plansDir}/${slug}/plan.yml`;
  }

  private branchOf(slug: string) {
    return `${this.git_config.branchPrefix}${slug}`;
  }

  private mainRef() {
    return `${this.git_config.remote}/${this.git_config.defaultBranch}`;
  }

  /** Every claim Git knows about, after at most one fetch. */
  read(options: { fetch?: boolean } = {}): Claim[] {
    if (!this.git.available) return this.localClaims(new Set());
    if (options.fetch !== false && this.git.hasRemote(this.git_config.remote)) {
      this.git.fetch(this.git_config.remote);
    }
    const claims = [...this.branchClaims(), ...this.mainClaims()];
    const known = new Set(claims.map((claim) => claim.slug));
    return [...claims, ...this.localClaims(known)];
  }

  private planAt(ref: string, slug: string): { stage: string | null; status: string | null } | null {
    const content = this.git.show(ref, this.planPath(slug));
    if (content === null) return null;
    try {
      const plan = asDict(parseYaml(content));
      return plan ? { stage: asString(plan.stage), status: asString(plan.status) } : null;
    } catch {
      return null;
    }
  }

  private branchClaims(): Claim[] {
    const prefix = `${this.git_config.remote}/${this.git_config.branchPrefix}`;
    const listing = this.git.text([
      'for-each-ref',
      '--format=%(refname:short)%09%(authorname)%09%(committerdate:iso-strict)',
      `refs/remotes/${prefix}`,
    ]);
    const claims: Claim[] = [];
    for (const line of listing.split('\n')) {
      if (line.trim() === '') continue;
      const parts = line.split('\t');
      const ref = parts[0] ?? '';
      const slug = ref.slice(prefix.length);
      if (!isSlug(slug)) continue;
      const plan = this.planAt(ref, slug);
      claims.push({
        slug,
        holder: parts[1] || 'unknown',
        ref,
        stage: plan?.stage ?? null,
        status: plan?.status ?? null,
        lastCommitAt: parts[2] ? new Date(parts[2]) : null,
        isPushed: true,
      });
    }
    return claims;
  }

  private mainClaims(): Claim[] {
    const ref = this.mainRef();
    const listing = this.git.maybe(['ls-tree', '--name-only', ref, `${this.plansDir}/`]);
    if (listing === null) return [];
    const claims: Claim[] = [];
    for (const path of listing.split('\n')) {
      if (path.trim() === '') continue;
      const slug = path.replace(/\/$/, '').split('/').pop() ?? '';
      if (!isSlug(slug)) continue;
      const plan = this.planAt(ref, slug);
      if (!plan) continue;
      const last = this.git
        .text(['log', '-1', '--format=%an%x09%cI', ref, '--', `${this.plansDir}/${slug}`])
        .trim()
        .split('\t');
      claims.push({
        slug,
        holder: last[0] || 'unknown',
        ref,
        stage: plan.stage,
        status: plan.status,
        lastCommitAt: last[1] ? new Date(last[1]) : null,
        isPushed: true,
      });
    }
    return claims;
  }

  /** Plans that exist in this checkout but nowhere on the remote. */
  private localClaims(known: Set<string>): Claim[] {
    const dir = join(this.root, this.plansDir);
    if (!exists(dir)) return [];
    const holder = this.git.available ? this.git.userName : 'you';
    const claims: Claim[] = [];
    for (const slug of listDirs(dir)) {
      if (known.has(slug) || !isSlug(slug)) continue;
      const file = join(dir, slug, 'plan.yml');
      if (!exists(file)) continue;
      const plan = asDict(parseYaml(readText(file)));
      claims.push({
        slug,
        holder,
        ref: 'local',
        stage: plan ? asString(plan.stage) : null,
        status: plan ? asString(plan.status) : null,
        lastCommitAt: null,
        isPushed: false,
      });
    }
    return claims;
  }

  /** Author of the last commit on a slug's remote branch, or null. */
  holderOf(slug: string): string | null {
    const ref = `${this.git_config.remote}/${this.branchOf(slug)}`;
    const holder = this.git.maybe(['log', '-1', '--format=%an', ref]);
    return holder === null ? null : holder.trim();
  }

  /**
   * Creates the claim branch from the remote default branch with a plan
   * skeleton, commits it, and pushes. A rejected push means someone else won
   * the race: the branch is removed and the checkout restored.
   */
  claim(slug: string, title: string, options: { fetch?: boolean; at?: Date } = {}): ClaimOutcome {
    if (!this.git.available) {
      return { ok: false, message: 'This directory is not a Git repository, so a claim cannot be recorded.' };
    }
    if (this.git.isDirty) {
      return {
        ok: false,
        message: 'The working tree has uncommitted changes. Commit or stash them, then claim again.',
      };
    }

    const remote = this.git_config.remote;
    const hasRemote = this.git.hasRemote(remote);
    if (options.fetch !== false && hasRemote) this.git.fetch(remote);

    const branch = this.branchOf(slug);
    const holder = hasRemote ? this.holderOf(slug) : null;
    if (holder) {
      return { ok: false, message: `"${slug}" is already claimed by ${holder} on ${remote}/${branch}.` };
    }
    if (this.git.maybe(['rev-parse', '--verify', '--quiet', branch]) !== null) {
      return {
        ok: false,
        message: `A local branch ${branch} already exists. Push it to claim the row, or delete it and claim again.`,
      };
    }

    const previous = this.git.currentBranch;
    const base = hasRemote && this.git.maybe(['rev-parse', '--verify', '--quiet', this.mainRef()]) !== null
      ? this.mainRef()
      : 'HEAD';
    const created = this.git.run(['switch', '--quiet', '-c', branch, base]);
    if (!created.ok) {
      return { ok: false, message: `Could not create ${branch} from ${base}: ${created.stderr.trim()}` };
    }

    const file = join(this.root, this.planPath(slug));
    writeText(file, serializePlan(newPlan(slug, title, options.at)));
    this.git.run(['add', '--', this.planPath(slug)]);
    const committed = this.git.run(['commit', '--quiet', '-m', `chore(${slug}): claim delivery row`]);
    if (!committed.ok) {
      this.restore(previous, branch);
      return { ok: false, message: `Could not commit the plan skeleton: ${committed.stderr.trim()}` };
    }

    if (!hasRemote) {
      return {
        ok: true,
        branch,
        message:
          `Claimed "${slug}" on the local branch ${branch} with ${this.planPath(slug)}. ` +
          `There is no "${remote}" remote, so nobody else can see this claim yet.`,
      };
    }

    const pushed = this.git.run(['push', '--quiet', '-u', remote, branch]);
    if (pushed.ok) {
      return {
        ok: true,
        branch,
        message: `Claimed "${slug}" on ${remote}/${branch} with ${this.planPath(slug)}.`,
      };
    }

    this.restore(previous, branch);
    this.git.fetch(remote);
    const winner = this.holderOf(slug) ?? 'someone else';
    return {
      ok: false,
      message:
        `Push rejected: "${slug}" was claimed by ${winner} first. Your checkout is back on ` +
        `${previous === '' ? 'the previous commit' : previous}.`,
    };
  }

  private restore(previous: string, branch: string): void {
    this.git.run(['switch', '--quiet', previous === '' ? '--detach' : previous]);
    this.git.run(['branch', '-D', branch]);
  }
}
