# Source documents

A **source** is durable product truth, keyed by capability and owned by the project. A plan's `requirements.md` is one feature's reading of it, keyed by that plan and thrown away with it. The test for where a statement belongs: would a second feature need to know this? Then it is a source. Is it only how this one change will be judged? Then it is the plan's own requirements.

Which kinds exist here, and where each lives, is `sources:` in `collab-swarm.yml`. Write into the paths it declares; a kind the project has not declared is added there, with `use:` saying in one line what a planner should take from it.

Everything below is content, not layout. Match the shape of the documents the project already has.

## Product document

The behaviour, and how it will be judged. One document per capability, named so a planner finds it by the words a user would use.

- **Outcome** — what changes for whom, in two or three sentences. No solution design.
- **Stories**, named in plain language, each with **acceptance criteria** that are observable: given a situation, when the user acts, then something specific is true. Name each criterion, because tickets and reviews cite it by name.
- **States** every criterion set must cover where they affect the user: empty, loading, failure and recovery, offline, no permission, signed out.
- **Non-goals** — the boundaries agreed in the interview, written as flatly as the goals.
- **Data and privacy** — what is collected, what is shown to whom, what leaves the device or the service.
- **Open questions** — each one also in the decisions register, so the board can see what it blocks.

Keep architecture, type names, file layout and library choices out; those are a plan's specification, and they go stale here.

## Design specification

Written where this project has surfaces to draw. A service whose only interface is its contract declares no design source and describes its operations and events in the API contract instead; leaving this document out is a shape, not an omission.

One entry per surface the feature presents: its purpose, the states it must render, the actions it offers, and the rules a developer cannot see in a picture — ordering, truncation, pagination, what a long value does, what a failure looks like next to an empty result.

Where a design tool is connected, cite the file and the node reference for each surface, and treat the index as a map to the design, not a substitute for it. Where there is no design tool, the words are the design: describe layout and interaction precisely enough that two developers would build the same screen.

## API contract

The operations the feature works with: path or name, method, request and response shape, error cases, pagination, and the header or envelope conventions the project has settled on.

Which way this document is written depends on `owned:` on the source, because the same file means opposite things on each side of the wire:

- **This repository defines it** (`owned: true`) — the operations this feature adds are written here in full, and they are the specification the implementation is judged against. Consumers read this file; nobody is waiting on anyone. A ticket delivers the operation and the contract entry together.
- **This repository consumes it** — an operation another team owes and has not delivered is **proposed**, not missing: write the shape the feature will build against, mark it proposed with the team that owns it, and record the wait as a gate in the delivery plan. The feature is then built against a stand-in, with one deferred ticket for the real connection, and nothing waits.

## Domain vocabulary

Every word this feature introduces, defined once, in the form the code, the tests and the plans will all use. Add the term here before inventing a synonym for something the project already names.

## Decisions register

One row per open question: the question in full, who asked it, who answers it, its status, and the answer when it comes. A question with a **working assumption** carries what the team is proceeding on and what a different answer would change — that pair is what lets planning continue while the answer is slow.

The delivery plan's rows cite these by id, and the board reads them, so the ids stay stable and a question is never deleted once cited: it is answered.

## Keep out of all of them

Secrets and credentials, external ticket numbers, revision tables and changelogs (Git is the history), estimates and dates (those are the delivery plan's register), and anything the user did not confirm.
