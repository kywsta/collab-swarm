/**
 * The delivery history: what this repository has delivered, compacted from the
 * plans that built it.
 *
 * A complete plan is worth reading while its feature is fresh and is noise once
 * it is not: its tickets are done, its sequencing is spent, and an agent that
 * searches the plans finds requirements the code may since have outgrown. The
 * history keeps one row per compacted plan — what it delivered, and the commit
 * that still holds every file of it — so the plan directory can go.
 *
 * Done was the one fact a plan directory carried for the board, so the history
 * carries it too: a `delivered` or `superseded` row is done exactly as a
 * complete plan on the default branch is, and a row that depends on it stays
 * unblocked after the plan is gone.
 */

import { join } from 'node:path';
import type { Config } from '../config.js';
import { inRoot } from '../config.js';
import { exists, listFiles, readText, readTextOrNull } from '../util/fs.js';
import { asString, isSlug, readFrontMatter } from '../util/yaml.js';
import type { Board } from './board.js';
import { Git } from './git.js';
import { changeFile, listPlanDirs, readPlan, readTickets } from './plan.js';
import { cells, normalizeHeader, Register, SEPARATOR_ROW } from './register.js';

export const HISTORY_FILE = 'HISTORY.md';

/** The history's path relative to the repository root: beside the plans it replaces. */
export const historyPath = (plansDir: string) => `${plansDir}/${HISTORY_FILE}`;

export const HISTORY_STATUSES = ['delivered', 'superseded', 'dropped'] as const;
export type HistoryStatus = (typeof HISTORY_STATUSES)[number];

export interface HistoryEntry {
  slug: string;
  title: string;
  /** The status cell's first word, lowercased: `superseded by x` reads as `superseded`. */
  status: string;
  completed: string;
  /** A commit that still holds `<plans>/<slug>/`, so any file of it can be read back. */
  commit: string;
  notes: string;
}

/**
 * Delivered work is done for every row that waits on it, and so is work that
 * shipped and was later replaced; a dropped plan never shipped anything.
 */
export const countsAsDone = (entry: HistoryEntry) =>
  entry.status === 'delivered' || entry.status === 'superseded';

export const isCommit = (value: string) => /^[0-9a-f]{7,64}$/.test(value);

const COLUMNS = {
  slug: ['slug', 'feature', 'change'],
  title: ['title', 'name', 'summary'],
  status: ['status'],
  completed: ['completed', 'completedon', 'closed', 'closedon', 'date'],
  commit: ['commit', 'sha', 'planat'],
  notes: ['notes', 'note'],
} as const;

type Column = keyof typeof COLUMNS;

/**
 * Every row of every table carrying both a `Slug` and a `Status` column.
 *
 * Other tables — the settled questions, the closed gates — are for the reader
 * and are skipped here; the board reads the settled questions through the
 * decisions parser instead.
 */
export function parseHistory(text: string): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  let header: Partial<Record<Column, number>> | null = null;

  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (!line.trimStart().startsWith('|')) {
      header = null;
      continue;
    }
    if (SEPARATOR_ROW.test(line.trim())) continue;
    if (header === null) {
      const names = cells(line).map(normalizeHeader);
      header = {};
      for (const [field, aliases] of Object.entries(COLUMNS) as [Column, readonly string[]][]) {
        const at = names.findIndex((name) => aliases.includes(name));
        if (at >= 0) header[field] = at;
      }
      continue;
    }
    if (header.slug === undefined || header.status === undefined) continue;

    const values = cells(line);
    const at = (field: Column) => {
      const index = header![field];
      return index === undefined ? '' : (values[index] ?? '');
    };
    const slugCell = at('slug');
    const slug = /`?([^`\s]+)`?/.exec(slugCell)?.[1] ?? '';
    if (slug === '') continue;
    entries.push({
      slug,
      title: at('title'),
      status: (at('status').split(/\s+/)[0] ?? '').toLowerCase(),
      completed: at('completed'),
      commit: at('commit').replace(/`/g, '').trim(),
      notes: at('notes'),
    });
  }
  return entries;
}

/** Slugs the history settles as done, for the board. */
export const doneSlugs = (entries: HistoryEntry[]) =>
  new Set(entries.filter(countsAsDone).map((entry) => entry.slug));

// ---------------------------------------------------------------------------
// Survey: what the plans directory and the backlog hold that could be compacted
// ---------------------------------------------------------------------------

/**
 * What may happen to a plan directory.
 *
 * - `ready`: complete, held by the default branch exactly as it is here, and
 *   waiting on nothing — it can be compacted.
 * - `deferred-work`: complete, but a deferred ticket is still owed; compacting
 *   it would lose the only record of that work unless it is lifted first.
 * - `unmerged`: the default branch does not hold this directory as it is here,
 *   so Git could not give it back after it was deleted.
 * - `orphaned`: never completed, has no backlog row, and nobody has touched it
 *   for weeks — probably abandoned or superseded, which is the user's call.
 * - `live`: work in progress; never compacted.
 */
