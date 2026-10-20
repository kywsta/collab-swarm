# collab-swarm

**Spec-driven delivery for humans and coding agents working as a swarm.**

A team of people and a swarm of agents share one backlog, one plan format, and one set of checks. Git is the only tracker: a branch claims a feature, a completed plan on the default branch marks it done. Everyone — and every agent, in every tool — sees the same board after one fetch.

Language and framework agnostic. Each repository's conventions are researched from its own code into a rule set; packs are optional baselines.

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
| *"We need customers to be able to gift a voucher"* | Researches what exists, interviews you until the behaviour is settled, writes the product, design and API documents, and puts the feature on the board |
| *"Turn these PRDs into a delivery plan"* | Writes the milestones, the feature register, the human gates and the open decisions — ordered by dependency, cut so every lane has work on day one |
| *"The BRDs changed — update the delivery plan"* | Finds every row and plan the changed sections reach, and sorts them by what each has already done: delivered work gets a follow-up row, plans in flight are revised, unstarted rows are reworked or retired |
| *"What's next?"* | Reads the board, proposes the best unclaimed features, claims the one you pick |
| *"Make a plan to implement password recovery"* | Grounds it in your sources, designs it against your codebase, splits it into vertical tickets — then stops for your review |
| *"Implement the plan"* | Runs tickets in dependency order, test-first, verifying each with your checks, then reviews the whole diff |
| *"Resume the password-recovery plan"* | Picks up from the stage recorded in `plan.yml` |
| *"Show a zero price as Free"* | Too small to plan: states a short contract, asks whether to record it, builds it test-first, and reviews the diff against that contract — off the board, no plan |
| *"Research the rule set for api"* | Reads the repository and the official guidance for the versions it uses, proposes the conventions it is built by with their evidence, and writes the ones you agree — again whenever the code has moved on |
| *"Compact the project history"* | Folds finished and superseded plans into one short delivery history, promotes what still matters, retires delivered milestones from the backlog — and deletes nothing you have not agreed to |

## Why a swarm needs this

Two people and four agent sessions on one repository will, by default, plan the same feature twice and discover it at merge time. collab-swarm removes the coordination problem rather than managing it:

- **The backlog is a Markdown table** your team already maintains. No external tracker to sync.
- **A claim is a pushed branch.** Claiming races are resolved by the Git server, atomically. The loser is told who won and offered the next row.
- **Done is a completed plan on the default branch.** Merging the pull request is what marks a feature done; nothing else to remember. Compacting the plan later into the delivery history keeps it done.
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

