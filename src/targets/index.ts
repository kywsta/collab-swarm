import { readTextOrNull } from '../util/fs.js';
import { CliError } from '../util/log.js';
import { readFrontMatter, toYaml } from '../util/yaml.js';
import { renderMemoryBlock } from './memory.js';
import type { EmitContext, Emission, Target } from './types.js';

export * from './types.js';
export { BLOCK_END, BLOCK_START, mergeBlock, renderMemoryBlock } from './memory.js';

const managed = (path: string, content: string): Emission => ({ path, content, mode: 'managed' });
const seed = (path: string, content: string): Emission => ({ path, content, mode: 'seed' });
const block = (path: string, content: string): Emission => ({ path, content, mode: 'block' });

/**
 * Codex, Antigravity and OpenCode all read `.agents/` natively, so the shared
 * payload lives there once and those targets only add their own wiring.
 */
const SHARED_ROOT = '.agents';

const workflowFiles = (context: EmitContext, root: string): Emission[] =>
  [...context.workflow.entries()].map(([name, content]) => managed(`${root}/workflow/${name}`, content));

/**
 * Rewrites a rule body's links to the workflow documents.
 *
 * A rule is authored beside its own payload (`../workflow/...`). A target that
 * keeps its rules somewhere else — Cursor puts them in `.cursor/rules` while
 * reading the shared `.agents/` payload — needs those links repointed, or the
 * rule names a directory that is not there.
 */
function repointWorkflowLinks(body: string, ruleDir: string, payloadRoot: string): string {
  const hops = ruleDir.split('/').filter(Boolean).length;
  const prefix = `${'../'.repeat(hops)}${payloadRoot}/workflow/`;
  if (prefix === '../workflow/') return body;
  return body.replaceAll('](../workflow/', `](${prefix}`);
}

/** Path-scoped rule, in the front-matter dialect the target understands. */
function ruleFor(target: 'paths' | 'cursor', rule: { paths: string[]; description: string }, body: string) {
  if (target === 'cursor') {
    const data: Record<string, unknown> = {
      description: rule.description || undefined,
      globs: rule.paths.length ? rule.paths.join(',') : undefined,
      alwaysApply: rule.paths.length === 0,
    };
    for (const key of Object.keys(data)) if (data[key] === undefined) delete data[key];
    return `---\n${toYaml(data).trimEnd()}\n---\n\n${body.replace(/^\n+/, '')}`;
  }
  const data: Record<string, unknown> = { paths: rule.paths };
  if (rule.description) data.description = rule.description;
  return `---\n${toYaml(data).trimEnd()}\n---\n\n${body.replace(/^\n+/, '')}`;
}

export function renderRules(
  context: EmitContext,
  dialect: 'paths' | 'cursor',
  ruleDir: string,
  payloadRoot: string,
): Map<string, string> {
  const rendered = new Map<string, string>();
  for (const rule of context.rules) {
    const text = readTextOrNull(rule.path) ?? '';
    const front = readFrontMatter(text);
    const body = repointWorkflowLinks(front ? front.body : text, ruleDir, payloadRoot);
    const name = dialect === 'cursor' ? rule.file.replace(/\.md$/, '.mdc') : rule.file;
    rendered.set(name, ruleFor(dialect, rule, body));
  }
  return rendered;
}

const claudeSettings = (context: EmitContext) =>
  `${JSON.stringify(
    {
      $schema: 'https://json.schemastore.org/claude-code-settings.json',
      permissions: {
        allow: [
          'Bash(npx swarm:*)',
          'Bash(swarm:*)',
          'Bash(git status:*)',
          'Bash(git diff:*)',
          'Bash(git log:*)',
          ...context.config.checks.map((check) => `Bash(${check.run.split(' ').slice(0, 2).join(' ')}:*)`),
        ].filter((value, index, all) => all.indexOf(value) === index),
      },
    },
    null,
    2,
  )}\n`;

export const claude: Target = {
  id: 'claude',
  label: 'Claude Code',
  hint: '.claude/ + CLAUDE.md',
  skillRoot: '.claude/skills',
  ruleRoot: '.claude/rules',
  memoryFile: 'CLAUDE.md',
  emit(context) {
    const rules = renderRules(context, 'paths', '.claude/rules', '.claude');
    return [
      ...workflowFiles(context, '.claude'),
      ...[...rules].map(([name, content]) => managed(`.claude/rules/${name}`, content)),
      block('CLAUDE.md', renderMemoryBlock(context, '.claude/workflow')),
      seed('.claude/settings.json', claudeSettings(context)),
    ];
  },
};

