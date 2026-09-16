import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { Board } from '../dist/core/board.js';
import { canTransition, newPlan, readPlan, readTickets, readyTickets, sectionBody, serializePlan } from '../dist/core/plan.js';
import { Register } from '../dist/core/register.js';
import { renderNext, renderStatus } from '../dist/core/render.js';
import { Findings, validatePlan } from '../dist/core/validate.js';
import { corePack, loadPacks, ticketSkills } from '../dist/packs.js';
import { parseConfig, serializeConfig } from '../dist/config.js';
import { mergeBlock, BLOCK_END, BLOCK_START } from '../dist/targets/memory.js';
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
