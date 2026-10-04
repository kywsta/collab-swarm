# Feature plan formats

Use the files in `templates/` as seeds. Replace every placeholder. Keep the documents readable without consulting a schema or decoding identifier tables.

## Package layout

```text
<plans>/<feature-slug>/
├── plan.yml
├── requirements.md
├── specification.md
└── tickets/
    └── <ticket-slug>.md
```

## `plan.yml`

```yaml
schema_version: 1
workflow_version: 1
feature: password-recovery
title: Password recovery
stage: tickets
status: ready
implementation_base_sha: null
created_at: "2026-09-02T00:00:00Z"
updated_at: "2026-09-02T00:00:00Z"
```

Stages are `requirements`, `specification`, `tickets`, `implementation`, `review`, and `complete`. Statuses are `in-progress`, `ready`, `blocked`, and `complete`.

`ready` means the complete plan is waiting for the user's implementation instruction. Set `implementation_base_sha` when implementation starts so a resumed review has a stable Git baseline. It is internal resume state, not something the user approves.

## Requirements

`requirements.md` contains:

- feature description and scope;
- the sources read, by path and heading;
- user stories;
- named acceptance criteria;
- the interfaces the feature presents, with design references when a design source is configured;
- the data and integrations it needs, with their contract source;
- quality constraints and open product questions.

Use `None` with a reason when a section genuinely does not apply — a feature with no rendered interface, or none that calls an external service.

## Specification

`specification.md` records the solution shape and relevant decisions, including a test plan expressed as named public boundaries and behaviours. It does not repeat product requirements or invent numeric decision and seam identifiers.

## Ticket

```yaml
---
title: Request a password reset email
status: planned
depends_on: []
skills: [tdd]
---
```

Ticket filenames and dependency values are kebab-case slugs. Ticket statuses are `planned`, `in-progress`, `blocked`, `deferred`, and `done`. The body contains `Outcome`, `Requirements`, `Implementation`, `Tests`, and `Done when` sections; a `deferred` ticket adds `## Deferred` naming the gate it waits for, and a `blocked` ticket adds `## Blocked` naming the decision it needs.

`skills` lists only skills whose role is *implements a ticket*. Run `npx collab-swarm packs` to see them; the validator rejects anything else.

## Small change

A recorded [small change](WORKFLOW.md#small-changes) is one file in place of a plan, `<plans>/<change-slug>/change.md`, seeded from `templates/change.md`:

```yaml
---
title: Show a zero price as "Free"
status: in-progress
base_sha: 1a2b3c4d
---
```

Statuses are `in-progress` and `complete`. `base_sha` is the Git SHA recorded before the first code change. The body contains `What changes`, `Why`, `Acceptance criteria`, `Out of scope`, and `Tests`; `None.` is a complete answer for `Out of scope`. A directory holds a `change.md` or a `plan.yml`, never both. An unrecorded small change writes no file.

## Delivery history

Finished plans are [compacted](WORKFLOW.md#compacting-history) into one file, `<plans>/HISTORY.md`, seeded from `templates/history.md`. It replaces the directories it lists, so it stays shorter than any one of them:

```markdown
## M1 · Entry

A signed-out visitor can browse and sign in with a PIN; every screen mounts in the tab shell.

| Slug | Title | Status | Completed | Commit | Notes |
| --- | --- | --- | --- | --- | --- |
| `pin-sign-in` | Sign in with a mobile number and PIN | delivered | 2026-09-30 | 3f9c2a1b7d4e | Lockout after five attempts is ADR 0004. |
| `guest-home` | Browse the catalogue before signing in | superseded | 2026-09-12 | 81d0e6c2a9f3 | Replaced by `guest-home-v2`. |
| `wallet-sync` | Sync the wallet in the background | dropped | 2026-08-20 | 5e7b19c0d2a4 | Abandoned at specification; the PRD no longer asks for it. |
```

Tables with a `Slug` and a `Status` column are parsed; column order is free.

- **`Slug`** — the plan or change directory that was removed. A slug is either a live directory or a history row, never both.
- **`Status`** — `delivered`, `superseded` (delivered, then replaced: the notes name the replacement as a backticked slug), or `dropped` (never finished). The first two count as done on the board; `dropped` does not.
- **`Commit`** — the last commit on the default branch that touched the directory. It must hold `<plans>/<slug>/`, and `npx collab-swarm history` reports a row whose commit does not.
- **`Notes`** — one line: what a reader would not guess from the title, where a lasting decision went, what was lifted into the backlog, what replaced it.

Group plan rows under the milestone headings of the backlog, with one sentence per milestone saying what it demonstrated; recorded small changes go under `## Small changes`. Two optional tables record what was retired from the backlog: `## Settled questions` (`Decision`, `Question`, `Answer`, `Recorded in`), which the board reads as answered, and `## Closed gates` (`Gate`, `Owner`, `Closed`, `Notes`), for the reader only.

The history is not a changelog or an event log: one row per compacted directory, written once, and never a record of who did what when.

## History and verification

Git records edits to plan artifacts and code. Test commands and review results are reported in the task and, when valuable long-term, in normal project documentation. The workflow does not create approval hashes, revision copies, event logs, attempt leases, traceability matrices, or evidence directories.
