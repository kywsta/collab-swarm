import { createInterface } from 'node:readline/promises';
import { style } from './log.js';

export interface Choice {
  value: string;
  label: string;
  hint?: string;
  preselected?: boolean;
}

export const interactive = () => process.stdin.isTTY === true && process.stdout.isTTY === true;

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export async function confirm(question: string, fallback = true): Promise<boolean> {
  if (!interactive()) return fallback;
  const suffix = fallback ? 'Y/n' : 'y/N';
  const answer = (await ask(`${question} ${style.dim(`[${suffix}]`)} `)).toLowerCase();
  if (answer === '') return fallback;
  return answer === 'y' || answer === 'yes';
}

export async function input(question: string, fallback: string): Promise<string> {
  if (!interactive()) return fallback;
  const answer = await ask(`${question} ${style.dim(`[${fallback}]`)} `);
  return answer === '' ? fallback : answer;
}

/**
 * Numbered single-select, with the same line-based reasoning as `multiSelect`.
 *
 * `fallback` is returned unchanged when there is no terminal to ask, so a
 * scripted `init` or a CI `sync` takes the pack's declared default rather than
 * hanging on a question nobody can answer.
 */
export async function select(title: string, choices: Choice[], fallback: string): Promise<string> {
  if (choices.length === 0) return fallback;
  if (!interactive()) return fallback;

  const fallbackIndex = Math.max(
    0,
    choices.findIndex((choice) => choice.value === fallback),
  );
  process.stdout.write(`\n${style.bold(title)}\n`);
  choices.forEach((choice, index) => {
    const mark = index === fallbackIndex ? style.green('•') : style.dim('◦');
    const hint = choice.hint ? ` ${style.dim(choice.hint)}` : '';
    process.stdout.write(`  ${mark} ${style.bold(String(index + 1))}. ${choice.label}${hint}\n`);
  });

  const answer = await ask(
    `${style.dim('A number, or Enter for')} ${fallbackIndex + 1}. ${choices[fallbackIndex]!.label}: `,
  );
  if (answer === '') return choices[fallbackIndex]!.value;
  const picked = Number.parseInt(answer, 10);
  return picked >= 1 && picked <= choices.length ? choices[picked - 1]!.value : choices[fallbackIndex]!.value;
}

/**
 * Numbered multi-select. Deliberately line-based rather than raw-mode cursor
 * UI: it works in every terminal, over SSH, and inside an agent session that
 * pipes stdin, and it degrades to the preselected defaults when not a TTY.
 */
export async function multiSelect(title: string, choices: Choice[]): Promise<string[]> {
  const defaults = choices.filter((choice) => choice.preselected).map((choice) => choice.value);
  if (!interactive()) return defaults;

  process.stdout.write(`\n${style.bold(title)}\n`);
  choices.forEach((choice, index) => {
    const mark = choice.preselected ? style.green('•') : style.dim('◦');
    const hint = choice.hint ? ` ${style.dim(choice.hint)}` : '';
    process.stdout.write(`  ${mark} ${style.bold(String(index + 1))}. ${choice.label}${hint}\n`);
  });

  const shown = defaults
    .map((value) => choices.findIndex((choice) => choice.value === value) + 1)
    .join(',');
  const answer = await ask(
    `${style.dim('Numbers separated by commas, "all", or Enter for')} ${shown || 'none'}: `,
  );
  if (answer === '') return defaults;
  if (answer.toLowerCase() === 'all') return choices.map((choice) => choice.value);

  const picked = answer
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((token) => Number.parseInt(token, 10))
    .filter((index) => index >= 1 && index <= choices.length)
    .map((index) => choices[index - 1]!.value);
  return [...new Set(picked)];
}
