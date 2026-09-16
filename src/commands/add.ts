import { VERSION, flagBool, type Args } from '../cli.js';
import { CONFIG_FILE, loadConfig, serializeConfig } from '../config.js';
import { resolvePack } from '../packs.js';
import { applySync, planSync } from '../sync.js';
import { writeText } from '../util/fs.js';
import { CliError, heading, info, ok, out, style } from '../util/log.js';
import { confirm } from '../util/prompt.js';
import { join } from 'node:path';

export async function run(args: Args): Promise<number> {
  const specs = args.positional;
  if (specs.length === 0) {
    throw new CliError(
      'Name the pack to add.',
      64,
      'Usage: collab-swarm add <npm-package|path> — for example `collab-swarm add ./packs/go`.',
    );
  }

  const { config, root } = loadConfig();
  const added: string[] = [];

  for (const spec of specs) {
    if (config.packs.includes(spec)) {
      info(`"${spec}" is already attached.`);
      continue;
    }
    const pack = resolvePack(spec, root);
    heading(`${pack.title} ${style.dim(`(${pack.name})`)}`);
    if (pack.description) out(`  ${pack.description}`);
    if (pack.skills.length > 0) {
      out(`  ${style.dim(`Skills: ${pack.skills.map((skill) => skill.name).join(', ')}`)}`);
    }
    if (pack.rules.length > 0) {
      out(`  ${style.dim(`Rules: ${pack.rules.map((rule) => rule.file).join(', ')}`)}`);
    }
    if (pack.checks.length > 0) {
      out(`  ${style.dim(`Suggested checks: ${pack.checks.map((check) => check.name).join(', ')}`)}`);
    }
    config.packs.push(spec);
    added.push(spec);

    const newChecks = pack.checks.filter(
      (check) => !config.checks.some((existing) => existing.name === check.name),
    );
    if (newChecks.length > 0) {
      const accept = flagBool(args, 'yes') || (await confirm(`  Add its ${newChecks.length} suggested check(s)?`, true));
      if (accept) config.checks.push(...newChecks);
    }
  }

  if (added.length === 0) return 0;

  writeText(join(root, CONFIG_FILE), serializeConfig(config));
  const plan = planSync(root, config, VERSION);
  const result = applySync(root, plan, config, VERSION);

  ok(`Attached ${added.join(', ')} · ${result.written.length} file(s) written`);
  out(style.dim('  Commit the generated files so every teammate and agent picks the pack up.'));
  return 0;
}
