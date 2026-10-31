/**
 * How current a board is. A board read in a checkout that trails the default
 * branch, or after a fetch that failed, looks exactly like a current one, so
 * whatever makes it older than it seems is said out loud.
 */

export interface FetchFailure {
  /** The code repository whose fetch failed, or null for this one. */
  repository: string | null;
  remote: string;
  /** From `FETCH_HEAD`; null when that checkout has never fetched. */
  lastFetchedAt: Date | null;
}

export interface Freshness {
  /** The ref the register was read from, such as `origin/main`; null when it was read from this checkout. */
  ref: string | null;
  /** Commits on `ref` that this checkout's HEAD does not have. */
  behind: number;
  /** The working tree's backlog is not the one the board reads. */
  backlogDiffers: boolean;
  fetchFailures: FetchFailure[];
}

const asOf = (at: Date | null) => (at === null ? '' : ` (${at.toISOString().slice(0, 16).replace('T', ' ')} UTC)`);

/** `This checkout is 3 commits behind origin/main`, for a notice or a doctor line. */
export const behindBy = (ref: string, count: number) =>
  `This checkout is ${count} commit${count === 1 ? '' : 's'} behind ${ref}`;

/** One line per reason the board may be older, or read from elsewhere, than the reader assumes. */
export function notices(freshness: Freshness, backlog: string | null): string[] {
  const lines = freshness.fetchFailures.map((failure) =>
    failure.repository === null
      ? `Could not fetch ${failure.remote}; the board is as of the last fetch${asOf(failure.lastFetchedAt)}.`
      : `Could not fetch ${failure.repository} (${failure.remote}); its merge state is as of the last fetch${asOf(failure.lastFetchedAt)}.`,
  );
  const ref = freshness.ref;
  if (ref !== null && freshness.behind > 0) lines.push(`${behindBy(ref, freshness.behind)}; the board reads ${ref}.`);
  if (ref !== null && freshness.backlogDiffers) {
    lines.push(`This checkout's ${backlog} differs from ${ref}'s; the board reads ${ref}'s.`);
  }
  return lines;
}

/** Why a claim stops when its fetch failed: the remote is the only place a rival claim shows up. */
export const unverifiableClaim = (slug: string, failure: FetchFailure) =>
  `Could not fetch ${failure.remote}, so there is no way to check whether someone else holds "${slug}". ` +
  `Fix the connection and claim again, or pass --no-fetch to claim against the last fetch${asOf(failure.lastFetchedAt)}.`;
