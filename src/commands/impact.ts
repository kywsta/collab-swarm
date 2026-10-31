import { flagBool, flagString, type Args } from '../cli.js';
import { loadConfig, type Config } from '../config.js';
import type { Board } from '../core/board.js';
import { Git } from '../core/git.js';
import {
  ImpactError,
  matters,
  sourceImpact,
  type Effect,
  type ImpactReport,
  type PlanDrift,
  type RowImpact,
  type SourceChange,
} from '../core/impact.js';
import { CliError, out, style } from '../util/log.js';
import { freshnessJson, printNotices, readBoard, type BoardRead } from './board.js';

const SHOWN_SECTIONS = 4;

const plural = (count: number, word: string) => `${count} ${count === 1 ? word : `${word}s`}`;

const short = (sha: string) => sha.slice(0, 12);

function listSections(sections: string[]): string {
  if (sections.length <= SHOWN_SECTIONS) return sections.join('; ');
  return `${sections.slice(0, SHOWN_SECTIONS).join('; ')}; and ${sections.length - SHOWN_SECTIONS} more`;
}

/** One changed document; `detail` lists its changed sections, otherwise they are counted. */
function describeChange(change: SourceChange, config: Config, detail: boolean): string {
  const what =
    change.kind === 'renamed'
      ? `renamed from ${change.previousPath}`
      : change.kind === 'added'
        ? 'new'
        : change.kind === 'deleted'
          ? 'deleted'
          : change.sections.length === 0
            ? 'changed'
            : detail
              ? `changed · ${listSections(change.sections)}`
              : `changed in ${plural(change.sections.length, 'section')}`;
  const label = config.sources[change.source]?.label ?? change.source;
  return `- ${style.bold(change.path)} · ${label} · ${what}`;
}

function describeEffect(effect: Effect): string {
  if (effect.reach === 'removed') {
    return effect.renamedTo
      ? `${effect.path} · renamed to ${effect.renamedTo}; the citation points nowhere`
      : `${effect.path} · deleted`;
  }
  if (effect.reach === 'elsewhere') {
    return `${effect.path} · ${plural(effect.sections.length, 'other section')} changed`;
  }
  const parts: string[] = [];
  if (effect.kind === 'added') parts.push('new document');
  if (effect.sections.length > 0) parts.push(listSections(effect.sections));
  if (effect.missing.length > 0) parts.push(`no longer found: ${effect.missing.join(', ')}`);
  return parts.length > 0 ? `${effect.path} · ${parts.join(' · ')}` : `${effect.path} · changed`;
}

function describeRow(row: RowImpact, board: Board | null): string[] {
  const where = [
    row.milestone && board ? board.register.describeMilestone(row.milestone) : null,
    row.holder ? `held by ${row.holder}` : null,
  ].filter(Boolean);
  const lines = [`- ${style.bold(row.slug)} — ${row.title}${where.length > 0 ? ` · ${where.join(' · ')}` : ''}`];
  const effects = row.effects.some(matters) ? row.effects.filter(matters) : row.effects;
  lines.push(...effects.map((effect) => `    ${describeEffect(effect)}`));
  return lines;
}

function describePlan(plan: PlanDrift): string[] {
  const head =
    `- ${style.bold(plan.slug)} — ${plan.title} · ${plan.holder ?? 'unknown'}` +
    (plan.stage ? ` · stage ${plan.stage}` : '');
  switch (plan.state) {
    case 'unrecorded':
      return [`${head} · no sources_sha recorded, so nobody can tell what it was written from`];
    case 'unreadable':
      return [`${head} · sources_sha ${plan.sourcesSha} is not a commit this clone holds; fetch it, or record the real one`];
    default: {
      const effects = plan.effects.filter(matters);
      return [
        `${head} · written from ${short(plan.sourcesSha!)}` +
          (plan.citesNothing ? ' · cites no source document, so every change counts' : ''),
        ...effects.map((effect) => `    ${describeEffect(effect)}`),
      ];
    }
  }
}

