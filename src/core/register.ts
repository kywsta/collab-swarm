/**
 * The feature register: the backlog every human and agent picks from.
 *
 * It is a Markdown file the team already maintains, not a database. Rows live
 * in tables under milestone headings; two optional tables record the human
 * gates a row waits for and the product decisions still open. Columns are
 * matched by header name, so a team may reorder or add columns freely.
 */

export interface RegisterRow {
  slug: string;
  title: string;
  /** Milestone id such as `M2`, or `""` when the file has no milestones. */
  milestone: string;
  /** The sources cell, verbatim: which PRD, design file or contract to read. */
  sources: string;
  /** Owner lane: `Dev 1`, `Backend`, a name. */
  lane: string;
  /** Relative size: `S`, `M`, `L`. */
  size: string;
  /** Other row slugs this row waits for. */
  dependsOn: string[];
  /** Gate ids (`G4`) this row waits for. */
  gates: string[];
  /** Decision ids (`D6`) this row waits for. */
  decisions: string[];
}

export interface Gate {
  id: string;
  name: string;
  owner: string;
  status: string;
}

export interface Decision {
  id: string;
  question: string;
  /** Answered by the decider, or carrying a working assumption. Either unblocks. */
  settled: boolean;
  /** How it was settled, so the board can say which without guessing. */
  settledBy: 'answer' | 'assumption' | null;
}

const MILESTONE_HEADING = /^#{2,4}\s+(M\d+)\b\s*(?:[·:—-]\s*)?(.*?)\s*(?:\([^)]*\))?\s*$/;
const BACKTICKED = /`([a-z0-9]+(?:-[a-z0-9]+)*)`/g;
const GATE_ID = /\bG\d+\b/g;
const DECISION_ID = /\bD\d+\b/g;
const SEPARATOR_ROW = /^\|[\s:|-]+\|$/;

const cells = (line: string): string[] => {
  const trimmed = line.trim();
  const inner = trimmed.slice(1, trimmed.endsWith('|') ? -1 : undefined);
  return inner.split('|').map((cell) => cell.trim());
};

const normalizeHeader = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Header aliases, so a team may name a column the way it already does. */
const COLUMNS: Record<keyof Omit<RegisterRow, 'gates' | 'decisions' | 'milestone'>, string[]> = {
  slug: ['slug', 'id', 'feature', 'key'],
  title: ['title', 'name', 'summary', 'description', 'outcome'],
  sources: ['sources', 'source', 'prdfigma', 'prd', 'spec', 'refs', 'references'],
  lane: ['owner', 'lane', 'assignee', 'dev', 'who', 'team'],
  size: ['size', 'estimate', 'points', 'effort'],
  dependsOn: ['dependson', 'depends', 'dependencies', 'blockedby', 'waitson', 'needs'],
};

/** Columns of the gate tracker and the decisions register. */
const META_COLUMNS = {
  gate: ['gate'],
  decision: ['decision'],
  question: ['question'],
  owner: ['owner', 'askedby', 'who'],
  status: ['status'],
  answer: ['answer', 'resolution', 'decisionmade'],
  assumption: ['workingassumption', 'assumption'],
  blocks: ['blocks'],
} as const;

interface Header {
  index: Partial<Record<keyof typeof COLUMNS, number>>;
  meta: Partial<Record<keyof typeof META_COLUMNS, number>>;
  kind: 'feature' | 'gate' | 'decision' | 'unknown';
}

function readHeader(line: string): Header {
  const names = cells(line).map(normalizeHeader);
  const index: Header['index'] = {};
  for (const [field, aliases] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, string[]][]) {
    const at = names.findIndex((name) => aliases.includes(name));
    if (at >= 0) index[field] = at;
  }
  const meta: Header['meta'] = {};
  for (const [field, aliases] of Object.entries(META_COLUMNS) as [
    keyof typeof META_COLUMNS,
    readonly string[],
  ][]) {
    const at = names.findIndex((name) => aliases.includes(name));
    if (at >= 0) meta[field] = at;
  }
  if (meta.gate !== undefined) return { index, meta, kind: 'gate' };
  if (meta.decision !== undefined || meta.question !== undefined) {
    return { index, meta, kind: 'decision' };
  }
  if (index.slug !== undefined && index.title !== undefined) return { index, meta, kind: 'feature' };
  return { index, meta, kind: 'unknown' };
}

