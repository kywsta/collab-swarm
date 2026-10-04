import { flagBool, type Args } from '../cli.js';
import { loadConfig } from '../config.js';
import type { Board } from '../core/board.js';
import { survey, type Candidate, type Survey } from '../core/history.js';
import { CliError, out, style } from '../util/log.js';
import { buildBoard } from './board.js';

const date = (at: Date | null) => (at ? at.toISOString().slice(0, 10) : 'never committed');

const plural = (count: number, word: string) =>
  `${count} ${count === 1 ? word : word.endsWith('y') ? `${word.slice(0, -1)}ies` : `${word}s`}`;

function describe(candidate: Candidate, board: Board | null): string {
  const parts = [
    candidate.kind === 'change' ? 'small change' : 'plan',
    candidate.milestone && board ? board.register.describeMilestone(candidate.milestone) : null,
    `last commit ${date(candidate.committedAt)}`,
    `${plural(candidate.files, 'file')}, ${plural(candidate.lines, 'line')}`,
    candidate.commit ? `commit ${candidate.commit}` : null,
  ].filter(Boolean);
  return `- ${style.bold(candidate.slug)} — ${candidate.title} · ${parts.join(' · ')}`;
}

function render(result: Survey, board: Board | null, compactCommand: string): string {
  const lines: string[] = [];
  const by = (verdict: Candidate['verdict']) => result.candidates.filter((c) => c.verdict === verdict);
  const ready = by('ready');
  const delivered = result.entries.filter((entry) => entry.status !== 'dropped').length;

  lines.push(
    style.bold(
      `Delivery history · ${result.file} · ` +
        (result.entries.length === 0
          ? 'nothing compacted yet'
          : `${plural(result.entries.length, 'row')} (${delivered} delivered, ` +
            `${result.entries.length - delivered} dropped)`) +
        ` · ${plural(result.candidates.length, 'directory')} under the plans`,
    ),
  );
  if (result.ref === null) {
    lines.push(style.yellow('No default branch to compare against, so nothing can be shown as safe to compact.'));
  }

  for (const problem of result.problems) {
    lines.push(`${style.red('✗')} ${problem.slug}: ${problem.message}`);
  }

  if (ready.length > 0) {
    const total = ready.reduce((sum, c) => sum + c.lines, 0);
    lines.push('', style.bold(`Ready to compact · ${plural(ready.length, 'directory')}, ${plural(total, 'line')}`));
    lines.push(...ready.map((candidate) => describe(candidate, board)));
  }

  const deferred = by('deferred-work');
  if (deferred.length > 0) {
    lines.push('', style.bold('Complete, but still owed deferred work — lift it into the backlog first, or keep the plan'));
    for (const candidate of deferred) {
      lines.push(describe(candidate, board));
      for (const ticket of candidate.deferred) lines.push(`    deferred: ${ticket.title} (${ticket.slug})`);
    }
  }

  const orphaned = by('orphaned');
  if (orphaned.length > 0) {
    lines.push('', style.bold('Never finished, and untouched for weeks — dropped or superseded? The user decides'));
    lines.push(...orphaned.map((candidate) => `${describe(candidate, board)} · ${candidate.status}`));
  }

  const unmerged = by('unmerged');
  if (unmerged.length > 0) {
    lines.push('', style.bold(`Complete here, but not as it is on ${result.ref ?? 'the default branch'} — merge before compacting`));
    lines.push(...unmerged.map((candidate) => describe(candidate, board)));
  }

  const live = by('live');
  if (live.length > 0) {
    lines.push('', `${style.dim('Live, never compacted')}: ${live.map((c) => c.slug).join(', ')}`);
  }

  const retire = result.retirable;
  if (retire && (retire.milestones.length + retire.gates.length + retire.decisions.length) > 0) {
    lines.push('', style.bold('Backlog'));
    for (const milestone of retire.milestones) {
      lines.push(
        `- Milestone ${board!.register.describeMilestone(milestone.id)} is fully delivered: ` +
          `${plural(milestone.rows.length, 'row')} (${milestone.rows.join(', ')})`,
      );
    }
    for (const gate of retire.gates) {
      lines.push(`- Gate ${gate.id} ${gate.name} (${gate.owner || 'no owner'}) is ${gate.status}, and nothing unfinished names it`);
    }
    for (const decision of retire.decisions) {
      lines.push(`- Decision ${decision.id} (${decision.question || 'no question recorded'}) is answered, and nothing unfinished cites it`);
    }
  }

  const nothing =
    ready.length + deferred.length + orphaned.length === 0 &&
    (!retire || retire.milestones.length + retire.gates.length + retire.decisions.length === 0);
  lines.push(
    '',
    nothing
      ? 'Nothing to compact.'
      : style.dim(`Compact it with your agent: ${compactCommand}`),
  );
  return lines.join('\n');
}

export async function run(args: Args): Promise<number> {
  const { config, root } = loadConfig();

  let board: Board | null = null;
  if (config.backlog) {
    try {
      board = buildBoard(root, config, { fetch: !flagBool(args, 'no-fetch') });
    } catch (error) {
      if (!(error instanceof CliError)) throw error;
    }
  }

  const result = survey(root, config, { board });

  if (flagBool(args, 'json')) {
    out(
      JSON.stringify(
        {
          file: result.file,
          ref: result.ref,
          entries: result.entries,
          problems: result.problems,
          candidates: result.candidates.map((candidate) => ({
            ...candidate,
            committedAt: candidate.committedAt?.toISOString() ?? null,
          })),
          retirable: result.retirable,
        },
        null,
        2,
      ),
    );
    return result.problems.length === 0 ? 0 : 1;
  }

  out('');
  out(render(result, board, '"Compact the project history"'));
  out('');
  return result.problems.length === 0 ? 0 : 1;
}
