import { isAbsolute, join, resolve } from 'node:path';
import { flagBool, type Args } from '../cli.js';
import { inRoot, loadConfig } from '../config.js';
import { Findings, validatePlan, validateRepository } from '../core/validate.js';
import { loadPacks } from '../packs.js';
import { listPlanDirs } from '../core/plan.js';
import { fail, ok, out, style, warn } from '../util/log.js';

export async function run(args: Args): Promise<number> {
  const { config, root } = loadConfig();
  const packs = loadPacks(root, config.packs);
  const asJson = flagBool(args, 'json');

  const target = args.positional[0];
  let findings: Findings;

  if (target) {
    const dir = isAbsolute(target) ? target : resolve(process.cwd(), target);
    findings = new Findings(root);
    validatePlan(dir, packs, findings);
  } else {
    findings = validateRepository(root, config, packs);
  }

  if (asJson) {
    out(JSON.stringify({ ok: findings.ok, findings: findings.list }, null, 2));
    return findings.ok ? 0 : 1;
  }

  for (const finding of findings.warnings) {
    warn(`${finding.path}: ${finding.message}`);
  }

  if (findings.ok) {
    const plans = target ? 1 : listPlanDirs(inRoot(root, config.plans)).length;
    ok(
      `Workflow contract valid` +
        (plans > 0 ? ` · ${plans} plan${plans === 1 ? '' : 's'} checked` : ' · no plans yet'),
    );
    return 0;
  }

  fail(`Workflow validation failed with ${findings.errors.length} error(s):`);
  for (const finding of findings.errors) {
    out(`  ${style.red('·')} ${style.bold(finding.path)}: ${finding.message}`);
  }
  return 1;
}
