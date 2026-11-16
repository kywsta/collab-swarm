import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import { parseConfig } from '../dist/config.js';
import { pullRepository, pullRoot } from '../dist/core/pull.js';
import { writeText } from '../dist/util/fs.js';

const scratch = [];
after(() => scratch.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const env = {
  GIT_AUTHOR_NAME: 'Ana',
  GIT_AUTHOR_EMAIL: 'ana@example.com',
  GIT_COMMITTER_NAME: 'Ana',
  GIT_COMMITTER_EMAIL: 'ana@example.com',
};
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'protocol.file.allow=always', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

const CONFIG = `version: 1
project: Hub
plans: plans
backlog: backlog.md
git: { remote: origin, defaultBranch: main, branchPrefix: "feat/" }
repositories:
  api:
    path: repositories/api
    defaultBranch: develop
  web:
    path: repositories/web
    defaultBranch: develop
`;

/** A commit pushed to a remote's branch by somebody else, from a clone of their own. */
const pushElsewhere = (base, origin, branch, file) => {
  const other = mkdtempSync(join(base, 'other-'));
  git(base, 'clone', '--quiet', '--branch', branch, origin, other);
  writeText(join(other, file), `${file}\n`);
  git(other, 'add', '-A');
  git(other, 'commit', '--quiet', '-m', `add ${file}`);
  git(other, 'push', '--quiet', 'origin', branch);
};

describe('pulling a hub and its code repositories', () => {
  let base;
  let hub;
  let hubOrigin;
  let api;
  let apiOrigin;
  const config = parseConfig(CONFIG);
  const head = (cwd) => git(cwd, 'rev-parse', 'HEAD');

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'collab-swarm-pull-'));
    scratch.push(base);
    apiOrigin = join(base, 'api.git');
    hubOrigin = join(base, 'hub.git');
    git(base, 'init', '--quiet', '--bare', '--initial-branch=develop', apiOrigin);
    git(base, 'init', '--quiet', '--bare', '--initial-branch=main', hubOrigin);

    const seed = join(base, 'api-seed');
    git(base, 'clone', '--quiet', apiOrigin, seed);
    git(seed, 'switch', '--quiet', '-c', 'develop');
    writeText(join(seed, 'README.md'), '# API\n');
    git(seed, 'add', '-A');
    git(seed, 'commit', '--quiet', '-m', 'init');
    git(seed, 'push', '--quiet', 'origin', 'develop');

    hub = join(base, 'hub');
    mkdirSync(hub);
    git(hub, 'init', '--quiet', '--initial-branch=main');
    git(hub, 'remote', 'add', 'origin', hubOrigin);
    writeText(join(hub, 'collab-swarm.yml'), CONFIG);
    writeText(join(hub, 'backlog.md'), '# Hub\n');
    git(hub, 'submodule', 'add', '--quiet', apiOrigin, 'repositories/api');
    git(hub, 'add', '-A');
    git(hub, 'commit', '--quiet', '-m', 'hub');
    git(hub, 'push', '--quiet', '-u', 'origin', 'main');
    api = join(hub, 'repositories', 'api');
    // As `git submodule update` leaves it: detached at the commit the hub records.
    git(api, 'switch', '--quiet', '--detach', 'HEAD');
    git(api, 'branch', '--quiet', '-D', 'develop');
    mkdirSync(join(hub, 'repositories', 'web'), { recursive: true });
  });

  it('fast-forwards the hub on its default branch', () => {
    pushElsewhere(base, hubOrigin, 'main', 'backlog-update.md');
    const outcome = pullRoot(hub, 'origin', 'main');
    assert.equal(outcome.state, 'updated');
    assert.equal(outcome.commits, 1);
    assert.equal(head(hub), git(hub, 'rev-parse', 'origin/main'));
  });

  it('says a current checkout is current', () => {
    assert.equal(pullRoot(hub, 'origin', 'main').state, 'current');
  });

  it('puts a detached submodule on its default branch at the remote tip', () => {
    pushElsewhere(base, apiOrigin, 'develop', 'routes.php');
    const outcome = pullRepository(hub, config.repositories.api);
    assert.equal(outcome.state, 'updated');
    assert.equal(outcome.branch, 'develop');
    assert.equal(outcome.commits, 1);
    assert.equal(head(api), git(api, 'rev-parse', 'origin/develop'));
  });

  it('leaves a feature branch checked out, and moves only the default branch beside it', () => {
    git(hub, 'switch', '--quiet', '-c', 'feat/guest-home');
    pushElsewhere(base, hubOrigin, 'main', 'backlog-update.md');
    const before = head(hub);
    const outcome = pullRoot(hub, 'origin', 'main');
    assert.equal(outcome.state, 'kept');
    assert.equal(outcome.branch, 'feat/guest-home');
    assert.match(outcome.detail, /moved its main to origin\/main/);
    assert.equal(head(hub), before);
    assert.equal(git(hub, 'rev-parse', 'main'), git(hub, 'rev-parse', 'origin/main'));
  });

  it('leaves uncommitted changes alone', () => {
    pushElsewhere(base, hubOrigin, 'main', 'backlog-update.md');
    writeText(join(hub, 'backlog.md'), '# Hub, being edited\n');
    const before = head(hub);
    const outcome = pullRoot(hub, 'origin', 'main');
    assert.equal(outcome.state, 'kept');
    assert.match(outcome.detail, /uncommitted changes/);
    assert.equal(head(hub), before);
  });

  it('leaves a default branch with commits of its own alone', () => {
    pushElsewhere(base, hubOrigin, 'main', 'backlog-update.md');
    writeText(join(hub, 'notes.md'), 'local\n');
    git(hub, 'add', '-A');
    git(hub, 'commit', '--quiet', '-m', 'local');
    const before = head(hub);
    const outcome = pullRoot(hub, 'origin', 'main');
    assert.equal(outcome.state, 'kept');
    assert.match(outcome.detail, /1 commit origin\/main does not/);
    assert.equal(head(hub), before);
  });

  it('leaves a submodule detached on commits its default branch lacks', () => {
    writeText(join(api, 'wip.php'), '<?php\n');
    git(api, 'add', '-A');
    git(api, 'commit', '--quiet', '-m', 'wip');
    const before = head(api);
    const outcome = pullRepository(hub, config.repositories.api);
    assert.equal(outcome.state, 'kept');
    assert.equal(head(api), before);
  });

  it('does not move a default branch another worktree has checked out', () => {
    git(hub, 'switch', '--quiet', '-c', 'feat/guest-home');
    const other = join(base, 'hub-main');
    git(hub, 'worktree', 'add', '--quiet', other, 'main');
    pushElsewhere(base, hubOrigin, 'main', 'backlog-update.md');
    const before = git(hub, 'rev-parse', 'main');
    const outcome = pullRoot(hub, 'origin', 'main');
    assert.equal(outcome.state, 'kept');
    assert.match(outcome.detail, /checked out in another worktree/);
    assert.equal(git(hub, 'rev-parse', 'main'), before);
  });

  it('names a repository that is not checked out, with the command that fixes it', () => {
    const outcome = pullRepository(hub, config.repositories.web);
    assert.equal(outcome.state, 'unavailable');
    assert.match(outcome.detail, /git submodule update --init repositories\/web/);
  });
});
