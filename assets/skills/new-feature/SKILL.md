---
name: new-feature
description: Shape a capability nobody has written down yet — research what the codebase already does, interview the user until the behaviour is settled, write the product, design and API documents it needs, then place it in the delivery plan. Use when a capability is asked for in conversation and no source document describes it, when the request is broad or ambiguous enough that its behaviour is still being invented, or when it contradicts what is already built. A change whose behaviour is already settled — moving a control, fixing a defect, adding a field to a screen that exists — is delivered by `deliver-change` without this skill.
---

# Shape a New Feature

Every plan in this workflow is written from **sources**: the product, design and API documents a project keeps, cited by path and heading. A capability that lives only in a chat message has no source, so a plan written from it invents the behaviour and nobody can check the invention later.

This skill produces the missing source and the backlog rows that deliver it. It writes documents, not code, and it stops before the feature is planned: `deliver-change` plans and builds from what this skill wrote. Read the [workflow contract](../../workflow/WORKFLOW.md) and the [source documents](SOURCE-DOCUMENTS.md) reference.

## 1. Size the request

Two questions decide whether this skill runs at all:

- **Is the behaviour already written down?** Search the configured sources for the surface, flow or data the request names. A request that changes something a document already describes, within that document's scope, is a delivery request: hand it to `deliver-change` and stop. *Move the button to the top*, *the total is wrong on refunds*, *add a middle-name field* are all delivery requests, even when the fix is large.
- **Would two careful readers build different things?** A request whose outcome, states or boundaries are still open needs shaping, whatever its size.

Shaping is also right when the request contradicts what is already built or documented, or when it names a capability no source describes at all.

Say which it is in one sentence, with the document that settles it or the question that does not. When the request is a delivery request, that sentence and the hand-off are the whole job.

Done when the request is named as already-specified or as needing shaping, and an already-specified one is on its way to `deliver-change` instead of through the steps below.

## 2. Research before asking

Questions the repository already answers spend the user's attention for nothing, so read first.

- Read `collab-swarm.yml` for `sources:`, `lanes:` and `backlog:`, then the sources themselves for every area the request touches.
- Follow the same behaviour through the code: the surfaces it would change, the data it would read, the flows it joins, the terms the codebase already uses for them.
- Check the feature register for a row that already covers this outcome, and the decisions register for a question that already asks about it.
- List every **contradiction**: where the request disagrees with a document, with the code, or with a decision already taken. Each becomes a question, written with both readings, not resolved quietly.

Done when the request's surfaces, data and neighbours are named from the repository, any overlapping register row is found, and every contradiction is written down with both readings.

## 3. Interview until it is settled

Ask only what neither the sources nor the code answer. Ask in small batches, each question carrying the answer you would recommend and why, so agreeing is one word. Work through, in order of how much they change the build:

- the outcome, and who it changes something for;
- the boundaries — what is explicitly **not** in this feature;
- the states every surface must handle: empty, loading, failure, offline, no permission, signed out;
- the data it needs and where it comes from, including operations no contract offers yet;
- the rules that decide the edge cases the research turned up;
- how the team will judge it done.

A question whose answers all lead to the same build is not worth asking — make the call, record it as an assumption, and move on. A question the user cannot answer today goes to the decisions register with a working assumption and what a different answer would change.

Then write the settled requirement back in short prose — outcome, scope, the states, what is out of scope, what is assumed — and get an explicit yes. Nothing is written into a document before that yes.

Done when no remaining question would change what gets built, and the user has agreed to a written summary of the feature in plain prose.

## 4. Write the documents

Write what was settled into the project's own sources, following [source documents](SOURCE-DOCUMENTS.md). Which documents exist is `sources:` in `collab-swarm.yml`; typically:

- the **product** document — the outcome, the stories, the named acceptance criteria, the non-goals;
- the **design** specification for each surface the feature presents, with its states and its references into the design tool — a service that renders nothing writes none, and its surfaces are the operations and events below;
- the **API** contract: for a contract this repository owns (`owned: true`), the operations this feature defines, in full; for one it consumes, the shape it will build against, marked proposed against the team that owns it;
- the **domain** vocabulary, for any word this feature introduces;
- the **decisions** register, for every question left open, with its working assumption.

Extend the document that already owns the area rather than starting a rival one; write a new document only for a genuinely new capability. Where the project has no source configured for a kind this feature now needs, propose the path, write the document, add it under `sources:` in `collab-swarm.yml`, and run `npx collab-swarm sync` so every agent reads it.

Nothing enters a document that the user did not confirm. Everything confirmed enters one, because what is not written down is not planned from.

Done when every confirmed statement lives at a path an agent will read, each open question is in the decisions register with its assumption, and no document contains a decision the user never saw.

## 5. Place it in the delivery plan

Use `to-backlog` to put the feature on the board: one row per vertical outcome, sized, in a lane, with its dependencies on existing rows, the gates it waits for, and the decisions it rides on. A feature that reorders what the team should build next resequences its milestone in the same pass.

A capability nobody can build yet still gets its rows, blocked by a named gate with an owner, so the wait is visible to everyone instead of living in one person's head.

Done when the feature is one or more register rows, and `npx collab-swarm status` shows each as available, or blocked for exactly the reason intended.

## 6. Report and hand off

Report in [plain names](../../workflow/WORKFLOW.md#plain-names): what the feature does and for whom, the decisions taken during the interview and who made each, the documents written or extended by heading, the rows added with what each waits for and who owns it, and the questions still open with their working assumptions.

Then name the next move: claim a row (`whats-next`) and plan it (`deliver-change`), which will cite the documents this skill just wrote.

Done when the user can see the feature, its documents, its place in the queue and its open questions without opening any of them.