export type Verdict = 'ready' | 'deferred-work' | 'unmerged' | 'orphaned' | 'live';

export interface Candidate {
  slug: string;
  kind: 'plan' | 'change';
  title: string;
  status: string;
  /** The register row's milestone, or null when the slug has no row. */
  milestone: string | null;
  /** Last commit on the default branch touching the directory: what a history row names. */
  commit: string | null;
  committedAt: Date | null;
  files: number;
  lines: number;
  deferred: { slug: string; title: string }[];
  verdict: Verdict;
}

export interface Retirable {
  /** Milestones whose every row is done: the whole section can collapse into the history. */
  milestones: { id: string; name: string; rows: string[] }[];
  /** Gates no longer open that no unfinished row names. */
  gates: { id: string; name: string; owner: string; status: string }[];
  /** Questions answered (not merely assumed) that nothing unfinished cites. */
  decisions: { id: string; question: string }[];
}

export interface HistoryProblem {
  slug: string;
  message: string;
}

export interface Survey {
  /** The history file, relative to the root. */
  file: string;
  entries: HistoryEntry[];
  /** History rows whose commit cannot give their plan back. */
  problems: HistoryProblem[];
  candidates: Candidate[];
  retirable: Retirable | null;
  /** The ref the survey compared against: `origin/main`, `main`, or null without Git. */
  ref: string | null;
}

const DAY = 24 * 60 * 60 * 1000;
const ORPHANED_AFTER_DAYS = 28;

/** The remote default branch when it exists, else the local one. */
function defaultRef(git: Git, config: Config): string | null {
  const { remote, defaultBranch } = config.git;
  for (const ref of [`${remote}/${defaultBranch}`, defaultBranch]) {
    if (git.maybe(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) !== null) return ref;
  }
  return null;
}

const countLines = (text: string) => (text === '' ? 0 : text.split('\n').length);

function readDirectory(
  root: string,
  config: Config,
  slug: string,
  git: Git,
  ref: string | null,
  rows: Map<string, string>,
  now: Date,
): Candidate | null {
  const relDir = `${config.plans}/${slug}`;
  const dir = inRoot(root, relDir);
  const files = listFiles(dir);
  const lines = files.reduce((sum, file) => sum + countLines(readText(join(dir, file))), 0);

  let kind: Candidate['kind'];
  let title: string;
  let status: string;
  let complete: boolean;
  let deferred: Candidate['deferred'] = [];

  const change = readTextOrNull(changeFile(dir));
  if (change !== null) {
    const front = readFrontMatter(change)?.data ?? {};
    kind = 'change';
    title = asString(front.title) ?? slug;
    status = asString(front.status) ?? 'unknown';
    complete = status === 'complete';
  } else {
    const plan = readPlan(dir);
    if (!plan) return null;
    kind = 'plan';
    title = plan.title || slug;
    status = plan.status || 'unknown';
    complete = plan.status === 'complete';
    deferred = readTickets(dir)
      .filter((ticket) => ticket.status === 'deferred')
      .map((ticket) => ({ slug: ticket.slug, title: ticket.title }));
  }

  let commit: string | null = null;
  let committedAt: Date | null = null;
  let held = false;
  if (ref !== null) {
    const last = git.text(['log', '-1', '--format=%H%x09%cI', ref, '--', relDir]).trim();
    if (last !== '') {
      const [sha, at] = last.split('\t');
      commit = sha!.slice(0, 12);
      committedAt = at ? new Date(at) : null;
      const untracked = git.text(['ls-files', '--others', '--exclude-standard', '--', relDir]).trim();
      held = untracked === '' && git.run(['diff', '--quiet', ref, '--', relDir]).ok;
    }
  }

  const milestone = rows.get(slug) ?? null;
  const idle = committedAt !== null && now.getTime() - committedAt.getTime() > ORPHANED_AFTER_DAYS * DAY;

  let verdict: Verdict;
  if (complete) {
    verdict = !held ? 'unmerged' : deferred.length > 0 ? 'deferred-work' : 'ready';
  } else if (held && idle && (kind === 'change' || !rows.has(slug))) {
    verdict = 'orphaned';
  } else {
    verdict = 'live';
  }

  return {
    slug,
    kind,
    title,
    status,
    milestone,
    commit,
    committedAt,
    files: files.length,
    lines,
    deferred,
    verdict,
  };
}

/**
 * What the backlog holds that the board no longer needs to show. A question the
 * history already records was retired by an earlier pass, and is not offered again.
 */
