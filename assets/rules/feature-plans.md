---
paths:
  - ".docs/changes/**"
  - "docs/changes/**"
description: Invariants for feature plan documents — plan.yml, requirements, specification and tickets.
---

# Feature plan rule

Full contract: [the workflow](../workflow/WORKFLOW.md) and [artifact formats](../workflow/ARTIFACTS.md).

- `plan.yml` is owned by `deliver-change`. Stage moves forward one step at a time and never leaves `complete`; `ready` is only valid once ticketing is finished.
- Record `implementation_base_sha` before the first code change, so a resumed review has a stable base.
- Every required section must exist and carry content. A concern that does not apply says `Not applicable` and why, rather than standing empty.
- Requirements hold product facts and cite their source by path and heading. Architecture, type names and file layout belong in the specification.
- A ticket's front matter carries only `title`, `status`, `depends_on`, and `skills`; `skills` names only ticket-role skills, which `npx collab-swarm packs` lists.
- Dependencies name other ticket slugs, form no cycle, and a ticket becomes active only once they are `done`.
- A `deferred` ticket names what it waits for under `## Deferred`; a `blocked` ticket names the decision it needs under `## Blocked`.
- Run `npx collab-swarm validate` after changing any of these files.
