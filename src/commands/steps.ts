import { flagBool, type Args } from '../cli.js';
import { loadConfig } from '../config.js';
import {
  buildStepMap,
  type AppliedRule,
  type RuleCoverage,
  type SkillMap,
} from '../core/steps.js';
import { ROLE_LABEL, loadPacks } from '../packs.js';
import { CliError, out, style } from '../util/log.js';

const JOIN = style.dim(' · ');

/** An indented `label  value` line under a step. */
const detail = (label: string, value: string) => out(`       ${style.dim(label.padEnd(5))} ${value}`);

const WHY: Record<AppliedRule['reason'], string> = {
  always: 'declares no path scope, so it applies everywhere',
  skill: 'names this skill as the recipe that satisfies it',
  path: 'scopes a file this step touches',
};

const ruleLine = (rule: AppliedRule) =>
  `${rule.file}${rule.match ? style.dim(` → ${rule.match}`) : ''}`;

/** `full` adds the documents a step links to, which the overview leaves out. */
function renderSteps(skill: SkillMap, full = false): void {
  for (const step of skill.steps) {
    out(`  ${style.bold(`${step.number}.`)} ${style.bold(step.title)}`);
    if (step.calls.length) detail('calls', step.calls.join(style.dim(' → ')));
    if (step.reads.length) detail('reads', step.reads.join(JOIN));
    if (step.names.length) detail('names', step.names.join(JOIN));
    if (step.artifacts.length) detail('files', step.artifacts.join(JOIN));
    if (full && step.documents.length) detail('docs', step.documents.join(JOIN));
    if (step.rules.length) detail('rules', step.rules.map(ruleLine).join(JOIN));
    for (const command of step.commands) detail('runs', style.cyan(command));
    if (step.doneWhen) detail('done', style.dim(step.doneWhen));
  }
}

function renderHeader(skill: SkillMap): void {
  out('');
  out(
    `${style.bold(skill.name)}${JOIN}${style.dim(ROLE_LABEL[skill.role])}${JOIN}${style.dim(skill.pack)}`,
  );
  for (const rule of skill.rules) {
    out(`  ${style.blue('▸')} ${style.dim('every step')}  ${rule.file} ${style.dim(`— ${WHY[rule.reason]}`)}`);
  }
}

/** Every installed skill, in the order the workflow reaches them. */
function renderOverview(map: ReturnType<typeof buildStepMap>, project: string, plans: string): void {
  const running = map.skills.filter((skill) => skill.steps.length > 0);
  const consulted = map.skills.filter((skill) => skill.steps.length === 0);

  out('');
  out(style.bold(`Execution steps${JOIN}${project}`));
  out(
    style.dim(
      `  ${running.length} skills run as steps · ${consulted.length} consulted · ` +
        `${map.rules.length} rule${map.rules.length === 1 ? '' : 's'} · plans in ${plans}`,
    ),
  );

  for (const skill of running) {
    renderHeader(skill);
    renderSteps(skill);
  }

  if (consulted.length > 0) {
    out('');
    out(style.bold('Read, not run'));
    out(style.dim('  No numbered sequence: read for vocabulary and judgement while another skill runs.'));
    for (const skill of consulted) {
      out(`  ${style.bold(skill.name)} ${style.dim(skill.topics.join(' · ') || skill.description)}`);
    }
  }

  out('');
  out(style.dim('  One skill in full: npx swarm steps <skill>'));
  out(style.dim('  By rule instead:   npx swarm steps --rules'));
  out('');
}

function renderSkill(skill: SkillMap): void {
  out('');
  out(
    `${style.bold(skill.heading)}${JOIN}${style.bold(skill.name)}${JOIN}` +
      `${style.dim(ROLE_LABEL[skill.role])}${JOIN}${style.dim(skill.pack)}`,
  );
  if (skill.description) out(style.dim(`  ${skill.description}`));
  if (skill.preamble) {
    out('');
    out(skill.preamble);
  }

  if (skill.rules.length > 0) {
    out('');
    out(style.bold('In force for every step'));
    for (const rule of skill.rules) {
      out(`  ${style.blue('▸')} ${rule.file} ${style.dim(`— ${WHY[rule.reason]}`)}`);
      if (rule.description) out(style.dim(`    ${rule.description}`));
      out(style.dim(`    scope ${rule.paths.length ? rule.paths.join(' · ') : 'every file'}`));
    }
  }

  if (skill.steps.length > 0) {
    out('');
    out(style.bold('Steps'));
    renderSteps(skill, true);
  } else {
    out('');
    out(style.bold('Topics'));
    out(`  ${skill.topics.join(JOIN) || style.dim('none')}`);
    out(style.dim('  This skill has no numbered sequence; it is read while another skill runs.'));
  }

  if (skill.companions.length > 0) {
    out('');
    out(`${style.bold('Beside it')} ${style.dim(skill.companions.join(' · '))}`);
  }
  out('');
}

function renderRules(rules: RuleCoverage[], plans: string): void {
  out('');
  out(style.bold(`Rules${JOIN}${rules.length} installed`));

  if (rules.length === 0) {
    out(style.dim('  No rules are installed. A pack adds path-scoped rules alongside its skills.'));
    out('');
    return;
  }

  for (const rule of rules) {
    out('');
    out(`${style.bold(rule.file)}${JOIN}${style.dim(rule.pack)}`);
    if (rule.description) out(`  ${rule.description}`);
    out(`  ${style.dim('scope')} ${rule.paths.length ? rule.paths.join(JOIN) : 'every file'}`);

    if (rule.sites.length === 0) {
      out(
        style.dim(
          '  No step names a file inside its scope. Expected for a rule over source\n' +
            `  files, which govern whatever a ticket touches; for one over plan files it\n` +
            `  usually means its globs and "plans: ${plans}" disagree.`,
        ),
      );
      continue;
    }

    const width = Math.max(...rule.sites.map((site) => site.skill.length));
    out(`  ${style.dim(`in force at ${rule.sites.length} site${rule.sites.length === 1 ? '' : 's'}`)}`);
    for (const site of rule.sites) {
      const where =
        site.step === null ? style.dim('every step') : `${site.step}. ${site.stepTitle}`;
      out(`    ${site.skill.padEnd(width)}  ${where}${site.match ? style.dim(`  ${site.match}`) : ''}`);
    }
  }
  out('');
}

export async function run(args: Args): Promise<number> {
  const { config, root } = loadConfig();
  const packs = loadPacks(root, config.packs);
  const map = buildStepMap(packs, { plansDir: config.plans });

  const wanted = args.positional[0];
  const skill = wanted ? map.skills.find((entry) => entry.name === wanted) : null;
  if (wanted && !skill) {
    throw new CliError(
      `No installed skill is called "${wanted}".`,
      1,
      `Installed: ${map.skills.map((entry) => entry.name).join(', ')}.`,
    );
  }

  if (flagBool(args, 'json')) {
    const body = skill
      ? skill
      : flagBool(args, 'rules')
        ? { project: config.project, rules: map.rules }
        : { project: config.project, plans: config.plans, ...map };
    out(JSON.stringify(body, null, 2));
    return 0;
  }

  if (skill) renderSkill(skill);
  else if (flagBool(args, 'rules')) renderRules(map.rules, config.plans);
  else renderOverview(map, config.project, config.plans);
  return 0;
}
