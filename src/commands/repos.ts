import { join } from 'node:path';
import { flagBool, type Args } from '../cli.js';
import { inRoot, loadConfig, type Config } from '../config.js';
import { Claims } from '../core/claims.js';
import { readPlan, stamp, writePlan } from '../core/plan.js';
import { Repository, describeProgress, repositoryHandles, unknownRepository } from '../core/repositories.js';
import { CliError, ok, out, style, warn } from '../util/log.js';
import { PROGRAM } from '../util/program.js';

/**
 * The code repositories this hub coordinates.
 *
 * With no slug: each configured repository, and whether it can be worked in
 * from this checkout. With a slug: where that feature's branch stands in every
 * repository its plan names. `--open` pushes the branch where the plan has no
 * base yet; `--open api,web` adds those repositories to the plan first, for
 * when the specification finds the work reaches further than the claim knew.
 */
export async function run(args: Args): Promise<number> {
  const { config, root } = loadConfig();
  const repositories = Object.values(config.repositories);
  if (repositories.length === 0) {
    throw new CliError(
      'No repositories are configured, so every plan lands in this one.',
      1,
      'A hub lists the code repositories it coordinates under `repositories:` in collab-swarm.yml.',
    );
  }

  const slug = args.positional[0];
  if (!slug) return list(root, config, flagBool(args, 'json'));
  return feature(root, config, slug, args);
}

function list(root: string, config: Config, asJson: boolean): number {
  const rows = Object.values(config.repositories).map((repo) => {
    const handle = new Repository(root, repo);
    const checkedOut = handle.checkedOut;
    return {
      name: repo.name,
      path: repo.path,
      remote: repo.remote,
      defaultBranch: repo.defaultBranch,
      checks: repo.checks.map((check) => check.name),
      checkedOut,
      branch: checkedOut ? handle.git.currentBranch || null : null,
      dirty: checkedOut ? handle.git.isDirty : false,
    };
  });

  if (asJson) {
    out(JSON.stringify({ repositories: rows }, null, 2));
    return 0;
  }

  out('');
  out(style.bold(`Repositories · ${rows.length} coordinated by ${config.project}`));
  for (const row of rows) {
    const state = row.checkedOut
      ? `on ${row.branch ?? 'a detached HEAD'}${row.dirty ? style.yellow(' · uncommitted changes') : ''}`
      : style.yellow('not checked out');
    const checks = row.checks.length > 0 ? `checks ${row.checks.join(', ')}` : style.yellow('no checks');
    out(`- ${style.bold(row.name)} · ${row.path} · merges into ${row.remote}/${row.defaultBranch} · ${checks} · ${state}`);
  }
  const missing = rows.filter((row) => !row.checkedOut);
  if (missing.length > 0) {
    out('');
    out(style.dim(`Check them out: git submodule update --init ${missing.map((row) => row.path).join(' ')}`));
  }
  out('');
  return 0;
}

function feature(root: string, config: Config, slug: string, args: Args): number {
  const dir = join(inRoot(root, config.plans), slug);
  const plan = readPlan(dir);
  if (!plan) {
    throw new CliError(
      `There is no plan for "${slug}" in this checkout.`,
      1,
      `Switch to its branch first: git switch ${config.git.branchPrefix}${slug}`,
    );
  }

  const opening = args.flags.get('open');
  const fetch = !flagBool(args, 'no-fetch');
  const handles = repositoryHandles(root, config.repositories);
  if (fetch) for (const handle of handles.values()) if (handle.checkedOut) handle.fetch();

  if (opening !== undefined) {
    const added = typeof opening === 'string'
      ? opening.split(',').map((name) => name.trim()).filter(Boolean)
      : [];
    const unknown = added.filter((name) => !config.repositories[name]);
    if (unknown.length > 0) {
      throw new CliError(
        `Unknown repository ${unknown.map((name) => `"${name}"`).join(', ')}.`,
        64,
        `Configured repositories: ${Object.keys(config.repositories).join(', ')}.`,
      );
    }
    for (const name of added) {
      if (!plan.repositories.some((repository) => repository.name === name)) {
        plan.repositories.push({ name, baseSha: null });
      }
    }

    const pending = plan.repositories.filter((repository) => repository.baseSha === null);
    if (pending.length === 0 && added.length === 0) {
      ok(`Every repository in the ${slug} plan already has its branch.`);
    }
    const claims = new Claims(root, config.git, config.plans, config.repositories);
    const opened = claims.openRepositories(
      slug,
      pending.map((repository) => repository.name),
      { fetch: false },
    );
    for (const result of opened.repositories) {
      const entry = plan.repositories.find((repository) => repository.name === result.name)!;
      entry.baseSha = result.baseSha;
    }
    for (const line of opened.lines) out(`  ${style.dim('·')} ${line}`);
    if (pending.length > 0 || added.length > 0) {
      plan.updatedAt = stamp();
      writePlan(dir, plan);
      ok(`Recorded the repositories and their bases in ${config.plans}/${slug}/plan.yml — commit it with the plan.`);
    }
  }

  const branch = `${config.git.branchPrefix}${slug}`;
  const progress = plan.repositories.map((repository) => {
    const handle = handles.get(repository.name);
    return {
      ...(handle ? handle.progress(branch, repository.baseSha) : unknownRepository(repository.name)),
      baseSha: repository.baseSha,
    };
  });

  if (flagBool(args, 'json')) {
    out(JSON.stringify({ feature: slug, branch, repositories: progress }, null, 2));
    return 0;
  }

  out('');
  if (progress.length === 0) {
    out(`The ${slug} plan names no repository yet, so its code has nowhere to land.`);
    out(style.dim(`  Add one once the specification says where the work goes: ${PROGRAM} repos ${slug} --open <name>`));
    out('');
    return 0;
  }
  out(style.bold(`${plan.title || slug} · ${branch} in ${progress.length} repositor${progress.length === 1 ? 'y' : 'ies'}`));
  for (const repository of progress) {
    const repo = config.repositories[repository.name];
    const where = repo ? `${repo.path} → ${repo.defaultBranch}` : 'not configured';
    const base = repository.baseSha ? `base ${repository.baseSha.slice(0, 12)}` : style.yellow('no base yet');
    out(`- ${describeProgress(repository)} · ${where} · ${base}`);
  }
  if (progress.some((repository) => repository.baseSha === null)) {
    out('');
    warn(`Open the missing branches: ${PROGRAM} repos ${slug} --open`);
  }
  out('');
  return 0;
}