/**
 * Reads one decision row.
 *
 * A row under a "working assumption" heading, or carrying an assumption
 * column, settles the question for planning without answering it — the
 * distinction the board reports back to the reader.
 */
function readDecisionRow(
  values: string[],
  header: Header,
  underAssumptions: boolean,
  existing: Decision | undefined,
): Decision | null {
  const at = (field: keyof typeof META_COLUMNS) => {
    const index = header.meta[field];
    return index === undefined ? '' : (values[index] ?? '');
  };
  const id = /\bD\d+\b/.exec(at('decision') || values[0] || '')?.[0];
  if (!id) return null;

  const status = at('status').toLowerCase();
  const answered =
    (status !== '' && !status.startsWith('open')) || at('answer') !== '';
  const assumed = underAssumptions || at('assumption') !== '';

  const settledBy: Decision['settledBy'] =
    answered || existing?.settledBy === 'answer' ? 'answer' : assumed ? 'assumption' : null;
  return {
    id,
    question: at('question') || existing?.question || '',
    settled: answered || assumed || (existing?.settled ?? false),
    settledBy,
  };
}

const ids = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].map((match) => match[0]);

export class Register {
  private constructor(
    readonly rows: RegisterRow[],
    private readonly gates: Map<string, Gate>,
    private readonly decisions: Map<string, Decision>,
    private readonly milestoneNames: Map<string, string>,
  ) {}

  static empty(): Register {
    return new Register([], new Map(), new Map(), new Map());
  }

  static parse(backlog: string, decisionsFile = ''): Register {
    const rows: RegisterRow[] = [];
    const gates = new Map<string, Gate>();
    const decisions = new Map<string, Decision>();
    const milestoneNames = new Map<string, string>();
    const everyEarlierMilestone = new Set<string>();

    let milestone = '';
    let header: Header | null = null;
    let underAssumptions = false;

    for (const line of backlog.split('\n')) {
      if (line.startsWith('#')) {
        const match = MILESTONE_HEADING.exec(line);
        milestone = match ? match[1]! : '';
        if (match && match[2]) milestoneNames.set(match[1]!, match[2].trim());
        underAssumptions = /working assumption/i.test(line);
        header = null;
        continue;
      }
      if (!line.trimStart().startsWith('|')) {
        header = null;
        continue;
      }
      if (SEPARATOR_ROW.test(line.trim())) continue;
      if (header === null) {
        header = readHeader(line);
        continue;
      }

      const values = cells(line);
      const at = (field: keyof typeof COLUMNS) => {
        const index = header!.index[field];
        return index === undefined ? '' : (values[index] ?? '');
      };

      if (header.kind === 'gate') {
        const gateCell = values[header.meta.gate ?? 0] ?? '';
        const id = /\bG\d+\b/.exec(gateCell)?.[0];
        if (id) {
          const cell = (field: keyof typeof META_COLUMNS) => {
            const index = header!.meta[field];
            return index === undefined ? '' : (values[index] ?? '');
          };
          gates.set(id, {
            id,
            name: gateCell.replace(id, '').replace(/^[\s·:—-]+/, '').trim(),
            owner: cell('owner'),
            status: cell('status'),
          });
        }
        continue;
      }

      if (header.kind === 'decision') {
        const id = /\bD\d+\b/.exec(values[header.meta.decision ?? 0] ?? '')?.[0];
        const decision = readDecisionRow(values, header, underAssumptions, id ? decisions.get(id) : undefined);
        if (decision) decisions.set(decision.id, decision);
        continue;
      }

      if (header.kind !== 'feature') continue;
      const slug = /`?([a-z0-9]+(?:-[a-z0-9]+)*)`?/.exec(at('slug'))?.[1];
      if (!slug) continue;
      const depends = at('dependsOn');
      const row: RegisterRow = {
        slug,
        title: at('title'),
        milestone,
        sources: at('sources'),
        lane: at('lane'),
        size: at('size').toUpperCase(),
        dependsOn: [...depends.matchAll(BACKTICKED)].map((match) => match[1]!),
        gates: ids(depends, GATE_ID),
        decisions: ids(depends, DECISION_ID),
      };
      if (/every (earlier|previous)|all (ui )?features/i.test(depends)) {
        everyEarlierMilestone.add(slug);
      }
      rows.push(row);
    }

    // A row that waits on "every earlier feature" is expanded now, so the board
    // never has to special-case the phrase.
    for (const slug of everyEarlierMilestone) {
      const row = rows.find((candidate) => candidate.slug === slug);
      if (!row) continue;
      const index = milestoneIndex(row.milestone);
      for (const other of rows) {
        if (other.slug === slug) continue;
        if (milestoneIndex(other.milestone) < index && !row.dependsOn.includes(other.slug)) {
          row.dependsOn.push(other.slug);
        }
      }
    }

    if (decisionsFile.trim() !== '') {
      for (const [id, decision] of Register.parseDecisions(decisionsFile)) {
        const existing = decisions.get(id);
        decisions.set(id, {
          id,
          question: decision.question || existing?.question || '',
          settled: decision.settled || (existing?.settled ?? false),
          settledBy: decision.settledBy ?? existing?.settledBy ?? null,
        });
      }
    }

    return new Register(rows, gates, decisions, milestoneNames);
  }

