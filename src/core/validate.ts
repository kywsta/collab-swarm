import { basename, join, relative } from 'node:path';
import type { Config, RepositoryConfig } from '../config.js';
import { CONFIG_FILE, inRoot } from '../config.js';
import type { PackSet } from '../packs.js';
import { readPackFile, ticketSkills } from '../packs.js';
import { unresolvedMarkers, unresolvedVars } from '../options.js';
import { exists, listDirs, listFiles, readTextOrNull } from '../util/fs.js';
import { isSlug, readFrontMatter } from '../util/yaml.js';
import { Git } from './git.js';
import { countsAsDone, historyFindings, historyPath, parseHistory } from './history.js';
import { driftCheck, type DriftCheck } from './impact.js';
import { Register } from './register.js';
import { RULES_ROOT, RULE_ORIGINS, ROOT_SCOPE, type RuleSet } from './rulesets.js';
import {
  CHANGE_SECTIONS,
  CHANGE_STATUSES,
  PLAN_STAGES,
  PLAN_STATUSES,
  REQUIREMENTS_SECTIONS,
  SCHEMA_VERSION,
  SPECIFICATION_SECTIONS,
  TICKET_SECTIONS,
  TICKET_STATUSES,
  WORKFLOW_VERSION,
  changeFile,
  isSettled,
  listPlanDirs,
  readPlan,
  readTickets,
  requirementsFile,
  sectionBody,
  specificationFile,
  stageAtLeast,
  ticketsDir,
  type Plan,
  type PlanStage,
  type Ticket,
} from './plan.js';

/** What a plan is checked against beyond its own files. */
export interface PlanContext {
  /** The code repositories the configuration coordinates. */
  repositories?: Record<string, RepositoryConfig>;
  /** Whether a plan's cited sources moved on the default branch since it was written. */
  drift?: DriftCheck | null;
}

const SHA = /^[0-9a-f]{7,64}$/;

/**
 * Source kinds this repository writes by definition, whoever else reads them.
 *
 * A denylist rather than a list of contract kinds, because `sources:` is open:
 * a project may declare `events`, `proto` or `schema`, and each of those can
 * genuinely be owned here or consumed from elsewhere. Only these three have no
 * second reading to distinguish.
 */
const INTERNAL_SOURCES = new Set(['product', 'domain', 'decisions']);

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

function checkTicketFrontMatter(
  ticket: Ticket,
  allowed: string[],
  planRepositories: string[],
  findings: Findings,
): void {
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
    if (!['title', 'status', 'depends_on', 'skills', 'repository'].includes(key)) {
      findings.error(ticket.file, `unexpected ticket field "${key}"`);
    }
  }

  // A ticket is built in one repository. With a single one there is nothing to
  // choose; with several, an implementer must not have to guess.
  if (ticket.repository !== null) {
    if (planRepositories.length === 0) {
      findings.error(
        ticket.file,
        `ticket names repository "${ticket.repository}", but the plan lists no repositories; add it to plan.yml or drop the field`,
      );
    } else if (!planRepositories.includes(ticket.repository)) {
      findings.error(
        ticket.file,
        `ticket names repository "${ticket.repository}", which the plan does not list: ${planRepositories.join(', ')}`,
      );
    }
  } else if (planRepositories.length > 1) {
    findings.error(
      ticket.file,
      `the plan spans ${planRepositories.join(', ')}; name the one this ticket is built in with \`repository:\``,
    );
  }

  if (ticket.status === 'deferred' && !/^## Deferred\s*$/m.test(text.replace(/\r\n/g, '\n'))) {
    findings.error(ticket.file, 'a deferred ticket must record what it waits for under "## Deferred"');
  }
  if (ticket.status === 'blocked' && !/^## Blocked\s*$/m.test(text.replace(/\r\n/g, '\n'))) {
    findings.warn(ticket.file, 'a blocked ticket should record the decision it needs under "## Blocked"');
  }
}

/**
 * A recorded small change. It has no stages and no tickets, and it is never a
 * claim, so only its own shape is checked: who it is, where review starts, and
 * the contract the review is held to.
 */
function validateChange(file: string, packs: PackSet, findings: Findings, context: PlanContext): void {
  const text = readTextOrNull(file);
  if (text === null) return;
  const front = readFrontMatter(text);
  if (!front) {
    findings.error(file, 'YAML front matter is missing or unclosed');
    return;
  }
  const { title, status, base_sha: sha, repository } = front.data;
  if (typeof title !== 'string' || title.trim() === '') {
    findings.error(file, 'title must be a non-empty string');
  }
  if (typeof status !== 'string' || !(CHANGE_STATUSES as readonly string[]).includes(status)) {
    findings.error(file, `status must be one of ${CHANGE_STATUSES.join(', ')}`);
  }
  if (typeof sha !== 'string' || !/^[0-9a-f]{7,64}$/.test(sha)) {
    findings.error(file, 'base_sha must be the Git SHA recorded before the first code change, so review has a stable base');
  }
  if (repository !== undefined) {
    if (typeof repository !== 'string' || repository.trim() === '') {
      findings.error(file, 'repository must name the coordinated repository the change is made in');
    } else if (context.repositories && !context.repositories[repository]) {
      findings.error(file, `repository "${repository}" is not under repositories: in ${CONFIG_FILE}`);
    }
  }
  for (const key of Object.keys(front.data)) {
    if (!['title', 'status', 'base_sha', 'repository'].includes(key)) {
      findings.error(file, `unexpected change field "${key}"`);
    }
  }
  checkSections(file, CHANGE_SECTIONS, findings);
  checkNoPlaceholders(file, findings);
  const templates = templateDir(packs);
  checkNotTemplate(file, templates === null ? null : join(templates, 'change.md'), CHANGE_SECTIONS, findings);
}

