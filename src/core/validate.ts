import { basename, join, relative } from 'node:path';
import type { Config } from '../config.js';
import { CONFIG_FILE, inRoot } from '../config.js';
import type { PackSet } from '../packs.js';
import { readPackFile, ticketSkills } from '../packs.js';
import { unresolvedMarkers, unresolvedVars } from '../options.js';
import { exists, listFiles, readTextOrNull } from '../util/fs.js';
import { isSlug, readFrontMatter } from '../util/yaml.js';
import {
  PLAN_STAGES,
  PLAN_STATUSES,
  REQUIREMENTS_SECTIONS,
  SCHEMA_VERSION,
  SPECIFICATION_SECTIONS,
  TICKET_SECTIONS,
  TICKET_STATUSES,
  WORKFLOW_VERSION,
  isSettled,
  listPlanDirs,
  readPlan,
  readTickets,
  requirementsFile,
  sectionBody,
  specificationFile,
  stageAtLeast,
  ticketsDir,
  type PlanStage,
  type Ticket,
} from './plan.js';

export interface Finding {
  /** Path shown to the user, relative to the repository root. */
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export class Findings {
  readonly list: Finding[] = [];

  constructor(private readonly root: string) {}

  private rel(path: string) {
    const value = relative(this.root, path);
    return value === '' || value.startsWith('..') ? path : value;
  }

  error(path: string, message: string) {
    this.list.push({ path: this.rel(path), message, severity: 'error' });
  }

  warn(path: string, message: string) {
    this.list.push({ path: this.rel(path), message, severity: 'warning' });
  }

  get errors() {
    return this.list.filter((finding) => finding.severity === 'error');
  }

  get warnings() {
    return this.list.filter((finding) => finding.severity === 'warning');
  }

  get ok() {
    return this.errors.length === 0;
  }
}

const SLUG_HINT = 'a descriptive kebab-case slug';

/** The core pack's templates, against which an unfilled section is detected. */
const templateDir = (packs: PackSet): string | null => {
  const core = packs.packs.find((pack) => pack.core);
  return core ? join(core.dir, 'workflow', 'templates') : null;
};

/** Reports a missing or empty `## Section` heading. */
function checkSections(
  file: string,
  sections: string[],
  findings: Findings,
  requireContent = true,
): void {
  const text = readTextOrNull(file);
  if (text === null) {
    findings.error(file, 'file is missing');
    return;
  }
  const normalized = text.replace(/\r\n/g, '\n');
  for (const section of sections) {
    const heading = new RegExp(
      `^## ${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`,
      'm',
    );
    const match = heading.exec(normalized);
    if (!match) {
      findings.error(file, `required section "${section}" is missing`);
      continue;
    }
    if (!requireContent) continue;
    const start = match.index + match[0].length;
    const next = /^##\s+/m.exec(normalized.slice(start));
    const body = normalized.slice(start, next ? start + next.index : undefined).trim();
    if (body === '') findings.error(file, `required section "${section}" is empty`);
  }
}

function checkNoPlaceholders(file: string, findings: Findings): void {
  const text = readTextOrNull(file);
  if (text === null) return;
  if (/\{\{[^}\n]+\}\}/.test(text)) findings.error(file, 'unresolved template placeholder');
  if (/<REPLACE[^>]*>/i.test(text)) findings.error(file, 'unresolved template placeholder');
}

/**
 * A body the template pre-fills that is *also* a complete answer. "None." under
 * open questions means there are none, not that nobody filled the section in.
 */
const SETTLED_ANSWER = /^(none|not applicable|n\/a)\.?$/i;

/**
 * A section still carrying the template's own prose is as unfinished as an
 * empty one, and reads as finished to everyone but its author.
 */
