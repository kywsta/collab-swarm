---
name: implement
description: Implement one in-progress ticket from a feature plan using TDD, the ticket's concern skills, focused verification, and a clean handback.
---

# Implement Ticket

Implement one ticket. `deliver-change` owns ticket status and feature-level review. Read the [workflow contract](../../workflow/WORKFLOW.md), the ticket, requirements, specification, and the project's domain vocabulary when it has one.

## 1. Fix the outcome

Confirm the ticket is `in-progress`, its dependencies are `done`, and its named requirements, specification constraints, public test boundaries, and skills are clear. If a product decision is missing, return to `deliver-change`.

Done when the ticket has one concrete outcome and no unresolved prerequisite.

## 2. Build in red-green slices

Use `tdd` for each changed behaviour. Before editing a concern, read the skill that owns it: the ticket's `skills` list is the plan, and `npx swarm packs` names the rest if the diff reaches a concern the ticket did not anticipate. Run the smallest relevant test after each slice. Change annotated sources before regenerating their outputs.

Documentation, generated output, mechanical configuration, and visual-only token changes may skip a new failing test when the ticket records why and another check demonstrates correctness.

Done when the ticket's behaviour is observable through the specification's public test boundaries and all focused tests pass.

## 3. Verify the ticket

Run the [project checks](../../workflow/WORKFLOW.md#project-checks):

```bash
npx swarm check --focus <ticket test path>
```

It runs the project's configured commands in order and validates the plan. Then inspect the diff for unrelated changes, hand-edited generated files, secrets, and missed documentation.

Done when the ticket is production-ready, focused, and green.

## 4. Hand back

Summarise, in [plain names](../../workflow/WORKFLOW.md#plain-names), the behaviour implemented, the files or modules affected, the tests and checks run, and any advisory follow-up; cite requirements by criterion name and sources by heading. Do not create an evidence package or modify plan status.

Done when `deliver-change` can mark the ticket done without reconstructing what changed.
