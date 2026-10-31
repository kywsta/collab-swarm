/**
 * Delivery claims, read and written through Git alone.
 *
 * A claim is the branch `<prefix><slug>` on the remote carrying
 * `<plans>/<slug>/plan.yml`. Done is that plan complete on the default branch,
 * or — once the plan has been compacted — its row in `<plans>/HISTORY.md` there.
 * In a hub, the plan names the code repositories it touches, and done also
 * needs the same branch merged in each of them. No tracker outside Git is
 * consulted or written, so every developer and every agent sees the same board
 * after one fetch.
 */

import { join } from 'node:path';
import type { GitConfig, RepositoryConfig } from '../config.js';
import { exists, listDirs, readText, writeText } from '../util/fs.js';
import { asDict, asString, isSlug, parseYaml } from '../util/yaml.js';
import { unverifiableClaim, type FetchFailure } from './freshness.js';
import { Git } from './git.js';
import { countsAsDone, historyAt } from './history.js';
import { newPlan, parsePlanRepositories, serializePlan, type PlanRepository } from './plan.js';
import {
  repositoryHandles,
  unknownRepository,
  type Repository,
  type RepositoryProgress,
} from './repositories.js';

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
  /** Done through a row in the delivery history; the plan directory is gone. */
  compacted?: boolean;
  /** Where the feature's branch stands in each code repository its plan names; absent outside a hub. */
  repositories?: RepositoryProgress[];
}

export const isComplete = (claim: Claim) => claim.status === 'complete';

/** Repositories the plan names whose branch has not merged yet. */
export const unmerged = (claim: Claim): RepositoryProgress[] =>
  (claim.repositories ?? []).filter((repository) => repository.state !== 'merged');

export interface ClaimOutcome {
  ok: boolean;
  message: string;
  branch?: string;
  /** One line per code repository the claim opened a branch in, or could not. */
  repositories?: string[];
}

interface PlanState {
  stage: string | null;
  status: string | null;
  repositories: PlanRepository[];
}

const readPlanState = (text: string): PlanState | null => {
  try {
    const plan = asDict(parseYaml(text));
    return plan
      ? {
          stage: asString(plan.stage),
          status: asString(plan.status),
          repositories: parsePlanRepositories(plan.repositories),
        }
      : null;
  } catch {
    return null;
  }
};

export class Claims {
  private readonly git: Git;
  private readonly handles: Map<string, Repository>;

  constructor(
    private readonly root: string,
    private readonly git_config: GitConfig,
    private readonly plansDir: string,
    repositories: Record<string, RepositoryConfig> = {},
  ) {
    this.git = new Git(root);
    this.handles = repositoryHandles(root, repositories);
  }