export const agents: Target = {
  id: 'agents',
  label: 'AGENTS.md standard',
  hint: '.agents/ + AGENTS.md — read by Codex, Antigravity, OpenCode, Amp and others',
  skillRoot: `${SHARED_ROOT}/skills`,
  ruleRoot: `${SHARED_ROOT}/rules`,
  memoryFile: 'AGENTS.md',
  emit(context) {
    const rules = renderRules(context, 'paths', `${SHARED_ROOT}/rules`, SHARED_ROOT);
    return [
      ...workflowFiles(context, SHARED_ROOT),
      ...[...rules].map(([name, content]) => managed(`${SHARED_ROOT}/rules/${name}`, content)),
      block('AGENTS.md', renderMemoryBlock(context, `${SHARED_ROOT}/workflow`)),
    ];
  },
};

export const codex: Target = {
  id: 'codex',
  label: 'OpenAI Codex',
  hint: 'AGENTS.md + .agents/skills (Codex reads both natively)',
  skillRoot: `${SHARED_ROOT}/skills`,
  ruleRoot: `${SHARED_ROOT}/rules`,
  memoryFile: 'AGENTS.md',
  emit(context) {
    return [...agents.emit(context), ...commandFiles(context, '.codex/prompts', 'md')];
  },
};

export const antigravity: Target = {
  id: 'antigravity',
  label: 'Google Antigravity',
  hint: 'AGENTS.md + .agents/rules and .agents/skills (recognised natively)',
  skillRoot: `${SHARED_ROOT}/skills`,
  ruleRoot: `${SHARED_ROOT}/rules`,
  memoryFile: 'AGENTS.md',
  emit(context) {
    return [...agents.emit(context), ...commandFiles(context, `${SHARED_ROOT}/workflows`, 'md')];
  },
};

export const opencode: Target = {
  id: 'opencode',
  label: 'OpenCode',
  hint: 'AGENTS.md + .opencode/commands (skills are read from .agents/)',
  skillRoot: `${SHARED_ROOT}/skills`,
  ruleRoot: `${SHARED_ROOT}/rules`,
  memoryFile: 'AGENTS.md',
  emit(context) {
    return [...agents.emit(context), ...commandFiles(context, '.opencode/commands', 'md')];
  },
};

export const cursor: Target = {
  id: 'cursor',
  label: 'Cursor',
  hint: '.cursor/rules/*.mdc + .cursor/commands, over the shared .agents/ payload',
  skillRoot: `${SHARED_ROOT}/skills`,
  ruleRoot: '.cursor/rules',
  memoryFile: 'AGENTS.md',
  emit(context) {
    // Cursor's own primitives are .mdc rules and saved commands; the skills and
    // workflow documents they point at are the shared copy under .agents/.
    const rules = renderRules(context, 'cursor', '.cursor/rules', SHARED_ROOT);
    return [
      ...workflowFiles(context, SHARED_ROOT),
      ...[...rules].map(([name, content]) => managed(`.cursor/rules/${name}`, content)),
      block('AGENTS.md', renderMemoryBlock(context, `${SHARED_ROOT}/workflow`)),
      ...commandFiles(context, '.cursor/commands', 'md'),
    ];
  },
};

/**
 * A slash command per coordinator and stage skill, for the tools that expose
 * saved prompts. Each one hands straight to the skill so there is a single
 * source of behaviour.
 */
function commandFiles(context: EmitContext, dir: string, extension: string): Emission[] {
  return context.skills
    .filter((skill) => skill.role === 'coordinator' || skill.role === 'stage')
    .map((skill) =>
      managed(
        `${dir}/${skill.name}.${extension}`,
        [
          '---',
          `description: ${skill.description.replace(/\n/g, ' ')}`,
          '---',
          '',
          `Run the \`${skill.name}\` skill for this repository.`,
          '',
          `Read its instructions at \`${sharedSkillPath(context, skill.name)}/SKILL.md\` and follow them exactly.`,
          'Arguments, when present, name the feature or plan to act on: $ARGUMENTS',
          '',
        ].join('\n'),
      ),
    );
}

const sharedSkillPath = (context: EmitContext, name: string) => {
  const roots = new Set(
    context.config.targets
      .map((id) => TARGETS.find((target) => target.id === id)?.skillRoot)
      .filter((root): root is string => Boolean(root)),
  );
  const preferred = [...roots].find((root) => root.startsWith(SHARED_ROOT)) ?? [...roots][0] ?? '.agents/skills';
  return `${preferred}/${name}`;
};

export const TARGETS: Target[] = [claude, agents, codex, cursor, opencode, antigravity];

export const targetIds = () => TARGETS.map((target) => target.id);

export function resolveTargets(ids: string[]): Target[] {
  const found: Target[] = [];
  for (const id of ids) {
    const target = TARGETS.find((candidate) => candidate.id === id);
    if (!target) {
      throw new CliError(
        `Unknown agent target "${id}".`,
        1,
        `Known targets: ${targetIds().join(', ')}.`,
      );
    }
    if (!found.includes(target)) found.push(target);
  }
  return found;
}
