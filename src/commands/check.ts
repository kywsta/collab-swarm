import { spawnSync } from 'node:child_process';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { flagBool, flagString, type Args } from '../cli.js';
import { loadConfig, type CheckConfig, type Config } from '../config.js';
import { Repository } from '../core/repositories.js';
import { exists } from '../util/fs.js';
import { CliError, fail, ok, out, style, warn } from '../util/log.js';

/** The checks one directory runs: this repository's own, or a coordinated repository's. */
export interface CheckGroup {
  /** The repository name, or null for this repository. */
  repository: string | null;
  cwd: string;
  checks: CheckConfig[];
  /** Why the group cannot run here, when it cannot. */
  unavailable: string | null;
}

const list = (value: string | null) =>
  (value ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

/** `path` relative to `dir` when it lies inside it, else null. */
const inside = (dir: string, path: string): string | null => {
  const rel = relative(dir, path);
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? null : rel.split('\\').join('/');
};

/**
 * Which groups run, and the focus path each one is given.
 *
 * A focus path names one place, so only the checks of the repository holding
 * it run, with the path made relative to that repository — which is where its
 * commands run from. Without a focus every group runs; `--repo` narrows to
 * the named repositories, and resolves a relative focus against them.
 */
export function selectGroups(
  root: string,
  config: Config,
  options: { repos?: string[]; focus?: string | null; cwd?: string },
): { groups: CheckGroup[]; focus: string | null } {
  const cwd = options.cwd ?? process.cwd();
  const hub: CheckGroup = { repository: null, cwd: root, checks: config.checks, unavailable: null };
  const repositories: CheckGroup[] = Object.values(config.repositories).map((repo) => {
    const handle = new Repository(root, repo);
    return {
      repository: repo.name,
      cwd: handle.dir,
      checks: repo.checks,
      unavailable: handle.checkedOut ? null : handle.checkoutHint,
    };
  });

  const requested = options.repos ?? [];
  const unknown = requested.filter((name) => !config.repositories[name]);
  if (unknown.length > 0) {
    const known = Object.keys(config.repositories);
    throw new CliError(
      `Unknown repository ${unknown.map((name) => `"${name}"`).join(', ')}.`,
      64,
      known.length > 0
        ? `Configured repositories: ${known.join(', ')}.`
        : 'No repositories are configured; add them under `repositories:` in collab-swarm.yml.',
    );
  }

  const focus = options.focus ?? null;
  if (requested.length > 0) {
    const groups = repositories.filter((group) => requested.includes(group.repository!));
    if (focus === null) return { groups, focus: null };
    const group = groups[0]!;
    const absolute = resolve(cwd, focus);
    return { groups, focus: inside(group.cwd, absolute) ?? focus };
  }

  if (focus !== null) {
    const absolute = resolve(cwd, focus);
    for (const group of repositories) {
      const rel = inside(group.cwd, absolute);
      if (rel !== null) return { groups: [group], focus: rel };
    }
    return { groups: [hub], focus: inside(root, absolute) ?? focus };
  }

  return { groups: [hub, ...repositories], focus: null };
}

/**
 * Runs the project's own checks, in order: this repository's from its root,
 * then each coordinated repository's from its own directory.
 *
 * The commands come from `collab-swarm.yml`, so the workflow stays language
 * agnostic and a human, an agent and CI all run exactly the same set.
 */
export async function run(args: Args): Promise<number> {
  const { config, root } = loadConfig();
  const configured = config.checks.length + Object.values(config.repositories).reduce((sum, repo) => sum + repo.checks.length, 0);
  if (configured === 0) {
    throw new CliError(
      'No checks are configured.',
      1,
      'Add them under `checks:` in collab-swarm.yml — agents run this command before marking a ticket done.',
    );
  }

  const ci = flagBool(args, 'ci');
  const only = list(flagString(args, 'only'));
  const skip = list(flagString(args, 'skip'));
  const repos = list(flagString(args, 'repo'));
  if (repos.length > 1 && flagString(args, 'focus') !== null) {
    throw new CliError('A focus path belongs to one repository; name one with --repo, or none.', 64);
  }
  const { groups, focus } = selectGroups(root, config, { repos, focus: flagString(args, 'focus') });

  const skipped: CheckGroup[] = [];
  const plan: { group: CheckGroup; check: CheckConfig }[] = [];
  for (const group of groups) {
    const selected = group.checks.filter((check) => {
      if (only.length > 0 && !only.includes(check.name)) return false;
      if (skip.includes(check.name)) return false;
      if (check.when && !exists(join(group.cwd, check.when))) return false;
      return true;
    });
    if (selected.length === 0) continue;
    if (group.unavailable !== null) {
      // Asked for by name, a repository that cannot run is a failure. Swept up
      // in the full set, it is reported and the rest still run.
      if (repos.length > 0 || focus !== null) throw new CliError(group.unavailable, 1);
      skipped.push(group);
      continue;
    }
    plan.push(...selected.map((check) => ({ group, check })));
  }

  if (plan.length === 0) {
    throw new CliError(
      skipped.length > 0
        ? `Nothing ran: every repository with checks is unavailable here (${skipped.map((group) => group.repository).join(', ')}).`
        : 'Every configured check was filtered out, so nothing ran.',
      skipped.length > 0 ? 1 : 64,
    );
  }

  const started = Date.now();
  for (const { group, check } of plan) {
    const command = commandFor(check, { focus, ci });
    const label = group.repository === null ? check.name : `${group.repository} · ${check.name}`;
    out(`\n${style.bold(`== ${label}`)} ${style.dim(command)}`);
    const result = spawnSync(command, { cwd: group.cwd, shell: true, stdio: 'inherit' });
    if (result.status !== 0) {
      fail(`Check "${label}" failed${result.status === null ? '' : ` with exit code ${result.status}`}.`);
      return result.status ?? 1;
    }
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  ok(`All ${plan.length} check(s) passed in ${seconds}s${focus ? ` (focused on ${focus})` : ''}`);
  for (const group of skipped) {
    warn(`Skipped the checks of "${group.repository}": ${group.unavailable}`);
  }
  return 0;
}

/** Picks the focused, CI or default variant and substitutes `{path}`. */
export function commandFor(check: CheckConfig, options: { focus?: string | null; ci?: boolean }): string {
  if (options.ci && check.ci) return check.ci;
  if (options.focus && check.focus) return check.focus.replaceAll('{path}', options.focus);
  return check.run;
}
