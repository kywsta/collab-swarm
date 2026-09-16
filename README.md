# collab-swarm

**Spec-driven delivery for humans and coding agents working as a swarm.**

A team of people and a swarm of agents share one backlog, one plan format, and one set of checks. Git is the only tracker: a branch claims a feature, a completed plan on the default branch marks it done. Everyone — and every agent, in every tool — sees the same board after one fetch.

Language and framework agnostic. Framework skills are added as packs.

```bash
npm install -D collab-swarm
npx swarm init
```

---

## What it installs

```text
requirements → specification → tickets → implementation → review → complete
```

One feature is one plan, committed to the repository:

```text
.docs/changes/password-recovery/
├── plan.yml              # stage, status, review base — where to resume
├── requirements.md       # product facts, cited to their source
├── specification.md      # engineering decisions and the test plan
└── tickets/
    ├── request-reset-email.md
    └── handle-reset-result.md
```

And the skills that produce and consume them, in the place each of your agents already looks.

| Say to your agent | What happens |
| --- | --- |
| *"What's next?"* | Reads the board, proposes the best unclaimed features, claims the one you pick |
| *"Make a plan to implement password recovery"* | Grounds it in your sources, designs it against your codebase, splits it into vertical tickets — then stops for your review |
| *"Implement the plan"* | Runs tickets in dependency order, test-first, verifying each with your checks, then reviews the whole diff |
| *"Resume the password-recovery plan"* | Picks up from the stage recorded in `plan.yml` |

## Why a swarm needs this

Two people and four agent sessions on one repository will, by default, plan the same feature twice and discover it at merge time. collab-swarm removes the coordination problem rather than managing it:

- **The backlog is a Markdown table** your team already maintains. No external tracker to sync.
- **A claim is a pushed branch.** Claiming races are resolved by the Git server, atomically. The loser is told who won and offered the next row.
- **Done is a completed plan on the default branch.** Merging the pull request is what marks a feature done; nothing else to remember.
- **Blocked is derived, not declared.** A row waiting on an unfinished dependency, an open human gate, or an unanswered product decision is never offered to anyone.

```console
$ npx swarm status

Delivery board · 2026-09-16 · milestone M0 Foundation · 1 done · 1 in progress · 3 available · 1 blocked

In progress
- design-kit · Dev 2 · stage requirements (in-progress) · Amara · origin/feat/design-kit · last commit 2 days ago

Done: app-shell

Next up
1. password-recovery — Reset a forgotten PIN by email · M1 Entry · Dev 1 · S · unblocks 0
2. guest-prices — Show list prices to a signed-out visitor · M1 Entry · Dev 2 · S · rides on the answer to D2 (Should a guest see prices before signing in?)
3. pin-sign-in — Sign in with a mobile number and PIN · M1 Entry · Dev 1 · M · rides on G2 Customer API contract (decided: mock-first)
Claim one: npx swarm claim <slug>
```

## Works with the agent you already use

`init` asks which agents work on this repository and writes the files each one reads:

| Target | What is written |
| --- | --- |
| **Claude Code** | `.claude/skills/`, `.claude/rules/` (path-scoped), `.claude/settings.json`, `CLAUDE.md` |
| **AGENTS.md standard** | `.agents/skills/`, `.agents/rules/`, `AGENTS.md` |
| **OpenAI Codex** | the above, plus `.codex/prompts/` — Codex reads `AGENTS.md` and `.agents/skills` natively |
| **Cursor** | `.cursor/rules/*.mdc` (`globs` / `alwaysApply`), `.cursor/commands/`, `AGENTS.md` |
| **OpenCode** | `.opencode/commands/`, `AGENTS.md` — OpenCode also reads `.claude/skills` and `.agents/skills` |
| **Google Antigravity** | `.agents/rules/` and `.agents/workflows/`, `AGENTS.md` — `.agents/` is recognised natively |

Targets that read the same directory share one copy of the payload, so picking five agents does not write five copies of every skill.

Your `AGENTS.md` and `CLAUDE.md` are **merged, not overwritten**: only the block between `<!-- collab-swarm:start -->` and `<!-- collab-swarm:end -->` is managed, and everything you write around it survives every upgrade.

## Configuration

One file, `collab-swarm.yml`, is the whole contract:

```yaml
version: 1
project: Demo Shop
targets: [claude, agents, cursor]
plans: .docs/changes
backlog: docs/delivery-plan.md

# Where this project's truth lives. Agents cite these; they never invent behaviour.
sources:
  product:
    label: Product requirements
    paths: ["docs/prd/**/*.md"]
    use: What the feature must do, and how it is judged
    required: true
  design:
    label: Figma index
    paths: ["docs/ui-nodes.md"]
    use: Which screens and components a surface must match
  api:
    label: OpenAPI contract
    paths: ["docs/openapi.yaml"]
    use: The operations, payloads and error cases a feature may use
  decisions:
    label: Decisions register
    paths: ["docs/decisions.md"]

# The one check set. A human, an agent and CI all run exactly these.
checks:
  - { name: format, run: "npm run format", ci: "npm run format:check" }
  - { name: lint, run: "npm run lint" }
  - { name: test, run: "npm test", focus: "npm test -- {path}" }

git: { remote: origin, defaultBranch: main, branchPrefix: "feat/" }
packs: []
```

