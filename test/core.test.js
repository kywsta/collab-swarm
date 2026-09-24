import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { Board } from '../dist/core/board.js';
import { canTransition, newPlan, readPlan, readTickets, readyTickets, sectionBody, serializePlan } from '../dist/core/plan.js';
import { Register } from '../dist/core/register.js';
import { renderNext, renderStatus } from '../dist/core/render.js';
import { Findings, validatePlan, validateRepository } from '../dist/core/validate.js';
import { bundledPackNames, corePack, loadPacks, readPackFile, resolvePack, ticketSkills } from '../dist/packs.js';
import { matches, parseSelections, renderText, unknownSelections, unresolvedMarkers, unresolvedVars } from '../dist/options.js';
import { buildStepMap, resolveArtifact, rulesAtStep } from '../dist/core/steps.js';
import { firstMatch, matchesGlob } from '../dist/util/glob.js';
import { parseConfig, serializeConfig } from '../dist/config.js';
import { mergeBlock, renderMemoryBlock, BLOCK_END, BLOCK_START } from '../dist/targets/memory.js';
import { writeText } from '../dist/util/fs.js';
import { parseArgs } from '../dist/cli.js';

const scratch = [];
const tempRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'collab-swarm-test-'));
  scratch.push(dir);
  return dir;
};
after(() => scratch.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const BACKLOG = `# Demo

### Gate tracker

| Gate | Owner | Blocks | Status | Closed on |
| --- | --- | --- | --- | --- |
| G1 Payment account | Ops | checkout | open | |
| G2 API contract | Backend | live adapters | decided: mock-first | 2026-09-10 |

| Decision | Question | Asked by | Status | Answer |
| --- | --- | --- | --- | --- |
| D1 | Which tiers may redeem? | Dev 1 | open | |
| D2 | Prices before sign-in? | Dev 2 | answered | Yes |

### Working assumptions

| Decision | Working assumption | What a different answer changes |
| --- | --- | --- |
| D1 | Every paid tier may redeem | one guard |

## Feature register

### M0 · Foundation

| Slug | Title | Sources | Owner | Size | Depends on |
| --- | --- | --- | --- | --- | --- |
| \`app-shell\` | Tab shell | prd/01 | Dev 2 | M | |
| \`design-kit\` | Shared widgets | prd/01 | Dev 2 | S | |

### M1 · Entry

| Slug | Title | Sources | Owner | Size | Depends on |
| --- | --- | --- | --- | --- | --- |
| \`pin-sign-in\` | Sign in with a PIN | prd/01 | Dev 1 | M | \`app-shell\`, G2 |
| \`voucher-redeem\` | Redeem a voucher | prd/01 | Dev 1 | L | D1, G1 |
| \`guest-prices\` | Guest prices | prd/01 | Dev 2 | S | D2 |
`;

describe('register', () => {
  const register = Register.parse(BACKLOG);

  it('reads every feature row with its milestone', () => {
    assert.equal(register.rows.length, 5);
    assert.equal(register.row('pin-sign-in').milestone, 'M1');
    assert.equal(register.row('pin-sign-in').title, 'Sign in with a PIN');
    assert.deepEqual(register.row('pin-sign-in').dependsOn, ['app-shell']);
    assert.deepEqual(register.row('pin-sign-in').gates, ['G2']);
  });

  it('names milestones, gates and decisions for plain-name output', () => {
    assert.equal(register.describeMilestone('M0'), 'M0 Foundation');
    assert.equal(register.describeGate('G1'), 'G1 Payment account');
    assert.match(register.describeDecision('D2'), /Prices before sign-in\?/);
  });

  it('blocks on an open gate but not a decided one', () => {
    assert.equal(register.gateBlocks('G1'), true);
    assert.equal(register.gateBlocks('G2'), false);
  });

  it('treats an untracked gate as blocking, since nobody said otherwise', () => {
    assert.equal(register.gateBlocks('G99'), true);
  });

  it('settles a decision by answer or by working assumption, and says which', () => {
    assert.equal(register.decisionBlocks('D1'), false);
    assert.equal(register.decision('D1').settledBy, 'assumption');
    assert.equal(register.decisionBlocks('D2'), false);
    assert.equal(register.decision('D2').settledBy, 'answer');
  });

  it('matches columns by header name, not position', () => {
    const reordered = Register.parse(`### M0 · Foundation

| Owner | Title | Slug | Depends on |
| --- | --- | --- | --- |
| Ana | Tab shell | \`app-shell\` | G1 |
`);
    const row = reordered.row('app-shell');
    assert.equal(row.lane, 'Ana');
    assert.equal(row.title, 'Tab shell');
    assert.deepEqual(row.gates, ['G1']);
  });

  it('expands a row that waits on every earlier feature', () => {
    const register = Register.parse(`### M0 · Foundation

| Slug | Title | Depends on |
| --- | --- | --- |
| \`a\` | A | |
| \`b\` | B | |

### M1 · Later

| Slug | Title | Depends on |
| --- | --- | --- |
| \`release\` | Release | every earlier feature |
`);
    assert.deepEqual(register.row('release').dependsOn.sort(), ['a', 'b']);
  });
});

const claim = (slug, over = {}) => ({
  slug,
  holder: 'Dev',
  ref: `origin/feat/${slug}`,
  stage: 'requirements',
  status: 'in-progress',
  lastCommitAt: new Date('2026-09-15T00:00:00Z'),
  isPushed: true,
  ...over,
});

describe('board', () => {
  const register = Register.parse(BACKLOG);

  it('marks a row done only when its plan is complete on the default branch', () => {
    const board = Board.build(
      register,
      [claim('app-shell', { ref: 'origin/main', status: 'complete' })],
      'main',
    );
    assert.equal(board.find('app-shell').state, 'done');
    // Its dependent is freed by that, not by the branch existing.
    assert.equal(board.find('pin-sign-in').state, 'available');
  });

  it('does not treat a complete plan on a feature branch as done', () => {
    const board = Board.build(register, [claim('app-shell', { status: 'complete' })], 'main');
    assert.equal(board.find('app-shell').state, 'in-progress');
    assert.equal(board.find('pin-sign-in').state, 'blocked');
  });

  it('blocks a row on an open gate and names its owner', () => {
    const board = Board.build(register, [], 'main');
    assert.equal(board.find('voucher-redeem').state, 'blocked');
    assert.match(board.find('voucher-redeem').blockers.join(), /Payment account \(Ops\) is open/);
  });

  it('refuses to claim a row that is taken, done or blocked', () => {
    const board = Board.build(register, [claim('app-shell')], 'main');
    assert.match(board.whyNotAvailable('app-shell'), /already claimed by Dev/);
    assert.match(board.whyNotAvailable('voucher-redeem'), /blocked by/);
    assert.match(board.whyNotAvailable('not-a-row'), /not in the feature register/);
    assert.equal(board.whyNotAvailable('design-kit'), null);
  });

  it('ranks by milestone, then rows unblocked, then size', () => {
    const board = Board.build(register, [], 'main');
    const picks = board.proposals({ count: 3 }).map((row) => row.row.slug);
    assert.deepEqual(picks, ['app-shell', 'design-kit', 'guest-prices']);
  });

  const m0Done = [
    claim('app-shell', { ref: 'origin/main', status: 'complete' }),
    claim('design-kit', { ref: 'origin/main', status: 'complete' }),
  ];

  it('puts the asker\'s lane first inside a milestone', () => {
    const board = Board.build(register, m0Done, 'main');
    const picks = board.proposals({ lane: 'Dev 1', count: 3 }).map((row) => row.row.slug);
    assert.equal(picks[0], 'pin-sign-in');
    // Without the lane, the tie falls to the smaller row instead.
    assert.equal(board.proposals({ count: 1 })[0].row.slug, 'guest-prices');
  });

  it('understands a lane named loosely', () => {
    const board = Board.build(register, m0Done, 'main');
    assert.equal(board.proposals({ lane: '1', count: 1 })[0].row.slug, 'pin-sign-in');
    assert.equal(board.proposals({ lane: 'dev 2', count: 1 })[0].row.slug, 'guest-prices');
  });

  it('prefers a complete plan on main over a lingering branch', () => {
    const board = Board.build(
      register,
      [claim('app-shell'), claim('app-shell', { ref: 'origin/main', status: 'complete' })],
      'main',
    );
    assert.equal(board.find('app-shell').state, 'done');
  });

  it('flags a claim with no commit for four weeks as stale', () => {
    const board = Board.build(register, [claim('app-shell')], 'main');
    const row = board.find('app-shell');
    assert.equal(board.isStale(row.claim, new Date('2026-09-20T00:00:00Z')), false);
    assert.equal(board.isStale(row.claim, new Date('2026-11-01T00:00:00Z')), true);
  });

  it('says what an available row rides on', () => {
    const board = Board.build(register, [claim('app-shell', { ref: 'origin/main', status: 'complete' })], 'main');
    assert.match(board.ridesOn(register.row('pin-sign-in')).join(), /API contract \(decided: mock-first\)/);
    assert.match(board.ridesOn(register.row('guest-prices')).join(), /the answer to D2/);
  });
});

describe('render', () => {
  const register = Register.parse(BACKLOG);
  const board = Board.build(register, [claim('app-shell')], 'main');
  const now = new Date('2026-09-16T00:00:00Z');

  it('leads with counts and the current milestone', () => {
    const text = renderStatus(board, { now });
    assert.match(text, /Delivery board · 2026-09-16 · milestone M0 Foundation/);
    assert.match(text, /0 done · 1 in progress/);
  });

  it('names who holds what, and where', () => {
    assert.match(renderStatus(board, { now }), /app-shell · Dev 2 · stage requirements \(in-progress\) · Dev · origin\/feat\/app-shell/);
  });

  it('says what frees the next row when fewer than three are available', () => {
    const narrow = Board.build(Register.parse(BACKLOG), [], 'main');
    assert.match(
      renderNext(narrow, { count: 10 }),
      /Next to free: pin-sign-in, blocked by "app-shell" is not done/,
    );
  });
});

describe('plan model', () => {
  it('moves one stage forward, any distance back, and never out of complete', () => {
    assert.equal(canTransition('requirements', 'specification'), true);
    assert.equal(canTransition('requirements', 'tickets'), false);
    assert.equal(canTransition('review', 'requirements'), true);
    assert.equal(canTransition('complete', 'review'), false);
  });

  it('round-trips a plan through YAML', () => {
    const dir = tempRepo();
    const plan = newPlan('password-recovery', 'Password recovery', new Date('2026-09-16T10:00:00Z'));
    writeText(join(dir, 'plan.yml'), serializePlan(plan));
    const read = readPlan(dir);
    assert.equal(read.feature, 'password-recovery');
    assert.equal(read.title, 'Password recovery');
    assert.equal(read.stage, 'requirements');
    assert.equal(read.implementationBaseSha, null);
    assert.equal(read.createdAt, '2026-09-16T10:00:00Z');
  });

  it('offers only tickets whose dependencies are done', () => {
    const dir = tempRepo();
    writeText(join(dir, 'tickets', 'first.md'), '---\ntitle: First\nstatus: done\ndepends_on: []\nskills: [tdd]\n---\n');
    writeText(join(dir, 'tickets', 'second.md'), '---\ntitle: Second\nstatus: planned\ndepends_on: [first]\nskills: [tdd]\n---\n');
    writeText(join(dir, 'tickets', 'third.md'), '---\ntitle: Third\nstatus: planned\ndepends_on: [second]\nskills: [tdd]\n---\n');
    const ready = readyTickets(readTickets(dir)).map((ticket) => ticket.slug);
    assert.deepEqual(ready, ['second']);
  });

  it('reads a named section body', () => {
    const markdown = '# Title\n\n## Approach\n\nOne shell route.\n\n## Risks\n\nNone.\n';
    assert.equal(sectionBody(markdown, 'Approach'), 'One shell route.');
    assert.equal(sectionBody(markdown, 'Missing'), null);
  });
});

describe('config', () => {
  it('round-trips through YAML', () => {
    const config = parseConfig(`version: 1
project: Demo
targets: [claude, cursor]
plans: .docs/changes
backlog: docs/plan.md
sources:
  product: { label: PRD, paths: ["docs/prd/**/*.md"], required: true }
checks:
  - { name: test, run: "npm test", focus: "npm test -- {path}" }
git: { remote: upstream, defaultBranch: trunk, branchPrefix: "feature/" }
`);
    assert.deepEqual(config.targets, ['claude', 'cursor']);
    assert.equal(config.sources.product.required, true);
    assert.equal(config.checks[0].focus, 'npm test -- {path}');
    assert.equal(config.git.defaultBranch, 'trunk');
    assert.deepEqual(parseConfig(serializeConfig(config)), config);
  });

  it('carries `owned` on a contract this repository defines', () => {
    const config = parseConfig(`version: 1
sources:
  api: { label: OpenAPI, paths: ["openapi.yaml"], owned: true }
  design: { label: Figma, paths: ["docs/ui.md"] }
`);
    assert.equal(config.sources.api.owned, true);
    assert.equal(config.sources.design.owned, undefined);
    assert.ok(serializeConfig(config).includes('owned: true'));
    assert.deepEqual(parseConfig(serializeConfig(config)), config);
  });

  it('accepts a single `path` as well as a `paths` list', () => {
    const config = parseConfig('version: 1\nsources:\n  domain: { label: Glossary, path: CONTEXT.md }\n');
    assert.deepEqual(config.sources.domain.paths, ['CONTEXT.md']);
  });

  it('falls back to defaults for everything absent', () => {
    const config = parseConfig('version: 1\n');
    assert.deepEqual(config.targets, ['claude']);
    assert.equal(config.plans, '.docs/changes');
    assert.equal(config.git.remote, 'origin');
  });
});

describe('packs', () => {
  const packs = loadPacks(process.cwd(), []);

  it('ships the core workflow skills with their roles', () => {
    const byName = new Map(packs.skills.map((skill) => [skill.name, skill.role]));
    assert.equal(byName.get('deliver-change'), 'coordinator');
    assert.equal(byName.get('to-requirements'), 'stage');
    assert.equal(byName.get('tdd'), 'ticket');
    assert.equal(byName.get('codebase-design'), 'reference');
  });

  it('exposes only ticket-role skills to tickets', () => {
    assert.deepEqual(ticketSkills(packs), ['tdd']);
  });

  it('gives every skill a description, which is how an agent finds it', () => {
    for (const skill of packs.skills) {
      assert.ok(skill.description.length > 20, `${skill.name} has no usable description`);
    }
  });

  it('adds a pack\'s skills and rules to the set', () => {
    const withExample = loadPacks(process.cwd(), ['examples/pack-example']);
    assert.ok(ticketSkills(withExample).includes('http-endpoint'));
    assert.ok(withExample.rules.some((rule) => rule.file === 'http-endpoints.md'));
  });

  it('gives every rule at least one path glob', () => {
    assert.ok(corePack().rules.every((rule) => rule.paths.length > 0));
  });
});

describe('validate', () => {
  const packs = loadPacks(process.cwd(), []);
  const complete = (dir, over = {}) => {
    const plan = { ...newPlan('demo', 'Demo'), ...over };
    writeText(join(dir, 'plan.yml'), serializePlan(plan));
  };
  const section = (names) => names.map((name) => `## ${name}\n\nWritten.\n`).join('\n');

  const run = (dir) => {
    const findings = new Findings(dir);
    validatePlan(dir, packs, findings);
    return findings;
  };

  it('accepts a freshly claimed row: a lone plan.yml at requirements', () => {
    const dir = join(tempRepo(), 'demo');
    complete(dir);
    assert.equal(run(dir).ok, true);
  });

  it('requires a base SHA from implementation onward', () => {
    const dir = join(tempRepo(), 'demo');
    complete(dir, { stage: 'implementation' });
    writeText(join(dir, 'requirements.md'), section(['Description', 'Sources', 'Scope', 'User stories', 'Acceptance criteria', 'Interfaces', 'Data and integrations', 'Quality constraints', 'Constraints and open questions']));
    assert.match(run(dir).errors.map((f) => f.message).join(), /implementation_base_sha is required/);
  });

  it('rejects the ready status before ticketing', () => {
    const dir = join(tempRepo(), 'demo');
    complete(dir, { status: 'ready' });
    assert.match(run(dir).errors.map((f) => f.message).join(), /ready status is only valid/);
  });

  it('rejects a ticket naming a skill no pack installs', () => {
    const dir = join(tempRepo(), 'demo');
    complete(dir, { stage: 'tickets', status: 'ready' });
    writeText(join(dir, 'requirements.md'), section(['Description', 'Sources', 'Scope', 'User stories', 'Acceptance criteria', 'Interfaces', 'Data and integrations', 'Quality constraints', 'Constraints and open questions']));
    writeText(join(dir, 'specification.md'), section(['Approach', 'Architecture and domain', 'Data and integrations', 'State and lifecycle', 'Failure behaviour', 'Interface and interaction', 'Security, observability, and performance', 'Test plan', 'Compatibility, migration, and rollback', 'Risks and open questions']));
    writeText(
      join(dir, 'tickets', 'one.md'),
      `---\ntitle: One\nstatus: planned\ndepends_on: []\nskills: [tdd, flutter-ui]\n---\n\n${section(['Outcome', 'Requirements', 'Implementation', 'Tests', 'Done when'])}`,
    );
    assert.match(run(dir).errors.map((f) => f.message).join(), /unknown ticket skill "flutter-ui"/);
  });

  it('rejects a dependency cycle', () => {
    const dir = join(tempRepo(), 'demo');
    complete(dir, { stage: 'tickets', status: 'ready' });
    writeText(join(dir, 'requirements.md'), section(['Description', 'Sources', 'Scope', 'User stories', 'Acceptance criteria', 'Interfaces', 'Data and integrations', 'Quality constraints', 'Constraints and open questions']));
    writeText(join(dir, 'specification.md'), section(['Approach', 'Architecture and domain', 'Data and integrations', 'State and lifecycle', 'Failure behaviour', 'Interface and interaction', 'Security, observability, and performance', 'Test plan', 'Compatibility, migration, and rollback', 'Risks and open questions']));
    const body = section(['Outcome', 'Requirements', 'Implementation', 'Tests', 'Done when']);
    writeText(join(dir, 'tickets', 'one.md'), `---\ntitle: One\nstatus: planned\ndepends_on: [two]\nskills: [tdd]\n---\n\n${body}`);
    writeText(join(dir, 'tickets', 'two.md'), `---\ntitle: Two\nstatus: planned\ndepends_on: [one]\nskills: [tdd]\n---\n\n${body}`);
    assert.match(run(dir).errors.map((f) => f.message).join(), /contains a cycle/);
  });

  it('rejects a deferred ticket that never says what it waits for', () => {
    const dir = join(tempRepo(), 'demo');
    complete(dir, { stage: 'tickets', status: 'ready' });
    writeText(join(dir, 'requirements.md'), section(['Description', 'Sources', 'Scope', 'User stories', 'Acceptance criteria', 'Interfaces', 'Data and integrations', 'Quality constraints', 'Constraints and open questions']));
    writeText(join(dir, 'specification.md'), section(['Approach', 'Architecture and domain', 'Data and integrations', 'State and lifecycle', 'Failure behaviour', 'Interface and interaction', 'Security, observability, and performance', 'Test plan', 'Compatibility, migration, and rollback', 'Risks and open questions']));
    writeText(
      join(dir, 'tickets', 'one.md'),
      `---\ntitle: One\nstatus: deferred\ndepends_on: []\nskills: [tdd]\n---\n\n${section(['Outcome', 'Requirements', 'Implementation', 'Tests', 'Done when'])}`,
    );
    assert.match(run(dir).errors.map((f) => f.message).join(), /must record what it waits for/);
  });

  it('rejects a section still holding the template text, but accepts "None."', () => {
    const dir = join(tempRepo(), 'demo');
    complete(dir);
    writeText(
      join(dir, 'requirements.md'),
      [
        '## Description\n\nDescribe the user outcome and why it matters.\n',
        section(['Sources', 'Scope', 'User stories', 'Acceptance criteria', 'Interfaces', 'Data and integrations', 'Quality constraints']),
        '## Constraints and open questions\n\nNone.\n',
      ].join('\n'),
    );
    const messages = run(dir).errors.map((finding) => finding.message).join('\n');
    assert.match(messages, /section "Description" still holds the template's placeholder text/);
    assert.doesNotMatch(messages, /Constraints and open questions/);
  });
});

describe('memory block', () => {
  it('creates the file when there is none', () => {
    const merged = mergeBlock(null, `${BLOCK_START}\nbody\n${BLOCK_END}`, 'Demo');
    assert.match(merged, /^# Demo/);
    assert.match(merged, /body/);
  });

  it('replaces only the marked block, keeping the project\'s own prose', () => {
    const existing = `# Demo\n\nOur own rules.\n\n${BLOCK_START}\nold\n${BLOCK_END}\n\nMore of ours.\n`;
    const merged = mergeBlock(existing, `${BLOCK_START}\nnew\n${BLOCK_END}`, 'Demo');
    assert.match(merged, /Our own rules\./);
    assert.match(merged, /More of ours\./);
    assert.match(merged, /new/);
    assert.doesNotMatch(merged, /old/);
  });

  it('appends to a file that has no block yet', () => {
    const merged = mergeBlock('# Demo\n\nOurs.\n', `${BLOCK_START}\nbody\n${BLOCK_END}`, 'Demo');
    assert.match(merged, /Ours\./);
    assert.match(merged, /body/);
  });
});

describe('argument parsing', () => {
  it('separates command, positionals and flags', () => {
    const args = parseArgs(['claim', 'app-shell', '--no-fetch', '--lane', 'Dev 2']);
    assert.equal(args.command, 'claim');
    assert.deepEqual(args.positional, ['app-shell']);
    assert.equal(args.flags.get('no-fetch'), true);
    assert.equal(args.flags.get('lane'), 'Dev 2');
  });

  it('accepts --flag=value', () => {
    const args = parseArgs(['check', '--focus=test/features/auth']);
    assert.equal(args.flags.get('focus'), 'test/features/auth');
  });
});

describe('glob', () => {
  it('spans directories with ** and stays in one segment with *', () => {
    assert.ok(matchesGlob('.docs/changes/pin-sign-in/plan.yml', '.docs/changes/**'));
    assert.ok(matchesGlob('src/api/v2/routes/user.ts', 'src/**/routes/**'));
    assert.ok(matchesGlob('src/routes/user.ts', 'src/**/routes/**'));
    assert.ok(matchesGlob('docs/prd/01-auth.md', 'docs/prd/**/*.md'));
    assert.ok(!matchesGlob('docs/changes/x/plan.yml', '.docs/changes/**'));
    assert.ok(!matchesGlob('src/routes/deep/user.ts', 'src/routes/*.ts'));
  });

  it('reports which pattern matched, so a rule can say why it applied', () => {
    assert.equal(firstMatch('docs/changes/x/plan.yml', ['.docs/changes/**', 'docs/changes/**']), 'docs/changes/**');
    assert.equal(firstMatch('src/main.ts', ['docs/**']), null);
  });
});

describe('step map', () => {
  const packs = loadPacks(process.cwd(), ['examples/pack-example']);
  const map = buildStepMap(packs, { plansDir: '.docs/changes' });
  const skill = (name) => map.skills.find((entry) => entry.name === name);

  it('reads the numbered sequence and its completion criteria', () => {
    const steps = skill('deliver-change').steps;
    assert.deepEqual(
      steps.map((step) => step.number),
      [1, 2, 3, 4, 5],
    );
    assert.equal(steps[0].title, 'Open the plan');
    assert.equal(steps[0].doneWhen, 'one package owns the feature and its current stage is known');
  });

  it('follows delegation but not a handback, so the call graph is the real one', () => {
    const deliver = skill('deliver-change').steps;
    // "Use `to-requirements` to write…" is a delegation, in the order named.
    assert.deepEqual(deliver[1].calls, ['to-requirements', 'to-spec', 'to-tickets']);
    assert.deepEqual(deliver[3].calls, ['implement']);

    // "Report readiness … to `deliver-change`" is a return, not a call.
    const handBack = skill('to-requirements').steps.at(-1);
    assert.deepEqual(handBack.calls, []);
    assert.deepEqual(handBack.names, ['deliver-change']);
  });

  it('separates a reference skill from one that is scheduled', () => {
    const order = skill('to-tickets').steps[1];
    assert.deepEqual(order.reads, ['codebase-design', 'domain-modeling']);
    assert.deepEqual(skill('implement').steps[1].calls, ['tdd']);
  });

  it('orders skills the way the workflow reaches them', () => {
    const named = map.skills.map((entry) => entry.name);
    const at = (name) => named.indexOf(name);
    assert.equal(named[0], 'deliver-change');
    assert.ok(at('to-requirements') < at('to-spec'));
    assert.ok(at('to-spec') < at('to-tickets'));
    assert.ok(at('to-tickets') < at('implement'));
    assert.ok(at('implement') < at('code-review'));
  });

  it('resolves a plan file against the configured plans directory', () => {
    assert.equal(resolveArtifact('requirements.md', 'docs/changes'), 'docs/changes/<feature>/requirements.md');
    assert.equal(resolveArtifact('<plans>/<feature-slug>/tickets/', '.docs/changes'), '.docs/changes/<feature>/tickets/');
    assert.equal(resolveArtifact('collab-swarm.yml', '.docs/changes'), 'collab-swarm.yml');
  });

  it('puts a rule in force at the step that touches a file in its scope', () => {
    const open = skill('deliver-change').steps[0];
    assert.ok(open.artifacts.includes('.docs/changes/<feature>/plan.yml'));
    const rule = open.rules.find((entry) => entry.file === 'feature-plans.md');
    assert.equal(rule.reason, 'path');
    assert.equal(rule.match, '.docs/changes/<feature>/plan.yml');
    assert.equal(rule.pattern, '.docs/changes/**');

    // A step that names no plan file does not drag the rule along.
    assert.deepEqual(skill('implement').steps[1].rules, []);
  });

  it('puts a pack rule in force for every step of the skill it names', () => {
    const endpoint = skill('http-endpoint');
    assert.deepEqual(
      endpoint.rules.map((rule) => [rule.file, rule.reason]),
      [['http-endpoints.md', 'skill']],
    );
    assert.deepEqual(rulesAtStep(endpoint, endpoint.steps[0]).map((rule) => rule.file), ['http-endpoints.md']);
  });

  it('reports every site a rule governs', () => {
    const plans = map.rules.find((rule) => rule.file === 'feature-plans.md');
    assert.ok(plans.sites.length >= 5);
    assert.ok(plans.sites.every((site) => site.reason === 'path'));
    assert.ok(plans.sites.some((site) => site.skill === 'to-spec' && site.stepTitle === 'Hand back'));

    const endpoints = map.rules.find((rule) => rule.file === 'http-endpoints.md');
    assert.deepEqual(endpoints.sites, [
      { skill: 'http-endpoint', step: null, stepTitle: null, reason: 'skill', match: null },
    ]);
  });

  it('collects the swarm commands a step involves', () => {
    assert.ok(skill('implement').steps[2].commands.includes('npx collab-swarm check --focus <ticket test path>'));
    assert.ok(skill('whats-next').steps[0].commands.includes('npx collab-swarm next --lane "Dev 2"'));
  });

  it('still reads a command written with the older bin name', () => {
    // A pack in the wild may say `npx swarm validate`. Losing its commands
    // from the execution map would be a silent regression, not a loud one.
    const legacy = packRootFor(join(tempRepo(), 'legacy-command'));
    const map = buildStepMap(loadPacks(process.cwd(), [legacy]), { plansDir: '.docs/changes' });
    const step = map.skills.find((entry) => entry.name === 'legacy-thing').steps[0];
    assert.deepEqual(step.commands, ['npx swarm validate', 'npx collab-swarm check']);
  });

  it('reads a sequence numbered a heading level down', () => {
    // `wizard` groups its steps under `## Process` and numbers them `### 1.`,
    // and closes each on an emphasised `**Done when:**`.
    const steps = skill('wizard').steps;
    assert.equal(steps.length, 4);
    assert.equal(steps[0].title, 'Scope the procedure');
    assert.match(steps[0].doneWhen, /^every stage is named in order/);
  });

  it('reads a sequence written as a plain ordered list', () => {
    const steps = skill('resolving-merge-conflicts').steps;
    assert.equal(steps.length, 5);
    assert.equal(steps[0].title, 'See the current state');
    assert.equal(steps[2].title, 'Resolve each hunk');
  });

  it('leaves flat reference as topics rather than inventing steps from its lists', () => {
    const design = skill('codebase-design');
    assert.deepEqual(design.steps, []);
    assert.ok(design.topics.includes('Deep vs shallow'));
    assert.deepEqual(skill('tdd').steps, []);
    assert.ok(skill('tdd').topics.includes('Rules of the loop'));
  });

  it('lists the files that sit beside a skill', () => {
    assert.deepEqual(skill('to-requirements').companions, ['REQUIREMENTS-FORMAT.md']);
  });
});

describe('stack packs', () => {
  const packRoot = (dir, skills, rules = {}) => {
    writeText(
      join(dir, 'collab-swarm-pack.json'),
      JSON.stringify({
        name: 'flutter',
        title: 'Flutter',
        collabSwarm: 1,
        skills: skills.map(({ name, role }) => ({ name, role })),
      }),
    );
    for (const skill of skills) {
      writeText(join(dir, 'skills', skill.name, 'SKILL.md'), skill.body);
    }
    for (const [file, body] of Object.entries(rules)) {
      writeText(join(dir, 'rules', file), body);
    }
    return dir;
  };

  const ROUTER = `---
name: flutter-dev
description: Route an approved Flutter ticket to the skills its work requires.
---

# Flutter Development Router

## 1. Select the concern set

| Ticket concern | Use |
| --- | --- |
| Endpoint, DTO, mapper | \`flutter-api-integration\` |
| ViewModel, page state | \`flutter-state-management\` |

Consult \`codebase-design\` when the seam shape is a design problem. Return to \`deliver-change\` when a decision changes.

Done when every concern maps to one skill.
`;

  const CONCERN = (name) => `---
name: ${name}
description: A concern of this project's Flutter stack, with its own invariants.
---

# ${name}

## 1. Build it

Done when it is built.
`;

  const dir = packRoot(join(tempRepo(), 'pack'), [
    { name: 'flutter-dev', role: 'router', body: ROUTER },
    { name: 'flutter-api-integration', role: 'ticket', body: CONCERN('flutter-api-integration') },
    { name: 'flutter-state-management', role: 'ticket', body: CONCERN('flutter-state-management') },
    { name: 'flutter-ui-review', role: 'review', body: CONCERN('flutter-ui-review') },
  ], {
    'api-integration.md': `---
paths: ["lib/**/data/**"]
description: Invariants for the Retrofit stack.
---

Recipe: [\`flutter-api-integration\`](../skills/flutter-api-integration/SKILL.md).
`,
  });

  const packs = loadPacks(process.cwd(), [dir]);

  it('keeps a router and a review skill out of a ticket\'s reach', () => {
    const allowed = ticketSkills(packs);
    assert.ok(allowed.includes('flutter-api-integration'));
    assert.ok(!allowed.includes('flutter-dev'), 'a ticket must not schedule the router');
    assert.ok(!allowed.includes('flutter-ui-review'), 'a ticket must not schedule a review skill');
  });

  it('reads the whole routing table as delegation, not just the row with a verb', () => {
    const map = buildStepMap(packs, { plansDir: '.docs/changes' });
    const router = map.skills.find((skill) => skill.name === 'flutter-dev');
    assert.equal(router.role, 'router');
    assert.deepEqual(router.steps[0].calls, ['flutter-api-integration', 'flutter-state-management']);
    // A return upward stays a mention even inside a router.
    assert.deepEqual(router.steps[0].names, ['deliver-change']);
    assert.deepEqual(router.steps[0].reads, ['codebase-design']);
  });

  it('orders the router before the concerns it selects', () => {
    const named = buildStepMap(packs, { plansDir: '.docs/changes' }).skills.map((s) => s.name);
    assert.ok(named.indexOf('flutter-dev') < named.indexOf('flutter-api-integration'));
  });

  it('puts a pack rule in force for the skill its recipe link names', () => {
    const map = buildStepMap(packs, { plansDir: '.docs/changes' });
    const api = map.skills.find((skill) => skill.name === 'flutter-api-integration');
    assert.deepEqual(
      api.rules.map((rule) => [rule.file, rule.reason]),
      [['api-integration.md', 'skill']],
    );
  });

  it('lists every role in the always-loaded instruction block', () => {
    const block = renderMemoryBlock(
      { config: parseConfig('project: Demo'), packs, root: '.', workflow: new Map(), skills: packs.skills, rules: packs.rules, version: '0' },
      '.claude/workflow',
    );
    assert.match(block, /Routes a ticket to its concerns:.*flutter-dev/);
    assert.match(block, /Reviews one surface:.*flutter-ui-review/);
    assert.match(block, /Implements a ticket:.*flutter-api-integration/);
  });

  it('reports a rule that would apply everywhere and a skill nobody would open', () => {
    const loose = packRoot(join(tempRepo(), 'loose'), [
      { name: 'unwritten', role: 'ticket', body: '---\nname: unwritten\ndescription:\n---\n\n# unwritten\n' },
    ], { 'house-style.md': '---\npaths: []\n---\n\n# House style\n' });
    const findings = validateRepository(
      process.cwd(),
      { ...parseConfig('project: Demo'), plans: join(tempRepo(), 'no-plans') },
      loadPacks(process.cwd(), [loose]),
    );
    const messages = findings.warnings.map((finding) => finding.message);
    assert.ok(messages.some((message) => message.includes('declares no paths')));
    assert.ok(messages.some((message) => message.includes('has no description')));
  });

  it('reports `owned` on a register this project writes either way', () => {
    const config = parseConfig(`project: Demo
sources:
  product: { label: PRD, paths: ["docs/prd/**/*.md"], owned: true }
  api: { label: OpenAPI, paths: ["openapi.yaml"], owned: true }
  events: { label: Event schemas, paths: ["events/**/*.json"], owned: true }
`);
    const findings = validateRepository(
      process.cwd(),
      { ...config, plans: join(tempRepo(), 'no-plans') },
      loadPacks(process.cwd(), []),
    );
    const owned = findings.warnings.filter((finding) => finding.message.includes('marked `owned`'));
    // Only the register: a contract kind the project invented keeps both readings.
    assert.equal(owned.length, 1);
    assert.ok(owned[0].message.includes('"product"'));
  });
});

/** A one-skill pack whose only step names a command in each spelling. */
function packRootFor(dir) {
  writeText(
    join(dir, 'collab-swarm-pack.json'),
    JSON.stringify({ name: 'legacy', collabSwarm: 1, skills: [{ name: 'legacy-thing', role: 'ticket' }] }),
  );
  writeText(
    join(dir, 'skills', 'legacy-thing', 'SKILL.md'),
    [
      '---',
      'name: legacy-thing',
      'description: A concern written before the bin was renamed.',
      '---',
      '',
      '# Legacy thing',
      '',
      '## 1. Do it',
      '',
      'Run `npx swarm validate`, then `npx collab-swarm check`.',
      '',
      'Done when both pass.',
      '',
    ].join('\n'),
  );
  return dir;
}

describe('pack options', () => {
  const optionPack = (dir) => {
    writeText(
      join(dir, 'collab-swarm-pack.json'),
      JSON.stringify({
        name: 'stack',
        title: 'Stack',
        collabSwarm: 1,
        detect: ['stack.toml'],
        options: [
          {
            id: 'database',
            question: 'Local database',
            default: 'none',
            choices: [
              { id: 'none', label: 'None' },
              {
                id: 'drift',
                label: 'Drift',
                vars: { store: 'database' },
                packages: [{ name: 'drift', use: 'Typed SQL' }],
              },
            ],
          },
          {
            id: 'push',
            question: 'Push',
            default: 'fcm',
            choices: [
              { id: 'fcm', label: 'FCM', vars: { source: 'FcmSource' } },
              { id: 'none', label: 'No push' },
            ],
          },
        ],
        skills: [
          { name: 'stack-dev', role: 'router' },
          { name: 'stack-storage', role: 'ticket', if: 'database!=none' },
          { name: 'stack-push', role: 'ticket', if: 'push!=none' },
        ],
        checks: [{ name: 'generate', run: 'stack gen', if: 'database=drift' }],
        stack: {
          summary: 'A stack with slots.',
          layout: ['src/'],
          conventions: ['One owner per concern.'],
          packages: [{ name: 'core', use: 'The framework' }],
        },
      }),
    );
    writeText(
      join(dir, 'skills', 'stack-dev', 'SKILL.md'),
      '---\nname: stack-dev\ndescription: Route a ticket.\n---\n\n# Router\n',
    );
    writeText(
      join(dir, 'skills', 'stack-storage', 'SKILL.md'),
      [
        '---',
        'name: stack-storage',
        'description: Local storage with {{database.label}}.',
        '---',
        '',
        '# Storage',
        '',
        'Open the {{database.store}} once.',
        '',
        '<!-- swarm:if database=drift -->',
        'Every schema change needs a migration.',
        '<!-- swarm:else -->',
        'Pick a database first.',
        '<!-- swarm:endif -->',
        '',
        'Secrets go to secure storage<!-- swarm:if database!=none -->, rows to the {{database.store}}<!-- swarm:endif -->.',
        '',
      ].join('\n'),
    );
    writeText(
      join(dir, 'skills', 'stack-push', 'SKILL.md'),
      '---\nname: stack-push\ndescription: Push over {{push.source}}.\n---\n\n# Push\n',
    );
    writeText(
      join(dir, 'rules', 'storage.md'),
      '---\nif: database!=none\npaths: ["src/storage/**"]\ndescription: Storage invariants.\n---\n\n- Use the {{database.store}}.\n',
    );
    return dir;
  };

  const dir = optionPack(join(tempRepo(), 'option-pack'));

  it('evaluates equality, negation, alternatives and conjunction', () => {
    const answers = { database: 'drift', push: 'none' };
    assert.equal(matches(undefined, answers), true);
    assert.equal(matches('database=drift', answers), true);
    assert.equal(matches('database=hive,drift', answers), true);
    assert.equal(matches('database!=none', answers), true);
    assert.equal(matches('push!=none', answers), false);
    assert.equal(matches('database!=none && push!=none', answers), false);
    assert.equal(matches('database!=none || push!=none', answers), true);
    // An option the pack never declared cannot be what removes a skill.
    assert.equal(matches('analytics=firebase', answers), true);
  });

  it('keeps an unresolved interpolation visible instead of blanking it', () => {
    const rendered = renderText('Open the {{database.store}}.', {}, {});
    assert.equal(rendered, 'Open the {{database.store}}.');
    assert.deepEqual(unresolvedVars(rendered), ['database.store']);
  });

  it('resolves blocks, else branches and inline spans', () => {
    const body = [
      '<!-- swarm:if database=drift -->',
      'migration',
      '<!-- swarm:else -->',
      'pick one',
      '<!-- swarm:endif -->',
      'secrets<!-- swarm:if database!=none -->, rows<!-- swarm:endif -->.',
    ].join('\n');

    const drift = renderText(body, { database: 'drift' }, {});
    assert.match(drift, /migration/);
    assert.ok(!drift.includes('pick one'));
    assert.match(drift, /secrets, rows\./);
    assert.deepEqual(unresolvedMarkers(drift), []);

    const none = renderText(body, { database: 'none' }, {});
    assert.match(none, /pick one/);
    assert.ok(!none.includes('migration'));
    assert.match(none, /secrets\./);
  });

  it('shows a conditional inside fenced code instead of running it, but still interpolates', () => {
    const doc = [
      'Before.',
      '```markdown',
      '<!-- swarm:if database=drift -->',
      'a sample the pack is documenting',
      '<!-- swarm:endif -->',
      '```',
      '<!-- swarm:if database=drift -->',
      'real prose',
      '<!-- swarm:endif -->',
      '```dart',
      'final store = {{database.store}};',
      '```',
    ].join('\n');

    const rendered = renderText(doc, { database: 'drift' }, { 'database.store': 'database' });
    assert.match(rendered, /<!-- swarm:if database=drift -->\na sample the pack is documenting/);
    assert.match(rendered, /^real prose$/m);
    assert.match(rendered, /final store = database;/);
    // A sample is not an unclosed conditional.
    assert.deepEqual(unresolvedMarkers(rendered), []);
  });

  it('installs only the skills, rules and checks the answers select', () => {
    const chosen = loadPacks(process.cwd(), [dir], { stack: { database: 'drift', push: 'none' } });
    const names = chosen.skills.map((skill) => skill.name);
    assert.ok(names.includes('stack-storage'));
    assert.ok(!names.includes('stack-push'), 'a skill an answer ruled out is not installed at all');
    assert.deepEqual(chosen.rules.filter((rule) => rule.pack === 'stack').map((rule) => rule.file), ['storage.md']);
    assert.deepEqual(chosen.packs[1].checks.map((check) => check.name), ['generate']);

    const defaults = loadPacks(process.cwd(), [dir]);
    const byDefault = defaults.skills.map((skill) => skill.name);
    assert.ok(byDefault.includes('stack-push'), 'the declared default applies when nothing is recorded');
    assert.ok(!byDefault.includes('stack-storage'));
    assert.deepEqual(defaults.packs[1].checks, []);
  });

  it('resolves a description and a body against the answers', () => {
    const chosen = loadPacks(process.cwd(), [dir], { stack: { database: 'drift' } });
    const storage = chosen.skills.find((skill) => skill.name === 'stack-storage');
    assert.equal(storage.description, 'Local storage with Drift.');

    const body = readPackFile(storage, join(storage.dir, 'SKILL.md'));
    assert.match(body, /Open the database once\./);
    assert.match(body, /Every schema change needs a migration\./);
    assert.match(body, /Secrets go to secure storage, rows to the database\./);
    assert.deepEqual(unresolvedVars(body), []);
  });

  it('falls back to the default when a recorded answer is no longer offered', () => {
    const pack = loadPacks(process.cwd(), [dir], { stack: { database: 'mongo' } }).packs[1];
    assert.equal(pack.selections.database, 'none');
    assert.deepEqual(unknownSelections(pack.options, { database: 'mongo', colour: 'red' }), [
      'colour (no such option)',
      'database=mongo (choices: none, drift)',
    ]);
  });

  it('joins the declared packages with the ones the answers brought in', () => {
    const pack = loadPacks(process.cwd(), [dir], { stack: { database: 'drift' } }).packs[1];
    assert.deepEqual(pack.stack.packages.map((entry) => entry.name), ['core', 'drift']);
  });

  it('writes the chosen slots, libraries and layout into the always-loaded block', () => {
    const packs = loadPacks(process.cwd(), [dir], { stack: { database: 'drift', push: 'none' } });
    const block = renderMemoryBlock(
      { config: parseConfig('project: Demo'), packs, root: '.', workflow: new Map(), skills: packs.skills, rules: packs.rules, version: '0' },
      '.claude/workflow',
    );
    assert.match(block, /## Stack/);
    assert.match(block, /\| Local database \| Drift \|/);
    assert.match(block, /\| No push \|/);
    assert.match(block, /`drift` \| Typed SQL/);
    assert.match(block, /One owner per concern\./);
  });

  it('round-trips the answers through the config file', () => {
    const config = { ...parseConfig('project: Demo'), packs: ['stack'], packOptions: { stack: { database: 'drift' } } };
    const reread = parseConfig(serializeConfig(config));
    assert.deepEqual(reread.packOptions, { stack: { database: 'drift' } });
    // A pack with no answers writes no key at all.
    assert.ok(!serializeConfig({ ...config, packOptions: {} }).includes('packOptions'));
  });

  it('parses answers given on the command line', () => {
    assert.deepEqual(parseSelections('database=drift,push=none'), { database: 'drift', push: 'none' });
    assert.deepEqual(parseSelections(''), {});
  });

  it('reports an unresolved variable as an error, not a warning', () => {
    const broken = join(tempRepo(), 'broken');
    writeText(
      join(broken, 'collab-swarm-pack.json'),
      JSON.stringify({ name: 'broken', collabSwarm: 1, skills: [{ name: 'broken-thing', role: 'ticket' }] }),
    );
    writeText(
      join(broken, 'skills', 'broken-thing', 'SKILL.md'),
      '---\nname: broken-thing\ndescription: A thing.\n---\n\n# Thing\n\nUse the {{nothing.defines.this}}.\n',
    );
    const findings = validateRepository(
      process.cwd(),
      { ...parseConfig('project: Demo'), plans: join(tempRepo(), 'no-plans') },
      loadPacks(process.cwd(), [broken]),
    );
    assert.ok(findings.errors.some((finding) => finding.message.includes('unresolved pack variable')));
  });
});

describe('default packs', () => {
  it('ships the Flutter pack and resolves it by its bare name', () => {
    assert.ok(bundledPackNames().includes('flutter'));
    const flutter = resolvePack('flutter', process.cwd());
    assert.equal(flutter.bundled, true);
    assert.deepEqual(flutter.detect, ['pubspec.yaml']);
    assert.ok(flutter.options.length > 0, 'a default pack asks about the slots a team fills');
  });

  it('routes every installed concern and installs no skill without a description', () => {
    const packs = loadPacks(process.cwd(), ['flutter']);
    const router = packs.skills.find((skill) => skill.name === 'flutter-dev');
    const routed = readPackFile(router, join(router.dir, 'SKILL.md'));

    for (const skill of packs.skills.filter((entry) => entry.pack === 'flutter')) {
      assert.notEqual(skill.description, '', `${skill.name} has no description`);
      if (skill.role !== 'ticket') continue;
      assert.match(routed, new RegExp(`\`${skill.name}\``), `${skill.name} is installed but unroutable`);
    }
  });

  it('publishes no unresolved variable or conditional, whichever answers are given', () => {
    const combinations = [
      {},
      { notifications: 'onesignal', analytics: 'mixpanel', crash: 'sentry', logging: 'talker', database: 'drift', i18n: 'slang', env: 'dart_define' },
      { notifications: 'none', analytics: 'none', crash: 'none', logging: 'none', database: 'hive', i18n: 'none', env: 'envied' },
      { database: 'isar', analytics: 'posthog' },
    ];

    for (const answers of combinations) {
      const packs = loadPacks(process.cwd(), ['flutter'], { flutter: answers });
      const files = [
        ...packs.skills.map((skill) => ({ owner: skill, path: join(skill.dir, 'SKILL.md') })),
        ...packs.rules.map((rule) => ({ owner: rule, path: rule.path })),
      ];
      for (const file of files) {
        const rendered = readPackFile(file.owner, file.path);
        assert.deepEqual(unresolvedVars(rendered), [], `${file.path} with ${JSON.stringify(answers)}`);
        assert.deepEqual(unresolvedMarkers(rendered), [], `${file.path} with ${JSON.stringify(answers)}`);
      }
    }
  });

  it('drops the push and localization concerns when the project uses neither', () => {
    const bare = loadPacks(process.cwd(), ['flutter'], {
      flutter: { notifications: 'none', analytics: 'none', crash: 'none', logging: 'none', i18n: 'none' },
    });
    const names = bare.skills.map((skill) => skill.name);
    assert.ok(!names.includes('flutter-push-notifications'));
    assert.ok(!names.includes('flutter-localization'));
    assert.ok(!names.includes('flutter-observability'));
    assert.ok(names.includes('flutter-api-integration'), 'the fixed core is not an option');

    const rules = bare.rules.map((rule) => rule.file);
    assert.ok(!rules.includes('push-notifications.md'));
    assert.ok(!rules.includes('observability.md'));
  });

  it('keeps the observability concern when any one of its three answers is set', () => {
    const logsOnly = loadPacks(process.cwd(), ['flutter'], {
      flutter: { analytics: 'none', crash: 'none', logging: 'logger' },
    });
    assert.ok(logsOnly.skills.some((skill) => skill.name === 'flutter-observability'));
  });
});