  private progress(slug: string, repositories: PlanRepository[]): RepositoryProgress[] {
    const branch = this.branchOf(slug);
    return repositories.map(
      (repository) =>
        this.handles.get(repository.name)?.progress(branch, repository.baseSha) ??
        unknownRepository(repository.name),
    );
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

  /**
   * Fetches this repository and every code repository checked out here, and
   * reports each one that has a remote but could not be fetched: its refs, and
   * so the board, are only as current as its last fetch.
   */
  fetch(): FetchFailure[] {
    const own = this.fetchOwn();
    return [...(own === null ? [] : [own]), ...this.fetchRepositories()];
  }

  /** Fetches this repository alone; the failure, or null. */
  fetchOwn(): FetchFailure | null {
    const remote = this.git_config.remote;
    if (this.git.available && this.git.hasRemote(remote) && !this.git.fetch(remote)) {
      return { repository: null, remote, lastFetchedAt: this.git.fetchedAt() };
    }
    return null;
  }

  /** Fetches each code repository checked out here; the ones that failed. */
  fetchRepositories(): FetchFailure[] {
    const failures: FetchFailure[] = [];
    for (const repository of this.handles.values()) {
      if (repository.checkedOut && !repository.fetch()) {
        failures.push({
          repository: repository.name,
          remote: repository.config.remote,
          lastFetchedAt: repository.git.fetchedAt(),
        });
      }
    }
    return failures;
  }

  /** Every claim Git knows about, after at most one fetch. */
  read(options: { fetch?: boolean } = {}): Claim[] {
    if (options.fetch !== false) this.fetch();
    if (!this.git.available) return this.localClaims(new Set());
    const claims = [...this.branchClaims(), ...this.mainClaims()];
    const known = new Set(claims.map((claim) => claim.slug));
    const compacted = this.historyClaims(known);
    for (const claim of compacted) known.add(claim.slug);
    return [...claims, ...compacted, ...this.localClaims(known)];
  }

  private planAt(ref: string, slug: string): PlanState | null {
    const content = this.git.show(ref, this.planPath(slug));
    return content === null ? null : readPlanState(content);
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
        repositories: this.progress(slug, plan?.repositories ?? []),
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
        repositories: this.progress(slug, plan.repositories),
      });
    }
    return claims;
  }

  /**
   * Plans compacted into the delivery history on the default branch. Their
   * directories are gone, so without these a delivered row would read as
   * available again and everything waiting on it as blocked.
   */
  private historyClaims(known: Set<string>): Claim[] {
    const ref = this.mainRef();
    const entries = historyAt(this.git, ref, this.plansDir) ?? [];
    return entries
      .filter((entry) => countsAsDone(entry) && !known.has(entry.slug))
      .map((entry) => ({
        slug: entry.slug,
        holder: 'history',
        ref,
        stage: 'complete',
        status: 'complete',
        lastCommitAt: null,
        isPushed: true,
        compacted: true,
        repositories: [],
      }));
  }

  /**
   * A plan here that the default branch once held and has since removed —
   * abandoned, or dropped — left over from before this checkout fell behind.
   * Read as unpushed work, it would hold its row as in progress.
   */
  private removedFromDefault(slug: string): boolean {
    if (!this.git.available) return false;
    const ref = this.mainRef();
    const path = this.planPath(slug);
    if (!this.git.hasCommit(ref) || this.git.show(ref, path) !== null) return false;
    if (this.git.hasCommit(`${this.git_config.remote}/${this.branchOf(slug)}`)) return false;
    return this.git.text(['log', '-1', '--format=%H', ref, '--', path]).trim() !== '';
  }

  private localPlanSlugs(): string[] {
    const dir = join(this.root, this.plansDir);
    if (!exists(dir)) return [];
    return listDirs(dir).filter((slug) => isSlug(slug) && exists(join(dir, slug, 'plan.yml')));
  }

  /** Plan directories here that the default branch has since removed; the board leaves them out. */
  removedPlans(): string[] {
    return this.localPlanSlugs()
      .filter((slug) => this.removedFromDefault(slug))
      .map((slug) => `${this.plansDir}/${slug}`);
  }

  /** Plans that exist in this checkout but nowhere on the remote. */
  private localClaims(known: Set<string>): Claim[] {
    const dir = join(this.root, this.plansDir);
    const holder = this.git.available ? this.git.userName : 'you';
    const claims: Claim[] = [];
    for (const slug of this.localPlanSlugs()) {
      if (known.has(slug) || this.removedFromDefault(slug)) continue;
      const file = join(dir, slug, 'plan.yml');
      const plan = readPlanState(readText(file));
      claims.push({
        slug,
        holder,
        ref: 'local',
        stage: plan?.stage ?? null,
        status: plan?.status ?? null,
        lastCommitAt: null,
        isPushed: false,
        repositories: this.progress(slug, plan?.repositories ?? []),
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
   * Opens the feature's branch in each named code repository, recording where
   * each one starts. A repository that cannot be opened from here is still
   * recorded, with no base, so the plan says where the work belongs and
   * `repos <slug> --open` can finish the job.
   */
  openRepositories(
    slug: string,
    names: string[],
    options: { fetch?: boolean } = {},
  ): { repositories: PlanRepository[]; lines: string[] } {
    const branch = this.branchOf(slug);
    const repositories: PlanRepository[] = [];
    const lines: string[] = [];
    for (const name of names) {
      const handle = this.handles.get(name);
      if (!handle) {
        repositories.push({ name, baseSha: null });
        lines.push(`${name}: not under repositories: in collab-swarm.yml, so no branch was opened`);
        continue;
      }
      const opened = handle.open(branch, options);
      repositories.push({ name, baseSha: opened.baseSha });
      lines.push(opened.message);
    }
    return { repositories, lines };
  }

  /**
   * Creates the claim branch from the remote default branch with a plan
   * skeleton, commits it, and pushes. A rejected push means someone else won
   * the race: the branch is removed and the checkout restored.
   *
   * With `repositories`, the same branch is first opened in each of those code
   * repositories and the plan records where each starts. Opening is safe to
   * repeat, so a lost race leaves behind only branches the winner will use.
   */
  claim(
    slug: string,
    title: string,
    options: { fetch?: boolean; at?: Date; repositories?: string[] } = {},
  ): ClaimOutcome {
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
    if (options.fetch !== false && hasRemote && !this.git.fetch(remote)) {
      const failure = { repository: null, remote, lastFetchedAt: this.git.fetchedAt() };
      return { ok: false, message: unverifiableClaim(slug, failure) };
    }

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

    const opened = this.openRepositories(slug, options.repositories ?? [], options);

    const previous = this.git.currentBranch;
    const base = hasRemote && this.git.maybe(['rev-parse', '--verify', '--quiet', this.mainRef()]) !== null
      ? this.mainRef()
      : 'HEAD';
    const created = this.git.run(['switch', '--quiet', '-c', branch, base]);
    if (!created.ok) {
      return { ok: false, message: `Could not create ${branch} from ${base}: ${created.stderr.trim()}` };
    }

    const file = join(this.root, this.planPath(slug));
    const sourcesSha = this.git.maybe(['rev-parse', base])?.trim() ?? null;
    writeText(file, serializePlan(newPlan(slug, title, options.at, opened.repositories, sourcesSha)));
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
        repositories: opened.lines,
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
        repositories: opened.lines,
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
