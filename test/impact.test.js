import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { Board } from '../dist/core/board.js';
import { Claims } from '../dist/core/claims.js';
import { Git } from '../dist/core/git.js';
import { answers, citations, impactOf, outline, sourceImpact } from '../dist/core/impact.js';
import { newPlan, readPlan, serializePlan } from '../dist/core/plan.js';
import { Register } from '../dist/core/register.js';
import { Findings, planDrift, validatePlan } from '../dist/core/validate.js';
import { parseConfig } from '../dist/config.js';
import { loadPacks } from '../dist/packs.js';
import { readText, remove, writeText } from '../dist/util/fs.js';

const scratch = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'collab-swarm-impact-'));
  scratch.push(dir);
  return dir;
};
after(() => scratch.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const PATHS = [
  'docs/prd/PRD-01-Auth.md',
  'docs/prd/PRD-02-Rewards.md',
  'docs/brd/BRD-02-Rewards.md',
  'docs/design/index.md',
];

describe('citations', () => {
  it('finds a document by path, file name or document id, and the sections named after it', () => {
    const found = citations('docs/prd/PRD-01-Auth.md §2, §3.1; PRD 2 #earning-points, "Redeem"', PATHS);
    assert.deepEqual(
      found.map((citation) => [citation.path, citation.anchors.map((anchor) => `${anchor.kind}:${anchor.value}`)]),
      [
        ['docs/prd/PRD-01-Auth.md', ['number:2', 'number:3.1']],
        ['docs/prd/PRD-02-Rewards.md', ['slug:earning-points', 'text:Redeem']],
      ],
    );
  });

  it('lets the longest name win, so one document id never captures another file', () => {
    const found = citations('PRD-02-Rewards.md and BRD-02-Rewards.md', PATHS);
    assert.deepEqual(found.map((citation) => citation.path).sort(), ['docs/brd/BRD-02-Rewards.md', 'docs/prd/PRD-02-Rewards.md']);
  });

  it('cites the whole document when any mention names no section', () => {
    assert.deepEqual(citations('PRD-01 §2, then PRD-01 throughout', PATHS)[0].anchors, []);
  });

  it('never takes a bare word for a document, nor PRD-1 for PRD-12', () => {
    assert.deepEqual(citations('see the design index; PRD-12 §1', PATHS), []);
  });
});

describe('headings', () => {
  it('records the heading trail in force at each line, ignoring fenced code', () => {
    const shape = outline('intro\n# Rewards\n## 2. Earning\ntext\n```\n# not a heading\n```\n## 3. Redeem\n');
    assert.deepEqual(shape.headings, ['Rewards', '2. Earning', '3. Redeem']);
    assert.deepEqual(shape.trails[1], []);
    assert.deepEqual(shape.trails[4], ['Rewards', '2. Earning']);
    assert.deepEqual(shape.trails[6], ['Rewards', '2. Earning']);
    assert.deepEqual(shape.trails[8], ['Rewards', '3. Redeem']);
  });

  it('answers a section number, an anchor, or a quoted phrase', () => {
    assert.ok(answers('2. Earning points', { kind: 'number', value: '2' }));
    assert.ok(answers('§2.1 Expiry', { kind: 'number', value: '2.1' }));
    assert.ok(!answers('12. Limits', { kind: 'number', value: '2' }));
    assert.ok(!answers('2.1 Expiry', { kind: 'number', value: '2.10' }));
    assert.ok(answers('Earning points!', { kind: 'slug', value: 'earning-points' }));
    assert.ok(answers('Redeem a voucher', { kind: 'text', value: 'redeem' }));
  });

  it('tells a cited section that changed from a cited document changed elsewhere', () => {
    const change = {
      path: 'docs/prd/PRD-02-Rewards.md',
      previousPath: null,
      kind: 'modified',
      source: 'product',
      sections: ['2. Earning'],
      regions: [['Rewards', '2. Earning']],
      headings: ['Rewards', '2. Earning', '3. Redeem'],
    };
    const [cited] = impactOf('PRD-02 §2', [change], PATHS);
    assert.equal(cited.reach, 'cited');
    assert.deepEqual(cited.sections, ['2. Earning']);
    assert.equal(impactOf('PRD-02 §3', [change], PATHS)[0].reach, 'elsewhere');
    const [moved] = impactOf('PRD-02 §4', [change], PATHS);
    assert.equal(moved.reach, 'cited');
    assert.deepEqual(moved.missing, ['§4']);
    assert.deepEqual(impactOf('PRD-01 §2', [change], PATHS), []);
  });
});

describe('impact against a real history', () => {
  const env = {
    GIT_AUTHOR_NAME: 'Ana',
    GIT_AUTHOR_EMAIL: 'ana@example.com',
    GIT_COMMITTER_NAME: 'Ana',
    GIT_COMMITTER_EMAIL: 'ana@example.com',
  };
  const git = (cwd, ...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } }).trim();

  const config = parseConfig(`version: 1
project: Demo
plans: plans
backlog: backlog.md
sources:
  product: { label: PRDs, paths: ["docs/prd/*.md"] }
  business: { label: BRDs, paths: ["docs/brd/*.md"] }
  decisions: { label: Decisions, paths: ["docs/decisions.md"] }
git: { remote: origin, defaultBranch: main, branchPrefix: "feat/" }
`);

  const PRD = `# Rewards

## 1. Overview

Points reward attendance.

## 2. Earning

One point per session.

## 3. Redeem

Points buy vouchers.
`;

  const BACKLOG = `# Demo delivery plan

### M0 · Foundation

| Slug | Title | Sources | Owner | Size | Depends on |
| --- | --- | --- | --- | --- | --- |
| \`overview\` | Rewards overview | PRD-02 §1 | Dev 1 | S | |
| \`earn-points\` | Earn points | PRD-02 §2 | Dev 1 | M | |
| \`redeem\` | Redeem points | docs/prd/PRD-02-Rewards.md §3 | Dev 2 | M | |
| \`sign-in\` | Sign in | PRD-01 | Dev 2 | M | |
`;

  let root;
  let origin;
  const claims = () => new Claims(root, config.git, config.plans);
  const board = () => Board.build(Register.parse(readText(join(root, 'backlog.md'))), claims().read(), 'main');
  const report = (since) => sourceImpact(new Git(root), root, config, board(), { since });

  before(() => {
    const base = tempDir();
    origin = join(base, 'origin.git');
    root = join(base, 'work');
    git(base, 'init', '--quiet', '--bare', '--initial-branch=main', origin);
    git(base, 'init', '--quiet', '--initial-branch=main', root);
    git(root, 'remote', 'add', 'origin', origin);
    writeText(join(root, 'docs/prd/PRD-01-Auth.md'), '# Auth\n\n## 1. Sign in\n\nA PIN.\n');
    writeText(join(root, 'docs/prd/PRD-02-Rewards.md'), PRD);
    writeText(join(root, 'docs/decisions.md'), '| Decision | Question |\n| --- | --- |\n| D1 | ? |\n');
    writeText(join(root, 'backlog.md'), BACKLOG);
    // `overview` shipped before anything else moved.
    writeText(
      join(root, 'plans/overview/plan.yml'),
      serializePlan({ ...newPlan('overview', 'Rewards overview'), stage: 'complete', status: 'complete', implementationBaseSha: '1a2b3c4d' }),
    );
    git(root, 'add', '-A');
    git(root, 'commit', '--quiet', '-m', 'Plan the rewards');
    git(root, 'push', '--quiet', '-u', 'origin', 'main');

    // Ana claims `earn-points` and writes its requirements from §2.
    const claimed = claims().claim('earn-points', 'Earn points', { fetch: false });
    assert.ok(claimed.ok, claimed.message);
    writeText(
      join(root, 'plans/earn-points/requirements.md'),
      '# Earn points\n\n## Sources\n\n| Source | Path and heading | Taken |\n| --- | --- | --- |\n| PRD | docs/prd/PRD-02-Rewards.md §2 Earning | the rate |\n',
    );
    git(root, 'add', '-A');
    git(root, 'commit', '--quiet', '-m', 'Requirements');
    git(root, 'push', '--quiet');
    git(root, 'switch', '--quiet', 'main');
  });

  it('records where a claim starts as the sources its plan is written from', () => {
    const plan = readPlan(join(root, 'plans/earn-points'));
    assert.equal(plan, null, 'the plan lives on the claim branch, not on main');
    const text = git(root, 'show', 'origin/feat/earn-points:plans/earn-points/plan.yml');
    const main = git(root, 'rev-parse', 'origin/main');
    assert.match(text, new RegExp(`sources_sha: ${main}`));
  });

  it('reports nothing while the sources match the delivery plan', () => {
    const result = report(null);
    assert.equal(result.base.reason, 'backlog');
    assert.deepEqual(result.changes, []);
    assert.deepEqual(result.rows, []);
    assert.deepEqual(result.plans.map((plan) => [plan.slug, plan.state]), [['earn-points', 'current']]);
  });

  it('sorts the rows a working-tree change reaches by what each has already done', () => {
    writeText(
      join(root, 'docs/prd/PRD-02-Rewards.md'),
      PRD.replace('Points reward attendance.', 'Points reward attendance and quizzes.').replace(
        'One point per session.',
        'Two points per session.',
      ),
    );
    remove(join(root, 'docs/prd/PRD-01-Auth.md'));
    writeText(join(root, 'docs/brd/BRD-03-Quizzes.md'), '# Quizzes\n');
    writeText(join(root, 'docs/decisions.md'), '| Decision | Question |\n| --- | --- |\n| D1 | answered |\n');
    try {
      const result = report(null);
      assert.deepEqual(
        result.changes.map((change) => [change.path, change.kind, change.sections]),
        [
          ['docs/brd/BRD-03-Quizzes.md', 'added', []],
          ['docs/prd/PRD-01-Auth.md', 'deleted', []],
          ['docs/prd/PRD-02-Rewards.md', 'modified', ['1. Overview', '2. Earning']],
        ],
      );
      const rows = Object.fromEntries(
        result.rows.map((row) => [row.slug, [row.state, row.effects.map((effect) => `${effect.reach}:${effect.sections.join('|')}`)]]),
      );
      assert.deepEqual(rows, {
        overview: ['done', ['cited:1. Overview']],
        'earn-points': ['in-progress', ['cited:2. Earning']],
        redeem: ['available', ['elsewhere:1. Overview|2. Earning']],
        'sign-in': ['available', ['removed:']],
      });
      assert.equal(result.rows.find((row) => row.slug === 'earn-points').holder, 'Ana');
      assert.deepEqual(result.uncited.map((change) => change.path), ['docs/brd/BRD-03-Quizzes.md']);
    } finally {
      git(root, 'checkout', '--quiet', '--', '.');
      remove(join(root, 'docs/brd'));
    }
  });

  it('finds the plans written from sources the default branch has since changed', () => {
    const before = git(root, 'rev-parse', 'HEAD');
    writeText(join(root, 'docs/prd/PRD-02-Rewards.md'), PRD.replace('Points buy vouchers.', 'Points buy vouchers and merchandise.'));
    git(root, 'commit', '--quiet', '-am', 'Redeem for merchandise');
    git(root, 'push', '--quiet');
    assert.deepEqual(report(null).plans.map((plan) => [plan.slug, plan.state]), [['earn-points', 'current']]);

    writeText(join(root, 'docs/prd/PRD-02-Rewards.md'), readText(join(root, 'docs/prd/PRD-02-Rewards.md')).replace('One point', 'Three points'));
    git(root, 'commit', '--quiet', '-am', 'Earn faster');
    git(root, 'push', '--quiet');
    const result = report(before);
    assert.equal(result.base.reason, 'since');
    const [plan] = result.plans;
    assert.equal(plan.state, 'drifted');
    assert.deepEqual(plan.effects.map((effect) => [effect.reach, effect.sections]), [['cited', ['2. Earning']]]);
    assert.deepEqual(
      result.rows.map((row) => [row.slug, row.effects[0].reach]),
      [
        ['overview', 'elsewhere'],
        ['earn-points', 'cited'],
        ['redeem', 'cited'],
      ],
    );
  });

  it('warns in validation about a plan here whose sources moved, or that never recorded them', () => {
    const packs = loadPacks(process.cwd(), []);
    const findings = new Findings(root);
    const drift = planDrift(root, config);
    git(root, 'switch', '--quiet', 'feat/earn-points');
    try {
      validatePlan(join(root, 'plans/earn-points'), packs, findings, { drift });
      const messages = findings.warnings.map((finding) => finding.message).join('\n');
      assert.match(messages, /sources this plan cites changed on origin\/main since sources_sha [0-9a-f]{12}: docs\/prd\/PRD-02-Rewards.md \(2\. Earning\)/);

      const plan = readPlan(join(root, 'plans/earn-points'));
      writeText(join(root, 'plans/earn-points/plan.yml'), serializePlan({ ...plan, sourcesSha: null }));
      const unrecorded = new Findings(root);
      validatePlan(join(root, 'plans/earn-points'), packs, unrecorded, { drift });
      assert.match(unrecorded.warnings.map((finding) => finding.message).join('\n'), /sources_sha is not recorded/);

      writeText(join(root, 'plans/earn-points/plan.yml'), serializePlan({ ...plan, sourcesSha: 'not-a-sha' }));
      const malformed = new Findings(root);
      validatePlan(join(root, 'plans/earn-points'), packs, malformed, { drift });
      assert.match(malformed.errors.map((finding) => finding.message).join('\n'), /sources_sha is not a Git SHA/);
    } finally {
      git(root, 'checkout', '--quiet', '--', '.');
      git(root, 'switch', '--quiet', 'main');
    }
  });

  it('refuses a --since that names no commit', () => {
    assert.throws(() => report('no-such-ref'), /"no-such-ref" is not a commit/);
  });
});
