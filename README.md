# collab-swarm

**Spec-driven delivery for humans and coding agents working as a swarm.**

A team of people and a swarm of agents share one backlog, one plan format, and one set of checks. Git is the only tracker: a branch claims a feature, a completed plan on the default branch marks it done. Everyone — and every agent, in every tool — sees the same board after one fetch.

Language and framework agnostic. Framework skills are added as packs.

```bash
npm install -D collab-swarm
npx collab-swarm init
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
$ npx collab-swarm status

Delivery board · 2026-09-16 · milestone M0 Foundation · 1 done · 1 in progress · 3 available · 1 blocked

In progress
- design-kit · Dev 2 · stage requirements (in-progress) · Amara · origin/feat/design-kit · last commit 2 days ago

Done: app-shell

Next up
1. password-recovery — Reset a forgotten PIN by email · M1 Entry · Dev 1 · S · unblocks 0
2. guest-prices — Show list prices to a signed-out visitor · M1 Entry · Dev 2 · S · rides on the answer to D2 (Should a guest see prices before signing in?)
3. pin-sign-in — Sign in with a mobile number and PIN · M1 Entry · Dev 1 · M · rides on G2 Customer API contract (decided: mock-first)
Claim one: npx collab-swarm claim <slug>
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

`init` detects your ecosystem (Node, Python, Go, Rust, Flutter/Dart) and prefills `checks`, detects common source locations, and offers the default skill pack that matches your repository. Edit it, run `npx collab-swarm sync`, and every agent's instructions are regenerated.

## Commands

```bash
npx collab-swarm init                    # install into this repository
npx collab-swarm sync [--check|--force]  # re-apply after an upgrade; --check fails CI when stale
npx collab-swarm add <pack>              # attach a default pack, an npm package, or a path
npx collab-swarm pack list               # the default packs shipped with collab-swarm
npx collab-swarm pack options <pack>     # re-answer what a pack asked, and re-apply it
npx collab-swarm pack new <name>         # scaffold a pack for this project's own stack
npx collab-swarm packs                   # what each installed pack contributes
npx collab-swarm steps [<skill>]         # what each skill does, step by step, and the rules in force

npx collab-swarm status [--lane <lane>]  # the board: done, in progress, available, blocked
npx collab-swarm next [--lane <lane>]    # the best unclaimed rows, ranked
npx collab-swarm claim <slug>            # take a row: pushes its branch with a plan skeleton
npx collab-swarm plan <slug>             # scaffold a plan package by hand

npx collab-swarm validate                # the workflow contract and every plan
npx collab-swarm check [--focus <path>]  # your configured checks, in order
npx collab-swarm doctor                  # what is installed, stale, or missing
```

`status`, `next`, `packs`, `steps` and `validate` accept `--json`.

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

The core workflow knows nothing about your stack. A pack adds what does: concern skills, path-scoped rules, the architecture they assume, and suggested checks.

Some ship inside collab-swarm. `init` offers the one that matches your repository, or add it later:

```bash
npx collab-swarm pack list      # what ships with this version
npx collab-swarm add flutter    # nothing to install; it is already here
```

A pack asks about the slots every team fills differently, and installs itself around your answers:

```console
$ npx collab-swarm add flutter

Push notifications
  • 1. Firebase Cloud Messaging · firebase_messaging + flutter_local_notifications
  ◦ 2. OneSignal · onesignal_flutter, FCM and APNs behind one dashboard
  ◦ 3. No push notifications · the push skill and its rule are not installed
A number, or Enter for 1. Firebase Cloud Messaging: 2
```

Answers are recorded in `collab-swarm.yml`, so a teammate's `npx collab-swarm sync` reproduces the same files without being asked anything. Change one later with `npx collab-swarm pack options flutter`; a skill your new answer rules out is removed from every target rather than left behind.

Anything else is an npm package or a directory:

```bash
npm install -D collab-swarm-pack-go
npx collab-swarm add collab-swarm-pack-go
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

`role` decides how a skill may be reached. Only **`ticket`** skills may appear in a ticket's `skills` list, and `validate` enforces it: a ticket naming a skill nobody installed fails, with the installed list in the error.

| Role | Reached by |
| --- | --- |
| `coordinator` | the user, for a whole feature |
| `stage` | one stage of the workflow |
| `router` | `implement`, once per red-green slice |
| `ticket` | **a ticket's `skills` list** |
| `review` | `deliver-change`, at feature review |
| `reference` | being read, when a decision needs its vocabulary |

