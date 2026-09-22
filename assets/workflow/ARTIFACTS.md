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

## History and verification

Git records edits to plan artifacts and code. Test commands and review results are reported in the task and, when valuable long-term, in normal project documentation. The workflow does not create approval hashes, revision copies, event logs, attempt leases, traceability matrices, or evidence directories.
