/**
 * Pack options: the questions a pack asks before it is installed.
 *
 * A stack is rarely one thing. A Flutter project has a fixed core — the state
 * container, the router, the HTTP stack — and a handful of slots the team
 * fills differently: which push provider, which local database, which
 * analytics. A pack that hard-codes one answer is wrong for everybody else; a
 * pack that hedges across all of them stops naming anything concrete, which is
 * the only reason a skill is worth its tokens.
 *
 * So a pack declares its slots as `options`, the project answers them once,
 * and the answers are recorded in `collab-swarm.yml`. Everything downstream —
 * which skills exist, which rules are scoped, which checks are offered, and
 * the prose inside each of them — is resolved against that answer, so a
 * teammate's `swarm sync` reproduces the same files from the same config.
 *
 * Three mechanisms, all greppable in the pack's own sources:
 *
 * - `if:` on a skill, rule or check — the thing exists only when it matches;
 * - `<!-- swarm:if ... -->` blocks inside a body — the prose that varies;
 * - `{{option}}` and `{{option.var}}` — the identifiers that vary.
 */

import { asDict, asString } from './util/yaml.js';

/** The answers a project recorded, keyed by option id. */
export type Selections = Record<string, string>;

/** Flattened variables a body may interpolate: `notifications`, `notifications.package`. */
export type OptionVars = Record<string, string>;

export interface OptionPackage {
  name: string;
  /** Version constraint in the ecosystem's own dialect, when the pack pins one. */
  version?: string;
  /** True for a build-time dependency (dev_dependencies, devDependencies). */
  dev?: boolean;
  /** One line: what this project uses it for. */
  use?: string;
  /** Condition gating the package, in the same dialect as `if`. */
  if?: string;
}

export interface OptionChoice {
  id: string;
  label: string;
  /** One line shown beside the label while choosing. */
  hint?: string;
  /** Variables this choice contributes, reachable as `{{<option>.<key>}}`. */
  vars: OptionVars;
  /** Packages the choice requires. */
  packages: OptionPackage[];
}

export interface PackOption {
  id: string;
  /** The question a human answers. */
  question: string;
  /** One line of context shown above the choices. */
  detail?: string;
  /** Choice id used when nothing is recorded and nobody is there to ask. */
  default: string;
  choices: OptionChoice[];
}

const asBool = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

function readVars(raw: unknown): OptionVars {
  const dict = asDict(raw);
  if (!dict) return {};
  const vars: OptionVars = {};
  for (const [key, value] of Object.entries(dict)) {
    if (typeof value === 'string') vars[key] = value;
  }
  return vars;
}

export function readPackages(raw: unknown): OptionPackage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => asDict(item))
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((item) => ({
      name: asString(item.name) ?? '',
      ...(asString(item.version) ? { version: asString(item.version)! } : {}),
      ...(asBool(item.dev) ? { dev: true } : {}),
      ...(asString(item.use) ? { use: asString(item.use)! } : {}),
      ...(asString(item.if) ? { if: asString(item.if)! } : {}),
    }))
    .filter((pkg) => pkg.name !== '');
}

export function readOptions(raw: unknown): PackOption[] {
  if (!Array.isArray(raw)) return [];
  const options: PackOption[] = [];
  for (const item of raw) {
    const entry = asDict(item);
    const id = entry && asString(entry.id);
    if (!entry || !id) continue;

    const choices: OptionChoice[] = [];
    for (const raw of Array.isArray(entry.choices) ? entry.choices : []) {
      const choice = asDict(raw);
      const choiceId = choice && asString(choice.id);
      if (!choice || !choiceId) continue;
      choices.push({
        id: choiceId,
        label: asString(choice.label) ?? choiceId,
        ...(asString(choice.hint) ? { hint: asString(choice.hint)! } : {}),
        vars: readVars(choice.vars),
        packages: readPackages(choice.packages),
      });
    }
    if (choices.length === 0) continue;

    const fallback = asString(entry.default);
    options.push({
      id,
      question: asString(entry.question) ?? id,
      ...(asString(entry.detail) ? { detail: asString(entry.detail)! } : {}),
      default: fallback && choices.some((choice) => choice.id === fallback) ? fallback : choices[0]!.id,
      choices,
    });
  }
  return options;
}

/**
 * The answer for every option: what the project recorded, or the default.
 *
 * A recorded answer naming a choice the pack no longer offers falls back to the
 * default rather than failing, so a pack upgrade that renames a choice degrades
 * to something installable; `doctor` reports the mismatch.
 */