function checkNotTemplate(
  file: string,
  templatePath: string | null,
  sections: string[],
  findings: Findings,
): void {
  const text = readTextOrNull(file);
  const template = templatePath === null ? null : readTextOrNull(templatePath);
  if (text === null || template === null) return;
  const untouched = sections.filter((section) => {
    const body = sectionBody(text, section);
    if (body === null || body === '' || SETTLED_ANSWER.test(body)) return false;
    return body === sectionBody(template, section);
  });
  for (const section of untouched) {
    findings.error(file, `section "${section}" still holds the template's placeholder text`);
  }
}

function checkTicketGraph(tickets: Ticket[], findings: Findings): void {
  const bySlug = new Map(tickets.map((ticket) => [ticket.slug, ticket]));

  for (const ticket of tickets) {
    for (const dependency of ticket.dependsOn) {
      if (dependency === ticket.slug) {
        findings.error(ticket.file, 'ticket cannot depend on itself');
      } else if (!bySlug.has(dependency)) {
        findings.error(ticket.file, `unknown ticket dependency "${dependency}"`);
      }
    }
    if (ticket.status === 'in-progress' || ticket.status === 'done') {
      const unfinished = ticket.dependsOn.filter(
        (dependency) => bySlug.get(dependency)?.status !== 'done',
      );
      if (unfinished.length > 0) {
        findings.error(
          ticket.file,
          `${ticket.status} ticket has unfinished dependencies: ${unfinished.join(', ')}`,
        );
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cyclic = (slug: string): boolean => {
    if (visiting.has(slug)) return true;
    if (visited.has(slug)) return false;
    visiting.add(slug);
    const found = (bySlug.get(slug)?.dependsOn ?? []).some(
      (dependency) => bySlug.has(dependency) && cyclic(dependency),
    );
    visiting.delete(slug);
    visited.add(slug);
    return found;
  };
  for (const ticket of tickets) {
    if (cyclic(ticket.slug)) {
      findings.error(ticket.file, 'ticket dependency graph contains a cycle');
      break;
    }
  }
}

function checkTicketFrontMatter(ticket: Ticket, allowed: string[], findings: Findings): void {
  const text = readTextOrNull(ticket.file);
  if (text === null) return;
  const front = readFrontMatter(text);
  if (!front) {
    findings.error(ticket.file, 'YAML front matter is missing or unclosed');
    return;
  }
  if (ticket.title === '') findings.error(ticket.file, 'ticket title must be a non-empty string');
  if (!TICKET_STATUSES.includes(ticket.status)) {
    findings.error(
      ticket.file,
      `ticket status "${ticket.status}" is not one of ${TICKET_STATUSES.join(', ')}`,
    );
  }
  if (!Array.isArray(front.data.depends_on)) {
    findings.error(ticket.file, 'depends_on must be a list of ticket slugs');
  } else if (ticket.dependsOn.some((slug) => !isSlug(slug))) {
    findings.error(ticket.file, `depends_on must contain ${SLUG_HINT}`);
  }

  const unknown = ticket.skills.filter((skill) => !allowed.includes(skill));
  if (ticket.skills.length === 0) {
    findings.error(ticket.file, 'skills must name at least one implementation skill');
  } else if (unknown.length > 0) {
    findings.error(
      ticket.file,
      `unknown ticket skill ${unknown.map((skill) => `"${skill}"`).join(', ')}. ` +
        `Installed ticket skills: ${allowed.join(', ')}. ` +
        'Install the pack that provides it, or drop it from this ticket.',
    );
  }

  for (const key of Object.keys(front.data)) {
    if (!['title', 'status', 'depends_on', 'skills'].includes(key)) {
      findings.error(ticket.file, `unexpected ticket field "${key}"`);
    }
  }

  if (ticket.status === 'deferred' && !/^## Deferred\s*$/m.test(text.replace(/\r\n/g, '\n'))) {
    findings.error(ticket.file, 'a deferred ticket must record what it waits for under "## Deferred"');
  }
  if (ticket.status === 'blocked' && !/^## Blocked\s*$/m.test(text.replace(/\r\n/g, '\n'))) {
    findings.warn(ticket.file, 'a blocked ticket should record the decision it needs under "## Blocked"');
  }
}

export function validatePlan(planDir: string, packs: PackSet, findings: Findings): void {
  const feature = basename(planDir);
  if (!isSlug(feature)) {
    findings.error(planDir, `feature directory must be ${SLUG_HINT}`);
    return;
  }

  const planPath = join(planDir, 'plan.yml');
  const plan = readPlan(planDir);
  if (!plan) {
    findings.error(planPath, exists(planPath) ? 'plan.yml must contain a YAML mapping' : 'file is missing');
    return;
  }

  if (plan.schemaVersion !== SCHEMA_VERSION) {
    findings.error(planPath, `schema_version must be ${SCHEMA_VERSION}`);
  }
  if (plan.workflowVersion !== WORKFLOW_VERSION) {
    findings.error(planPath, `workflow_version must be ${WORKFLOW_VERSION}`);
  }
  if (plan.feature !== feature) {
    findings.error(planPath, `feature must match the directory name "${feature}"`);
  }
  if (plan.title === '') findings.error(planPath, 'title must be a non-empty string');
  for (const key of ['createdAt', 'updatedAt'] as const) {
    if (plan[key] === '') {
      findings.error(planPath, `${key === 'createdAt' ? 'created_at' : 'updated_at'} must be a timestamp`);
    }
  }

  const stageOk = PLAN_STAGES.includes(plan.stage);
  if (!stageOk) findings.error(planPath, `stage must be one of ${PLAN_STAGES.join(', ')}`);
  if (!PLAN_STATUSES.includes(plan.status)) {
    findings.error(planPath, `status must be one of ${PLAN_STATUSES.join(', ')}`);
  }
  if ((plan.stage === 'complete') !== (plan.status === 'complete')) {
    findings.error(planPath, 'the complete stage and the complete status must be set together');
  }
  if (plan.status === 'ready' && plan.stage !== 'tickets') {
    findings.error(planPath, 'the ready status is only valid once ticketing is finished');
  }

  const sha = plan.implementationBaseSha;
  if (sha !== null && !/^[0-9a-f]{7,64}$/.test(sha)) {
    findings.error(planPath, 'implementation_base_sha is not a Git SHA');
  }
  if (stageOk && stageAtLeast(plan.stage, 'implementation') && sha === null) {
    findings.error(
      planPath,
      'implementation_base_sha is required from the implementation stage onward, so review has a stable base',
    );
  }
  if (!stageOk) return;

  // A freshly claimed row is a lone plan.yml at the requirements stage; its
  // documents arrive with the coordinator. Every later stage requires them.
  const templates = templateDir(packs);
  const template = (name: string) => (templates === null ? null : join(templates, name));

  const requirements = requirementsFile(planDir);
  const claimedOnly = plan.stage === 'requirements' && !exists(requirements);
  if (!claimedOnly) {
    checkSections(requirements, REQUIREMENTS_SECTIONS, findings);
    checkNoPlaceholders(requirements, findings);
    checkNotTemplate(requirements, template('requirements.md'), REQUIREMENTS_SECTIONS, findings);
  }

  if (stageAtLeast(plan.stage, 'specification')) {
    const specification = specificationFile(planDir);
    checkSections(specification, SPECIFICATION_SECTIONS, findings);
    checkNoPlaceholders(specification, findings);
    checkNotTemplate(specification, template('specification.md'), SPECIFICATION_SECTIONS, findings);
  }

  let tickets: Ticket[] = [];
  if (stageAtLeast(plan.stage, 'tickets')) {
    const allowed = ticketSkills(packs);
    const files = listFiles(ticketsDir(planDir)).filter(
      (name) => name.endsWith('.md') && !name.includes('/'),
    );
    for (const file of files) {
      if (!isSlug(file.slice(0, -3))) {
        findings.error(join(ticketsDir(planDir), file), `ticket filename must be ${SLUG_HINT}`);
      }
    }
    tickets = readTickets(planDir);
    if (tickets.length === 0) {
      findings.error(ticketsDir(planDir), 'at least one ticket is required from the tickets stage onward');
    }
    for (const ticket of tickets) {
      checkTicketFrontMatter(ticket, allowed, findings);
      checkSections(ticket.file, TICKET_SECTIONS, findings);
      checkNoPlaceholders(ticket.file, findings);
      checkNotTemplate(ticket.file, template('ticket.md'), TICKET_SECTIONS, findings);
    }
    checkTicketGraph(tickets, findings);
  }

  if (stageAtLeast(plan.stage, 'review') && tickets.some((ticket) => !isSettled(ticket.status))) {
    const open = tickets.filter((ticket) => !isSettled(ticket.status)).map((ticket) => ticket.slug);
    findings.error(
      planPath,
      `every ticket must be done or deferred before feature review; open: ${open.join(', ')}`,
    );
  }
}

/** Every plan under the configured plans root, plus the repository's own wiring. */
export function validateRepository(
  root: string,
  config: Config,
  packs: PackSet,
  options: { plansOnly?: boolean } = {},
): Findings {
  const findings = new Findings(root);

  if (!options.plansOnly) {
    for (const [key, source] of Object.entries(config.sources)) {
      if (!source.required) continue;
      const hit = source.paths.some((pattern) => {
        if (!pattern.includes('*')) return exists(inRoot(root, pattern));
        const segments = pattern.split('/');
        const fixed = segments.slice(0, segments.findIndex((part) => part.includes('*')));
        return exists(inRoot(root, fixed.join('/') || '.'));
      });
      if (!hit) {
        findings.error(
          join(root, CONFIG_FILE),
          `required source "${key}" (${source.label}) matches nothing: ${source.paths.join(', ')}`,
        );
      }
    }

    if (config.backlog && !exists(inRoot(root, config.backlog))) {
      findings.warn(config.backlog, 'the configured backlog file does not exist, so the board has no register to read');
    }

    // An unscoped rule is loaded into every agent turn, which is almost never
    // what a pack meant: a rule earns its place by being narrow.
    for (const rule of packs.rules) {
      if (rule.paths.length === 0) {
        findings.warn(
          rule.path,
          `rule "${rule.file}" declares no paths, so it applies to every file in the repository; scope it with \`paths:\``,
        );
      }
    }

    // A skill an agent never opens because its description is blank.
    for (const skill of packs.skills) {
      if (skill.description === '') {
        findings.warn(
          join(skill.dir, 'SKILL.md'),
          `skill "${skill.name}" has no description, which is the line an agent reads to decide whether to open it`,
        );
      }
    }

    // An interpolation nothing answered. The published file carries the braces
    // verbatim, so an agent reads `{{database.box}}` where an identifier belongs.
    for (const file of [
      ...packs.skills.map((skill) => ({ owner: skill, path: join(skill.dir, 'SKILL.md') })),
      ...packs.rules.map((rule) => ({ owner: rule, path: rule.path })),
    ]) {
      const rendered = readPackFile(file.owner, file.path) ?? '';
      const open = unresolvedVars(rendered);
      if (open.length > 0) {
        findings.error(
          file.path,
          `${open.length} unresolved pack variable(s): ${open.map((name) => `{{${name}}}`).join(', ')}; ` +
            'no option answer defines them, so they publish into the agent files as written',
        );
      }
      const markers = unresolvedMarkers(rendered);
      if (markers.length > 0) {
        findings.error(
          file.path,
          `${markers.length} unclosed pack conditional(s): ${markers.join(', ')}; ` +
            'the comment publishes into the agent files as written',
        );
      }
    }
  }

  const plansRoot = inRoot(root, config.plans);
  for (const dir of listPlanDirs(plansRoot)) {
    validatePlan(join(plansRoot, dir), packs, findings);
  }
  return findings;
}
