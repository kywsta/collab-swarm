import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { Board } from '../dist/core/board.js';
import { Claims } from '../dist/core/claims.js';
import { countsAsDone, historyFindings, parseHistory, survey } from '../dist/core/history.js';
import { newPlan, serializePlan } from '../dist/core/plan.js';
import { Register } from '../dist/core/register.js';
import { parseConfig } from '../dist/config.js';
import { writeText } from '../dist/util/fs.js';

const scratch = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'collab-swarm-history-'));
  scratch.push(dir);
  return dir;
};
after(() => scratch.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const config = parseConfig(`version: 1
project: Demo
plans: plans
backlog: backlog.md
git: { remote: origin, defaultBranch: main, branchPrefix: "feat/" }
`);

const HISTORY = `# Delivery history

## M0 · Foundation

Every screen mounts in the tab shell.

| Slug | Title | Status | Completed | Commit | Notes |
| --- | --- | --- | --- | --- | --- |
| \`app-shell\` | Tab shell | delivered | 2026-09-01 | 1a2b3c4d5e6f | |
| \`guest-home\` | Guest home | superseded by \`guest-home-v2\` | 2026-09-05 | 2b3c4d5e6f7a | Replaced by \`guest-home-v2\`. |
| \`wallet-sync\` | Wallet sync | dropped | 2026-08-20 | 3c4d5e6f7a8b | |

## Settled questions

| Decision | Question | Answer | Recorded in |
| --- | --- | --- | --- |
| D7 | Prices before sign-in? | Yes | docs/prd/01.md |
`;

describe('history file', () => {
  const entries = parseHistory(HISTORY);

  it('reads every row of a table carrying Slug and Status, and skips the rest', () => {
    assert.deepEqual(entries.map((entry) => entry.slug), ['app-shell', 'guest-home', 'wallet-sync']);
    assert.equal(entries[1].status, 'superseded');
    assert.equal(entries[0].commit, '1a2b3c4d5e6f');
  });

  it('counts delivered and superseded work as done, and dropped work as not', () => {
    assert.deepEqual(entries.map(countsAsDone), [true, true, false]);
  });

  it('keeps a question retired into the history answered for the board', () => {
    const register = Register.parse(
      `### M1 · Entry\n\n| Slug | Title | Depends on |\n| --- | --- | --- |\n| \`guest-prices\` | Guest prices | D7 |\n`,
      HISTORY,
    );
    assert.equal(register.decisionBlocks('D7'), false);
    assert.equal(register.decision('D7').settledBy, 'answer');
    // The history's feature table is not mistaken for register rows.
    assert.deepEqual(register.rows.map((row) => row.slug), ['guest-prices']);
  });

  it('reports a row with no commit, an unknown status, a duplicate, or a live directory', () => {
    const root = tempDir();
    writeText(
      join(root, 'plans', 'HISTORY.md'),
      `| Slug | Title | Status | Commit | Notes |
| --- | --- | --- | --- | --- |
| \`a\` | A | finished | 1a2b3c4d | |
| \`b\` | B | delivered | | |
| \`b\` | B again | delivered | 1a2b3c4d | |
| \`c\` | C | delivered | 1a2b3c4d | |
| \`d\` | D | superseded | 1a2b3c4d | |
`,
    );
    writeText(join(root, 'plans', 'c', 'plan.yml'), serializePlan(newPlan('c', 'C')));
    const found = historyFindings(root, config);
    const errors = found.filter((f) => f.severity === 'error').map((f) => f.message).join('\n');
    assert.match(errors, /"a" has status "finished"/);
    assert.match(errors, /"b" must name the commit/);
    assert.match(errors, /"b" appears more than once/);
    assert.match(errors, /"c" is in the history and still has a plan directory/);
    assert.match(found.find((f) => f.severity === 'warning').message, /"d" is superseded; name what replaced it/);
  });
});

describe('compacting against a real remote', () => {
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

  const origin = tempDir();
  git(origin, 'init', '--quiet', '--bare', '--initial-branch=main');
  const root = tempDir();
  git(root, 'init', '--quiet', '--initial-branch=main');
  git(root, 'config', 'user.name', 'Ana');
  git(root, 'config', 'user.email', 'ana@example.com');
  git(root, 'remote', 'add', 'origin', origin);

  const BACKLOG = `### M0 · Foundation

| Slug | Title | Depends on |
| --- | --- | --- |
| \`app-shell\` | Tab shell | |
| \`design-kit\` | Shared widgets | |

### M1 · Entry

| Slug | Title | Depends on |
| --- | --- | --- |
| \`pin-sign-in\` | Sign in with a PIN | \`app-shell\` |
`;

  const completePlan = (slug) =>
    writeText(
      join(root, 'plans', slug, 'plan.yml'),
      serializePlan({ ...newPlan(slug, slug), stage: 'complete', status: 'complete', implementationBaseSha: '1a2b3c4d' }),
    );
  const commitAll = (message) => {
    git(root, 'add', '-A');
    git(root, 'commit', '--quiet', '-m', message);
    git(root, 'push', '--quiet', 'origin', 'main');
  };
  const board = ({ pushedOnly = false } = {}) =>
    Board.build(
      Register.parse(BACKLOG),
      new Claims(root, config.git, config.plans).read().filter((claim) => !pushedOnly || claim.isPushed),
      'main',
    );

  writeText(join(root, 'backlog.md'), BACKLOG);
  completePlan('app-shell');
  completePlan('design-kit');
  writeText(
    join(root, 'plans', 'design-kit', 'tickets', 'connect-icons.md'),
    '---\ntitle: Load icons from the CDN\nstatus: deferred\ndepends_on: []\nskills: [tdd]\n---\n',
  );
  writeText(join(root, 'plans', 'old-idea', 'plan.yml'), serializePlan(newPlan('old-idea', 'Old idea')));
  commitAll('deliver foundation');
  completePlan('pin-sign-in'); // complete here, never pushed

  it('sorts each directory by whether it can be compacted', () => {
    const later = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    const result = survey(root, config, { board: board(), now: later });
    const verdicts = Object.fromEntries(result.candidates.map((c) => [c.slug, c.verdict]));
    assert.deepEqual(verdicts, {
      'app-shell': 'ready',
      'design-kit': 'deferred-work',
      'old-idea': 'orphaned',
      'pin-sign-in': 'unmerged',
    });
    const shell = result.candidates.find((c) => c.slug === 'app-shell');
    assert.equal(shell.commit, git(root, 'rev-parse', 'HEAD').slice(0, 12));
    assert.equal(shell.milestone, 'M0');
    assert.equal(result.candidates.find((c) => c.slug === 'design-kit').deferred[0].title, 'Load icons from the CDN');
    assert.deepEqual(result.retirable.milestones.map((m) => m.id), ['M0']);
  });

  it('keeps a compacted feature done, and its dependent free, once its plan is gone', () => {
    const commit = git(root, 'log', '-1', '--format=%h', 'origin/main', '--', 'plans/app-shell');
    git(root, 'rm', '-r', '--quiet', 'plans/app-shell');
    writeText(
      join(root, 'plans', 'HISTORY.md'),
      `| Slug | Title | Status | Completed | Commit | Notes |\n| --- | --- | --- | --- | --- | --- |\n| \`app-shell\` | Tab shell | delivered | 2026-09-01 | ${commit} | |\n`,
    );
    git(root, 'add', 'plans/HISTORY.md');
    git(root, 'commit', '--quiet', '-m', 'compact history');
    git(root, 'push', '--quiet', 'origin', 'main');

    const after = board();
    assert.equal(after.find('app-shell').state, 'done');
    assert.equal(after.find('app-shell').claim.compacted, true);
    assert.match(after.whyNotAvailable('app-shell'), /compacted into the delivery history/);
    // Ignoring this checkout's unpushed plan, the row waiting on the compacted one is free.
    assert.equal(board({ pushedOnly: true }).find('pin-sign-in').state, 'available');

    const result = survey(root, config, { board: after });
    assert.deepEqual(result.problems, []);
    assert.equal(result.candidates.some((c) => c.slug === 'app-shell'), false);
    assert.deepEqual(historyFindings(root, config), []);
  });

  it('does not offer a question the history already holds for retirement again', () => {
    const committed = execFileSync('git', ['show', 'HEAD:plans/HISTORY.md'], { cwd: root, encoding: 'utf8' });
    writeText(join(root, 'plans', 'HISTORY.md'), `${committed}\n${HISTORY.slice(HISTORY.indexOf('## Settled questions'))}`);
    const register = Register.parse(
      `${BACKLOG}\n| Decision | Question | Status | Answer |\n| --- | --- | --- | --- |\n| D2 | Kept? | answered | Yes |\n`,
      HISTORY,
    );
    const result = survey(root, config, { board: Board.build(register, [], 'main') });
    assert.deepEqual(result.retirable.decisions.map((d) => d.id), ['D2']);
  });

  it('reports a history row whose commit cannot give its plan back', () => {
    writeText(
      join(root, 'plans', 'HISTORY.md'),
      `| Slug | Title | Status | Commit |\n| --- | --- | --- | --- |\n| \`app-shell\` | Tab shell | delivered | ${git(root, 'rev-parse', '--short', 'HEAD')} |\n`,
    );
    const result = survey(root, config);
    assert.match(result.problems[0].message, /does not hold plans\/app-shell/);
  });
});
