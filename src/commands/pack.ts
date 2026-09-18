/**
 * Scaffolds a pack this repository owns.
 *
 * A stack pack is written for one project, from its own libraries and layout,
 * so it is authored here rather than installed. The scaffold exists to make
 * the manifest and the directory shape correct before an agent starts writing
 * prose into them: a role misspelled in the manifest silently degrades to
 * `ticket`, and a ticket may then schedule a skill that was never meant to be.
 *
 * Every file it writes is deliberately unfinished — front matter with an empty
 * description and no body — so an unfilled skill is visible in `swarm packs`
 * rather than passing for finished work.
 */

import { join } from 'node:path';
import { flagBool, flagString, type Args } from '../cli.js';
import { CONFIG_FILE, loadConfig, serializeConfig } from '../config.js';
import { ROLE_LABEL, MANIFEST_FILE, SKILL_ROLES, type SkillRole } from '../packs.js';
import { exists, writeText } from '../util/fs.js';
import { isSlug } from '../util/yaml.js';
import { CliError, heading, ok, out, style } from '../util/log.js';

/** Where a pack this repository owns lives, unless the caller names another path. */
export const PACKS_ROOT = '.collab-swarm/packs';

const list = (args: Args, name: string): string[] =>
  (flagString(args, name) ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

interface Planned {
  name: string;
  role: SkillRole;
}

/** A skill file that is valid, loadable, and obviously not written yet. */
const skillStub = (skill: Planned) =>
  [
    '---',
    `name: ${skill.name}`,
    'description:',
    '---',
    '',
    `# ${skill.name}`,
    '',
    `Unwritten. This skill ${ROLE_LABEL[skill.role]}.`,
    '',
  ].join('\n');

/**
 * A rule file scoped to a path that matches nothing.
 *
 * An empty `paths` means *applies everywhere*, so a stub left unfilled would
 * be loaded into every agent turn — the loudest possible way to be unfinished.
 * A placeholder glob is inert, and `swarm validate` reports it.
 */
const ruleStub = (file: string) =>
  [
    '---',
    'paths:',
    '  - "TODO-scope-this-rule/**"',
    'description:',
    '---',
    '',
    `# ${file.replace(/\.md$/, '').replace(/-/g, ' ')} rule`,
    '',
    'Unwritten.',
    '',
  ].join('\n');

function manifest(name: string, title: string, description: string, skills: Planned[]): string {
  return `${JSON.stringify(
    {
      name,
      title,
      description,
      collabSwarm: 1,
      skills: skills.map((skill) => ({ name: skill.name, role: skill.role })),
      checks: [],
    },
    null,
    2,
  )}\n`;
}

export async function run(args: Args): Promise<number> {
  if (args.positional[0] !== 'new') {
    throw new CliError(
      'Say what to do with a pack.',
      64,
      'Usage: swarm pack new <name> [--router <skill>] [--skills a,b] [--reviews a] [--rules a,b].',
    );
  }

  const name = args.positional[1];
  if (!name) {
    throw new CliError('Name the pack.', 64, 'For example: swarm pack new flutter.');
  }
  if (!isSlug(name)) {
    throw new CliError(
      `"${name}" is not a usable pack name.`,
      64,
      'Use lower-case words joined by hyphens, such as `flutter` or `nestjs`.',
    );
  }

  const { config, root } = loadConfig();
  const dir = flagString(args, 'dir') ?? `${PACKS_ROOT}/${name}`;
  const absolute = join(root, dir);
  if (exists(join(absolute, MANIFEST_FILE))) {
    throw new CliError(
      `${dir} already holds a pack.`,
      1,
      'Edit it in place, or pass --dir to scaffold somewhere else.',
    );
  }

  const planned: Planned[] = [];
  const add = (names: string[], role: SkillRole) => {
    for (const skill of names) {
      if (!isSlug(skill)) {
        throw new CliError(
          `"${skill}" is not a usable skill name.`,
          64,
          'Use lower-case words joined by hyphens, such as `flutter-api-integration`.',
        );
      }
      if (planned.some((entry) => entry.name === skill)) continue;
      planned.push({ name: skill, role });
    }
  };

  const router = flagString(args, 'router');
  if (router) add([router], 'router');
  add(list(args, 'skills'), 'ticket');
  add(list(args, 'reviews'), 'review');
  add(list(args, 'references'), 'reference');

  const rules = list(args, 'rules').map((rule) => (rule.endsWith('.md') ? rule : `${rule}.md`));
  const title = flagString(args, 'title') ?? name;
  const description = flagString(args, 'description') ?? '';

  writeText(join(absolute, MANIFEST_FILE), manifest(name, title, description, planned));
  for (const skill of planned) {
    writeText(join(absolute, 'skills', skill.name, 'SKILL.md'), skillStub(skill));
  }
  for (const rule of rules) {
    writeText(join(absolute, 'rules', rule), ruleStub(rule));
  }

  if (flagBool(args, 'attach')) {
    if (!config.packs.includes(dir)) {
      config.packs.push(dir);
      writeText(join(root, CONFIG_FILE), serializeConfig(config));
    }
  }

  heading(`Scaffolded ${title} ${style.dim(`(${dir})`)}`);
  for (const skill of planned) {
    out(`  ${style.green('•')} ${style.bold(skill.name)} ${style.dim(`— ${ROLE_LABEL[skill.role]}`)}`);
  }
  for (const rule of rules) out(`  ${style.blue('▸')} ${style.dim(`rules/${rule}`)}`);
  if (planned.length === 0 && rules.length === 0) {
    out(style.dim('  Empty: name its skills with --router, --skills, --reviews and --rules.'));
  }

  out('');
  ok('Every file is a stub: front matter with no description, and no body.');
  out(style.dim(`  Roles: ${SKILL_ROLES.join(', ')}. Only a ticket-role skill may be named by a ticket.`));
  out(style.dim('  Write each SKILL.md and rule, then:'));
  out(style.dim(`    npx swarm add ${dir}`));
  out(style.dim(`    npx swarm steps ${router ?? '<skill>'}   # read the pack back and check it`));
  return 0;
}