  /**
   * A standalone decisions register. Rows under a heading mentioning "working
   * assumption" count as settled even while the question stays open, which is
   * how a team keeps planning while waiting for an answer.
   */
  static parseDecisions(text: string): Map<string, Decision> {
    const parsed = new Map<string, Decision>();
    let underAssumptions = false;
    let header: Header | null = null;

    for (const line of text.split('\n')) {
      if (line.startsWith('#')) {
        underAssumptions = /working assumption/i.test(line);
        header = null;
        continue;
      }
      if (!line.trimStart().startsWith('|')) {
        header = null;
        continue;
      }
      if (SEPARATOR_ROW.test(line.trim())) continue;
      if (header === null) {
        header = readHeader(line);
        continue;
      }
      if (header.kind !== 'decision') continue;
      const values = cells(line);
      const id = /\bD\d+\b/.exec(values[header.meta.decision ?? 0] ?? '')?.[0];
      const decision = readDecisionRow(values, header, underAssumptions, id ? parsed.get(id) : undefined);
      if (decision) parsed.set(decision.id, decision);
    }
    return parsed;
  }

  row(slug: string): RegisterRow | undefined {
    return this.rows.find((row) => row.slug === slug);
  }

  gate(id: string): Gate | undefined {
    return this.gates.get(id);
  }

  decision(id: string): Decision | undefined {
    return this.decisions.get(id);
  }

  milestoneName(id: string): string | undefined {
    return this.milestoneNames.get(id);
  }

  /** `M2 Discovery`, or the bare id when the heading carried no name. */
  describeMilestone(id: string): string {
    const name = this.milestoneNames.get(id);
    return name ? `${id} ${name}` : id || 'no milestone';
  }

  /** `G4 Firebase per flavor`, or the bare id for an untracked gate. */
  describeGate(id: string): string {
    const gate = this.gates.get(id);
    return gate && gate.name ? `${id} ${gate.name}` : id;
  }

  /** `D6 (Which metrics must the rewrite instrument?)`, or the bare id. */
  describeDecision(id: string): string {
    const decision = this.decisions.get(id);
    return decision && decision.question ? `${id} (${decision.question})` : id;
  }

  /**
   * A gate blocks only while its tracker status is open. An untracked gate
   * blocks, because nobody has said otherwise.
   */
  gateBlocks(id: string, neverBlocking: string[] = []): boolean {
    if (neverBlocking.includes(id)) return false;
    const status = (this.gates.get(id)?.status ?? '').toLowerCase();
    return status === '' || status.startsWith('open');
  }

  decisionBlocks(id: string): boolean {
    return !(this.decisions.get(id)?.settled ?? false);
  }

  dependents(slug: string): RegisterRow[] {
    return this.rows.filter((row) => row.dependsOn.includes(slug));
  }
}

export const milestoneIndex = (milestone: string): number =>
  milestone === '' ? 0 : Number.parseInt(milestone.slice(1), 10) || 0;

export const sizeIndex = (size: string): number => {
  const order = ['XS', 'S', 'M', 'L', 'XL'];
  const at = order.indexOf(size.toUpperCase());
  return at < 0 ? order.indexOf('M') : at;
};