function retirable(board: Board, liveText: string, retired: Set<string>): Retirable {
  const register = board.register;
  const unfinished = board.rows.filter((row) => row.state !== 'done').map((row) => row.row);

  const byMilestone = new Map<string, string[]>();
  for (const row of board.rows) {
    if (row.row.milestone === '') continue;
    const list = byMilestone.get(row.row.milestone) ?? [];
    list.push(row.row.slug);
    byMilestone.set(row.row.milestone, list);
  }
  const milestones = [...byMilestone.entries()]
    .filter(([, slugs]) => slugs.every((slug) => board.find(slug)?.state === 'done'))
    .map(([id, rows]) => ({ id, name: register.milestoneName(id) ?? '', rows }));

  const cited = (id: string) => new RegExp(`\\b${id}\\b`).test(liveText);

  const gates = register
    .listGates()
    .filter((gate) => !register.gateBlocks(gate.id))
    .filter((gate) => !unfinished.some((row) => row.gates.includes(gate.id)) && !cited(gate.id))
    .map(({ id, name, owner, status }) => ({ id, name, owner, status }));

  const decisions = register
    .listDecisions()
    .filter((decision) => decision.settledBy === 'answer' && !retired.has(decision.id))
    .filter((decision) => !unfinished.some((row) => row.decisions.includes(decision.id)) && !cited(decision.id))
    .map(({ id, question }) => ({ id, question }));

  return { milestones, gates, decisions };
}

/**
 * Reads the history, every plan and recorded change, and — when a board is
 * given — the backlog, and says what each could become.
 *
 * Nothing is written. Deciding what was superseded, what lasting knowledge a
 * plan holds, and what to tell the team is the `compact-history` skill's work;
 * this only gathers the facts it needs, the same way every time.
 */
export function survey(
  root: string,
  config: Config,
  options: { board?: Board | null; now?: Date } = {},
): Survey {
  const git = new Git(root);
  const ref = git.available ? defaultRef(git, config) : null;
  const now = options.now ?? new Date();
  const file = historyPath(config.plans);
  const text = readTextOrNull(inRoot(root, file)) ?? '';
  const entries = parseHistory(text);

  const problems: HistoryProblem[] = [];
  if (git.available) {
    for (const entry of entries) {
      if (!isCommit(entry.commit)) continue;
      const path = `${entry.commit}:${config.plans}/${entry.slug}`;
      if (git.maybe(['cat-file', '-e', path]) === null) {
        problems.push({
          slug: entry.slug,
          message: `commit ${entry.commit} does not hold ${config.plans}/${entry.slug}/, so its plan cannot be read back`,
        });
      }
    }
  }

  const rows = new Map<string, string>(
    (options.board?.rows ?? []).map((row) => [row.row.slug, row.row.milestone]),
  );
  const plansRoot = inRoot(root, config.plans);
  const candidates = listPlanDirs(plansRoot)
    .map((slug) => readDirectory(root, config, slug, git, ref, rows, now))
    .filter((candidate): candidate is Candidate => candidate !== null);

  const liveText = candidates
    .filter((candidate) => candidate.verdict !== 'ready')
    .flatMap((candidate) => {
      const dir = join(plansRoot, candidate.slug);
      return listFiles(dir).map((name) => readText(join(dir, name)));
    })
    .join('\n');

  return {
    file,
    entries,
    problems,
    candidates,
    retirable: options.board
      ? retirable(options.board, liveText, new Set(Register.parseDecisions(text).keys()))
      : null,
    ref,
  };
}

/** Findings for `validate`: the history's shape, and no slug both compacted and live. */
export function historyFindings(
  root: string,
  config: Config,
): { message: string; severity: 'error' | 'warning' }[] {
  const text = readTextOrNull(inRoot(root, historyPath(config.plans)));
  if (text === null) return [];
  const found: { message: string; severity: 'error' | 'warning' }[] = [];
  const error = (message: string) => found.push({ message, severity: 'error' });
  const seen = new Set<string>();

  for (const entry of parseHistory(text)) {
    const name = `"${entry.slug}"`;
    if (!isSlug(entry.slug)) error(`${name} is not a kebab-case slug`);
    if (!(HISTORY_STATUSES as readonly string[]).includes(entry.status)) {
      error(`${name} has status "${entry.status}"; it must start with ${HISTORY_STATUSES.join(', ')}`);
    }
    if (!isCommit(entry.commit)) {
      error(`${name} must name the commit that still holds its plan, so the plan can be read back`);
    }
    if (seen.has(entry.slug)) error(`${name} appears more than once`);
    seen.add(entry.slug);
    if (exists(inRoot(root, `${config.plans}/${entry.slug}`))) {
      error(
        `${name} is in the history and still has a plan directory; ` +
          'delete the directory once the row is written, or remove the row if the plan is still live',
      );
    }
    if (entry.status === 'superseded' && !/`[a-z0-9-]+`/.test(entry.notes)) {
      found.push({
        message: `${name} is superseded; name what replaced it in its notes, as a backticked slug`,
        severity: 'warning',
      });
    }
  }
  return found;
}

/** Reads the history at a Git ref; null when the ref does not hold one. */
export function historyAt(git: Git, ref: string, plansDir: string): HistoryEntry[] | null {
  const text = git.show(ref, historyPath(plansDir));
  return text === null ? null : parseHistory(text);
}
