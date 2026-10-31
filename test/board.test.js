import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

import { Claims } from '../dist/core/claims.js';
import { parseConfig } from '../dist/config.js';
import { writeText } from '../dist/util/fs.js';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js');

const scratch = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'collab-swarm-board-'));
  scratch.push(dir);
  return dir;
};
after(() => scratch.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const env = {
  ...process.env,
  NO_COLOR: '1',
  GIT_AUTHOR_NAME: 'Ana',
  GIT_AUTHOR_EMAIL: 'ana@example.com',
  GIT_COMMITTER_NAME: 'Ana',
  GIT_COMMITTER_EMAIL: 'ana@example.com',
};
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env }).trim();
const swarm = (cwd, ...args) => {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, all: `${result.stdout}${result.stderr}` };
};

const CONFIG = `version: 1
project: Demo
plans: plans
backlog: backlog.md
checks:
  - { name: test, run: "echo ok" }
git: { remote: origin, defaultBranch: main, branchPrefix: "feat/" }
repositories:
  api:
    path: repositories/api
    defaultBranch: main
`;

const backlog = (rows) => `# Demo

### M0 · Foundation

| Slug | Title | Owner | Size | Depends on |
| --- | --- | --- | --- | --- |
${rows.map((slug) => `| \`${slug}\` | ${slug.replace(/-/g, ' ')} | Dev 1 | S | |`).join('\n')}
`;

describe('the board in a checkout behind the default branch', () => {
  let origin;
  let current;
  let stale;

  before(() => {
    const base = tempDir();
    origin = join(base, 'origin.git');
    current = join(base, 'current');
    stale = join(base, 'stale');
    git(base, 'init', '--quiet', '--bare', '--initial-branch=main', origin);
    git(base, 'init', '--quiet', '--initial-branch=main', current);
    git(current, 'remote', 'add', 'origin', origin);
    writeText(join(current, 'collab-swarm.yml'), CONFIG);
    writeText(join(current, 'backlog.md'), backlog(['old-row', 'kept-row']));
    git(current, 'add', '-A');
    git(current, 'commit', '--quiet', '-m', 'Plan the work');
    git(current, 'push', '--quiet', '-u', 'origin', 'main');

    git(base, 'clone', '--quiet', origin, stale);

    // The project is restructured: one row retired, one added.
    writeText(join(current, 'backlog.md'), backlog(['kept-row', 'new-row']));
    git(current, 'commit', '--quiet', '-am', 'Restructure the backlog');
    git(current, 'push', '--quiet');
    git(stale, 'fetch', '--quiet', 'origin');
  });

  it('reads the backlog from the default branch, not the stale working tree', () => {
    const result = swarm(stale, 'status', '--json');
    assert.equal(result.code, 0, result.all);
    const board = JSON.parse(result.stdout);
    assert.deepEqual(board.rows.map((row) => row.slug), ['kept-row', 'new-row']);
    assert.equal(board.source.ref, 'origin/main');
    assert.equal(board.source.behind, 1);
    assert.deepEqual(board.fetchFailures, []);
  });

  it('says the checkout is behind, near the top of status and next', () => {
    for (const command of ['status', 'next']) {
      const result = swarm(stale, command);
      assert.equal(result.code, 0, result.all);
      const lines = result.stdout.split('\n').filter((line) => line.trim() !== '');
      assert.match(lines[0], /This checkout is 1 commit behind origin\/main; the board reads origin\/main\./);
    }
    assert.doesNotMatch(swarm(current, 'status').stdout, /behind/);
  });

  it('refuses to claim a row only the stale backlog still has', () => {
    const result = swarm(stale, 'claim', 'old-row');
    assert.equal(result.code, 1, result.all);
    assert.match(result.all, /"old-row" is not in the feature register/);
    assert.equal(git(stale, 'ls-remote', '--heads', 'origin', 'feat/old-row'), '');
  });

  it('warns in doctor, with the fast-forward that fixes it', () => {
    const result = swarm(stale, 'doctor');
    assert.match(result.stdout, /! This checkout is 1 commit behind origin\/main/);
    assert.match(result.stdout, /git merge --ff-only origin\/main/);
    assert.doesNotMatch(swarm(current, 'doctor').stdout, /behind origin\/main/);
  });

  it('keeps the default branch backlog while this checkout drafts edits, and says so', () => {
    writeText(join(current, 'backlog.md'), backlog(['kept-row', 'new-row', 'drafted-row']));
    try {
      const json = JSON.parse(swarm(current, 'status', '--json').stdout);
      assert.deepEqual(json.rows.map((row) => row.slug), ['kept-row', 'new-row']);
      assert.equal(json.source.backlogDiffers, true);
      assert.equal(json.source.behind, 0);
      assert.match(swarm(current, 'status').stdout, /This checkout's backlog\.md differs from origin\/main's; the board reads origin\/main's\./);
      assert.match(swarm(current, 'status').stdout, /--working-tree/);

      // Whoever drafts it checks the draft the way the board will read it once merged.
      const draft = JSON.parse(swarm(current, 'status', '--json', '--working-tree').stdout);
      assert.deepEqual(draft.rows.map((row) => row.slug), ['kept-row', 'new-row', 'drafted-row']);
      assert.equal(draft.source.ref, null);
      assert.equal(draft.source.workingTree, true);
      assert.equal(draft.source.backlogDiffers, false);
      const text = swarm(current, 'next', '--working-tree');
      assert.match(text.stdout.split('\n').find((line) => line.trim() !== ''), /reads this checkout's backlog\.md/);
      assert.match(text.stdout, /drafted-row/);

      // A claim is cut from the default branch, so it never reads a draft.
      const claim = swarm(current, 'claim', 'drafted-row', '--working-tree');
      assert.equal(claim.code, 1, claim.all);
      assert.match(claim.all, /"drafted-row" is not in the feature register/);
    } finally {
      git(current, 'checkout', '--quiet', '--', 'backlog.md');
    }
    assert.equal(JSON.parse(swarm(current, 'status', '--json').stdout).source.backlogDiffers, false);
  });

  it('reads the working tree when there is no remote branch to read', () => {
    const lone = tempDir();
    git(lone, 'init', '--quiet', '--initial-branch=main');
    writeText(join(lone, 'collab-swarm.yml'), CONFIG.replace(/repositories:[\s\S]*/, ''));
    writeText(join(lone, 'backlog.md'), backlog(['only-here']));
    const json = JSON.parse(swarm(lone, 'status', '--json').stdout);
    assert.deepEqual(json.rows.map((row) => row.slug), ['only-here']);
    assert.equal(json.source.ref, null);
    assert.equal(json.source.behind, 0);
  });

  describe('when the fetch fails', () => {
    let lastFetch;
    before(() => {
      git(stale, 'fetch', '--quiet', 'origin');
      lastFetch = statSync(join(stale, '.git', 'FETCH_HEAD')).mtime;
      // Fetching from a remote that is gone fails; pushing still reaches the real one.
      git(stale, 'remote', 'set-url', 'origin', join(dirname(origin), 'gone.git'));
      git(stale, 'remote', 'set-url', '--push', 'origin', origin);
      // A code repository checked out here whose remote cannot be reached either.
      const api = join(stale, 'repositories', 'api');
      git(stale, 'init', '--quiet', '--initial-branch=main', api);
      git(api, 'remote', 'add', 'origin', join(dirname(origin), 'api-gone.git'));
    });

    it('says the board is as of the last fetch, naming each repository that failed', () => {
      const result = swarm(stale, 'status');
      assert.equal(result.code, 0, result.all);
      assert.match(
        result.stdout,
        /Could not fetch origin; the board is as of the last fetch \(\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\)\./,
      );
      assert.match(result.stdout, /Could not fetch api \(origin\); its merge state is as of the last fetch/);

      const json = JSON.parse(swarm(stale, 'next', '--json').stdout);
      assert.deepEqual(
        json.fetchFailures.map((failure) => [failure.repository, failure.remote]),
        [
          [null, 'origin'],
          ['api', 'origin'],
        ],
      );
      // The failed fetches before this one did not overwrite when the last one succeeded.
      assert.equal(json.fetchFailures[0].lastFetchedAt, lastFetch.toISOString());
      assert.equal(json.fetchFailures[1].lastFetchedAt, null);
      assert.ok(json.notices.some((notice) => notice.startsWith('Could not fetch origin')));
    });

    it('says nothing about fetching when asked not to fetch', () => {
      const json = JSON.parse(swarm(stale, 'status', '--json', '--no-fetch').stdout);
      assert.deepEqual(json.fetchFailures, []);
    });

    it('refuses a claim it cannot check, unless --no-fetch was passed', () => {
      const refused = swarm(stale, 'claim', 'new-row');
      assert.equal(refused.code, 1, refused.all);
      assert.match(refused.all, /Could not fetch origin, so there is no way to check whether someone else holds "new-row"/);
      assert.match(refused.all, /--no-fetch/);
      assert.equal(git(stale, 'ls-remote', '--heads', origin, 'feat/new-row'), '');
      const config = parseConfig(CONFIG);
      const direct = new Claims(stale, config.git, config.plans).claim('new-row', 'New row');
      assert.equal(direct.ok, false);
      assert.match(direct.message, /no way to check whether someone else holds "new-row"/);

      // The claim branch is cut from origin/main, so the stale working tree must not block it.
      const claimed = swarm(stale, 'claim', 'new-row', '--no-fetch');
      assert.equal(claimed.code, 0, claimed.all);
      assert.notEqual(git(stale, 'ls-remote', '--heads', origin, 'feat/new-row'), '');
    });
  });
});
