# Stack pack format

The anatomy of the four things a stack pack contains. Read this before writing any of them; `to-pack` owns the process, this file owns the shapes.

## Layout

```text
.collab-swarm/packs/<name>/
├── collab-swarm-pack.json
├── skills/
│   ├── <stack>-dev/SKILL.md            # the router
│   ├── <stack>-<concern>/SKILL.md      # one per concern
│   │   └── examples.md                 # worked files, when the recipe needs them
│   └── <stack>-<surface>-review/SKILL.md
└── rules/
    └── <concern>.md
```

`npx collab-swarm pack new` writes this shape with every file stubbed. Fill the stubs; never leave one with an empty `description`, because that is the line an agent reads to decide whether to open the skill at all.

## Roles

| Role | Reached by | May a ticket name it? |
| --- | --- | --- |
| `router` | `implement`, once per red-green slice | No |
| `ticket` | a ticket's `skills` list | **Yes** |
| `review` | `deliver-change` at feature review | No |
| `reference` | being read, when a decision needs its vocabulary | No |

A pack ships one router, one `ticket` skill per concern, a `review` skill per surface that needs judgement a diff cannot show, and `reference` skills only for vocabulary that outlives any single ticket.

## A concern skill

The unit of the pack. One concern, one skill, one owner for every rule about it.

````markdown
---
name: <stack>-api-integration
description: <The stack it builds, named by its real parts> — <part, part, part>. Triggers on <the words a ticket uses when this concern is in play>.
---

# API Integration

<One paragraph: the flow, and the one convention a newcomer gets wrong.>
Worked files: [examples.md](examples.md).

```text
Http client → generated API → DTO → mapper → repository → domain
```

## 1. <First thing built>

<What this project does, in this project's names. Which base class, which
annotation, which provider, which directory. Show the two-line version.>

## 2. <Next thing built>

...

## Checklist

- [ ] <An observable condition a reviewer can check from the diff>
- [ ] <...>
````

What separates a skill worth its tokens from one that is not:

- **It names this codebase's parts.** `guardedParse`, `privateApiClientProvider`, `AppFailure`, `@RestApi(parser: Parser.FlutterCompute)` — the identifiers actually in the repository. A skill that says "use your HTTP client" restates the framework's documentation and earns nothing.
- **It fixes the order.** Most concerns are a stack built bottom-up. Say the order once, and every later step is placement rather than invention.
- **It names what to build, not everything that exists.** Say a domain module earns its place when it owns policy, invariants, orchestration, rollback or lifecycle — and that a one-method class forwarding to a repository fails the deletion test.
- **It closes on a checklist.** The concern's own completion conditions, which `implement` accumulates across the selected skills and verifies with the project checks.
- **It keeps the bulk in `examples.md`.** The recipe stays short enough to be read every time; the worked files sit one link away, read only when the recipe is not enough.

Write the description as the trigger. It is the only part loaded on every turn.

## A rule

The always-available short form of the skill, scoped to the files it governs.

```markdown
---
paths:
  - "<the directories this concern actually owns>"
description: Invariants for <concern> — <three words, three words, three words>.
---

# <Concern> rule

Detailed recipe: [`<stack>-<concern>`](../skills/<stack>-<concern>/SKILL.md).
Apply with [<sibling concern>](<sibling>.md).

- <Invariant, as the positive behaviour to produce.>
- <Invariant.>
- <Invariant.>
```

Three or four invariants: the ones a reviewer would catch and a newcomer would miss. `paths` is required and must match something real — run `npx collab-swarm steps --rules` afterwards and confirm the rule lands where you meant.

Keep the `Recipe:` link. It is how a reader gets from the invariant to the procedure, and `npx collab-swarm steps` reads it to report the rule as in force for every step of that skill.

## The router

One per pack. It reads the ticket and selects **the smallest applicable skill set** — a ticket that only touches error handling must never load the navigation skill.

```markdown
---
name: <stack>-dev
description: Route an approved <stack> ticket to only the implementation skills its <concern, concern, concern> work requires.
---

# <Stack> Development Router

<One line: what this pack covers, and what it does not.>

## 1. Select the concern set

Read the ticket and the feature specification. The ticket's `skills` list is the
plan; the diff decides whether another concern became necessary.

| Ticket concern | Use |
| --- | --- |
| <The words that appear in a ticket when this concern is in play> | `<stack>-api-integration` |
| <...> | `<stack>-state-management` |

<Which reference skills to consult, and what returns to `deliver-change`.>

Done when every concern the ticket names maps to one skill, and nothing outside
the slice was selected.

## 2. Apply the selected skills

For each red-green slice, consult the selected skills before editing their
concern. Accumulate each selected skill's completion checks; `implement` owns
running the resulting verification set.

Done when every changed concern was written with its own skill open, and the
accumulated checks are handed to `implement`.

## 3. Hand back

Report: the skills selected and why each applied; the specification decisions
and seams exercised; any generation step introduced; the concern-specific
checks required; any scope or contract conflict that needs escalation.

Done when every changed concern maps to one skill, every selected skill's
completion criteria are satisfied, and no unapproved concern is hiding in the
diff.
```

Write it as a numbered sequence, like every other skill that runs. A router
written as a bare table has no completion criterion, and `npx collab-swarm steps` reports
it among the documents that are read rather than run.

The routing table's left column is the vocabulary a ticket is written in, not a list of file types. "Provider, lifetime, override, composition root" routes better than "dependency injection files", because the ticket says the former.

## A review skill

One per surface where a diff does not show whether the work is right — a rendered screen against its design, a query plan, an accessibility pass.

