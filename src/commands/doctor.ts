import { join } from 'node:path';
import { VERSION, type Args } from '../cli.js';
import { PROGRAM } from '../util/program.js';
import { CONFIG_FILE, inRoot, loadConfig } from '../config.js';
import { behindBy } from '../core/freshness.js';
import { Git } from '../core/git.js';
import { Repository } from '../core/repositories.js';
import { ROOT_SCOPE, ruleSetStatus, scopes } from '../core/rulesets.js';
import { listPlanDirs } from '../core/plan.js';
import { validateRepository } from '../core/validate.js';
import { locatePack, packName } from '../packs.js';
import { loadWorkspace } from '../workspace.js';
import { unknownSelections } from '../options.js';
import { planSync } from '../sync.js';
import { exists } from '../util/fs.js';
import { heading, out, style } from '../util/log.js';

type Level = 'ok' | 'info' | 'warn' | 'fail';

const MARK: Record<Level, string> = {
  ok: style.green('✓'),
  info: style.dim('·'),
  warn: style.yellow('!'),
  fail: style.red('✗'),
};

export async function run(_args: Args): Promise<number> {
  const { config, root } = loadConfig();
  const lines: { level: Level; text: string; hint?: string }[] = [];
  const say = (level: Level, text: string, hint?: string) => lines.push({ level, text, ...(hint ? { hint } : {}) });

  say('ok', `collab-swarm ${VERSION} · ${CONFIG_FILE} at ${root}`);

  const git = new Git(root);
  if (!git.available) {
    say('fail', 'Not a Git repository', 'The delivery board records claims as branches; Git is required.');
  } else if (!git.hasRemote(config.git.remote)) {
    say(
      'warn',
      `No "${config.git.remote}" remote`,
      'Claims stay local until a remote exists, so teammates cannot see them.',
    );
  } else {
    say('ok', `Git remote "${config.git.remote}", default branch "${config.git.defaultBranch}"`);
    // The board reads the default branch, but this checkout's skills, rules and
    // configuration are whatever it last pulled.
    const main = `${config.git.remote}/${config.git.defaultBranch}`;
    const behind = git.countAhead('HEAD', main);
    if (behind) {
      const own = git.countAhead(main, 'HEAD') ?? 0;
      say(
        'warn',
        `${behindBy(main, behind)}; the board reads ${main}`,
        own === 0
          ? `Catch up: git merge --ff-only ${main}`
          : `This branch has ${own} commit${own === 1 ? '' : 's'} of its own. Catch up: git merge ${main}`,
      );
    }
  }

  for (const repository of Object.values(config.repositories)) {
    const handle = new Repository(root, repository);
    if (!handle.checkedOut) {
      say(
        'warn',
        `Repository "${repository.name}" is not checked out at ${repository.path}`,
        'Its branches cannot be opened or read from here, so the board cannot confirm its code merged: ' +
          `git submodule update --init ${repository.path}`,
      );
    } else if (handle.sha(handle.defaultRef) === null) {
      say(
        'fail',
        `Repository "${repository.name}" has no ${handle.defaultRef}`,
        `Fetch it, or correct repositories.${repository.name}.defaultBranch in ${CONFIG_FILE}.`,
      );
    } else {
      say('ok', `Repository "${repository.name}" at ${repository.path}, merging into ${handle.defaultRef}`);
    }
  }

  const packs = loadWorkspace(root, config);
  say(
    'ok',
    `${packs.packs.length} pack(s): ${packs.packs.map((pack) => pack.name).join(', ')} · ` +
      `${packs.skills.length} skills, ${packs.rules.length} rules`,
  );
  // Rule sets are optional: the workflow runs without one. What doctor reports
  // is a set that has fallen behind its repository, since agents then build by
  // rules the code no longer follows.
  const hub = Object.keys(config.repositories).length > 0;
  for (const scope of scopes(config)) {
    const status = ruleSetStatus(root, config, scope);
    if (scope.name === ROOT_SCOPE && hub && status.verdict === 'none') continue;
    const label = scope.name === ROOT_SCOPE ? 'This repository' : `"${scope.name}"`;
    if (status.verdict === 'current') {
      say('ok', `${label}: rule set current, researched ${status.recordedAt}`);
    } else if (status.verdict === 'stale') {
      say('warn', `${label}: rule set behind the code`, `See what moved: npx collab-swarm rules ${scope.name}, then research it again (the \`to-rules\` skill).`);
    } else if (status.verdict === 'unrecorded') {
      say('warn', `${label}: rule set never recorded`, `After researching it: npx collab-swarm rules ${scope.name} --record`);
    } else if (status.verdict === 'none' || status.verdict === 'baseline') {
      say(
        'info',
        `${label}: ${status.verdict === 'none' ? 'no rule set' : `pack baseline (${status.packs.join(', ')}) only`}`,
        `Optional. Ask your agent to "research the rule set for ${scope.name === ROOT_SCOPE ? 'this repository' : scope.name}".`,
      );
    }
  }
  if (!packs.skills.some((skill) => skill.role === 'router')) {
    const concerns = packs.skills.filter((skill) => skill.role === 'ticket' && skill.pack !== 'core');
    if (concerns.length >= 4) {
      say(
        'warn',
        `${concerns.length} concern skills and no router`,
        'An agent reads every one of them per slice. A router selects the smallest applicable set.',
      );
    }
  }

  for (const scope of scopes(config)) {
    for (const spec of scope.packs) {
      const repository = scope.name === ROOT_SCOPE ? undefined : scope.name;
      const pack = packs.packs.find((candidate) => candidate.spec === spec && candidate.repository === repository);
      if (!pack) continue;
      const where = repository ? ` --repo ${repository}` : '';
      const recorded = scope.packOptions[packName(locatePack(spec, root).dir)] ?? {};
      const stale = unknownSelections(pack.options, recorded);
      if (stale.length > 0) {
        say(
          'warn',
          `${pack.title} has ${stale.length} answer(s) it no longer offers: ${stale.join('; ')}`,
          `The default was used instead. Re-answer them: npx collab-swarm pack options ${spec}${where}`,
        );
      }
      const unanswered = pack.options.filter((option) => recorded[option.id] === undefined);
      if (unanswered.length > 0) {
        say(
          'warn',
          `${pack.title} has ${unanswered.length} unanswered question(s): ${unanswered.map((option) => option.id).join(', ')}`,
          `Defaults are in force and are not recorded, so an upgrade may change them: npx collab-swarm pack options ${spec}${where}`,
        );
      }
    }
  }

  const plan = planSync(root, config, VERSION);
  const pending = plan.files.filter((file) => file.action === 'create' || file.action === 'update');
  const drifted = plan.files.filter((file) => file.action === 'drift');
  if (pending.length === 0 && plan.stale.length === 0) {
    say('ok', `Agent files current for ${plan.targets.map((target) => target.label).join(', ')}`);
  } else {
    say(
      'warn',
      `${pending.length + plan.stale.length} agent file(s) out of date`,
      'Run: npx collab-swarm sync',
    );
  }
  if (drifted.length > 0) {
    say('warn', `${drifted.length} managed file(s) edited locally: ${drifted.map((file) => file.path).join(', ')}`);
  }

  if (config.checks.length === 0) {
    say('warn', 'No checks configured', 'Agents cannot verify a ticket. Add commands under `checks:`.');
  } else {
    say('ok', `${config.checks.length} check(s): ${config.checks.map((check) => check.name).join(', ')}`);
  }

  if (!config.backlog) {
    say('warn', 'No backlog configured', 'Without a feature register there is no board to claim rows from.');
  } else if (!exists(inRoot(root, config.backlog))) {
    say('fail', `Backlog ${config.backlog} is missing`);
  } else {
    say('ok', `Backlog ${config.backlog}`);
  }

  const missingSources = Object.entries(config.sources).filter(
    ([, source]) =>
      !source.paths.some((pattern) => {
        const fixed = pattern.split('/').slice(0, pattern.split('/').findIndex((part) => part.includes('*')));
        return exists(inRoot(root, fixed.length ? fixed.join('/') : pattern));
      }),
  );
  if (missingSources.length > 0) {
    say('warn', `Sources matching nothing: ${missingSources.map(([key]) => key).join(', ')}`);
  } else if (Object.keys(config.sources).length > 0) {
    say('ok', `${Object.keys(config.sources).length} source(s) of truth declared`);
  }

  const plansRoot = inRoot(root, config.plans);
  const plans = exists(plansRoot) ? listPlanDirs(plansRoot) : [];
  const findings = validateRepository(root, config, packs, { plansOnly: true });
  if (findings.ok) {
    say('ok', `${plans.length} plan(s) valid`);
  } else {
    say('fail', `${findings.errors.length} validation error(s)`, 'Run: npx collab-swarm validate');
  }

  heading(`${PROGRAM} doctor`);
  for (const line of lines) {
    out(`  ${MARK[line.level]} ${line.text}`);
    if (line.hint) out(`    ${style.dim(line.hint)}`);
  }
  out('');

  return lines.some((line) => line.level === 'fail') ? 1 : 0;
}
