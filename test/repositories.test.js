import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { selectGroups } from '../dist/commands/check.js';
import { Board } from '../dist/core/board.js';
import { Claims } from '../dist/core/claims.js';
import { survey } from '../dist/core/history.js';
import { newPlan, readPlan, serializePlan, writePlan } from '../dist/core/plan.js';
import { Register } from '../dist/core/register.js';
import { Repository } from '../dist/core/repositories.js';
import { Findings, validatePlan, validateRepository } from '../dist/core/validate.js';
import { parseConfig, serializeConfig } from '../dist/config.js';
import { loadPacks } from '../dist/packs.js';
import { renderMemoryBlock } from '../dist/targets/memory.js';
import { readText, writeText } from '../dist/util/fs.js';

const scratch = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'collab-swarm-repos-'));
  scratch.push(dir);
  return dir;
};
after(() => scratch.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const CONFIG = `version: 1
project: Hub
plans: plans
backlog: backlog.md
checks:
  - { name: validate, run: "echo hub" }
git: { remote: origin, defaultBranch: main, branchPrefix: "feat/" }
repositories:
  api:
    path: repositories/api
    defaultBranch: develop
    checks:
      - { name: test, run: "echo api", focus: "echo api {path}" }
  web:
    path: repositories/web
    defaultBranch: develop
    checks:
      - { name: test, run: "echo web" }
`;

const BACKLOG = `# Hub

### M0 · Foundation

| Slug | Title | Owner | Size | Depends on | Repositories |
| --- | --- | --- | --- | --- | --- |
| \`sign-in\` | Sign in | Dev 1 | M | | \`api\` |
| \`profile\` | Profile | Dev 1 | S | \`sign-in\` | api, web |
`;

describe('repositories in the configuration', () => {
  it('round-trips, inheriting the remote and default branch it does not name', () => {
    const config = parseConfig(CONFIG);
    assert.equal(config.repositories.api.path, 'repositories/api');
    assert.equal(config.repositories.api.defaultBranch, 'develop');
    assert.equal(config.repositories.api.remote, 'origin');
    assert.equal(config.repositories.api.checks[0].focus, 'echo api {path}');
    assert.deepEqual(parseConfig(serializeConfig(config)), config);

    const inherited = parseConfig('version: 1\ngit: { defaultBranch: trunk }\nrepositories:\n  api: { path: api/ }\n');
    assert.equal(inherited.repositories.api.defaultBranch, 'trunk');
    assert.equal(inherited.repositories.api.path, 'api');
  });

  it('writes nothing for a single repository', () => {
    assert.equal(serializeConfig(parseConfig('version: 1\n')).includes('repositories'), false);
  });

  it('reads the backlog column naming where each row lands', () => {
    const register = Register.parse(BACKLOG);
    assert.deepEqual(register.row('sign-in').repositories, ['api']);
    assert.deepEqual(register.row('profile').repositories, ['api', 'web']);
  });

  it('keeps a plan without repositories exactly as it was', () => {
    const text = serializePlan(newPlan('demo', 'Demo', new Date('2026-10-01T00:00:00Z')));
    assert.equal(text.includes('repositories'), false);
    const withRepos = serializePlan(
      newPlan('demo', 'Demo', new Date('2026-10-01T00:00:00Z'), [{ name: 'api', baseSha: null }]),
    );
    assert.match(withRepos, /repositories:\n {2}api:\n {4}base_sha: null/);
  });
});

describe('a hub coordinating a submodule against real remotes', () => {
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
    }).trim();

  let hub;
  let api;
  let apiOrigin;
  let config;
  const claims = () => new Claims(hub, config.git, config.plans, config.repositories);
  const board = () =>
    Board.build(Register.parse(readText(join(hub, 'backlog.md'))), claims().read(), 'main');

  before(() => {
    const base = tempDir();
    apiOrigin = join(base, 'api.git');
    const hubOrigin = join(base, 'hub.git');
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
    git(hub, 'config', 'user.name', 'Ana');
    git(hub, 'config', 'user.email', 'ana@example.com');
    git(hub, 'remote', 'add', 'origin', hubOrigin);
    writeText(join(hub, 'collab-swarm.yml'), CONFIG);
    writeText(join(hub, 'backlog.md'), BACKLOG);
    git(hub, 'submodule', 'add', '--quiet', apiOrigin, 'repositories/api');
    git(hub, 'add', '-A');
    git(hub, 'commit', '--quiet', '-m', 'hub');
    git(hub, 'push', '--quiet', '-u', 'origin', 'main');

    api = join(hub, 'repositories', 'api');
    git(api, 'config', 'user.name', 'Ana');
    git(api, 'config', 'user.email', 'ana@example.com');
    // An uninitialised submodule: the directory exists, the checkout does not.
    mkdirSync(join(hub, 'repositories', 'web'), { recursive: true });
    config = parseConfig(CONFIG);
  });

  it('tells a checkout from an uninitialised submodule directory', () => {
    assert.equal(new Repository(hub, config.repositories.api).checkedOut, true);
    assert.equal(new Repository(hub, config.repositories.web).checkedOut, false);
  });

  it('claims in the hub and opens the same branch in each repository, leaving its checkout alone', () => {
    const develop = git(api, 'rev-parse', 'origin/develop');
    const result = claims().claim('sign-in', 'Sign in', { repositories: ['api'] });
    assert.equal(result.ok, true, result.message);
    assert.match(result.repositories.join(), /api: opened origin\/feat\/sign-in from develop/);

    assert.match(git(apiOrigin, 'branch', '--list', 'feat/sign-in'), /feat\/sign-in/);
    assert.equal(git(api, 'branch', '--show-current'), 'develop');

    const plan = readPlan(join(hub, 'plans', 'sign-in'));
    assert.deepEqual(plan.repositories, [{ name: 'api', baseSha: develop }]);
  });

  it('reports a branch with no commits as open, not merged', () => {
    const claim = claims().read().find((candidate) => candidate.slug === 'sign-in' && candidate.isPushed);
    assert.equal(claim.repositories[0].state, 'open');
    assert.equal(claim.repositories[0].detail, 'no commits yet');
  });

  it('counts the commits the default branch does not have yet', () => {
    git(api, 'switch', '--quiet', 'feat/sign-in');
    writeText(join(api, 'sign-in.txt'), 'sign in\n');
    git(api, 'add', '-A');
    git(api, 'commit', '--quiet', '-m', 'feat: sign in');
    git(api, 'push', '--quiet', 'origin', 'feat/sign-in');

    const claim = claims().read().find((candidate) => candidate.slug === 'sign-in' && candidate.isPushed);
    assert.equal(claim.repositories[0].state, 'open');
    assert.equal(claim.repositories[0].ahead, 1);
  });

  it('keeps a feature in progress while its plan is complete but its code is not merged', () => {
    const dir = join(hub, 'plans', 'sign-in');
    const plan = readPlan(dir);
    writePlan(dir, { ...plan, stage: 'complete', status: 'complete' });
    git(hub, 'add', '-A');
    git(hub, 'commit', '--quiet', '-m', 'complete sign-in');
    git(hub, 'push', '--quiet', 'origin', 'feat/sign-in');
    git(hub, 'switch', '--quiet', 'main');
    git(hub, 'merge', '--quiet', '--no-ff', '-m', 'Merge sign-in', 'feat/sign-in');
    git(hub, 'push', '--quiet', 'origin', 'main');

    const view = board();
    assert.equal(view.find('sign-in').state, 'in-progress');
    assert.equal(view.find('profile').state, 'blocked');
    assert.match(view.whyNotAvailable('sign-in'), /complete on origin\/main and waiting for its code to merge: api \(1 commit not yet in develop\)/);

    const held = survey(hub, config, { board: view }).candidates.find((candidate) => candidate.slug === 'sign-in');
    assert.equal(held.verdict, 'awaiting-code');
  });

  it('counts the feature done once its branch merges in the repository', () => {
    git(api, 'switch', '--quiet', 'develop');
    git(api, 'merge', '--quiet', '--no-ff', '-m', "Merge branch 'feat/sign-in' into 'develop'", 'origin/feat/sign-in');
    git(api, 'push', '--quiet', 'origin', 'develop');

    const view = board();
    assert.equal(view.find('sign-in').state, 'done');
    assert.equal(view.find('profile').state, 'available');
  });

  it('still counts it merged after the branch is deleted, from the merge commit', () => {
    git(api, 'push', '--quiet', 'origin', '--delete', 'feat/sign-in');
    const claim = claims().read().find((candidate) => candidate.slug === 'sign-in' && candidate.ref === 'origin/main');
    assert.equal(claim.repositories[0].state, 'merged');
    assert.match(claim.repositories[0].detail, /branch has since been deleted/);
    assert.equal(board().find('sign-in').state, 'done');
  });

  it('claims again with a repository on a feature branch, and records one it cannot reach without a base', () => {
    git(api, 'switch', '--quiet', '-c', 'scratch');
    const result = claims().claim('profile', 'Profile', { repositories: ['api', 'web'] });
    assert.equal(result.ok, true, result.message);
    assert.match(result.repositories.join('\n'), /web: repositories\/web is not checked out/);

    const plan = readPlan(join(hub, 'plans', 'profile'));
    assert.equal(plan.repositories.find((repository) => repository.name === 'web').baseSha, null);
    assert.notEqual(plan.repositories.find((repository) => repository.name === 'api').baseSha, null);

    const claim = claims().read().find((candidate) => candidate.slug === 'profile' && candidate.isPushed);
    assert.equal(claim.repositories.find((repository) => repository.name === 'web').state, 'unavailable');
  });

  it('opens an existing branch again without moving it', () => {
    const repository = new Repository(hub, config.repositories.api);
    const first = git(api, 'rev-parse', 'origin/feat/profile');
    const again = repository.open('feat/profile');
    assert.equal(again.ok, true);
    assert.equal(again.created, false);
    assert.equal(git(api, 'rev-parse', 'origin/feat/profile'), first);
  });
});

