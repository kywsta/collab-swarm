import { join } from 'node:path';
import { VERSION, type Args } from '../cli.js';
import { CONFIG_FILE, inRoot, loadConfig } from '../config.js';
import { Git } from '../core/git.js';
import { listPlanDirs } from '../core/plan.js';
import { validateRepository } from '../core/validate.js';
import { loadPacks } from '../packs.js';
import { planSync } from '../sync.js';
import { exists } from '../util/fs.js';
import { heading, out, style } from '../util/log.js';

type Level = 'ok' | 'warn' | 'fail';

const MARK: Record<Level, string> = {
  ok: style.green('✓'),
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
  }

  const packs = loadPacks(root, config.packs);
  say(
    'ok',
    `${packs.packs.length} pack(s): ${packs.packs.map((pack) => pack.name).join(', ')} · ` +
      `${packs.skills.length} skills, ${packs.rules.length} rules`,
  );

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

  heading('collab-swarm doctor');
  for (const line of lines) {
    out(`  ${MARK[line.level]} ${line.text}`);
    if (line.hint) out(`    ${style.dim(line.hint)}`);
  }
  out('');

  return lines.some((line) => line.level === 'fail') ? 1 : 0;
}
