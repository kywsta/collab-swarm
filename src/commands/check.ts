import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { flagBool, flagString, type Args } from '../cli.js';
import { loadConfig, type CheckConfig } from '../config.js';
import { exists } from '../util/fs.js';
import { CliError, fail, ok, out, style } from '../util/log.js';

/**
 * Runs the project's own checks, in order, from the repository root.
 *
 * The commands come from `collab-swarm.yml`, so the workflow stays language
 * agnostic and a human, an agent and CI all run exactly the same set.
 */
export async function run(args: Args): Promise<number> {
  const { config, root } = loadConfig();
  if (config.checks.length === 0) {
    throw new CliError(
      'No checks are configured.',
      1,
      'Add them under `checks:` in collab-swarm.yml — agents run this command before marking a ticket done.',
    );
  }

  const focus = flagString(args, 'focus');
  const ci = flagBool(args, 'ci');
  const only = (flagString(args, 'only') ?? '').split(',').map((name) => name.trim()).filter(Boolean);
  const skip = (flagString(args, 'skip') ?? '').split(',').map((name) => name.trim()).filter(Boolean);

  const selected = config.checks.filter((check) => {
    if (only.length > 0 && !only.includes(check.name)) return false;
    if (skip.includes(check.name)) return false;
    if (check.when && !exists(join(root, check.when))) return false;
    return true;
  });

  if (selected.length === 0) {
    throw new CliError('Every configured check was filtered out, so nothing ran.', 64);
  }

  const started = Date.now();
  for (const check of selected) {
    const command = commandFor(check, { focus, ci });
    out(`\n${style.bold(`== ${check.name}`)} ${style.dim(command)}`);
    const result = spawnSync(command, { cwd: root, shell: true, stdio: 'inherit' });
    if (result.status !== 0) {
      fail(
        `Check "${check.name}" failed${result.status === null ? '' : ` with exit code ${result.status}`}.`,
      );
      return result.status ?? 1;
    }
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  ok(`All ${selected.length} check(s) passed in ${seconds}s${focus ? ` (focused on ${focus})` : ''}`);
  return 0;
}

/** Picks the focused, CI or default variant and substitutes `{path}`. */
export function commandFor(check: CheckConfig, options: { focus?: string | null; ci?: boolean }): string {
  if (options.ci && check.ci) return check.ci;
  if (options.focus && check.focus) return check.focus.replaceAll('{path}', options.focus);
  return check.run;
}
