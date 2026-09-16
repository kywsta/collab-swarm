---
name: to-requirements
description: Create a feature requirements file from the project's configured sources of truth — product documents, design indexes, API contracts, domain vocabulary and the decisions register.
---

# Write Feature Requirements

Write product behaviour into one readable `requirements.md`. Read the [workflow contract](../../workflow/WORKFLOW.md) and [requirements format](REQUIREMENTS-FORMAT.md). When invoked by `deliver-change`, it owns plan status.

## 1. Gather feature sources

Read `collab-swarm.yml` first: `sources:` declares which kinds of truth this project has, where each lives, and which are required. Then read them.

- **product** — find the requested feature and cite the file and heading.
- **design** — search the index for every matching screen, component and node reference. Cite the index path, matching rows, and the references UI work will need. An index is a map, not the design: open the linked node when visual or interaction detail matters and the connector is available, and mark detail unverified when it is not.
- **api** — inspect the required operations in the contract file, or in the connected server when the contract is exposed that way. List each operation and where it came from.
- **domain** — use the project's own words in stories, criteria and names. Add a term there before inventing one.
- **decisions** — check whether an open question already has an answer or a working assumption.

When an operation the feature needs exists in no contract, that is a **gate**, not an open product question: record it under `Constraints and open questions` with the shape the feature will build against, so `to-tickets` can plan the stand-in slice and one deferred connection ticket. It never stops planning.

A project that declares no sources plans from the user's request and the existing code and tests, and says so in the Sources section.

Product behaviour comes only from the sources. A question they leave open goes to the decisions register as a question and to this file's open questions, never into a decision made here. When that register already records a working assumption, build on it, cite the decision id, mark the criterion assumed, and keep the question listed so an answer changes a ticket rather than the plan.

Done when every required source is read or named as an open question.

## 2. Write the product contract

Start from the shared requirements template. Write:

- a concise description and explicit scope;
- the sources read, by path and heading, with what was taken from each;
- user stories named in plain language;
- named, observable acceptance criteria covering success, empty, error, recovery, privacy, accessibility and permission states where they affect the user;
- the interfaces the feature presents, with design references and required states;
- the data and integrations it needs, with their contract source;
- relevant quality constraints;
- unresolved product questions.

Use `None` with a reason for a section that genuinely does not apply. Keep architecture, type names, and file changes in the specification.

Done when a developer can explain what to build, which designs to open, which operations to use, and how the behaviour will be judged.

## 3. Hand back

Write `<plans>/<feature-slug>/requirements.md`. Report readiness and any blocking questions to `deliver-change` in [plain names](../../workflow/WORKFLOW.md#plain-names): each question as the question itself, each source as its heading, each gate as what it waits for and who owns it. `deliver-change` records the plan stage and status. Run `npx collab-swarm validate`.

Done when the file validates and contains no unresolved placeholder or implicit product decision.
