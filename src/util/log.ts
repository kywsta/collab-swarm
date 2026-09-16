/** Terminal output. No dependency, honours NO_COLOR and non-TTY pipes. */

const ESC = '[';

const enabled =
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== 'dumb' &&
  process.stdout.isTTY === true;

const wrap = (code: string) => (text: string) =>
  enabled ? `${ESC}${code}m${text}${ESC}0m` : text;

export const style = {
  bold: wrap('1'),
  dim: wrap('2'),
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  blue: wrap('34'),
  cyan: wrap('36'),
};

export const out = (line = '') => process.stdout.write(`${line}\n`);
export const err = (line = '') => process.stderr.write(`${line}\n`);

export const info = (line: string) => out(`${style.cyan('·')} ${line}`);
export const ok = (line: string) => out(`${style.green('✓')} ${line}`);
export const warn = (line: string) => err(`${style.yellow('!')} ${line}`);
export const fail = (line: string) => err(`${style.red('✗')} ${line}`);

export const heading = (line: string) => out(`\n${style.bold(line)}`);

/** A thrown CliError is a message for the user, not a stack trace. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly code = 1,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'CliError';
  }
}
