import type { Config } from '../config.js';
import type { PackSet, RuleEntry, SkillEntry } from '../packs.js';

/** One file an emitter wants on disk, with content already rendered. */
export interface Emission {
  /** Path relative to the repository root, POSIX separators. */
  path: string;
  content: string;
  /**
   * `managed` files are rewritten on every sync and drift is reported.
   * `seed` files are written once and then left to the project.
   * `block` files keep the project's own prose and only the marked block is
   * replaced, so a team may write freely around it.
   */
  mode: 'managed' | 'seed' | 'block';
}

export interface EmitContext {
  config: Config;
  packs: PackSet;
  root: string;
  /** Rendered workflow documents, keyed by their path under the workflow root. */
  workflow: Map<string, string>;
  /** Skills to publish, in stable order. */
  skills: SkillEntry[];
  /** Rules to publish, in stable order. */
  rules: RuleEntry[];
  version: string;
}

export interface Target {
  /** Stable id used in config and on the command line. */
  id: string;
  /** Name shown to a human choosing targets. */
  label: string;
  /** One line: which tool reads these files. */
  hint: string;
  /**
   * Directory the skills payload is written to, relative to the root. Targets
   * sharing a root have the payload written once.
   */
  skillRoot: string | null;
  /** Directory rules are written to, or null when the target has no rule format. */
  ruleRoot: string | null;
  /** Root instruction file this target reads. */
  memoryFile: string;
  /** Files beyond skills and rules: settings, commands, mirrors. */
  emit(context: EmitContext): Emission[];
}
