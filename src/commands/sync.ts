import { VERSION, flagBool, type Args } from '../cli.js';
import { loadConfig } from '../config.js';
import { applySync, planSync } from '../sync.js';
import { fail, heading, info, ok, out, style, warn } from '../util/log.js';

export async function run(args: Args): Promise<number> {
  const { config, root } = loadConfig();
  const dryRun = flagBool(args, 'check') || flagBool(args, 'dry-run');
  const force = flagBool(args, 'force');

  const plan = planSync(root, config, VERSION);
  const creates = plan.files.filter((file) => file.action === 'create');
  const updates = plan.files.filter((file) => file.action === 'update');
  const drifted = plan.files.filter((file) => file.action === 'drift');

  if (dryRun) {
    const pending = creates.length + updates.length + plan.stale.length;
    if (pending === 0 && drifted.length === 0) {
      ok('Agent files are up to date.');
      return 0;
    }
    heading('Out of date');
    for (const file of creates) out(`  ${style.green('+')} ${file.path}`);
    for (const file of updates) out(`  ${style.yellow('~')} ${file.path}`);
    for (const path of plan.stale) out(`  ${style.red('-')} ${path} ${style.dim('(no longer emitted)')}`);
    for (const file of drifted) out(`  ${style.red('!')} ${file.path} ${style.dim('(edited locally)')}`);
    fail('Run `npx swarm sync` to bring them up to date.');
    return 1;
  }

  const result = applySync(root, plan, config, VERSION, { force });

  if (result.written.length === 0 && result.removed.length === 0 && result.drifted.length === 0) {
    ok('Agent files are already up to date.');
    return 0;
  }

  if (result.written.length > 0) ok(`Wrote ${result.written.length} file(s)`);
  if (result.removed.length > 0) {
    info(`Removed ${result.removed.length} file(s) an earlier version wrote: ${result.removed.join(', ')}`);
  }
  if (result.drifted.length > 0) {
    warn(`Left ${result.drifted.length} locally edited file(s) alone:`);
    for (const path of result.drifted) out(`  ${style.yellow('!')} ${path}`);
    out(
      style.dim(
        '  Move project-specific guidance into your own skills or rules, then rerun with --force to restore these.',
      ),
    );
  }

  out(style.dim(`  Targets: ${plan.targets.map((target) => target.label).join(', ')}`));
  return 0;
}
