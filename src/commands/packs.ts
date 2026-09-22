import { flagBool, type Args } from '../cli.js';
import { loadConfig } from '../config.js';
import { ROLE_LABEL, loadPacks } from '../packs.js';
import { heading, out, style } from '../util/log.js';

export async function run(args: Args): Promise<number> {
  const { config, root } = loadConfig();
  const set = loadPacks(root, config.packs, config.packOptions);

  if (flagBool(args, 'json')) {
    out(
      JSON.stringify(
        set.packs.map((pack) => ({
          name: pack.name,
          title: pack.title,
          spec: pack.spec,
          core: pack.core,
          bundled: pack.bundled,
          options: pack.options.map((option) => ({
            id: option.id,
            question: option.question,
            chosen: pack.selections[option.id],
            choices: option.choices.map((choice) => choice.id),
          })),
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
    const origin = pack.core ? ' · built in' : pack.bundled ? ` · default pack · ${pack.spec}` : ` · ${pack.spec}`;
    heading(`${pack.title}${style.dim(origin)}`);
    if (pack.description) out(`  ${pack.description}`);
    for (const option of pack.options) {
      const chosen = option.choices.find((choice) => choice.id === pack.selections[option.id]);
      out(`  ${style.blue('?')} ${option.question}: ${style.bold(chosen?.label ?? '—')}`);
    }
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
  if (set.packs.some((pack) => pack.options.length > 0 && !pack.core)) {
    out(style.dim('  Change an answer: npx collab-swarm pack options <pack>'));
  }
  out(style.dim('  Add another: npx collab-swarm add <name|npm-package|path> · see the defaults: npx collab-swarm pack list'));
  return 0;
}
