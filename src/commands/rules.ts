import { flagBool, type Args } from '../cli.js';
import { loadConfig, type Config } from '../config.js';
import { Repository } from '../core/repositories.js';
import {
  RULES_ROOT,
  ROOT_SCOPE,
  fingerprint,
  loadRuleSet,
  ruleSetStatus,
  scopes,
  writeResearch,
  type RuleSetStatus,
  type Scope,
} from '../core/rulesets.js';
import { exists } from '../util/fs.js';
import { CliError, ok, out, style } from '../util/log.js';
import { PROGRAM } from '../util/program.js';

/**
 * Where each repository's rule set stands.
 *
 * With no name: every rule set, and whether it has fallen behind the
 * repository it governs. With a name: that one in detail. `--record` notes what
 * the repository depends on now, which is the last step of a research pass and
 * the baseline the next `rules` compares against.
 */
export async function run(args: Args): Promise<number> {
  const { config, root } = loadConfig();
  const name = args.positional[0];
  const all = scopes(config);

  if (!name) {
    // In a hub the code lives elsewhere, so the hub's own set is shown only
    // when it has one.
    const shown = all.filter(
      (scope) =>
        scope.name !== ROOT_SCOPE ||
        Object.keys(config.repositories).length === 0 ||
        scope.packs.length > 0 ||
        exists(loadRuleSet(root, scope).dir),
    );
    const statuses = shown.map((scope) => ruleSetStatus(root, config, scope));
    if (flagBool(args, 'json')) {
      out(JSON.stringify({ ruleSets: statuses }, null, 2));
      return 0;
    }
    out('');
    out(style.bold(`Rule sets · ${RULES_ROOT}/`));
    for (const status of statuses) describe(status).forEach((line) => out(line));
    // A stale set misleads the agents following it; a missing one only leaves
    // them to their priors. So the first suggestion is the one doing harm.
    const urgency: RuleSetStatus['verdict'][] = ['stale', 'unrecorded', 'baseline', 'none'];
    const behind = statuses
      .filter((status) => urgency.includes(status.verdict))
      .sort((a, b) => urgency.indexOf(a.verdict) - urgency.indexOf(b.verdict));
    if (behind.length > 0) {
      out('');
      out(
        style.dim(
          `Research one: ask your agent to "research the rule set for ${behind[0]!.name}" (the \`to-rules\` skill).`,
        ),
      );
    }
    out('');
    return 0;
  }

  const scope = all.find((candidate) => candidate.name === name);
  if (!scope) {
    throw new CliError(
      `There is no repository named "${name}".`,
      64,
      `Rule sets: ${all.map((candidate) => candidate.name).join(', ')}.`,
    );
  }

  if (flagBool(args, 'record')) return record(root, config, scope);

  const status = ruleSetStatus(root, config, scope);
  if (flagBool(args, 'json')) {
    out(JSON.stringify(status, null, 2));
    return 0;
  }
  out('');
  describe(status, true).forEach((line) => out(line));
  out('');
  return 0;
}

const VERDICT: Record<RuleSetStatus['verdict'], string> = {
  none: style.yellow('no rule set — agents build from their own priors'),
  baseline: style.yellow('pack baseline only, nothing researched yet'),
  unrecorded: style.yellow('written, but the research was never recorded'),
  stale: style.yellow('behind the repository'),
  current: style.green('current'),
  unavailable: style.yellow('not checked out here'),
};

function describe(status: RuleSetStatus, detailed = false): string[] {
  const parts = [style.bold(status.name), status.path || 'this repository', VERDICT[status.verdict]];
  if (status.packs.length > 0) parts.push(`baseline ${status.packs.join(', ')}`);
  if (status.rules > 0) {
    const origins = Object.entries(status.origins)
      .map(([origin, count]) => `${count} ${origin}`)
      .join(', ');
    parts.push(`${status.rules} rule${status.rules === 1 ? '' : 's'} (${origins})`);
  }
  if (status.skills > 0) parts.push(`${status.skills} skill${status.skills === 1 ? '' : 's'}`);
  if (status.hasStack) parts.push('stack profile');
  if (status.recordedAt) parts.push(`researched ${status.recordedAt}`);
  const lines = [`- ${parts.join(' · ')}`];

  const notes: string[] = [];
  if (status.detail) notes.push(status.detail);
  const moved = status.drift;
  if (moved) {
    const cap = (items: string[]) => (detailed || items.length <= 4 ? items : [...items.slice(0, 4), `${items.length - 4} more`]);
    if (moved.added.length) notes.push(`added since: ${cap(moved.added).join(', ')}`);
    if (moved.removed.length) notes.push(`removed since: ${cap(moved.removed).join(', ')}`);
    if (moved.upgraded.length) {
      notes.push(`major upgrades: ${cap(moved.upgraded.map((item) => `${item.name} ${item.from} → ${item.to}`)).join(', ')}`);
    }
    if (moved.manifests.added.length) notes.push(`new manifests: ${moved.manifests.added.join(', ')}`);
  }
  if (status.dead.length) notes.push(`rules matching no file: ${status.dead.join(', ')}`);
  for (const pack of status.fits) {
    const where = status.name === ROOT_SCOPE ? '' : ` --repo ${status.name}`;
    notes.push(`a default pack fits as its baseline, if you want one: ${PROGRAM} add ${pack}${where}`);
  }
  for (const note of notes) lines.push(`    ${style.dim(note)}`);
  return lines;
}

function record(root: string, config: Config, scope: Scope): number {
  const set = loadRuleSet(root, scope);
  if (!exists(set.dir)) {
    throw new CliError(
      `There is no rule set for "${scope.name}" to record yet.`,
      1,
      `Research it first: the \`to-rules\` skill writes ${RULES_ROOT}/${scope.name}/.`,
    );
  }
  const repository = config.repositories[scope.name];
  const handle = repository ? new Repository(root, repository) : null;
  if (handle && !handle.checkedOut) throw new CliError(handle.checkoutHint, 1);

  const print = fingerprint(handle ? handle.dir : root);
  const saved = writeResearch(set.dir, print);
  ok(
    `Recorded what ${scope.name} depends on (${Object.keys(saved.dependencies).length} packages from ` +
      `${saved.manifests.join(', ') || 'no manifest'}) in ${RULES_ROOT}/${scope.name}/research.json`,
  );
  out(style.dim(`  ${PROGRAM} rules compares against it from now on; commit it with the rule set.`));
  return 0;
}