export function resolveSelections(options: PackOption[], recorded: Selections = {}): Selections {
  const selections: Selections = {};
  for (const option of options) {
    const answer = recorded[option.id];
    selections[option.id] =
      answer !== undefined && option.choices.some((choice) => choice.id === answer)
        ? answer
        : option.default;
  }
  return selections;
}

/** Recorded answers that name an option or a choice the pack does not offer. */
export function unknownSelections(options: PackOption[], recorded: Selections = {}): string[] {
  const unknown: string[] = [];
  for (const [id, answer] of Object.entries(recorded)) {
    const option = options.find((candidate) => candidate.id === id);
    if (!option) unknown.push(`${id} (no such option)`);
    else if (!option.choices.some((choice) => choice.id === answer)) {
      unknown.push(`${id}=${answer} (choices: ${option.choices.map((choice) => choice.id).join(', ')})`);
    }
  }
  return unknown.sort();
}

/** Every variable a body may interpolate, for one set of answers. */
export function optionVars(options: PackOption[], selections: Selections): OptionVars {
  const vars: OptionVars = {};
  for (const option of options) {
    const chosen = option.choices.find((choice) => choice.id === selections[option.id]);
    if (!chosen) continue;
    vars[option.id] = chosen.id;
    vars[`${option.id}.label`] = chosen.label;
    for (const [key, value] of Object.entries(chosen.vars)) vars[`${option.id}.${key}`] = value;
  }
  return vars;
}

/** Packages required by the choices a project made, in declaration order. */
export function selectedPackages(options: PackOption[], selections: Selections): OptionPackage[] {
  const packages: OptionPackage[] = [];
  for (const option of options) {
    const chosen = option.choices.find((choice) => choice.id === selections[option.id]);
    if (chosen) packages.push(...chosen.packages);
  }
  return packages;
}

/**
 * Evaluates a condition against the answers.
 *
 * ```text
 * notifications=onesignal          the answer is onesignal
 * notifications=firebase,onesignal the answer is either
 * notifications!=none              the answer is anything but none
 * database!=none && analytics=firebase
 * analytics!=none || crash!=none   one concern, reached from either answer
 * ```
 *
 * `||` binds looser than `&&`, and there is no grouping: a condition that
 * needs parentheses is a concern that should have been two.
 *
 * An empty condition is always true, and so is one naming an option the pack
 * does not declare: a condition is a filter, and a filter nobody answered
 * cannot be what removes a skill from the install.
 */
export function matches(condition: string | undefined, selections: Selections): boolean {
  if (!condition || condition.trim() === '') return true;
  return condition
    .split('||')
    .map((alternative) => alternative.trim())
    .filter(Boolean)
    .some((alternative) => every(alternative, selections));
}

function every(alternative: string, selections: Selections): boolean {
  return alternative
    .split('&&')
    .map((clause) => clause.trim())
    .filter(Boolean)
    .every((clause) => {
      const negated = clause.includes('!=');
      const [rawId, rawValues = ''] = clause.split(negated ? '!=' : '=');
      const id = (rawId ?? '').trim();
      const answer = selections[id];
      if (answer === undefined) return true;
      const values = rawValues
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      const hit = values.includes(answer);
      return negated ? !hit : hit;
    });
}

const IF_BLOCK = /^[ \t]*<!--[ \t]*swarm:if[ \t]+([^>]*?)[ \t]*-->[ \t]*$/;
const ELSE_BLOCK = /^[ \t]*<!--[ \t]*swarm:else[ \t]*-->[ \t]*$/;
const END_BLOCK = /^[ \t]*<!--[ \t]*swarm:endif[ \t]*-->[ \t]*$/;

/**
 * A conditional that opens and closes inside one line.
 *
 * Most of what varies between two answers is a clause, not a paragraph: "and
 * the box that holds it open" belongs inside its sentence. A line-only form
 * would force every such clause into its own paragraph, which reads worse than
 * the sentence it replaced.
 */
const IF_INLINE =
  /<!--[ \t]*swarm:if[ \t]+([^>]*?)[ \t]*-->(.*?)(?:<!--[ \t]*swarm:else[ \t]*-->(.*?))?<!--[ \t]*swarm:endif[ \t]*-->/;

const interpolate = (line: string, vars: OptionVars): string =>
  line.replace(/\{\{([a-z0-9_.-]+)\}\}/gi, (whole, name: string) => vars[name] ?? whole);