A pack may also declare the architecture it installs — the layout, the conventions, and the libraries it is built on. That is rendered into `AGENTS.md` and `CLAUDE.md` beside the chosen integrations, so an agent reads it before deciding which skill to open, and reaches for a library you already have instead of adding one.

See [docs/PACKS.md](docs/PACKS.md) for options, conditions and the stack declaration, and [`examples/pack-example`](examples/pack-example) for a working pack.

## Skills for your own stack

A default pack only exists for stacks somebody has already packaged. Your project's conventions — the call adapter everything routes through, the base class every handler extends, the wrapper you use instead of raw exceptions — exist in your code and nowhere else.

Ask your agent for them:

```text
"Write the skills for this project's stack."
```

The `to-pack` skill reads your dependency manifest, your build and lint config, and two or three features already built end to end, proposes the concerns it found, and then writes a pack into `.collab-swarm/packs/<name>/`:

```text
flutter-dev                routes a ticket to its concerns
flutter-api-integration    implements a ticket
flutter-state-management   implements a ticket
flutter-ui-implement       implements a ticket
flutter-ui-review          reviews one surface
rules/api-integration.md   lib/**/data/**, lib/**/domain/**
```

The rule that separates a useful stack skill from a wasted one is that **it names your code**. `guardedParse`, `privateApiClientProvider`, `@RestApi(parser: Parser.FlutterCompute)` — not "use your HTTP client". A skill that restates the framework's documentation costs tokens on every turn and teaches nothing.

The **router** is what keeps a large pack cheap. `implement` hands it each red-green slice, and it selects the smallest applicable set, so a ticket that only touches error handling never loads the navigation skill:

```text
tdd
 └─ flutter-dev  ── selects ──▶  flutter-api-integration
                                 flutter-error-handling
code-review
 └─ flutter-ui-review  (only because the diff touched a screen)
```

Tickets name concern skills; nothing names the router or a review skill, because `implement` and `deliver-change` reach those themselves.

Verify what you got with the commands that read it back — `npx collab-swarm packs`, `npx collab-swarm steps <router>`, `npx collab-swarm steps --rules`, `npx collab-swarm validate`. A skill with no description, a rule scoped to nothing, and a step with no completion criterion are each reported.

## Seeing what an agent will do

The skills *are* the agent's instructions, so `steps` reads them back as an execution map: the sequence each one runs, what finishes each step, which skill it hands work to, and which rules are in force while it runs.

```console
$ npx collab-swarm steps deliver-change

Deliver Feature · deliver-change · coordinates a feature · core

Steps
  1. Open the plan
       files collab-swarm.yml · .docs/changes/<feature>/plan.yml
       rules feature-plans.md → .docs/changes/<feature>/plan.yml
       runs  npx collab-swarm validate
       done  one package owns the feature and its current stage is known
  2. Build the complete plan
       calls to-requirements → to-spec → to-tickets
       files .docs/changes/<feature>/requirements.md · .docs/changes/<feature>/specification.md
       rules feature-plans.md → .docs/changes/<feature>/requirements.md
       done  the user can judge the whole plan without opening a register
  ...
```

`steps` with no argument walks every installed skill in the order the workflow reaches them, so the list top to bottom *is* the delegation. A step's `calls` are the skills it is told to use; a skill it merely reports back to shows as `names`, so the map is the real call graph rather than a keyword sweep.

`steps --rules` inverts it — for each rule, every step it governs and the file that brought it into force. That is the shortest path to *why did it do that?*: a rule reaches a step either because the step writes a file inside the rule's globs, or because the rule names the skill as its recipe, and the map says which.

Nothing is recorded to produce any of this. The map is read from the payload in your checkout, so it describes the skills you actually have, including everything your packs added — and the workflow keeps [no event log](assets/workflow/WORKFLOW.md), by design. It tells you what an agent is instructed to do, not what one did.

## Upgrading

`sync` vendors the payload, so the repository stays self-contained and works in sandboxes with no `node_modules`. A manifest at `.collab-swarm/manifest.json` records what was written, which lets `sync` tell three cases apart:

- a file **you edited** — reported as drift and left alone (`--force` restores it);
- a file an **older version wrote** that is no longer emitted — removed, along with any directory it emptied;
- everything else — rewritten.

Add `npx collab-swarm sync --check` and `npx collab-swarm validate` to CI to catch a stale or invalid checkout.

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

The `tdd`, `codebase-design`, `domain-modeling` and `writing-for-agents` skills build on ideas from Kent Beck, John Ousterhout's *A Philosophy of Software Design*, Michael Feathers' seams, Eric Evans' domain-driven design, and Martin Fowler's refactoring catalogue.

## License

MIT
