import { flagBool, type Args } from '../cli.js';
import { loadConfig } from '../config.js';
import { ROLE_LABEL, loadPacks } from '../packs.js';
import { heading, out, style } from '../util/log.js';

export async function run(args: Args): Promise<number> {
  const { config, root } = loadConfig();
  const set = loadPacks(root, config.packs);

  if (flagBool(args, 'json')) {
    out(
      JSON.stringify(
        set.packs.map((pack) => ({
          name: pack.name,
          title: pack.title,
          spec: pack.spec,
          core: pack.core,
          skills: pack.skills.map((skill) => ({ name: skill.name, role: skill.role })),
          rules: pack.rules.map((rule) => rule.file),
        })),
        null,
        2,
      ),
    );
    return 0;
  }

  for (const pack of set.packs) {
    heading(`${pack.title}${pack.core ? style.dim(' · built in') : style.dim(` · ${pack.spec}`)}`);
    if (pack.description) out(`  ${pack.description}`);
    for (const skill of pack.skills) {
      out(`  ${style.green('•')} ${style.bold(skill.name)} ${style.dim(`— ${ROLE_LABEL[skill.role]}`)}`);
    }
    for (const rule of pack.rules) {
      const scope = rule.paths.length ? rule.paths.join(', ') : 'always applies';
      out(`  ${style.blue('▸')} ${rule.file} ${style.dim(`— ${scope}`)}`);
    }
  }

  out('');
  out(style.dim(`  ${set.skills.length} skills and ${set.rules.length} rules across ${set.packs.length} pack(s).`));
  out(style.dim('  Add another: npx swarm add <npm-package|path>'));
  return 0;
}