/**
 * The code repositories a plan names, against the ones the hub coordinates.
 * Each needs a base from implementation onward, for the same reason the plan
 * does: review in that repository starts there.
 */
function checkPlanRepositories(
  planPath: string,
  plan: Plan,
  context: PlanContext,
  findings: Findings,
): void {
  const seen = new Set<string>();
  for (const repository of plan.repositories) {
    if (seen.has(repository.name)) {
      findings.error(planPath, `repository "${repository.name}" is listed twice`);
    }
    seen.add(repository.name);
    if (context.repositories && !context.repositories[repository.name]) {
      const known = Object.keys(context.repositories);
      findings.error(
        planPath,
        `repository "${repository.name}" is not under repositories: in ${CONFIG_FILE}` +
          (known.length > 0 ? ` (configured: ${known.join(', ')})` : ''),
      );
    }
    if (repository.baseSha !== null && !SHA.test(repository.baseSha)) {
      findings.error(planPath, `repositories.${repository.name}.base_sha is not a Git SHA`);
    }
    if (PLAN_STAGES.includes(plan.stage) && stageAtLeast(plan.stage, 'implementation') && repository.baseSha === null) {
      findings.error(
        planPath,
        `repositories.${repository.name}.base_sha is required from the implementation stage onward, ` +
          'so review in that repository has a stable base; open its branch with `npx collab-swarm repos <slug> --open`',
      );
    }
  }
}

