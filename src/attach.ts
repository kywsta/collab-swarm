/**
 * Attaching a pack: the interview, the record, and what the project is told.
 *
 * Shared by `init`, `add` and `pack options` so a pack is attached the same way
 * however it was reached — the questions in the same order, the answers written
 * to the same place, and the same summary printed back.
 */

import type { CheckConfig, Config } from './config.js';
import type { Pack } from './packs.js';
import { type Selections } from './options.js';
import { info, out, style } from './util/log.js';
import { confirm, select } from './util/prompt.js';

export interface AttachOptions {
  /** Answers supplied on the command line, which are never asked again. */
  preset?: Selections;
  /** Take defaults for everything unanswered instead of asking. */
  assumeYes?: boolean;
}

/**
 * Asks a pack's questions, in the order it declares them.
 *
 * Only unanswered options are asked, so `add flutter --options database=none`
 * skips that one and re-running `pack options` keeps the previous answer as the
 * highlighted default.
 */
export async function askOptions(pack: Pack, options: AttachOptions = {}): Promise<Selections> {
  if (pack.options.length === 0) return {};

  const preset = options.preset ?? {};
  const answers: Selections = {};
  let asked = false;

  for (const option of pack.options) {
    const supplied = preset[option.id];
    if (supplied && option.choices.some((choice) => choice.id === supplied)) {
      answers[option.id] = supplied;
      continue;
    }
    const current = pack.selections[option.id] ?? option.default;
    if (options.assumeYes) {
      answers[option.id] = current;
      continue;
    }
    if (!asked) {
      out('');
      info(
        `${pack.title} fits itself to this project. Each answer decides which skills are installed and what they say.`,
      );
      asked = true;
    }
    if (option.detail) out(`\n  ${style.dim(option.detail)}`);
    answers[option.id] = await select(
      option.question,
      option.choices.map((choice) => ({
        value: choice.id,
        label: choice.label,
        ...(choice.hint ? { hint: `· ${choice.hint}` } : {}),
      })),
      current,
    );
  }
  return answers;
}

/** What the pack contributes, once its answers are known. */
export function describePack(pack: Pack): void {
  if (pack.description) out(`  ${pack.description}`);
  for (const option of pack.options) {
    const chosen = option.choices.find((choice) => choice.id === pack.selections[option.id]);
    if (chosen) out(`  ${style.dim(`${option.question}: `)}${chosen.label}`);
  }
  if (pack.skills.length > 0) {
    out(`  ${style.dim(`Skills: ${pack.skills.map((skill) => skill.name).join(', ')}`)}`);
  }
  if (pack.rules.length > 0) {
    out(`  ${style.dim(`Rules: ${pack.rules.map((rule) => rule.file).join(', ')}`)}`);
  }
  if (pack.checks.length > 0) {
    out(`  ${style.dim(`Suggested checks: ${pack.checks.map((check) => check.name).join(', ')}`)}`);
  }
}

/**
 * Offers the pack's checks, skipping any name the project already uses.
 *
 * A check is a suggestion: the team may have tuned its own `test` command, and
 * a pack silently replacing it would break the one command a human, an agent
 * and CI all run.
 */
export async function offerChecks(
  config: Config,
  pack: Pack,
  assumeYes: boolean,
): Promise<CheckConfig[]> {
  const fresh = pack.checks.filter(
    (check) => !config.checks.some((existing) => existing.name === check.name),
  );
  if (fresh.length === 0) return [];
  const accept = assumeYes || (await confirm(`  Add its ${fresh.length} suggested check(s)?`, true));
  return accept ? fresh : [];
}

/**
 * Records a pack and its answers in the config, in memory.
 *
 * The caller writes the file and runs the sync, so `init` can attach a pack
 * before it has written `collab-swarm.yml` for the first time.
 */
export function record(config: Config, spec: string, pack: Pack, answers: Selections): void {
  if (!config.packs.includes(spec)) config.packs.push(spec);
  if (Object.keys(answers).length > 0) {
    config.packOptions = { ...config.packOptions, [pack.name]: answers };
  }
}
