/**
 * Source impact: which rows and plans a change to the sources reaches.
 *
 * Every register row cites its sources in its `Sources` cell, and every plan's
 * requirements cite the sections it was written from. A change to a product,
 * design or contract document is therefore traceable to the work it touches
 * without anyone re-reading the whole backlog: diff the sources, find the
 * heading each changed line falls under, and match those against the
 * citations.
 *
 * Matching is lenient about how a citation is written — a path, a file name,
 * or a document id such as `PRD-02`, followed by `§3`, `#anchor` or a quoted
 * heading — and strict about what it reports: a row whose cited section
 * changed is told apart from one that only cites the same document.
 */

import type { Config } from '../config.js';
import { inRoot } from '../config.js';
import { readTextOrNull } from '../util/fs.js';
import { matchesGlob } from '../util/glob.js';
import { asDict, asString, parseYaml } from '../util/yaml.js';
import type { Board, RowState } from './board.js';
import type { Git } from './git.js';
import { historyPath } from './history.js';
import { sectionBody } from './plan.js';

export type ChangeKind = 'added' | 'modified' | 'deleted' | 'renamed';

export interface SourceChange {
  /** Where the document is now; for a deleted one, where it was. */
  path: string;
  /** Where a renamed document was. */
  previousPath: string | null;
  kind: ChangeKind;
  /** The key under `sources:` it belongs to: `product`, `api`. */
  source: string;
  /** The heading each changed region falls under, once each, in document order. */
  sections: string[];
  /** The heading trail of each changed region, outermost first. */
  regions: string[][];
  /** Every heading the document has now, for telling a moved citation from a changed one. */
  headings: string[];
}

/**
 * How far a change reaches the text citing it:
 * - `cited` — a section it cites changed, or it cites the whole document;
 * - `elsewhere` — it cites the document, but other sections changed;
 * - `removed` — the document it cites was deleted or renamed.
 */
export type Reach = 'cited' | 'elsewhere' | 'removed';

export interface Effect {
  path: string;
  kind: ChangeKind;
  reach: Reach;
  /** The changed sections that matter here: the cited ones, or every one for `elsewhere`. */
  sections: string[];
  /** Cited sections no heading answers to any more — renamed, renumbered or removed. */
  missing: string[];
  /** Where a renamed document went. */
  renamedTo: string | null;
}

export interface RowImpact {
  slug: string;
  title: string;
  milestone: string;
  state: RowState;
  /** Who holds the claim, for a row in progress or done. */
  holder: string | null;
  effects: Effect[];
}

/**
 * Whether a plan still reads the sources it was written from:
 * - `current` — nothing it cites changed on the default branch since;
 * - `drifted` — something it cites did;
 * - `unrecorded` — it has no `sources_sha`, so nobody can tell;
 * - `unreadable` — its `sources_sha` is not a commit this clone holds.
 */
export type DriftState = 'current' | 'drifted' | 'unrecorded' | 'unreadable';

export interface PlanDrift {
  slug: string;
  title: string;
  holder: string | null;
  /** Where the plan was read: a claim branch, the default branch, or `local`. */
  ref: string;
  stage: string | null;
  sourcesSha: string | null;
  state: DriftState;
  /** The plan cites no source document, so every change to the sources counts. */
  citesNothing: boolean;
  effects: Effect[];
}

export interface ImpactBase {
  sha: string;
  /** What the user passed, or the backlog's path when the default was used. */
  label: string;
  subject: string;
  date: string;
  /** `since` when the user named it; `backlog` when it is the last commit to the delivery plan. */
  reason: 'since' | 'backlog';
}

export interface ImpactReport {
  base: ImpactBase;
  changes: SourceChange[];
  /** Rows citing a changed source, in register order. */
  rows: RowImpact[];
  /** Changes no row cites: new work, or a document the cited ones must absorb first. */
  uncited: SourceChange[];
  /** Every plan in flight, against what the default branch holds now. */
  plans: PlanDrift[];
  /** The ref plans were compared against. */
  against: string;
}