export function validatePlan(
  planDir: string,
  packs: PackSet,
  findings: Findings,
  context: PlanContext = {},
): void {
  const feature = basename(planDir);
  if (!isSlug(feature)) {
    findings.error(planDir, `feature directory must be ${SLUG_HINT}`);
    return;
  }

  const planPath = join(planDir, 'plan.yml');
  const change = changeFile(planDir);
  if (exists(change)) {
    if (exists(planPath)) {
      findings.error(change, 'a directory holds either a feature plan or a small change, not both');
      return;
    }
    validateChange(change, packs, findings, context);
    return;
  }
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
  checkPlanRepositories(planPath, plan, context, findings);
  if (sha !== null && !SHA.test(sha)) {
    findings.error(planPath, 'implementation_base_sha is not a Git SHA');
  }
  if (plan.sourcesSha !== null && !SHA.test(plan.sourcesSha)) {
    findings.error(planPath, 'sources_sha is not a Git SHA');
  } else {
    const drift = context.drift?.check(planDir, plan);
    if (drift) findings.warn(planPath, drift);
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
    const planRepositories = plan.repositories.map((repository) => repository.name);
    for (const ticket of tickets) {
      checkTicketFrontMatter(ticket, allowed, planRepositories, findings);
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

/**
 * The coordinated repositories: names a branch and a plan can carry, one
 * checkout each, and a backlog that names only repositories that exist.
 * A repository that is not checked out is fine — the hub's own CI rarely
 * initialises submodules — so only the configuration is judged here.
 */
function checkRepositories(root: string, config: Config, findings: Findings): void {
  const file = join(root, CONFIG_FILE);
  const repositories = Object.values(config.repositories);
  const paths = new Map<string, string>();
  for (const repository of repositories) {
    if (!isSlug(repository.name)) {
      findings.error(file, `repository name "${repository.name}" must be ${SLUG_HINT}; plans and tickets refer to it`);
    }
    const other = paths.get(repository.path);
    if (other) {
      findings.error(file, `repositories "${other}" and "${repository.name}" share the path ${repository.path}`);
    }
    paths.set(repository.path, repository.name);
    if (repository.checks.length === 0) {
      findings.warn(
        file,
        `repository "${repository.name}" has no checks, so a ticket built there is verified by nothing; add them under its \`checks:\``,
      );
    }
  }

  if (!config.backlog) return;
  const backlog = readTextOrNull(inRoot(root, config.backlog));
  if (backlog === null) return;
  for (const row of Register.parse(backlog).rows) {
    const unknown = row.repositories.filter((name) => !config.repositories[name]);
    if (unknown.length === 0) continue;
    findings.error(
      inRoot(root, config.backlog),
      `row "${row.slug}" names repositor${unknown.length === 1 ? 'y' : 'ies'} ${unknown.map((name) => `"${name}"`).join(', ')} ` +
        `that ${CONFIG_FILE} does not list under repositories:`,
    );
  }
}

/**
 * Every slug a row waits on must be able to become done: another row, a plan,
 * or a delivered row in the history. A deleted or misspelt slug otherwise keeps
 * the row blocked for good, and the board can only say it "is not done".
 */
function checkDependencies(root: string, config: Config, findings: Findings): void {
  if (!config.backlog) return;
  const file = inRoot(root, config.backlog);
  const backlog = readTextOrNull(file);
  if (backlog === null) return;
  const rows = Register.parse(backlog).rows;
  const history = parseHistory(readTextOrNull(inRoot(root, historyPath(config.plans))) ?? '');
  const dropped = new Set(history.filter((entry) => !countsAsDone(entry)).map((entry) => entry.slug));
  const known = new Set([
    ...rows.map((row) => row.slug),
    ...listPlanDirs(inRoot(root, config.plans)),
    ...history.filter(countsAsDone).map((entry) => entry.slug),
  ]);
  for (const row of rows) {
    for (const dependency of row.dependsOn) {
      if (known.has(dependency)) continue;
      findings.error(
        file,
        dropped.has(dependency)
          ? `row "${row.slug}" depends on "${dependency}", which the delivery history records as dropped, ` +
              `so it never counts as done and "${row.slug}" stays blocked; remove the dependency or name what replaced it`
          : `row "${row.slug}" depends on "${dependency}", which is no row, no plan and nothing the delivery history delivered, ` +
              `so "${row.slug}" stays blocked; correct the slug or remove the dependency`,
      );
    }
  }
}

/**
 * Rule sets: one directory per repository that exists, rules whose author is
 * known, and globs written relative to the repository they govern — the
 * repository's path is added on publishing, so writing it again doubles it.
 */
function checkRuleSets(root: string, config: Config, sets: RuleSet[], findings: Findings): void {
  const known = new Set([ROOT_SCOPE, ...Object.keys(config.repositories)]);
  for (const name of listDirs(join(root, RULES_ROOT))) {
    if (known.has(name)) continue;
    findings.warn(
      join(root, RULES_ROOT, name),
      `rule set "${name}" belongs to no repository; name it after one under repositories:, or "${ROOT_SCOPE}" for this one`,
    );
  }
  for (const set of sets) {
    for (const rule of set.rules) {
      if (!(RULE_ORIGINS as readonly string[]).includes(rule.origin)) {
        findings.error(rule.path, `origin "${rule.origin}" is not one of ${RULE_ORIGINS.join(', ')}`);
      }
      const prefix = set.scope.path === '' ? null : `${set.scope.path}/`;
      if (prefix && rule.paths.some((glob) => glob.replace(/^\.\//, '').startsWith(prefix))) {
        findings.warn(
          rule.path,
          `globs are relative to ${set.scope.path}, which is added when the rule is published; drop the leading "${prefix}"`,
        );
      }
    }
  }
}

/** The drift check for this checkout's plans, reading each row's sources from the backlog. */
export function planDrift(root: string, config: Config): DriftCheck | null {
  const backlog = config.backlog ? readTextOrNull(inRoot(root, config.backlog)) : null;
  const register = backlog === null ? Register.empty() : Register.parse(backlog);
  return driftCheck(new Git(root), root, config, (slug) => register.row(slug)?.sources ?? '');
}

/** Every plan under the configured plans root, plus the repository's own wiring. */
export function validateRepository(
  root: string,
  config: Config,
  packs: PackSet & { conflicts?: string[]; ruleSets?: RuleSet[] },
  options: { plansOnly?: boolean } = {},
): Findings {
  const findings = new Findings(root);

  if (!options.plansOnly) {
    for (const conflict of packs.conflicts ?? []) findings.error(join(root, CONFIG_FILE), conflict);
    checkRuleSets(root, config, packs.ruleSets ?? [], findings);

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

    // `owned` decides whether a gap in a *contract* is this project's work or
    // somebody else's gate. The project's own registers are written here by
    // definition, so the flag says nothing there and only misleads a reader.
    for (const [key, source] of Object.entries(config.sources)) {
      if (!source.owned || !INTERNAL_SOURCES.has(key)) continue;
      findings.warn(
        join(root, CONFIG_FILE),
        `source "${key}" (${source.label}) is marked \`owned\`, but nothing branches on it: ` +
          "this project's own register is written here either way. " +
          'The flag belongs on a contract a feature reads or extends, such as `api`.',
      );
    }

    if (config.backlog && !exists(inRoot(root, config.backlog))) {
      findings.warn(config.backlog, 'the configured backlog file does not exist, so the board has no register to read');
    }

    checkRepositories(root, config, findings);
    checkDependencies(root, config, findings);

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
  const drift = planDrift(root, config);
  for (const dir of listPlanDirs(plansRoot)) {
    validatePlan(join(plansRoot, dir), packs, findings, { repositories: config.repositories, drift });
  }

  const history = inRoot(root, historyPath(config.plans));
  for (const finding of historyFindings(root, config)) {
    if (finding.severity === 'error') findings.error(history, finding.message);
    else findings.warn(history, finding.message);
  }
  return findings;
}
