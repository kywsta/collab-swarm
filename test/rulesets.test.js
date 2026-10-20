import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';

import { parseConfig } from '../dist/config.js';
import {
  drift,
  fingerprint,
  majorOf,
  ruleSetStatus,
  scopeRule,
  scopes,
  writeResearch,
} from '../dist/core/rulesets.js';
import { validateRepository } from '../dist/core/validate.js';
import { planSync } from '../dist/sync.js';
import { writeText } from '../dist/util/fs.js';
import { loadWorkspace } from '../dist/workspace.js';

const scratch = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'collab-swarm-rules-'));
  scratch.push(dir);
  return dir;
};
after(() => scratch.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const EXAMPLE = resolve('examples/pack-example');

const hubConfig = (extra = '') =>
  parseConfig(`version: 1
project: Hub
targets: [claude, cursor]
plans: plans
git: { remote: origin, defaultBranch: main, branchPrefix: "feat/" }
repositories:
  api:
    path: repositories/api
    defaultBranch: develop
    packs: ["${EXAMPLE}"]
  web:
    path: repositories/web
    defaultBranch: develop
${extra}`);

const rule = (paths, origin = 'research', body = 'Hold the line.') =>
  `---\npaths:\n${paths.map((path) => `  - "${path}"`).join('\n')}\ndescription: A rule.\norigin: ${origin}\n---\n\n# Rule\n\n${body}\n`;

describe('reading what a repository depends on', () => {
  it('reads the manifests of every common ecosystem', () => {
    const dir = tempDir();
    writeText(join(dir, 'package.json'), JSON.stringify({ dependencies: { react: '^19.2.8' }, devDependencies: { vite: '^8.3.0' } }));
    writeText(join(dir, 'composer.json'), JSON.stringify({ require: { php: '^8.4', 'laravel/framework': '^12.0' } }));
    writeText(join(dir, 'pubspec.yaml'), 'name: app\ndependencies:\n  flutter:\n    sdk: flutter\n  go_router: ^16.0.0\ndev_dependencies:\n  mocktail: ^1.0.0\n');
    writeText(join(dir, 'go.mod'), 'module x\n\ngo 1.22\n\nrequire (\n\tgithub.com/go-chi/chi/v5 v5.0.12\n)\n');
    writeText(join(dir, 'Cargo.toml'), '[package]\nname = "x"\n\n[dependencies]\nserde = { version = "1.0", features = ["derive"] }\ntokio = "1"\n');
    writeText(join(dir, 'pyproject.toml'), '[project]\nname = "x"\ndependencies = [\n  "fastapi>=0.110",\n  "pydantic[email]>=2",\n]\n');
    writeText(join(dir, 'requirements.txt'), '# pinned\nrequests==2.32.0\n-r other.txt\n');

    const { manifests, dependencies } = fingerprint(dir);
    assert.deepEqual(manifests, ['Cargo.toml', 'composer.json', 'go.mod', 'package.json', 'pubspec.yaml', 'pyproject.toml', 'requirements.txt']);
    assert.equal(dependencies['npm:react'], '^19.2.8');
    assert.equal(dependencies['npm:vite'], '^8.3.0');
    assert.equal(dependencies['composer:laravel/framework'], '^12.0');
    assert.equal(dependencies['pub:flutter'], 'sdk');
    assert.equal(dependencies['pub:mocktail'], '^1.0.0');
    assert.equal(dependencies['go:go'], '1.22');
    assert.equal(dependencies['go:github.com/go-chi/chi/v5'], 'v5.0.12');
    assert.equal(dependencies['cargo:serde'], '1.0');
    assert.equal(dependencies['cargo:tokio'], '1');
    assert.equal(dependencies['pypi:fastapi'], '>=0.110');
    assert.equal(dependencies['pypi:pydantic'], '>=2');
    assert.equal(dependencies['pypi:requests'], '==2.32.0');
  });

  it('reports what was added, removed and moved a major version, and ignores minor moves', () => {
    const before = { manifests: ['composer.json'], dependencies: { 'composer:laravel/framework': '^11.0', 'composer:old': '^1', 'composer:pint': '^1.20' } };
    const now = { manifests: ['composer.json', 'package.json'], dependencies: { 'composer:laravel/framework': '^12.0', 'composer:pint': '^1.27', 'npm:vite': '^8' } };
    const moved = drift(before, now);
    assert.deepEqual(moved.added, ['npm:vite']);
    assert.deepEqual(moved.removed, ['composer:old']);
    assert.deepEqual(moved.upgraded, [{ name: 'composer:laravel/framework', from: '^11.0', to: '^12.0' }]);
    assert.deepEqual(moved.manifests.added, ['package.json']);
    assert.equal(majorOf('~> 3.2'), 3);
    assert.equal(majorOf('*'), null);
  });
});

describe('scoping a rule to its repository', () => {
  const [, api] = scopes(hubConfig());

  it('renames it after the repository and puts its path in front of every glob', () => {
    const scoped = scopeRule({ file: 'http.md', path: '/x', paths: ['app/Http/**', './routes/*.php'], description: '', pack: 'p', selections: {}, vars: {} }, api);
    assert.equal(scoped.file, 'api-http.md');
    assert.deepEqual(scoped.paths, ['repositories/api/app/Http/**', 'repositories/api/routes/*.php']);
    assert.equal(scoped.repository, 'api');
  });

  it('confines a rule with no globs to its repository instead of the whole hub', () => {
    const scoped = scopeRule({ file: 'all.md', path: '/x', paths: [], description: '', pack: 'p', selections: {}, vars: {} }, api);
    assert.deepEqual(scoped.paths, ['repositories/api/**']);
  });
});

describe('a hub with rule sets', () => {
  const root = tempDir();
  writeText(join(root, '.collab-swarm/rules/api/STACK.md'), '---\ndescription: Laravel 12 API.\n---\n\nLaravel 12 on PHP 8.4. Controllers stay thin; actions hold the work.\n');
  writeText(join(root, '.collab-swarm/rules/api/rules/http-endpoints.md'), rule(['app/Http/**'], 'team', 'Our own endpoint rules.'));
  writeText(join(root, '.collab-swarm/rules/api/rules/queues.md'), rule(['app/Jobs/**']));
  writeText(join(root, '.collab-swarm/rules/web/rules/components.md'), rule(['src/components/**']));
  const config = hubConfig();
  const workspace = loadWorkspace(root, config);
  const byFile = new Map(workspace.rules.map((entry) => [entry.file, entry]));

  it('builds on the baseline pack, scoped to the repository, and lets the rule set replace a baseline rule', () => {
    assert.deepEqual(byFile.get('api-queues.md').paths, ['repositories/api/app/Jobs/**']);
    const endpoints = byFile.get('api-http-endpoints.md');
    assert.equal(endpoints.pack, 'rules:api');
    assert.deepEqual(endpoints.paths, ['repositories/api/app/Http/**']);
    assert.deepEqual(byFile.get('web-components.md').paths, ['repositories/web/src/components/**']);
    assert.ok(workspace.skills.some((skill) => skill.name === 'http-endpoint'));
    assert.deepEqual(workspace.conflicts, []);
  });

  it('publishes a repository\'s stack as a rule that loads only for its files', () => {
    const stack = byFile.get('api-stack.md');
    assert.deepEqual(stack.paths, ['repositories/api/**']);
    assert.match(stack.content, /Laravel 12 on PHP 8\.4/);
  });

  it('writes each target\'s rules in its own dialect', () => {
    const files = new Map(planSync(root, config, '0').files.map((file) => [file.path, file.content]));
    assert.match(files.get('.claude/rules/api-queues.md'), /paths:\n {2}- repositories\/api\/app\/Jobs\/\*\*/);
    assert.match(files.get('.cursor/rules/api-queues.mdc'), /globs: repositories\/api\/app\/Jobs\/\*\*/);
    assert.match(files.get('CLAUDE.md'), /\| `api` \| `repositories\/api` \| `develop` \| none configured \| `\.collab-swarm\/rules\/api\/` on .* baseline \|/);
    assert.match(files.get('CLAUDE.md'), /\| `web` \| .* \| `\.collab-swarm\/rules\/web\/` \|/);
  });

  it('reports a skill two repositories both publish, rather than letting one vanish', () => {
    const clash = tempDir();
    writeText(join(clash, '.collab-swarm/rules/web/skills/http-endpoint/SKILL.md'), '---\nname: http-endpoint\ndescription: Our own.\n---\n\n# Ours\n');
    const found = loadWorkspace(clash, hubConfig());
    assert.match(found.conflicts.join(), /skill "http-endpoint" comes from both example and rules:web/);
    const findings = validateRepository(clash, hubConfig(), found);
    assert.match(findings.errors.map((finding) => finding.message).join(), /comes from both/);
  });

  it('flags an unknown author, a doubled path, and a set belonging to no repository', () => {
    const odd = tempDir();
    writeText(join(odd, '.collab-swarm/rules/api/rules/x.md'), rule(['repositories/api/app/**'], 'vibes'));
    writeText(join(odd, '.collab-swarm/rules/mobile/rules/y.md'), rule(['lib/**']));
    const findings = validateRepository(odd, hubConfig(), loadWorkspace(odd, hubConfig()));
    const messages = findings.list.map((finding) => finding.message).join('\n');
    assert.match(messages, /origin "vibes" is not one of research, team/);
    assert.match(messages, /drop the leading "repositories\/api\/"/);
    assert.match(messages, /rule set "mobile" belongs to no repository/);
  });
});

describe('knowing when a rule set has fallen behind', () => {
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const root = tempDir();
  const api = join(root, 'repositories/api');
  writeText(join(api, 'composer.json'), JSON.stringify({ require: { 'laravel/framework': '^11.0' } }));
  writeText(join(api, 'app/Http/Controllers/HomeController.php'), '<?php\n');
  git(api, 'init', '--quiet');
  git(api, 'add', '-A');
  const config = hubConfig();
  const [, apiScope, webScope] = scopes(config);
  const status = () => ruleSetStatus(root, config, apiScope);

  it('starts from the baseline, then asks for the research to be recorded', () => {
    assert.equal(status().verdict, 'baseline');
    writeText(join(root, '.collab-swarm/rules/api/rules/http.md'), rule(['app/Http/**']));
    assert.equal(status().verdict, 'unrecorded');
  });

  it('is current once recorded, and stale when a major version moves or a rule matches nothing', () => {
    writeResearch(join(root, '.collab-swarm/rules/api'), fingerprint(api));
    assert.equal(status().verdict, 'current');

    writeText(join(api, 'composer.json'), JSON.stringify({ require: { 'laravel/framework': '^12.0' } }));
    assert.equal(status().verdict, 'stale');
    assert.equal(status().drift.upgraded[0].name, 'composer:laravel/framework');

    writeResearch(join(root, '.collab-swarm/rules/api'), fingerprint(api));
    writeText(join(root, '.collab-swarm/rules/api/rules/jobs.md'), rule(['app/Jobs/**']));
    assert.equal(status().verdict, 'stale');
    assert.deepEqual(status().dead, ['jobs.md']);
  });

  it('cannot judge a repository that is not checked out', () => {
    assert.equal(ruleSetStatus(root, config, webScope).verdict, 'unavailable');
  });

  it('names a default pack that fits a repository with no rules, without attaching it', () => {
    const app = tempDir();
    writeText(join(app, 'pubspec.yaml'), 'name: app\n');
    const single = parseConfig('version: 1\n');
    const status = ruleSetStatus(app, single, scopes(single)[0]);
    assert.equal(status.verdict, 'none');
    assert.deepEqual(status.fits, ['flutter']);
    assert.deepEqual(single.packs, []);
  });
});