/** Where a change falls when no heading precedes it. */
export const TOP = '(top of the document)';

/**
 * Source kinds left out of impact. Decisions reach rows through the ids in
 * their `Depends on` cells, which the board already resolves; a citation match
 * would only repeat that, less precisely.
 */
const NOT_CITED = new Set(['decisions']);

// ---------------------------------------------------------------------------
// Which files are sources

/** The source a path belongs to, or null for anything the plan does not read. */
export function sourceOf(path: string, config: Config): string | null {
  if (config.backlog && path === config.backlog) return null;
  if (path === historyPath(config.plans) || path.startsWith(`${config.plans}/`)) return null;
  for (const [key, source] of Object.entries(config.sources)) {
    if (NOT_CITED.has(key)) continue;
    if (source.paths.some((pattern) => matchesGlob(path, pattern))) return key;
  }
  return null;
}

const nulSplit = (text: string) => text.split('\0').filter((part) => part !== '');

/** Every source file at a ref, or in the working tree when `target` is null. */
export function sourceFiles(git: Git, config: Config, target: string | null): string[] {
  const listing =
    target === null
      ? git.text(['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
      : git.text(['ls-tree', '-r', '-z', '--name-only', target]);
  return [...new Set(nulSplit(listing))].filter((path) => sourceOf(path, config) !== null).sort();
}

// ---------------------------------------------------------------------------
// What changed, section by section

interface Outline {
  /** The heading trail in force at each line, 1-based; index 0 is before the first line. */
  trails: string[][];
  headings: string[];
}

const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

export function outline(text: string): Outline {
  const trails: string[][] = [[]];
  const headings: string[] = [];
  let stack: { level: number; text: string }[] = [];
  let fence: string | null = null;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const opener = FENCE.exec(line)?.[1]?.[0];
    if (opener) {
      fence = fence === null ? opener : fence === opener ? null : fence;
    } else if (fence === null) {
      const match = HEADING.exec(line);
      if (match && match[2]) {
        const level = match[1]!.length;
        stack = stack.filter((entry) => entry.level < level);
        stack.push({ level, text: match[2] });
        headings.push(match[2]);
      }
    }
    trails.push(stack.map((entry) => entry.text));
  }
  return { trails, headings };
}

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * The new-side lines each hunk touches. A pure deletion has no new lines, so
 * it stands at the line it followed: the section it was cut from.
 */
function changedLines(diff: string): number[] {
  const lines: number[] = [];
  for (const line of diff.split('\n')) {
    const match = HUNK.exec(line);
    if (!match) continue;
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    if (count === 0) lines.push(start);
    for (let at = start; at < start + count; at++) lines.push(at);
  }
  return lines;
}

const label = (trail: string[]) => trail[trail.length - 1] ?? TOP;

/**
 * Every source document that differs between `base` and `target`.
 *
 * With a `target`, the comparison is `base...target`: what the target gained
 * since the two diverged, so a branch's own edits to an owned contract never
 * read as the default branch moving. With none, it is `base` against the
 * working tree, untracked documents included.
 */
export function changedSources(
  git: Git,
  root: string,
  config: Config,
  base: string,
  target: string | null,
): SourceChange[] {
  const range = target === null ? [base] : [`${base}...${target}`];
  const entries: { kind: ChangeKind; path: string; previousPath: string | null }[] = [];
  const tokens = nulSplit(git.text(['diff', '--name-status', '-z', '-M', '--no-ext-diff', ...range]));
  for (let index = 0; index < tokens.length; index++) {
    const status = tokens[index]!;
    if (status.startsWith('R') || status.startsWith('C')) {
      const previousPath = tokens[++index]!;
      const path = tokens[++index]!;
      entries.push({ kind: status.startsWith('R') ? 'renamed' : 'added', path, previousPath: status.startsWith('R') ? previousPath : null });
      continue;
    }
    const path = tokens[++index]!;
    const kind: ChangeKind = status === 'A' ? 'added' : status === 'D' ? 'deleted' : 'modified';
    entries.push({ kind, path, previousPath: null });
  }
  if (target === null) {
    for (const path of nulSplit(git.text(['ls-files', '-z', '--others', '--exclude-standard']))) {
      entries.push({ kind: 'added', path, previousPath: null });
    }
  }

  const read = (path: string) =>
    target === null ? readTextOrNull(inRoot(root, path)) : git.show(target, path);

  const changes: SourceChange[] = [];
  for (const entry of entries) {
    const source = sourceOf(entry.path, config) ?? (entry.previousPath ? sourceOf(entry.previousPath, config) : null);
    if (source === null) continue;
    const change: SourceChange = { ...entry, source, sections: [], regions: [], headings: [] };
    if (entry.kind === 'modified' || entry.kind === 'renamed') {
      const shape = outline(read(entry.path) ?? '');
      const paths = entry.previousPath ? [entry.previousPath, entry.path] : [entry.path];
      const diff = git.text(['diff', '-U0', '--no-color', '--no-ext-diff', '-M', ...range, '--', ...paths]);
      const seen = new Set<string>();
      for (const line of changedLines(diff)) {
        const trail = shape.trails[Math.min(line, shape.trails.length - 1)] ?? [];
        const key = trail.join('\u0001');
        if (seen.has(key)) continue;
        seen.add(key);
        change.regions.push(trail);
      }
      change.sections = [...new Set(change.regions.map(label))];
      change.headings = shape.headings;
    }
    changes.push(change);
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

// ---------------------------------------------------------------------------
// Citations

export type AnchorKind = 'number' | 'slug' | 'text';

export interface Anchor {
  kind: AnchorKind;
  value: string;
  /** As written, for telling the reader which citation no longer resolves. */
  raw: string;
}

export interface Citation {
  path: string;
  /** Empty when some mention cites the document as a whole. */
  anchors: Anchor[];
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const stem = (name: string) => (name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name);

/**
 * The ways a cell may name a document: its path, its file name, a distinctive
 * stem (`02-auth`), and a document id (`PRD-02`, also written `PRD 2`). A bare
 * word such as `index` is not distinctive enough to count.
 */
function namePatterns(path: string): RegExp[] {
  const name = basename(path);
  const bare = stem(name);
  const literal = (text: string) => new RegExp(`(?<![\\w-])${escape(text)}(?![\\w])`, 'gi');
  const patterns = [literal(path), literal(name)];
  if (bare !== name && /[-_\d]/.test(bare) && bare.length >= 4) patterns.push(literal(bare));
  const id = /^([A-Za-z]+)[-_](\d+)/.exec(bare);
  if (id) patterns.push(new RegExp(`(?<![\\w-])${escape(id[1]!)}[-_ ]?0*${Number(id[2])}(?![\\d])`, 'gi'));
  return patterns;
}

const ANCHORS: { kind: AnchorKind; pattern: RegExp }[] = [
  { kind: 'number', pattern: /§+\s*(\d+(?:\.\d+)*)/g },
  { kind: 'number', pattern: /\bsec(?:tion|\.)?\s+(\d+(?:\.\d+)*)/gi },
  { kind: 'text', pattern: /§+\s*([A-Za-z][^,;§()]*[^,;§()\s])/g },
  { kind: 'slug', pattern: /(?:^|[\s(,;])#([A-Za-z0-9][\w-]*)/g },
  { kind: 'text', pattern: /"([^"\n]+)"/g },
  { kind: 'text', pattern: /“([^”\n]+)”/g },
];

function anchorsIn(segment: string): Anchor[] {
  const found: Anchor[] = [];
  for (const { kind, pattern } of ANCHORS) {
    for (const match of segment.matchAll(pattern)) {
      found.push({ kind, value: match[1]!.trim(), raw: match[0].trim() });
    }
  }
  return found;
}

/**
 * The documents a piece of text cites, out of `paths`, with the sections it
 * names for each. A section reference belongs to the document named before it,
 * up to the next document named.
 */
export function citations(text: string, paths: string[]): Citation[] {
  const mentions: { path: string; start: number; end: number }[] = [];
  for (const path of paths) {
    for (const pattern of namePatterns(path)) {
      for (const match of text.matchAll(pattern)) {
        mentions.push({ path, start: match.index, end: match.index + match[0].length });
      }
    }
  }
  // The longest name wins where two overlap: `docs/a/02-auth.md` over `02-auth`.
  mentions.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const kept: typeof mentions = [];
  for (const mention of mentions) {
    if (kept.some((other) => mention.start < other.end && other.start < mention.end)) continue;
    kept.push(mention);
  }
  kept.sort((a, b) => a.start - b.start);

  const byPath = new Map<string, { whole: boolean; anchors: Anchor[] }>();
  kept.forEach((mention, index) => {
    const segment = text.slice(mention.end, kept[index + 1]?.start ?? text.length);
    const anchors = anchorsIn(segment);
    const entry = byPath.get(mention.path) ?? { whole: false, anchors: [] };
    if (anchors.length === 0) entry.whole = true;
    entry.anchors.push(...anchors);
    byPath.set(mention.path, entry);
  });
  return [...byPath].map(([path, entry]) => ({ path, anchors: entry.whole ? [] : entry.anchors }));
}

/** GitHub's heading anchor: lower case, punctuation dropped, spaces as hyphens. */
export const headingSlug = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');

export function answers(heading: string, anchor: Anchor): boolean {
  switch (anchor.kind) {
    case 'number':
      return new RegExp(`^(?:§+\\s*|section\\s+)?0*${escape(anchor.value)}(?![\\d])`, 'i').test(heading.trim());
    case 'slug':
      return headingSlug(heading) === anchor.value.toLowerCase();
    case 'text':
      return heading.toLowerCase().includes(anchor.value.toLowerCase());
  }
}

function effectOf(change: SourceChange, citation: Citation): Effect {
  const effect: Effect = {
    path: change.path,
    kind: change.kind,
    reach: 'cited',
    sections: [],
    missing: [],
    renamedTo: null,
  };
  if (change.kind === 'deleted') return { ...effect, reach: 'removed' };
  if (change.kind === 'renamed' && citation.path === change.previousPath) {
    return { ...effect, path: change.previousPath, reach: 'removed', renamedTo: change.path };
  }
  if (change.kind === 'added') return effect;
  // A document with no headings, such as a mockup, cannot be cited by section.
  if (citation.anchors.length === 0 || change.headings.length === 0) {
    return { ...effect, sections: change.sections };
  }
  const relevant = change.regions.filter((trail) =>
    trail.some((heading) => citation.anchors.some((anchor) => answers(heading, anchor))),
  );
  const missing = citation.anchors
    .filter((anchor) => !change.headings.some((heading) => answers(heading, anchor)))
    .map((anchor) => anchor.raw);
  if (relevant.length > 0 || missing.length > 0) {
    return { ...effect, sections: [...new Set(relevant.map(label))], missing: [...new Set(missing)] };
  }
  return { ...effect, reach: 'elsewhere', sections: change.sections };
}

/**
 * What `changes` do to the text citing them. `known` is every source path the
 * text might name, so a section reference after an unchanged document is not
 * mistaken for one belonging to the changed document named before it.
 */
export function impactOf(text: string, changes: SourceChange[], known: string[]): Effect[] {
  const paths = new Set(known);
  for (const change of changes) {
    paths.add(change.path);
    if (change.previousPath) paths.add(change.previousPath);
  }
  const cited = new Map(citations(text, [...paths]).map((citation) => [citation.path, citation]));
  const effects: Effect[] = [];
  for (const change of changes) {
    const citation = cited.get(change.path) ?? (change.previousPath ? cited.get(change.previousPath) : undefined);
    if (citation) effects.push(effectOf(change, citation));
  }
  return effects;
}

/** True when an effect means the citing work must be looked at again. */
export const matters = (effect: Effect) => effect.reach !== 'elsewhere';

// ---------------------------------------------------------------------------
// Plans in flight

/** The default branch as the remote has it, or the local one without a remote. */
export function defaultRef(git: Git, config: Config): string | null {
  const candidates = [`${config.git.remote}/${config.git.defaultBranch}`, config.git.defaultBranch];
  return candidates.find((ref) => git.maybe(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) !== null) ?? null;
}

export const isCommit = (git: Git, sha: string) =>
  git.maybe(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]) !== null;

/** Memoises the comparisons several plans planned from the same commit share. */
export class DriftReader {
  private readonly changes = new Map<string, SourceChange[]>();
  private known: string[] | null = null;

  constructor(
    private readonly git: Git,
    private readonly root: string,
    private readonly config: Config,
    /** The ref the sources are compared against: the default branch. */
    readonly against: string,
  ) {}

  /**
   * Whether the sources `citing` names changed on the default branch since
   * `sourcesSha`. Text citing no source at all is reached by every change.
   */
  drift(sourcesSha: string | null, citing: string): Pick<PlanDrift, 'state' | 'citesNothing' | 'effects'> {
    if (sourcesSha === null) return { state: 'unrecorded', citesNothing: false, effects: [] };
    if (!isCommit(this.git, sourcesSha)) return { state: 'unreadable', citesNothing: false, effects: [] };
    let changes = this.changes.get(sourcesSha);
    if (!changes) {
      changes = changedSources(this.git, this.root, this.config, sourcesSha, this.against);
      this.changes.set(sourcesSha, changes);
    }
    this.known ??= sourceFiles(this.git, this.config, this.against);
    const citesNothing = citations(citing, this.known).length === 0;
    const effects = citesNothing
      ? changes.map((change) => ({
          path: change.path,
          kind: change.kind,
          reach: 'cited' as const,
          sections: change.sections,
          missing: [],
          renamedTo: null,
        }))
      : impactOf(citing, changes, this.known);
    return { state: effects.some(matters) ? 'drifted' : 'current', citesNothing, effects };
  }
}

/** What a plan cites: its requirements' sources section and its register row's sources cell. */
export const planCitations = (requirements: string | null, rowSources: string) =>
  [requirements === null ? '' : (sectionBody(requirements, 'Sources') ?? ''), rowSources].join('\n');

function readSourcesSha(text: string | null): string | null {
  if (text === null) return null;
  try {
    return asString(asDict(parseYaml(text))?.sources_sha) || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The report

function resolveBase(git: Git, config: Config, since: string | null): ImpactBase | null {
  let sha: string | null;
  let label: string;
  let reason: ImpactBase['reason'];
  if (since !== null) {
    sha = git.maybe(['rev-parse', '--verify', '--quiet', `${since}^{commit}`])?.trim() ?? null;
    label = since;
    reason = 'since';
  } else {
    if (!config.backlog) return null;
    sha = git.maybe(['log', '-1', '--format=%H', '--', config.backlog])?.trim() || null;
    label = config.backlog;
    reason = 'backlog';
  }
  if (!sha) return null;
  const [subject = '', date = ''] = git.text(['log', '-1', '--format=%s%x09%cs', sha]).trim().split('\t');
  return { sha, label, subject, date, reason };
}

export class ImpactError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
  }
}

/**
 * Which rows the sources changed under since `since` — by default, since the
 * delivery plan was last committed, which is when it last agreed with them —
 * and which plans in flight were written from sources the default branch has
 * since moved past.
 */
export function sourceImpact(
  git: Git,
  root: string,
  config: Config,
  board: Board | null,
  options: { since?: string | null } = {},
): ImpactReport {
  const base = resolveBase(git, config, options.since ?? null);
  if (base === null) {
    throw options.since
      ? new ImpactError(`"${options.since}" is not a commit in this repository.`, 'Name a commit, branch or tag with --since.')
      : new ImpactError(
          'The delivery plan has never been committed, so there is no point at which it agreed with the sources.',
          'Name the commit the plan was last reconciled at with --since <ref>.',
        );
  }

  // Against the working tree, from where this checkout left the base: a
  // `--since` naming a branch ahead of this one must not read its changes as
  // this checkout undoing them.
  const from = git.maybe(['merge-base', base.sha, 'HEAD'])?.trim() || base.sha;
  const changes = changedSources(git, root, config, from, null);
  const known = sourceFiles(git, config, null);

  const rows: RowImpact[] = [];
  const reached = new Set<string>();
  for (const row of board?.rows ?? []) {
    const effects = impactOf(row.row.sources, changes, known);
    if (effects.length === 0) continue;
    for (const effect of effects) reached.add(effect.renamedTo ?? effect.path);
    rows.push({
      slug: row.row.slug,
      title: row.row.title,
      milestone: row.row.milestone,
      state: row.state,
      holder: row.claim && !row.claim.compacted ? row.claim.holder : null,
      effects,
    });
  }
  const uncited = changes.filter((change) => !reached.has(change.path));

  const against = defaultRef(git, config);
  const plans: PlanDrift[] = [];
  if (board && against) {
    const reader = new DriftReader(git, root, config, against);
    for (const row of board.where('in-progress')) {
      const claim = row.claim!;
      const read = (file: string) =>
        claim.ref === 'local'
          ? readTextOrNull(inRoot(root, `${config.plans}/${row.row.slug}/${file}`))
          : git.show(claim.ref, `${config.plans}/${row.row.slug}/${file}`);
      const sourcesSha = readSourcesSha(read('plan.yml'));
      plans.push({
        slug: row.row.slug,
        title: row.row.title,
        holder: claim.holder,
        ref: claim.ref,
        stage: claim.stage,
        sourcesSha,
        ...reader.drift(sourcesSha, planCitations(read('requirements.md'), row.row.sources)),
      });
    }
  }

  return { base, changes, rows, uncited, plans, against: against ?? config.git.defaultBranch };
}

// ---------------------------------------------------------------------------
// Drift, as validation reports it

/** The warning a plan in this checkout earns, if any; null when it reads its sources as they are. */
export interface DriftCheck {
  check(planDir: string, plan: { feature: string; status: string; sourcesSha: string | null }): string | null;
}

/**
 * Checks plans in this checkout against the default branch as last fetched.
 * Null outside Git or without a default branch to compare with. A
 * `sources_sha` this clone does not hold — a shallow CI checkout — is passed
 * over rather than reported, since nothing the plan's author did is wrong.
 */
export function driftCheck(git: Git, root: string, config: Config, rowSources: (slug: string) => string): DriftCheck | null {
  if (!git.available) return null;
  const against = defaultRef(git, config);
  if (against === null) return null;
  const reader = new DriftReader(git, root, config, against);
  return {
    check(planDir, plan) {
      if (plan.status === 'complete') return null;
      const requirements = readTextOrNull(`${planDir}/requirements.md`);
      if (plan.sourcesSha === null) {
        return requirements === null
          ? null
          : 'sources_sha is not recorded, so a change to the sources this plan was written from cannot be detected; ' +
              'set it to the commit the requirements were written from';
      }
      const drift = reader.drift(plan.sourcesSha, planCitations(requirements, rowSources(plan.feature)));
      if (drift.state !== 'drifted') return null;
      const effects = drift.effects.filter(matters);
      const shown = effects.slice(0, 3).map((effect) =>
        effect.reach === 'removed'
          ? `${effect.path} (${effect.renamedTo ? `renamed to ${effect.renamedTo}` : 'deleted'})`
          : effect.sections.length > 0
            ? `${effect.path} (${effect.sections.slice(0, 3).join('; ')})`
            : effect.path,
      );
      const more = effects.length > shown.length ? `, and ${effects.length - shown.length} more` : '';
      return (
        `sources this plan cites changed on ${against} since sources_sha ${plan.sourcesSha.slice(0, 12)}: ` +
        `${shown.join(', ')}${more}. Merge ${against}, revise the plan from the changed sections, ` +
        'and record the new sources_sha'
      );
    },
  };
}