function renderInline(line: string, selections: Selections): string {
  let current = line;
  // Repeated rather than global: an inner span becomes reachable only once the
  // span around it has been resolved.
  for (let guard = 0; guard < 50; guard++) {
    const match = IF_INLINE.exec(current);
    if (!match) break;
    const kept = matches(match[1], selections) ? (match[2] ?? '') : (match[3] ?? '');
    current = current.slice(0, match.index) + kept + current.slice(match.index + match[0].length);
  }
  return current;
}

/** A fenced code block's opening or closing line, and the fence it is made of. */
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;

/**
 * Resolves a pack body against the answers: conditional blocks, then variables.
 *
 * Blocks nest. An unresolved `{{...}}` is left in place rather than blanked,
 * because a variable nobody defined is a mistake in the pack, and a visible
 * one is reported by `validate` instead of quietly producing prose with a hole
 * in it.
 *
 * Inside fenced code, a conditional marker is text rather than a directive: a
 * pack's own documentation shows this syntax, and a sample that is evaluated
 * rather than shown documents nothing. Variables still interpolate there,
 * because a code sample naming the real adapter is the whole point of one —
 * and a variable nothing defines is left as written either way.
 */
export function renderText(text: string, selections: Selections, vars: OptionVars): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  /** One frame per open block: whether its branch is being kept. */
  const stack: { keeping: boolean; taken: boolean; enclosing: boolean }[] = [];
  const emitting = () => stack.every((frame) => frame.keeping);
  let fence: string | null = null;

  /**
   * Removing a block leaves the blank lines that surrounded it. Collapsing the
   * run here rather than over the joined text keeps fenced code byte-exact: a
   * code sample is allowed its own blank lines.
   */
  const push = (line: string) => {
    if (fence === null && line.trim() === '' && out[out.length - 1]?.trim() === '') return;
    out.push(line);
  };

  for (const line of lines) {
    const rail = FENCE.exec(line)?.[1];
    if (fence !== null) {
      // Inside a fence: only a closing rail of the same kind, at least as long,
      // is read as anything but text.
      const closing = rail !== undefined && rail[0] === fence[0] && rail.length >= fence.length;
      if (emitting()) push(interpolate(line, vars));
      if (closing) fence = null;
      continue;
    }
    if (rail) {
      if (emitting()) push(interpolate(line, vars));
      fence = rail;
      continue;
    }

    const open = IF_BLOCK.exec(line);
    if (open) {
      const enclosing = emitting();
      const keeping = enclosing && matches(open[1], selections);
      stack.push({ keeping, taken: keeping, enclosing });
      continue;
    }
    if (ELSE_BLOCK.test(line) && stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      frame.keeping = frame.enclosing && !frame.taken;
      frame.taken = true;
      continue;
    }
    if (END_BLOCK.test(line) && stack.length > 0) {
      stack.pop();
      continue;
    }
    if (emitting()) push(interpolate(renderInline(line, selections), vars));
  }

  return out.join('\n');
}

/** Interpolation left unresolved after rendering, for the validator to report. */
export const unresolvedVars = (text: string): string[] => [
  ...new Set([...text.matchAll(/\{\{([a-z0-9_.-]+)\}\}/gi)].map((match) => match[1]!)),
];

/**
 * Conditional markers still in the rendered text, outside fenced code.
 *
 * A marker survives rendering when it was never closed, or when an opening and
 * a closing marker sit on different lines with prose between them on the same
 * line as one of the two. Either way the comment publishes into the agent
 * files, so the validator reports it. A marker inside a fence is a sample, and
 * rendering deliberately leaves it alone.
 */
export function unresolvedMarkers(text: string): string[] {
  const found = new Set<string>();
  let fence: string | null = null;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const rail = FENCE.exec(line)?.[1];
    if (fence !== null) {
      if (rail && rail[0] === fence[0] && rail.length >= fence.length) fence = null;
      continue;
    }
    if (rail) {
      fence = rail;
      continue;
    }
    for (const match of line.matchAll(/<!--[ \t]*swarm:(if[^>]*?|else|endif)[ \t]*-->/g)) {
      found.add(match[0].trim());
    }
  }
  return [...found];
}

/** Parses `a=b,c=d` into recorded answers, for `--options` on the command line. */
export function parseSelections(raw: string): Selections {
  const selections: Selections = {};
  for (const pair of raw.split(',')) {
    const [id, value] = pair.split('=');
    if (id && value) selections[id.trim()] = value.trim();
  }
  return selections;
}
