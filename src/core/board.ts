/**
 * The delivery board: the feature register joined with the claims Git holds.
 *
 * Nothing outside the repository records state, so every developer and every
 * agent sees the same board after one fetch.
 */

import { isComplete, type Claim } from './claims.js';
import { milestoneIndex, sizeIndex, type Register, type RegisterRow } from './register.js';

export type RowState = 'done' | 'in-progress' | 'available' | 'blocked';

export interface BoardRow {
  row: RegisterRow;
  state: RowState;
  claim: Claim | null;
  /** Human-readable reasons; empty unless the state is blocked. */
  blockers: string[];
}

export interface BoardOptions {
  /** Gate ids that never block, because their work is planned around instead. */
  nonBlockingGates?: string[];
  /** A claim with no commit for this long is called out as stale. */
  staleAfterDays?: number;
}

const DAY = 24 * 60 * 60 * 1000;

/** A complete plan on the default branch beats a lingering branch; anything pushed beats a local plan. */
function precedence(claim: Claim, defaultBranch: string): number {
  const onMain = claim.ref.endsWith(`/${defaultBranch}`);
  if (isComplete(claim) && onMain) return 3;
  if (claim.isPushed && !onMain) return 2;
  if (claim.isPushed) return 1;
  return 0;
}

export class Board {
  private constructor(
    readonly register: Register,
    readonly rows: BoardRow[],
    private readonly options: Required<BoardOptions>,
  ) {}

  static build(
    register: Register,
    claims: Claim[],
    defaultBranch: string,
    options: BoardOptions = {},
  ): Board {
    const settings: Required<BoardOptions> = {
      nonBlockingGates: options.nonBlockingGates ?? [],
      staleAfterDays: options.staleAfterDays ?? 28,
    };

    const bySlug = new Map<string, Claim>();
    for (const claim of claims) {
      const current = bySlug.get(claim.slug);
      if (!current || precedence(claim, defaultBranch) > precedence(current, defaultBranch)) {
        bySlug.set(claim.slug, claim);
      }
    }

    const done = new Set(
      [...bySlug.values()]
        .filter((claim) => isComplete(claim) && claim.ref.endsWith(`/${defaultBranch}`))
        .map((claim) => claim.slug),
    );

    const rows: BoardRow[] = register.rows.map((row) => {
      const claim = bySlug.get(row.slug) ?? null;
      if (done.has(row.slug)) return { row, state: 'done', claim, blockers: [] };
      if (claim) return { row, state: 'in-progress', claim, blockers: [] };

      const blockers: string[] = [];
      for (const dependency of row.dependsOn) {
        if (!done.has(dependency)) blockers.push(`"${dependency}" is not done`);
      }
      for (const id of row.gates) {
        if (!register.gateBlocks(id, settings.nonBlockingGates)) continue;
        const gate = register.gate(id);
        blockers.push(
          gate
            ? `${register.describeGate(id)} (${gate.owner || 'no owner'}) is ${gate.status || 'open'}`
            : `${id} is missing from the gate tracker`,
        );
      }
      for (const id of row.decisions) {
        if (register.decisionBlocks(id)) {
          blockers.push(`${register.describeDecision(id)} has neither an answer nor a working assumption`);
        }
      }
      return { row, state: blockers.length === 0 ? 'available' : 'blocked', claim: null, blockers };
    });

    return new Board(register, rows, settings);
  }

  find(slug: string): BoardRow | undefined {
    return this.rows.find((row) => row.row.slug === slug);
  }

  where(state: RowState): BoardRow[] {
    return this.rows.filter((row) => row.state === state);
  }

  /** The earliest milestone holding a row that is not done. */
  get currentMilestone(): string | null {
    for (const row of this.rows) {
      if (row.state !== 'done') return row.row.milestone;
    }
    return null;
  }

  isStale(claim: Claim, now: Date): boolean {
    if (!claim.lastCommitAt) return false;
    return now.getTime() - claim.lastCommitAt.getTime() > this.options.staleAfterDays * DAY;
  }

  /** Null when the row may be claimed now; otherwise the reason it may not. */
  whyNotAvailable(slug: string): string | null {
    const row = this.find(slug);
    if (!row) return `"${slug}" is not in the feature register.`;
    switch (row.state) {
      case 'available':
        return null;
      case 'done':
        return `"${slug}" is already done (plan complete on ${row.claim?.ref ?? 'the default branch'}).`;
      case 'in-progress': {
        const claim = row.claim!;
        const where = claim.isPushed ? claim.ref : `${claim.ref} (unpushed plan in this checkout)`;
        return `"${slug}" is already claimed by ${claim.holder} on ${where}.`;
      }
      case 'blocked':
        return `"${slug}" is blocked by ${row.blockers.join('; ')}.`;
    }
  }

  /**
   * Available rows ranked by: earliest milestone, the asker's lane when named,
   * most rows unblocked, smallest size, then register order.
   */
  proposals(options: { lane?: string | null; count?: number } = {}): BoardRow[] {
    const lane = normalizeLane(options.lane ?? null, this.register);
    const order = new Map(this.rows.map((row, index) => [row.row.slug, index]));
    return this.where('available')
      .sort((a, b) => {
        const milestone = milestoneIndex(a.row.milestone) - milestoneIndex(b.row.milestone);
        if (milestone !== 0) return milestone;
        if (lane && a.row.lane !== b.row.lane) {
          if (a.row.lane === lane) return -1;
          if (b.row.lane === lane) return 1;
        }
        const dependents =
          this.register.dependents(b.row.slug).length - this.register.dependents(a.row.slug).length;
        if (dependents !== 0) return dependents;
        const size = sizeIndex(a.row.size) - sizeIndex(b.row.size);
        if (size !== 0) return size;
        return (order.get(a.row.slug) ?? 0) - (order.get(b.row.slug) ?? 0);
      })
      .slice(0, options.count ?? 3);
  }

  /** What lets an available row start: a decided gate, an assumption, a carve-out. */
  ridesOn(row: RegisterRow): string[] {
    const rides: string[] = [];
    for (const id of row.gates) {
      const gate = this.register.gate(id);
      if (this.options.nonBlockingGates.includes(id)) {
        rides.push(`${this.register.describeGate(id)} (planned around)`);
      } else if (gate && !this.register.gateBlocks(id, this.options.nonBlockingGates)) {
        rides.push(`${this.register.describeGate(id)} (${gate.status})`);
      }
    }
    for (const id of row.decisions) {
      if (this.register.decisionBlocks(id)) continue;
      const settledBy = this.register.decision(id)?.settledBy;
      rides.push(
        settledBy === 'assumption'
          ? `a working assumption for ${this.register.describeDecision(id)}`
          : `the answer to ${this.register.describeDecision(id)}`,
      );
    }
    return rides;
  }
}

/** Matches a lane the user names loosely: "2", "dev 2", "Ana" against the register's lanes. */
export function normalizeLane(lane: string | null, register: Register): string | null {
  if (!lane) return null;
  const lanes = [...new Set(register.rows.map((row) => row.lane).filter(Boolean))];
  const wanted = lane.trim().toLowerCase();
  const exact = lanes.find((candidate) => candidate.toLowerCase() === wanted);
  if (exact) return exact;
  const contains = lanes.find(
    (candidate) => candidate.toLowerCase().includes(wanted) || wanted.includes(candidate.toLowerCase()),
  );
  if (contains) return contains;
  const digit = /\d+/.exec(wanted)?.[0];
  return digit ? (lanes.find((candidate) => candidate.includes(digit)) ?? null) : null;
}
