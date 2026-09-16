---
name: to-tickets
description: Split a feature specification into a small dependency-ordered set of descriptive vertical tickets.
---

# Write Feature Tickets

Read the [workflow contract](../../workflow/WORKFLOW.md), [ticket format](TICKET-FORMAT.md), requirements, specification, and relevant code.

## 1. Find vertical outcomes

Split the feature into the fewest tickets that each deliver independently demonstrable behaviour and fit one focused agent context. Keep the layers a single behaviour needs together in one ticket. Add prefactoring only when it makes a later behaviour ticket materially safer.

Name every ticket by outcome, such as `request-reset-email`, rather than by a sequence number.

Done when each ticket has a visible result and the set covers the complete feature.

## 2. Order the work

Use ticket slugs in `depends_on`. Prefer a simple sequence. Add parallel branches only when tickets are truly independent. Reject cycles, horizontal layer batches, duplicate work, and oversized tickets.

Choose the smallest applicable skill list. Behavioural tickets normally include `tdd` plus the concern skills the slice touches. Run `npx collab-swarm packs` to see which skills a ticket may name: only those whose role is *implements a ticket*. Coordination skills and reference skills such as `codebase-design` and `domain-modeling` are read when needed, never listed here.

Done when at least one ticket can start and every dependency represents a real implementation prerequisite.

## 3. Write and present

Write one file per ticket under `<plans>/<feature-slug>/tickets/` with `status: planned`. Each ticket names the requirements it delivers, implementation constraints, tests, and a concrete done condition.

When the requirements record a missing external dependency, plan the feature on a deterministic stand-in and add one `connect-<feature-slug>-<dependency>` ticket with `status: deferred` and a `## Deferred` section naming what it waits for and who owns it. A deferred ticket does not block review or completion; it is reopened as `planned` when the dependency arrives.

Report readiness to `deliver-change`; it sets `stage: tickets` and `status: ready`. Run `npx collab-swarm validate` and present the ticket order by descriptive title, dependencies, and outcome, in [plain names](../../workflow/WORKFLOW.md#plain-names); a deferred ticket says what it waits for and who owns it, such as "the customer API contract from Backend".

Done when the complete plan is readable, valid, and ready for the user's implementation instruction.