describe('checks across repositories', () => {
  const root = '/work/hub';
  const config = parseConfig(CONFIG);

  it('sends a focus path to the repository holding it, relative to that repository', () => {
    const { groups, focus } = selectGroups(root, config, {
      focus: 'repositories/api/tests/SignInTest.php',
      cwd: root,
    });
    assert.deepEqual(groups.map((group) => group.repository), ['api']);
    assert.equal(focus, 'tests/SignInTest.php');
  });

  it('reads a focus path relative to the named repository', () => {
    const { groups, focus } = selectGroups(root, config, { repos: ['api'], focus: 'tests/SignInTest.php', cwd: root });
    assert.deepEqual(groups.map((group) => group.repository), ['api']);
    assert.equal(focus, 'tests/SignInTest.php');
  });

  it('keeps a hub path for the hub, and runs every group without one', () => {
    assert.deepEqual(
      selectGroups(root, config, { focus: 'plans/x', cwd: root }).groups.map((group) => group.repository),
      [null],
    );
    assert.deepEqual(
      selectGroups(root, config, { cwd: root }).groups.map((group) => group.repository),
      [null, 'api', 'web'],
    );
  });

  it('refuses a repository nobody configured', () => {
    assert.throws(() => selectGroups(root, config, { repos: ['mobile'], cwd: root }), /Unknown repository "mobile"/);
  });
});