`init` detects your ecosystem (Node, Python, Go, Rust, Flutter/Dart) and prefills `checks`, and detects common source locations. Edit it, run `npx swarm sync`, and every agent's instructions are regenerated.

## Commands

```bash
npx swarm init                    # install into this repository
npx swarm sync [--check|--force]  # re-apply after an upgrade; --check fails CI when stale
npx swarm add <pack>              # attach a language or framework skill pack
npx swarm packs                   # what each installed pack contributes

npx swarm status [--lane <lane>]  # the board: done, in progress, available, blocked
npx swarm next [--lane <lane>]    # the best unclaimed rows, ranked
npx swarm claim <slug>            # take a row: pushes its branch with a plan skeleton
npx swarm plan <slug>             # scaffold a plan package by hand

npx swarm validate                # the workflow contract and every plan
npx swarm check [--focus <path>]  # your configured checks, in order
npx swarm doctor                  # what is installed, stale, or missing
```

`status`, `next`, `packs` and `validate` accept `--json`.

## The backlog

A Markdown file your team edits. Columns are matched **by header name**, so name and order them however you like; only `Slug` and `Title` are required.

```markdown
### M1 · Entry

| Slug | Title | Sources | Owner | Size | Depends on |
| --- | --- | --- | --- | --- | --- |
| `pin-sign-in` | Sign in with a mobile number and PIN | docs/prd/01-auth.md | Dev 1 | M | `app-shell`, G2 |
| `voucher-redeem` | Redeem a voucher at checkout | docs/prd/02-vouchers.md | Dev 1 | L | D1, G1 |
```

`Depends on` mixes three kinds of blocker, and the board resolves each:

- **`slug`** — another feature, freed when its plan completes on the default branch;
- **`G<n>`** — a human gate (an account, a credential, a contract another team owes), freed when the gate tracker's status stops saying `open`;
- **`D<n>`** — a product decision, freed by an answer *or* by a recorded working assumption, so planning is never held hostage to a slow reply.

Proposals are ranked by earliest milestone, then the asker's lane, then how many rows the work unblocks, then size.

## Skill packs

The core workflow knows nothing about your stack. A pack adds what does: concern skills, path-scoped rules, and suggested checks.

```bash
npm install -D collab-swarm-pack-go
npx swarm add collab-swarm-pack-go
```

A pack is a directory with a manifest, a `skills/` folder, and optionally `rules/`:

```text
collab-swarm-pack-go/
├── collab-swarm-pack.json
├── skills/http-endpoint/SKILL.md
└── rules/http-endpoints.md
```

```json
{
  "name": "go",
  "title": "Go",
  "description": "Go concerns: HTTP endpoints, sqlc queries, worker jobs.",
  "collabSwarm": 1,
  "skills": [{ "name": "http-endpoint", "role": "ticket" }],
  "checks": [{ "name": "vet", "run": "go vet ./..." }]
}
```

`role` decides how a skill may be reached — `coordinator`, `stage`, `ticket`, or `reference`. Only **`ticket`** skills may appear in a ticket's `skills` list, and `validate` enforces it: a ticket naming a skill nobody installed fails, with the installed list in the error. See [docs/PACKS.md](docs/PACKS.md), and [`examples/pack-example`](examples/pack-example) for a working one.

## Upgrading

`sync` vendors the payload, so the repository stays self-contained and works in sandboxes with no `node_modules`. A manifest at `.collab-swarm/manifest.json` records what was written, which lets `sync` tell three cases apart:

- a file **you edited** — reported as drift and left alone (`--force` restores it);
- a file an **older version wrote** that is no longer emitted — removed, along with any directory it emptied;
- everything else — rewritten.

Add `npx swarm sync --check` and `npx swarm validate` to CI to catch a stale or invalid checkout.

## Programmatic use

```js
import { Board, Register, Claims, validateRepository, loadConfig } from 'collab-swarm';

const { config, root } = loadConfig();
const board = Board.build(
  Register.parse(await readFile(config.backlog, 'utf8')),
  new Claims(root, config.git, config.plans).read(),
  config.git.defaultBranch,
);
console.log(board.proposals({ lane: 'Dev 2' }));
```

## Requirements

Node 20.11 or newer, and Git. One runtime dependency (`yaml`).

## Credits

Extracted from the agentic delivery workflow built for the Pocket Customer app. The `tdd`, `codebase-design`, `domain-modeling` and `writing-for-agents` skills build on ideas from Kent Beck, John Ousterhout's *A Philosophy of Software Design*, Michael Feathers' seams, Eric Evans' domain-driven design, and Martin Fowler's refactoring catalogue.

## License

MIT