const GROUPS: { title: string; test: (row: RowImpact) => boolean }[] = [
  {
    title: 'Delivered, and the sources it was built from changed — what shipped may no longer be what is asked for',
    test: (row) => row.state === 'done',
  },
  {
    title: 'In progress — its plan may be building what is no longer asked for',
    test: (row) => row.state === 'in-progress',
  },
  {
    title: 'Not started — revise, resequence or retire the row before anyone claims it',
    test: (row) => row.state === 'available' || row.state === 'blocked',
  },
];

export function renderImpact(report: ImpactReport, board: Board | null, config: Config): string {
  const lines: string[] = [];
  const since =
    report.base.reason === 'backlog'
      ? `since ${report.base.label} was last committed`
      : `since ${report.base.label}`;
  lines.push(
    style.bold(
      `Source impact · ${since} (${short(report.base.sha)}, ${report.base.date}: ${report.base.subject}) · ` +
        `${plural(report.changes.length, 'document')} changed`,
    ),
  );

  if (report.changes.length > 0) {
    lines.push('', style.bold('Changed sources'));
    lines.push(...report.changes.map((change) => describeChange(change, config, false)));
  }

  const affected = report.rows.filter((row) => row.effects.some(matters));
  for (const group of GROUPS) {
    const rows = affected.filter(group.test);
    if (rows.length === 0) continue;
    lines.push('', style.bold(group.title));
    for (const row of rows) lines.push(...describeRow(row, board));
  }

  const elsewhere = report.rows.filter((row) => !row.effects.some(matters));
  if (elsewhere.length > 0) {
    lines.push('', style.bold('Cites a changed document, but none of the sections that changed'));
    for (const row of elsewhere) lines.push(...describeRow(row, board));
  }

  if (report.uncited.length > 0) {
    lines.push(
      '',
      style.bold('Changed, and no row cites it — new work, or a document the cited ones must absorb first'),
    );
    lines.push(...report.uncited.map((change) => describeChange(change, config, true)));
  }

  const stale = report.plans.filter((plan) => plan.state !== 'current');
  if (stale.length > 0) {
    lines.push(
      '',
      style.bold(`Plans in flight whose sources have moved on ${report.against} since they were written`),
    );
    for (const plan of stale) lines.push(...describePlan(plan));
  }

  const nothing = report.changes.length === 0 && stale.length === 0;
  lines.push(
    '',
    nothing
      ? 'The sources have not changed, and every plan in flight reads them as they are.'
      : style.dim('Reconcile the delivery plan with your agent: "The sources changed — update the delivery plan"'),
  );
  return lines.join('\n');
}

export async function run(args: Args): Promise<number> {
  const { config, root } = loadConfig();
  const git = new Git(root);
  if (!git.available) {
    throw new CliError('This directory is not a Git repository, so there is no history to compare the sources with.');
  }

  let read: BoardRead | null = null;
  if (config.backlog) {
    try {
      read = readBoard(root, config, { fetch: !flagBool(args, 'no-fetch') });
    } catch (error) {
      if (!(error instanceof CliError)) throw error;
    }
  }
  const board: Board | null = read?.board ?? null;

  let report: ImpactReport;
  try {
    report = sourceImpact(git, root, config, board, { since: flagString(args, 'since') });
  } catch (error) {
    if (error instanceof ImpactError) throw new CliError(error.message, 1, error.hint);
    throw error;
  }

  if (flagBool(args, 'json')) {
    const { changes, uncited, ...rest } = report;
    const plain = (change: SourceChange) => {
      const { regions: _regions, headings: _headings, ...fields } = change;
      return fields;
    };
    out(
      JSON.stringify(
        { ...rest, changes: changes.map(plain), uncited: uncited.map(plain), ...freshnessJson(read) },
        null,
        2,
      ),
    );
    return 0;
  }

  out('');
  printNotices(read);
  out(renderImpact(report, board, config));
  out('');
  return 0;
}
