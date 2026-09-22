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
import { VERSION, flagBool, flagString, type Args } from '../cli.js';
import { PROGRAM } from '../util/program.js';
import { CONFIG_FILE, loadConfig, serializeConfig } from '../config.js';
import { askOptions, describePack, offerChecks, record } from '../attach.js';
import { parseSelections } from '../options.js';
import {
  ROLE_LABEL,
  MANIFEST_FILE,
  SKILL_ROLES,
  bundledPacks,
  locatePack,
  packName,
  resolvePack,
  type SkillRole,
} from '../packs.js';
import { applySync, planSync } from '../sync.js';
import { exists, writeText } from '../util/fs.js';
import { isSlug } from '../util/yaml.js';
import { CliError, heading, info, ok, out, style } from '../util/log.js';

/** Where a pack this repository owns lives, unless the caller names another path. */
export const PACKS_ROOT = '.collab-swarm/packs';

const list = (args: Args, name: string): string[] =>
  (flagString(args, name) ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

export interface Planned {
  name: string;
  role: SkillRole;
}

export interface Scaffold {
  /** Absolute path of the pack directory. */
  dir: string;
  name: string;
  title: string;
  description: string;
  skills: Planned[];
  /** Rule file names, with or without the `.md`. */
  rules: string[];
  /** What the project said about its stack, for the agent that fills the stubs. */
  brief?: string;
}

/**
 * Writes the pack's shape: manifest, one stub per skill, one per rule.
 *
 * Shared with `init`, which offers the same scaffold to a project whose stack
 * no default pack covers, so a pack written by hand and one written by an agent
 * start from the same skeleton.
 */
export function scaffoldPack(scaffold: Scaffold): string[] {
  const rules = scaffold.rules.map((rule) => (rule.endsWith('.md') ? rule : `${rule}.md`));
  writeText(
    join(scaffold.dir, MANIFEST_FILE),
    manifest(scaffold.name, scaffold.title, scaffold.description, scaffold.skills),
  );
  for (const skill of scaffold.skills) {
    writeText(join(scaffold.dir, 'skills', skill.name, 'SKILL.md'), skillStub(skill));
  }
  for (const rule of rules) writeText(join(scaffold.dir, 'rules', rule), ruleStub(rule));
  if (scaffold.brief) writeText(join(scaffold.dir, BRIEF_FILE), scaffold.brief);
  return rules;
}

/** What the project told `init` about its stack, read by the `to-pack` skill. */
export const BRIEF_FILE = 'BRIEF.md';

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
  switch (args.positional[0]) {
    case 'new':
      return runNew(args);
    case 'list':
      return runList();
    case 'options':
      return runOptions(args);
    default:
      throw new CliError(
        'Say what to do with a pack.',
        64,
        `Usage: ${PROGRAM} pack list | ${PROGRAM} pack options <pack> | ${PROGRAM} pack new <name> [--router <skill>] [--skills a,b].`,
      );
  }
}

/** The default packs this collab-swarm ships, and what each one asks. */
function runList(): number {
  const packs = bundledPacks();
  if (packs.length === 0) {
    info('This collab-swarm ships no default packs.');
    out(style.dim('  Write one for this project: npx collab-swarm pack new <name>, or ask your agent to run `to-pack`.'));
    return 0;
  }
  for (const pack of packs) {
    heading(`${pack.title} ${style.dim(`· ${PROGRAM} add ${pack.name}`)}`);
    if (pack.description) out(`  ${pack.description}`);
    for (const option of pack.options) {
      const choices = pack.options.length > 0 ? option.choices.map((choice) => choice.id).join(' | ') : '';
      out(`  ${style.blue('?')} ${option.question} ${style.dim(choices)}`);
    }
    const concerns = pack.skills.filter((skill) => skill.role === 'ticket');
    out(
      style.dim(
        `  ${concerns.length} concern skill(s), ${pack.rules.length} rule(s)` +
          `${pack.checks.length > 0 ? `, ${pack.checks.length} suggested check(s)` : ''} at these defaults.`,
      ),
    );
  }
  out('');
  out(style.dim('  Nothing to install: a default pack ships inside collab-swarm.'));
  return 0;
}

/** Re-asks an attached pack's questions and re-applies everything they decide. */
async function runOptions(args: Args): Promise<number> {
  const { config, root } = loadConfig();
  const spec = args.positional[1];
  if (!spec) {
    throw new CliError(
      'Name the attached pack whose answers to change.',
      64,
      config.packs.length > 0
        ? `Attached: ${config.packs.join(', ')}.`
        : 'No packs are attached. Add one: npx collab-swarm add <pack>.',
    );
  }
  if (!config.packs.includes(spec)) {
    throw new CliError(
      `"${spec}" is not attached to this repository.`,
      1,
      config.packs.length > 0
        ? `Attached: ${config.packs.join(', ')}. Attach another with: npx collab-swarm add ${spec}`
        : `Attach it first: npx collab-swarm add ${spec}`,
    );
  }

  const assumeYes = flagBool(args, 'yes') || flagBool(args, 'y');
  const preset = parseSelections(flagString(args, 'options') ?? '');
  const recorded = config.packOptions[packName(locatePack(spec, root).dir)] ?? {};
  const current = resolvePack(spec, root, recorded);
  if (current.options.length === 0) {
    info(`${current.title} asks no questions, so there is nothing to change.`);
    return 0;
  }

  const answers = await askOptions(current, { preset, ...(assumeYes ? { assumeYes } : {}) });
  const pack = resolvePack(spec, root, answers);

  heading(`${pack.title} ${style.dim(`(${pack.name})`)}`);
  describePack(pack);

  record(config, spec, pack, answers);
  config.checks.push(...(await offerChecks(config, pack, assumeYes)));
  writeText(join(root, CONFIG_FILE), serializeConfig(config));

  const plan = planSync(root, config, VERSION);
  const result = applySync(root, plan, config, VERSION);
  ok(
    `${result.written.length} file(s) written` +
      `${result.removed.length > 0 ? `, ${result.removed.length} removed` : ''}`,
  );
  out(style.dim('  A skill an answer ruled out is removed from every target, not left behind.'));
  return 0;
}

async function runNew(args: Args): Promise<number> {
  const name = args.positional[1];
  if (!name) {
    throw new CliError('Name the pack.', 64, `For example: ${PROGRAM} pack new flutter.`);
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

  const title = flagString(args, 'title') ?? name;
  const description = flagString(args, 'description') ?? '';
  const rules = scaffoldPack({
    dir: absolute,
    name,
    title,
    description,
    skills: planned,
    rules: list(args, 'rules'),
  });

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
  out(style.dim(`    npx collab-swarm add ${dir}`));
  out(style.dim(`    npx collab-swarm steps ${router ?? '<skill>'}   # read the pack back and check it`));
  return 0;
}
