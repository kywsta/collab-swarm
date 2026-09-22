import { join } from 'node:path';
import { VERSION, flagBool, flagString, type Args } from '../cli.js';
import { PROGRAM } from '../util/program.js';
import { CONFIG_FILE, loadConfig, serializeConfig } from '../config.js';
import { askOptions, describePack, offerChecks, record } from '../attach.js';
import { parseSelections } from '../options.js';
import { bundledPackNames, resolvePack } from '../packs.js';
import { applySync, planSync } from '../sync.js';
import { writeText } from '../util/fs.js';
import { CliError, heading, info, ok, out, style } from '../util/log.js';
import { interactive } from '../util/prompt.js';

export async function run(args: Args): Promise<number> {
  const specs = args.positional;
  if (specs.length === 0) {
    const available = bundledPackNames();
    throw new CliError(
      'Name the pack to add.',
      64,
      available.length > 0
        ? `A default pack (${available.join(', ')}), an npm package, or a path — for example \`${PROGRAM} add ./packs/go\`.`
        : `Usage: ${PROGRAM} add <npm-package|path> — for example \`${PROGRAM} add ./packs/go\`.`,
    );
  }

  const { config, root } = loadConfig();
  const assumeYes = flagBool(args, 'yes') || flagBool(args, 'y') || !interactive();
  const preset = parseSelections(flagString(args, 'options') ?? '');
  const added: string[] = [];

  for (const spec of specs) {
    if (config.packs.includes(spec)) {
      info(`"${spec}" is already attached. Change its answers with: npx collab-swarm pack options ${spec}`);
      continue;
    }

    // Loaded twice on purpose: once with its own defaults so the interview can
    // show them, then again with the answers, because an answer decides which
    // skills, rules and checks the pack has at all.
    const answers = await askOptions(resolvePack(spec, root), { preset, ...(assumeYes ? { assumeYes } : {}) });
    const pack = resolvePack(spec, root, answers);

    heading(`${pack.title} ${style.dim(pack.bundled ? `(default pack · ${pack.name})` : `(${pack.name})`)}`);
    describePack(pack);

    record(config, spec, pack, answers);
    added.push(spec);
    config.checks.push(...(await offerChecks(config, pack, assumeYes)));
  }

  if (added.length === 0) return 0;

  writeText(join(root, CONFIG_FILE), serializeConfig(config));
  const plan = planSync(root, config, VERSION);
  const result = applySync(root, plan, config, VERSION);

  ok(`Attached ${added.join(', ')} · ${result.written.length} file(s) written`);
  out(style.dim('  Read it back: npx collab-swarm packs · npx collab-swarm steps'));
  out(style.dim('  Commit the generated files so every teammate and agent picks the pack up.'));
  return 0;
}