describe('validating a hub', () => {
  const packs = loadPacks(process.cwd(), []);
  const config = parseConfig(CONFIG);
  const section = (names) => names.map((name) => `## ${name}\n\nWritten.\n`).join('\n');
  const REQUIREMENTS = ['Description', 'Sources', 'Scope', 'User stories', 'Acceptance criteria', 'Interfaces', 'Data and integrations', 'Quality constraints', 'Constraints and open questions'];
  const SPECIFICATION = ['Approach', 'Architecture and domain', 'Data and integrations', 'State and lifecycle', 'Failure behaviour', 'Interface and interaction', 'Security, observability, and performance', 'Test plan', 'Compatibility, migration, and rollback', 'Risks and open questions'];
  const TICKET = section(['Outcome', 'Requirements', 'Implementation', 'Tests', 'Done when']);

  const plan = (repositories, over = {}) => {
    const dir = join(tempDir(), 'demo');
    writeText(join(dir, 'plan.yml'), serializePlan({ ...newPlan('demo', 'Demo', new Date(), repositories), ...over }));
    writeText(join(dir, 'requirements.md'), section(REQUIREMENTS));
    writeText(join(dir, 'specification.md'), section(SPECIFICATION));
    return dir;
  };
  const ticket = (dir, slug, front) =>
    writeText(join(dir, 'tickets', `${slug}.md`), `---\ntitle: ${slug}\nstatus: planned\ndepends_on: []\nskills: [tdd]\n${front}---\n\n${TICKET}`);
  const errors = (dir) => {
    const findings = new Findings(dir);
    validatePlan(dir, packs, findings, { repositories: config.repositories });
    return findings.errors.map((finding) => finding.message).join('\n');
  };

  it('asks each ticket of a plan spanning repositories where it is built', () => {
    const dir = plan([{ name: 'api', baseSha: null }, { name: 'web', baseSha: null }], { stage: 'tickets', status: 'ready' });
    ticket(dir, 'one', 'repository: api\n');
    ticket(dir, 'two', '');
    ticket(dir, 'three', 'repository: mobile\n');
    const found = errors(dir);
    assert.doesNotMatch(found, /one\.md/);
    assert.match(found, /the plan spans api, web; name the one this ticket is built in/);
    assert.match(found, /names repository "mobile", which the plan does not list/);
  });

  it('needs no repository on a ticket when the plan has one', () => {
    const dir = plan([{ name: 'api', baseSha: null }], { stage: 'tickets', status: 'ready' });
    ticket(dir, 'one', '');
    assert.equal(errors(dir), '');
  });

  it('rejects a repository the configuration does not list, and a missing base once implementing', () => {
    const dir = plan([{ name: 'mobile', baseSha: null }], { stage: 'implementation', implementationBaseSha: 'abcdef1' });
    ticket(dir, 'one', '');
    const found = errors(dir);
    assert.match(found, /repository "mobile" is not under repositories:/);
    assert.match(found, /repositories\.mobile\.base_sha is required from the implementation stage onward/);
  });

  it('rejects a backlog row naming a repository nobody configured', () => {
    const root = tempDir();
    writeText(join(root, 'backlog.md'), BACKLOG.replace('api, web', 'api, mobile'));
    const findings = validateRepository(root, config, packs);
    assert.match(findings.errors.map((finding) => finding.message).join(), /row "profile" names repository "mobile"/);
  });

  it('tells every agent where the code lives and how a feature reaches it', () => {
    const block = renderMemoryBlock({ config, packs, root: '/', workflow: [], skills: [], rules: [], version: '0' }, '.claude/workflow');
    assert.match(block, /## Code repositories/);
    assert.match(block, /\| `api` \| `repositories\/api` \| `develop` \| test \|/);
    assert.match(block, /once the same branch has also merged in every code repository the plan names/);
  });
});
