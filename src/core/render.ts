import { style } from '../util/log.js';
import type { Board, BoardRow } from './board.js';

const date = (at: Date) => at.toISOString().slice(0, 10);

function ago(from: Date, now: Date): string {
  const ms = now.getTime() - from.getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'} ago`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return 'minutes ago';
}

const stageOf = (row: BoardRow): string => {
  const claim = row.claim;
  if (!claim || claim.stage === null) return 'no plan yet';
  return `stage ${claim.stage}${claim.status ? ` (${claim.status})` : ''}`;
};

export interface RenderOptions {
  now?: Date;
  lane?: string | null;
  count?: number;
  /** Command shown to the reader for claiming a row. */
  claimCommand?: string;
}

export function renderNext(board: Board, options: RenderOptions = {}): string {
  const lines: string[] = [];
  const picks = board.proposals({ lane: options.lane ?? null, count: options.count ?? 3 });

  if (picks.length === 0) {
    lines.push('Next up: nothing is available.');
  } else {
    lines.push(style.bold(`Next up${options.lane ? ` for ${options.lane}` : ''}`));
  }

  picks.forEach((pick, index) => {
    const row = pick.row;
    const dependents = board.register.dependents(row.slug);
    const rides = board.ridesOn(row);
    const parts = [
      board.register.describeMilestone(row.milestone),
      row.lane,
      row.size,
      `unblocks ${dependents.length}${dependents.length ? ` (${dependents.map((d) => d.slug).join(', ')})` : ''}`,
    ].filter(Boolean);
    if (rides.length) parts.push(`rides on ${rides.join(', ')}`);
    if (row.sources) parts.push(row.sources);
    lines.push(`${index + 1}. ${style.bold(row.slug)} — ${row.title} · ${parts.join(' · ')}`);
  });

  if (picks.length < (options.count ?? 3)) {
    const blocked = board.where('blocked');
    if (blocked.length > 0) {
      const next = blocked[0]!;
      lines.push(
        `Nothing else is available. Next to free: ${next.row.slug}, blocked by ${next.blockers.join('; ')}.`,
      );
    }
  }
  if (picks.length > 0) {
    lines.push(style.dim(`Claim one: ${options.claimCommand ?? 'npx collab-swarm claim <slug>'}`));
  }
  return lines.join('\n');
}

export function renderStatus(board: Board, options: RenderOptions = {}): string {
  const now = options.now ?? new Date();
  const lines: string[] = [];

  const counts = {
    done: board.where('done').length,
    inProgress: board.where('in-progress').length,
    available: board.where('available').length,
    blocked: board.where('blocked').length,
  };
  const milestone = board.currentMilestone;
  lines.push(
    style.bold(
      `Delivery board · ${date(now)} · ` +
        `milestone ${milestone === null ? 'all done' : board.register.describeMilestone(milestone)} · ` +
        `${counts.done} done · ${counts.inProgress} in progress · ` +
        `${counts.available} available · ${counts.blocked} blocked`,
    ),
  );

  const inProgress = board.where('in-progress');
  const pushed = inProgress.filter((row) => row.claim!.isPushed);
  const unpushed = inProgress.filter((row) => !row.claim!.isPushed);

  if (pushed.length > 0) {
    lines.push('', style.bold('In progress'));
    for (const row of pushed) {
      const claim = row.claim!;
      const parts = [row.row.slug, row.row.lane, stageOf(row), claim.holder, claim.ref].filter(Boolean);
      if (claim.lastCommitAt) parts.push(`last commit ${ago(claim.lastCommitAt, now)}`);
      const stale = board.isStale(claim, now)
        ? ` · ${style.yellow(`stale: no commit since ${date(claim.lastCommitAt!)}`)}`
        : '';
      lines.push(`- ${parts.join(' · ')}${stale}`);
    }
  }

  if (unpushed.length > 0) {
    lines.push('', style.bold('Unpushed plans in this checkout (invisible to everyone else)'));
    for (const row of unpushed) {
      lines.push(`- ${row.row.slug} · ${stageOf(row)} · push its branch to claim the row`);
    }
  }

  if (milestone !== null) {
    const gateLines: string[] = [];
    for (const row of board.where('blocked')) {
      if (row.row.milestone !== milestone) continue;
      for (const blocker of row.blockers) {
        if (!blocker.includes('is not done')) gateLines.push(`- ${blocker} · blocks ${row.row.slug}`);
      }
    }
    if (gateLines.length > 0) {
      lines.push('', style.bold(`Gates blocking ${board.register.describeMilestone(milestone)} rows`));
      lines.push(...[...new Set(gateLines)]);
    }
  }

  const done = board.where('done');
  if (done.length > 0) {
    lines.push('', `${style.green('Done')}: ${done.map((row) => row.row.slug).join(', ')}`);
  }

  lines.push('', renderNext(board, options));
  return lines.join('\n');
}