`init` detects your ecosystem (Node, Laravel, Python, Go, Rust, Flutter/Dart) and prefills `checks`, and detects common source locations. It attaches no pack: the rules your code is built by are [researched](#rule-sets), with a pack as the starting point only where you ask for one. Edit it, run `npx collab-swarm sync`, and every agent's instructions are regenerated.

### Frontend, backend, or both

`sources:` is where a project says what kind of thing it is. A kind it has no counterpart for is left out, not stubbed — and the one distinction that matters is whether a contract is **read** here or **owned** here.

An app owns its screens and reads a contract somebody else serves:

```yaml
sources:
  design:
    label: Figma index
    paths: ["docs/ui-nodes.md"]
  api:
    label: OpenAPI contract
    paths: ["docs/openapi.yaml"]     # read: an operation it lacks is a gate, built against a stand-in
```

A service declares no design source at all, and owns the contract instead:

```yaml
sources:
  api:
    label: OpenAPI contract
    paths: ["openapi.yaml"]
    owned: true                      # an operation it lacks is this feature's work, delivered with it
```

`owned: true` is what stops a service filing its own endpoint as a gate and waiting for itself: a gap in a contract you define is a ticket, a gap in one you consume is a gate with an owner, a stand-in, and one deferred ticket for the real connection. A service's interfaces are its operations and events, listed where an app lists its screens. A monorepo that owns both sides simply marks both.

### A hub, with the code in other repositories

Some programmes keep their knowledge apart from their code: one repository holds the requirements, the backlog and the plans, and each app is a repository of its own — usually a submodule — with its own remote, default branch, CI and deployment. Install collab-swarm in the hub and list the code repositories; `init` offers the hub's submodules, each with the default branch its remote advertises and the checks its own stack suggests.

```yaml
git: { remote: origin, defaultBranch: main, branchPrefix: "feat/" }
repositories:
  api:
    path: repositories/api
    defaultBranch: develop
    checks:
      - { name: format, run: "vendor/bin/pint", ci: "vendor/bin/pint --test" }
      - { name: test, run: "php artisan test", focus: "php artisan test {path}" }
  participant:
    path: repositories/participant
    defaultBranch: develop
    checks:
      - { name: test, run: "flutter test", focus: "flutter test {path}" }
```

There is still one backlog and one board. A row says where its code lands in a `Repositories` column, and a feature's branch has the same name everywhere:

```console
$ npx collab-swarm claim check-in-gate
✓ Claimed "check-in-gate" on origin/feat/check-in-gate with .docs/changes/check-in-gate/plan.yml.
  · api: opened origin/feat/check-in-gate from develop
  · participant: opened origin/feat/check-in-gate from develop
```

- **The plan records where each branch started** — `repositories: { api: { base_sha: … } }` in `plan.yml` — which is that repository's review base. The specification adds a repository the row did not name with `npx collab-swarm repos <slug> --open <name>`.
- **Every ticket names the repository it is built in** with `repository:` when the plan spans several, and its checks run there: `npx collab-swarm check --focus repositories/api/tests/Feature/CheckInTest.php` runs only the API's checks, from its own directory.
- **Done needs the code merged.** A row is done when its plan is complete on the hub's default branch *and* its branch has merged in every repository the plan names. Until then `status` shows it awaiting merge — `awaiting merge: api merged, participant (2 commits not yet in develop)` — and nothing that depends on it is offered. A branch deleted after merging still counts when its merge commit names it; a squash merge must keep the branch name in its message. A repository that is not checked out cannot be confirmed, so it does not count as merged.

`npx collab-swarm repos` lists the repositories and whether each is checked out here; `repos <slug>` shows where one feature's branch stands in each.

## Commands

```bash
npx collab-swarm init                    # install into this repository
npx collab-swarm sync [--check|--force]  # re-apply after an upgrade; --check fails CI when stale
npx collab-swarm rules [<name>]           # each rule set, and whether it has fallen behind its code; --record after research
npx collab-swarm add <pack> [--repo <n>] # attach a pack as a baseline: a default pack, an npm package, or a path
npx collab-swarm pack list               # the default packs shipped with collab-swarm
npx collab-swarm pack options <pack>     # re-answer what a pack asked, and re-apply it
npx collab-swarm pack new <name>         # scaffold a pack to share a stack across projects
npx collab-swarm packs                   # what each installed pack contributes
npx collab-swarm steps [<skill>]         # what each skill does, step by step, and the rules in force

npx collab-swarm status [--lane <lane>]  # the board: done, in progress, available, blocked
npx collab-swarm next [--lane <lane>]    # the best unclaimed rows, ranked
npx collab-swarm claim <slug>            # take a row: pushes its branch with a plan skeleton
npx collab-swarm repos [<slug>]          # a hub's code repositories, or one feature's branch in each
npx collab-swarm plan <slug>             # scaffold a plan package by hand

npx collab-swarm validate                # the workflow contract and every plan
npx collab-swarm history                 # what has been delivered, and what can be compacted
npx collab-swarm impact [--since <ref>]  # which rows and plans a change to the sources reaches
npx collab-swarm check [--focus <path>]  # your configured checks, in order; --repo <name> for one code repository
npx collab-swarm doctor                  # what is installed, stale, or missing
```

`status`, `next`, `repos`, `rules`, `history`, `impact`, `packs`, `steps` and `validate` accept `--json`.

## The backlog

A Markdown file your team edits — or asks an agent to write from your product documents (`to-backlog`). Columns are matched **by header name**, so name and order them however you like; only `Slug` and `Title` are required.

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

A capability none of your documents describes yet does not get a row invented for it. `new-feature` shapes it first — what exists today, what the user actually means, what the states and boundaries are — writes that into your product, design and API documents, and only then registers the rows that deliver it. A change to behaviour a document already describes skips all of that and goes straight to a plan.

## Rule sets

The core workflow knows nothing about your stack. What each repository is written in, the conventions its code has settled on, and the way its libraries are actually used go in its **rule set**: a stack profile and path-scoped rules, kept in `.collab-swarm/rules/<repository>/` — `root` for this repository, or one per repository a [hub](#a-hub-with-the-code-in-other-repositories) coordinates.

Ask your agent for one:

```text
"Research the rule set for api."
```

The `to-rules` skill reads the repository — its manifests and the exact versions in its lockfile, its build, lint and test config, the agent instructions it already carries, and two or three features built end to end — then the official guidance for those versions. It proposes a profile and a rule per concern, each with its evidence, asks you where best practice and the code disagree, and writes only what you agree:

```text
.collab-swarm/rules/api/
├── STACK.md                  # Laravel 12 on PHP 8.4, what it is built with, the conventions everywhere
├── rules/
│   ├── http-endpoints.md     # app/Http/**, routes/api.php
│   └── queue-jobs.md         # app/Jobs/**
└── research.json             # what api depended on when this was researched
```

The rule that separates a useful rule from a wasted one is that **it names your code** — the form request every endpoint validates through, the action class that holds the work — not "validate your input". A rule that restates the framework's documentation costs tokens on every matching file and teaches nothing.

Globs are written relative to the repository. `sync` adds its path and publishes the set into every agent target, so a session started in the hub loads api's rules only while it touches api's files, and its stack profile with them.

A rule set is meant to be researched again as the code grows. `npx collab-swarm rules` compares each repository with what its last research recorded:

```console
$ npx collab-swarm rules

Rule sets · .collab-swarm/rules/
- api · repositories/api · behind the repository · 6 rules (5 research, 1 team) · stack profile · researched 2026-10-20
    added since: composer:spatie/laravel-permission
    major upgrades: composer:laravel/framework ^11.0 → ^12.0
- dashboard · repositories/dashboard · no rule set — agents build from their own priors
- participant · repositories/participant · pack baseline only, nothing researched yet · baseline flutter
```

Each rule records who wrote it — `origin: research` or `origin: team` — and a later pass revises only its own, proposing any change to yours. `doctor` reports a set that has fallen behind; `validate` reports a glob that repeats the repository's path and two sources publishing the same rule or skill.

## Packs: optional baselines

None is attached by default. A pack is a rule set somebody has already written for a whole stack — concern skills, path-scoped rules, the architecture they assume, and suggested checks — and where one fits a repository, it is the baseline that repository's rule set builds on. A rule in the set with the same file name replaces the pack's; everything else adds to it.

Some ship inside collab-swarm. Attach one to the repository it fits:

```bash
npx collab-swarm pack list                       # what ships with this version
npx collab-swarm add flutter --repo participant  # a baseline for one repository
npx collab-swarm add flutter                     # or for this repository itself
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

Answers are recorded in `collab-swarm.yml`, so a teammate's `npx collab-swarm sync` reproduces the same files without being asked anything. Each repository keeps its own answers, so two apps on the same stack may answer differently. Change one later with `npx collab-swarm pack options flutter --repo participant`; a skill your new answer rules out is removed from every target rather than left behind.

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

## When the requirements change

Requirements move after the backlog is cut: a new BRD version, a change request, a re-scoped PRD. Every row cites its sources, and every plan records the commit its requirements were read from (`sources_sha`), so the work a change reaches is found rather than remembered.

```console
$ npx collab-swarm impact

Source impact · since docs/delivery-plan.md was last committed (a637579c1e2b, 2026-10-14: Plan M1) · 3 documents changed

Changed sources
- docs/prd/PRD-02-Participant-App.md · PRDs · changed in 2 sections
- docs/brd/BRD-02-Participant-App.md · BRDs · changed in 4 sections
- docs/brd/CR-02-Family-Rewards.md · BRDs · new

Delivered, and the sources it was built from changed — what shipped may no longer be what is asked for
- my-reward — My reward · M1 Entry
    docs/prd/PRD-02-Participant-App.md · 7.7 My Reward

In progress — its plan may be building what is no longer asked for
- home — Participant home · M1 Entry · held by Ana
    docs/prd/PRD-02-Participant-App.md · 7.4 Home

Changed, and no row cites it — new work, or a document the cited ones must absorb first
- docs/brd/BRD-02-Participant-App.md · BRDs · changed · 4.1 Screen map; 6. Rewards; and 2 more
- docs/brd/CR-02-Family-Rewards.md · BRDs · new
```

A citation is matched however the row writes it — a path, a file name or a document id such as `PRD-02`, followed by `§7.4`, `#anchor` or a quoted heading — and a row whose cited section changed is told apart from one that only cites the same document. Ask your agent to *"update the delivery plan"*: `to-backlog` starts from this list. A delivered row stays done and gets a follow-up row, an unstarted one is reworked or retired, and a plan in flight is revised by its holder, because `validate` warns on their branch once a source it cites has moved on the default branch.

## Keeping the repository small

Every feature leaves a plan behind, and a plan is only worth reading while its feature is being built. A year in, `.docs/changes/` holds sixty of them: spent tickets, sequencing nobody needs, and requirements for features that were later rebuilt, which still read as true to an agent searching for how something works.

```console
$ npx collab-swarm history

Delivery history · .docs/changes/HISTORY.md · nothing compacted yet · 41 directories under the plans

Ready to compact · 34 directories, 9,812 lines
- app-shell — Tab shell · plan · M0 Foundation · last commit 2026-06-02 · 9 files, 388 lines · commit 3f9c2a1b7d4e
  ...
Complete, but still owed deferred work — lift it into the backlog first, or keep the plan
- pin-sign-in — Sign in with a PIN · plan · M1 Entry · ...
    deferred: Connect the live customer API (connect-live-api)

Backlog
- Milestone M0 Foundation is fully delivered: 6 rows (app-shell, design-kit, ...)
- Gate G4 Firebase projects per flavor (Dev 1) is closed, and nothing unfinished names it
```

Ask your agent to *"compact the project history"*. The `compact-history` skill judges what the command cannot: which plans a later one superseded, which specification decisions still constrain the code (they go to your architecture decisions), which product facts no source holds yet, and which deferred tickets must become backlog rows rather than vanish. It proposes all of it in one message, and acts only on what you agree to.

The result is one file beside the plans, a row per compacted directory with the commit that still holds it:

```markdown
| Slug | Title | Status | Completed | Commit | Notes |
| --- | --- | --- | --- | --- | --- |
| `app-shell` | Tab shell | delivered | 2026-06-02 | 3f9c2a1b7d4e | |
| `guest-home` | Browse before signing in | superseded | 2026-07-12 | 81d0e6c2a9f3 | Replaced by `guest-home-v2`. |
```

Nothing is lost: `git show 3f9c2a1b7d4e:.docs/changes/app-shell/specification.md` reads any of it back. And nothing on the board moves: a delivered row in the history is done, exactly as a complete plan was, so everything waiting on it stays unblocked after its directory is gone.

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
