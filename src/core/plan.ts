import { join } from 'node:path';
import { listDirs, listFiles, readTextOrNull, writeText } from '../util/fs.js';
import {
  asDict,
  asString,
  asStringList,
  isSlug,
  parseYaml,
  readFrontMatter,
  toYaml,
  type Dict,
} from '../util/yaml.js';

export const SCHEMA_VERSION = 1;
export const WORKFLOW_VERSION = 1;

export const PLAN_STAGES = [
  'requirements',
  'specification',
  'tickets',
  'implementation',
  'review',
  'complete',
] as const;
export type PlanStage = (typeof PLAN_STAGES)[number];

export const PLAN_STATUSES = ['in-progress', 'ready', 'blocked', 'complete'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const TICKET_STATUSES = ['planned', 'in-progress', 'blocked', 'deferred', 'done'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** A ticket that no longer blocks feature review or completion. */
export const isSettled = (status: TicketStatus) => status === 'done' || status === 'deferred';

export const stageIndex = (stage: PlanStage) => PLAN_STAGES.indexOf(stage);
export const stageAtLeast = (stage: PlanStage, floor: PlanStage) =>
  stageIndex(stage) >= stageIndex(floor);

/** Forward one stage at a time; backward any distance; never out of `complete`. */
export function canTransition(from: PlanStage, to: PlanStage): boolean {
  if (from === 'complete') return false;
  const a = stageIndex(from);
  const b = stageIndex(to);
  return b === a + 1 || b < a;
}

export const REQUIREMENTS_SECTIONS = [
  'Description',
  'Sources',
  'Scope',
  'User stories',
  'Acceptance criteria',
  'Interfaces',
  'Data and integrations',
  'Quality constraints',
  'Constraints and open questions',
];

export const SPECIFICATION_SECTIONS = [
  'Approach',
  'Architecture and domain',
  'Data and integrations',
  'State and lifecycle',
  'Failure behaviour',
  'Interface and interaction',
  'Security, observability, and performance',
  'Test plan',
  'Compatibility, migration, and rollback',
  'Risks and open questions',
];

export const TICKET_SECTIONS = ['Outcome', 'Requirements', 'Implementation', 'Tests', 'Done when'];

export interface Plan {
  schemaVersion: number;
  workflowVersion: number;
  feature: string;
  title: string;
  stage: PlanStage;
  status: PlanStatus;
  implementationBaseSha: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Ticket {
  slug: string;
  file: string;
  title: string;
  status: TicketStatus;
  dependsOn: string[];
  skills: string[];
}

export const planFile = (planDir: string) => join(planDir, 'plan.yml');
export const requirementsFile = (planDir: string) => join(planDir, 'requirements.md');
export const specificationFile = (planDir: string) => join(planDir, 'specification.md');
export const ticketsDir = (planDir: string) => join(planDir, 'tickets');

export const stamp = (at: Date = new Date()) => at.toISOString().replace(/\.\d+/, '');

export function readPlan(planDir: string): Plan | null {
  const text = readTextOrNull(planFile(planDir));
  if (text === null) return null;
  const raw = asDict(parseYaml(text));
  if (!raw) return null;
  return {
    schemaVersion: typeof raw.schema_version === 'number' ? raw.schema_version : 0,
    workflowVersion: typeof raw.workflow_version === 'number' ? raw.workflow_version : 0,
    feature: asString(raw.feature) ?? '',
    title: asString(raw.title) ?? '',
    stage: (asString(raw.stage) ?? '') as PlanStage,
    status: (asString(raw.status) ?? '') as PlanStatus,
    implementationBaseSha: asString(raw.implementation_base_sha),
    createdAt: asString(raw.created_at) ?? '',
    updatedAt: asString(raw.updated_at) ?? '',
  };
}

export function serializePlan(plan: Plan): string {
  const body: Dict = {
    schema_version: plan.schemaVersion,
    workflow_version: plan.workflowVersion,
    feature: plan.feature,
    title: plan.title,
    stage: plan.stage,
    status: plan.status,
    implementation_base_sha: plan.implementationBaseSha,
    created_at: plan.createdAt,
    updated_at: plan.updatedAt,
  };
  return toYaml(body);
}

export function writePlan(planDir: string, plan: Plan): void {
  writeText(planFile(planDir), serializePlan(plan));
}

/** The skeleton a fresh claim pushes: a lone plan.yml at the requirements stage. */
export function newPlan(slug: string, title: string, at: Date = new Date()): Plan {
  const now = stamp(at);
  return {
    schemaVersion: SCHEMA_VERSION,
    workflowVersion: WORKFLOW_VERSION,
    feature: slug,
    title,
    stage: 'requirements',
    status: 'in-progress',
    implementationBaseSha: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function readTicket(file: string, slug: string): Ticket | null {
  const text = readTextOrNull(file);
  if (text === null) return null;
  const front = readFrontMatter(text);
  if (!front) return null;
  return {
    slug,
    file,
    title: asString(front.data.title) ?? '',
    status: (asString(front.data.status) ?? '') as TicketStatus,
    dependsOn: asStringList(front.data.depends_on),
    skills: asStringList(front.data.skills),
  };
}

export function readTickets(planDir: string): Ticket[] {
  return listFiles(ticketsDir(planDir))
    .filter((name) => name.endsWith('.md') && !name.includes('/'))
    .map((name) => {
      const slug = name.slice(0, -3);
      return readTicket(join(ticketsDir(planDir), name), slug);
    })
    .filter((ticket): ticket is Ticket => ticket !== null);
}

/** Feature plan directories under the configured plans root. */
export const listPlanDirs = (plansRoot: string): string[] =>
  listDirs(plansRoot).filter((name) => isSlug(name));

/** Tickets whose dependencies are all done, in register order. */
export function readyTickets(tickets: Ticket[]): Ticket[] {
  const byStatus = new Map(tickets.map((ticket) => [ticket.slug, ticket.status]));
  return tickets.filter(
    (ticket) =>
      ticket.status === 'planned' &&
      ticket.dependsOn.every((slug) => byStatus.get(slug) === 'done'),
  );
}

/** A named `## Section` heading's body, or null when the heading is absent. */
export function sectionBody(markdown: string, section: string): string | null {
  const normalized = markdown.replace(/\r\n/g, '\n');
  const heading = new RegExp(`^## ${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
  const match = heading.exec(normalized);
  if (!match) return null;
  const start = match.index + match[0].length;
  const next = /^##\s+/m.exec(normalized.slice(start));
  return normalized.slice(start, next ? start + next.index : undefined).trim();
}
