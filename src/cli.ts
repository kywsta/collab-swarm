#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CliError, err, out, style } from './util/log.js';
import { PROGRAM } from './util/program.js';

export { BINS, INVOCATION, PROGRAM } from './util/program.js';

const here = dirname(fileURLToPath(import.meta.url));
export const VERSION: string = (() => {
  for (const candidate of [join(here, '..', 'package.json'), join(here, '..', '..', 'package.json')]) {
    try {
      return JSON.parse(readFileSync(candidate, 'utf8')).version as string;
    } catch {
      /* try the next location */
    }
  }
  return '0.0.0';
})();

export interface Args {
  command: string;
  positional: string[];
  flags: Map<string, string | true>;
}

export function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  let command = '';

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (token.startsWith('--')) {
      const [name, inline] = token.slice(2).split(/=(.*)/s);
      const key = name!;
      if (inline !== undefined) {
        flags.set(key, inline);
        continue;
      }
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith('-')) {
        flags.set(key, next);
        index++;
      } else {
        flags.set(key, true);
      }
      continue;
    }
    if (token.startsWith('-') && token.length > 1) {
      flags.set(token.slice(1), true);
      continue;
    }
    if (command === '') command = token;
    else positional.push(token);
  }
  return { command, positional, flags };
}

export const flagString = (args: Args, name: string): string | null => {
  const value = args.flags.get(name);
  return typeof value === 'string' ? value : null;
};

export const flagBool = (args: Args, name: string): boolean => args.flags.has(name);

const HELP = `${style.bold(PROGRAM)} — spec-driven delivery for humans and coding agents.

${style.bold('Usage')}
  ${PROGRAM} <command> [options]

${style.bold('Set up')}
  init                     Install the workflow into this repository
  sync [--check] [--force] Re-apply skills, rules and instructions after an upgrade
  add <pack...>            Attach a skill pack: a default pack, an npm package, or a path
  packs                    List installed packs and what each contributes
  pack list                The default packs shipped with collab-swarm
  pack options <pack>      Re-answer what a pack asked, and re-apply it
  pack new <name>          Scaffold a skill pack for this project's own stack
  steps [<skill>]          Show what each skill does, step by step, and the rules in force
  doctor                   Check the installation and report what is missing

${style.bold('Deliver')}
  status [--lane <lane>]   The delivery board: done, in progress, available, blocked
  next [--lane <lane>]     The best unclaimed rows, ranked
  claim <slug>             Claim a row by pushing its branch with a plan skeleton
  plan <slug> [--title T]  Scaffold a feature plan package locally
  validate [<plan-dir>]    Check the workflow contract and every plan
  check [--focus <path>]   Run the project's configured checks

${style.bold('Options')}
  --no-fetch               Read the board without contacting the remote
  --json                   Machine-readable output where supported
  --options k=v,k=v        Answer a pack's questions without prompting
  --yes                    Accept defaults without prompting
  -h, --help               Show this help
  -v, --version            Show the version

${style.dim('Docs: https://github.com/ksta/collab-swarm')}`;

async function dispatch(args: Args): Promise<number> {
  switch (args.command) {
    case 'init':
      return (await import('./commands/init.js')).run(args);
    case 'sync':
      return (await import('./commands/sync.js')).run(args);
    case 'validate':
      return (await import('./commands/validate.js')).run(args);
    case 'status':
    case 'next':
      return (await import('./commands/board.js')).run(args);
    case 'claim':
      return (await import('./commands/claim.js')).run(args);
    case 'plan':
      return (await import('./commands/plan.js')).run(args);
    case 'check':
      return (await import('./commands/check.js')).run(args);
    case 'add':
      return (await import('./commands/add.js')).run(args);
    case 'packs':
      return (await import('./commands/packs.js')).run(args);
    case 'pack':
      return (await import('./commands/pack.js')).run(args);
    case 'steps':
      return (await import('./commands/steps.js')).run(args);
    case 'doctor':
      return (await import('./commands/doctor.js')).run(args);
    case '':
    case 'help':
      out(HELP);
      return 0;
    default:
      throw new CliError(
        `Unknown command "${args.command}".`,
        64,
        `Run \`${PROGRAM} help\` to see the commands.`,
      );
  }
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (flagBool(args, 'version') || flagBool(args, 'v')) {
    out(VERSION);
    return 0;
  }
  if ((flagBool(args, 'help') || flagBool(args, 'h')) && args.command === '') {
    out(HELP);
    return 0;
  }
  try {
    return await dispatch(args);
  } catch (error) {
    if (error instanceof CliError) {
      err(`${style.red('✗')} ${error.message}`);
      if (error.hint) err(`  ${style.dim(error.hint)}`);
      return error.code;
    }
    throw error;
  }
}

/**
 * True when this file is the process entry point.
 *
 * npm installs the binary as a symlink in `node_modules/.bin`, so argv[1] is
 * that link rather than this file; resolving it is what makes the installed
 * package run at all.
 */
function isEntryPoint(): boolean {
  const argv = process.argv[1];
  if (argv === undefined) return false;
  try {
    return pathToFileURL(realpathSync(argv)).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      err(`${style.red('✗')} ${(error as Error).stack ?? String(error)}`);
      process.exitCode = 1;
    });
}