```markdown
---
name: <stack>-<surface>-review
description: Review <surface> against <the standard it must meet>. Runs during feature review, on the surfaces the diff touched.
---

# <Surface> Review

<What it inspects, and what it cannot see.>

## 1. Fix the surfaces

<Which changed files put a surface in scope.>

Done when the set of surfaces to review is fixed.

## 2. <The pass>

...

Done when every in-scope surface is judged and every finding carries severity,
location, and consequence.
```

Report findings as `blocking` or `advisory`, with the same shape `code-review` uses, so `deliver-change` can merge them into one report. A review skill reports; it does not repair.

## Options: the questions a pack asks

A stack is rarely one thing. The core of a Flutter app is fixed — the state container, the router, the HTTP stack — but a handful of slots are filled differently by every team: which push provider, which local database, which analytics. A pack that hard-codes one answer is wrong for everybody else; one that hedges across all of them stops naming anything concrete, which was the only reason a skill was worth its tokens.

A pack declares those slots as `options`. The project answers once, `npx collab-swarm add` records the answers in `collab-swarm.yml`, and everything downstream resolves against them — so a teammate's `npm install && npx collab-swarm sync` reproduces the same files without another interview.

```json
"options": [
  {
    "id": "database",
    "question": "Structured local database",
    "detail": "Secure storage and preferences are in the pack either way.",
    "default": "none",
    "choices": [
      { "id": "none", "label": "None beyond secure storage and preferences" },
      {
        "id": "drift",
        "label": "Drift",
        "hint": "typed SQL, migrations, reactive queries",
        "vars": { "store": "database" },
        "packages": [
          { "name": "drift", "version": "^2.0.0", "use": "Typed SQLite access and migrations" },
          { "name": "drift_dev", "version": "^2.0.0", "dev": true, "use": "Generating the database" }
        ]
      }
    ]
  }
]
```

Three mechanisms use the answers, all of them greppable in the pack's own sources.

### `if` — whether a thing exists at all

A condition on a manifest skill entry, a rule's front matter, a check, or a declared package:

```text
database=drift                    the answer is drift
database=drift,isar               the answer is either
notifications!=none               the answer is anything but none
database!=none && analytics=firebase
analytics!=none || crash!=none    one concern reached from either answer
```

`||` binds looser than `&&`, and there is no grouping: a condition needing parentheses is a concern that should have been two. A condition naming an option the pack does not declare is true, so a filter nobody answered never removes a skill.

A skill ruled out is not installed — not installed and greyed out, not installed and empty. It cannot be routed to, named by a ticket, or read by mistake, and `pack options` removes it from every target when an answer changes.

### `<!-- swarm:if -->` — the prose that varies

Inside any skill or rule body, on its own line for a block or inline for a clause:

```markdown
<!-- swarm:if database=drift -->
Every schema change needs a migration **and** a test that runs it.
<!-- swarm:else -->
Add a database package before the first store.
<!-- swarm:endif -->

Put secrets in secure storage<!-- swarm:if database!=none -->, structured objects in the {{database.store}}<!-- swarm:endif -->, and blobs in files.
```

A conditional inside a fenced code block is shown, not run — a pack documenting this syntax would otherwise have its own examples rewritten. A `{{variable}}` inside a fence *is* interpolated, because a code sample naming the real adapter is the point of one.

### `{{option}}` and `{{option.var}}` — the identifiers that vary

`{{database}}` is the chosen id, `{{database.label}}` its label, and `{{database.store}}` whatever the choice declared under `vars`. An interpolation nothing defines is left in place rather than blanked, and `npx collab-swarm validate` reports it as an error — a hole in published prose is worse than a loud one in the pack.

### Writing an option well

- **Ask about what genuinely varies.** An option per library is an interview nobody finishes. Ask about the slots a team actually decides.
- **Give every option a `none`** unless the stack cannot work without one, and make sure the pack still reads correctly with it chosen.
- **Pick the mainstream default.** It is what `--yes`, CI and a scripted `init` will take.
- **Keep the fixed core fixed.** If swapping an answer would rewrite every skill, it is not an option — it is a different pack.

## Declaring the stack

A pack may describe the architecture it installs. It is rendered into `AGENTS.md` and `CLAUDE.md`, so an agent reads it before it decides which skill to open, and reaches for a library the project already has rather than adding one.

```json
"stack": {
  "summary": "One paragraph: the architecture in a sentence.",
  "layout": ["lib/", "├── core/", "└── features/<feature>/"],
  "conventions": ["**Layer direction.** presentation → domain → data ports.", "..."],
  "packages": [
    { "name": "go_router", "version": "^17.0.0", "use": "Routing, shell branches and redirects" }
  ]
}
```

`packages` is joined with the packages the chosen options bring in, de-duplicated by name. Declaring a package documents it; nothing is written to the project's dependency manifest, because adding a dependency is the agent's job when a ticket needs it.

`detect` lists files whose presence suggests the pack, so `npx collab-swarm init` offers the matching one first:

```json
"detect": ["pubspec.yaml"]
```

## Checks

Commands the pack needs that the project may not have configured — a code generator, a framework analyzer, a lint the framework ships. They are offered, not imposed: `npx collab-swarm add` shows them and asks.

```json
"checks": [
  { "name": "generate", "run": "dart run build_runner build --delete-conflicting-outputs", "when": "build.yaml" }
]
```

Use `when` for a check that only applies when a file exists, and `focus` for the variant `npx collab-swarm check --focus <path>` runs during ticket verification.
