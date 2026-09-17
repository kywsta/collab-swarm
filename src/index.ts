/**
 * Programmatic entry point.
 *
 * Everything the CLI does is available here, so a project can build its own
 * tooling on the same board, validator and plan model.
 */

export { VERSION, main, parseArgs } from './cli.js';
export {
  CONFIG_FILE,
  CONFIG_VERSION,
  DEFAULT_CONFIG,
  findRoot,
  loadConfig,
  parseConfig,
  serializeConfig,
  type CheckConfig,
  type Config,
  type GitConfig,
  type LoadedConfig,
  type SourceConfig,
} from './config.js';
export { Board, normalizeLane, type BoardRow, type RowState } from './core/board.js';
export { Claims, isComplete, type Claim, type ClaimOutcome } from './core/claims.js';
export { Git } from './core/git.js';
export {
  PLAN_STAGES,
  PLAN_STATUSES,
  TICKET_STATUSES,
  canTransition,
  isSettled,
  newPlan,
  readPlan,
  readTickets,
  readyTickets,
  sectionBody,
  serializePlan,
  writePlan,
  type Plan,
  type PlanStage,
  type PlanStatus,
  type Ticket,
  type TicketStatus,
} from './core/plan.js';
export {
  Register,
  milestoneIndex,
  sizeIndex,
  type Decision,
  type Gate,
  type RegisterRow,
} from './core/register.js';
export { renderNext, renderStatus } from './core/render.js';
export {
  FEATURE,
  buildStepMap,
  readSkillMap,
  resolveArtifact,
  rulesAtStep,
  type AppliedRule,
  type RuleCoverage,
  type RuleReason,
  type RuleSite,
  type SkillMap,
  type Step,
  type StepMap,
  type StepMapOptions,
} from './core/steps.js';
export { Findings, validatePlan, validateRepository, type Finding } from './core/validate.js';
export {
  ROLE_LABEL,
  assetsDir,
  corePack,
  loadPack,
  loadPacks,
  resolvePack,
  skillNames,
  ticketSkills,
  type Pack,
  type PackSet,
  type RuleEntry,
  type SkillEntry,
  type SkillRole,
} from './packs.js';
export { applySync, buildContext, planSync, type SyncPlan } from './sync.js';
export { TARGETS, resolveTargets, targetIds, type Target } from './targets/index.js';
