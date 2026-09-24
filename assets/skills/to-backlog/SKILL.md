---
name: to-backlog
description: Write or update the delivery plan the board reads — milestones, the feature register, the human gates and the decisions register — from the project's product, design and API documents, ordered by dependency and cut so every lane has work on day one. Use when a project has no backlog, when new product documents land, when the register has drifted from what is being built, or when a milestone must be resequenced.
---

# Write the Delivery Plan

One Markdown file is the backlog every human and agent picks from, and Git is the tracker. Its path is `backlog:` in `collab-swarm.yml`. `npx collab-swarm status`, `next` and `claim` parse it, so its tables are a contract: read the [backlog format](BACKLOG-FORMAT.md) before writing, and the [workflow contract](../../workflow/WORKFLOW.md) for what a feature and a gate mean here.

This skill decides **what gets built, in what order, by whom, and what a human must do first**. It never writes feature code, and it never plans one feature in detail — a claimed row goes to `deliver-change`.

## 1. Read the ground

Read `collab-swarm.yml` first: `backlog`, `sources`, `lanes`, `plans`. Then read the sources it names — every product document, the design index, the API contract, the domain vocabulary, the decisions register. A source marked `owned: true` is a contract this repository defines rather than consumes, which decides whether a gap in it becomes a gate or a row.

Then read what already exists, because a register written against an empty repository invents work that is already done:

```bash
npx collab-swarm status      # the current board, if a backlog is already there
npx collab-swarm packs       # which concerns have skills, which do not
```

Walk the codebase for the surfaces, data and infrastructure already in place, and read the existing backlog when there is one.

Documents the user points at that `sources:` does not declare are read the same way, and then added under `sources:` with a `use:` line, so every plan written later cites them instead of rediscovering them; run `npx collab-swarm sync` after editing the config.

Ask the user only what neither the sources nor the code answer: which lanes exist and who is in them, and any capability they intend that no document describes. A capability with no document is not registered from a conversation — it goes to `new-feature`, which writes the document first.

Done when every behaviour in the sources maps either to something the repository already delivers or to work this pass will register, and the lanes are named.

## 2. Cut the work into features

A row is one **vertical outcome**: something a user can be shown, delivered by one plan, one branch, one pull request. Not a layer (*"the data layer for rewards"*), not an epic (*"rewards"*), not a task (*"add a button"*).

- Merge two rows that would touch the same files for the same behaviour a week apart.
- Split a row whose plan would not fit one focused agent context, or that mixes two outcomes a user would describe separately — usually along the flow, never along the layers.
- Size relatively: `S`, `M`, `L`. The scale is for ordering and balancing lanes; calendar dates belong to the team, not to this file.
- Give each row a short kebab-case slug naming the outcome. The slug becomes a branch name and a plan directory, so it is chosen once and never renamed.

Enabling work counts as a row when a user-visible outcome depends on it: the shell every screen mounts in, the shared component kit, the pipeline that runs the checks.

Done when every behaviour the sources describe sits in exactly one row, each row names an outcome rather than a layer, and each has a slug, a lane and a size.

## 3. Order by dependency, then cut for parallel work

Draw the real prerequisites first: a screen needs the shell, a purchase needs the balance, a list needs the component kit. An edge is a prerequisite only when the later row cannot be built or demonstrated without the earlier one. Anything softer is sequencing preference, and it costs parallelism — leave it out.

Then arrange the graph so the swarm is never serialised:

1. Group rows into chains that stay inside one domain, and give each chain to a lane, so a lane's rows depend mostly on that lane's own rows.
2. Count the cross-lane edges. Each one is a hand-off someone waits on; move rows between lanes until few remain, and name the survivors explicitly so they get sequenced early in their milestone.
3. Name the files more than one lane will touch — the router, the dependency registry, the shared component directory, the string catalogue — and give each a single owning lane, with a one-line rule for how another lane adds to it.
4. Milestones are demo points along the dependency depth, not fences. Each milestone states in one sentence what can be demonstrated when it ends, and holds rows for **every** lane, so nobody waits for another lane's milestone to finish.

Where a row depends on something a human owes (an account, a contract, a decision), plan around it rather than after it: the row is built against a stand-in and carries one deferred connection ticket. That keeps a slow gate from serialising the graph.

Done when the graph is acyclic, every lane has at least one row it can start on day one of every milestone, cross-lane hand-offs are counted and named, and each shared file has one owning lane.

## 4. Name the human gates and the open questions

A **gate** is work only a human can do: an account, a credential, a signing key, a contract another team owes, a product decision nobody has made. Give each one an id, a title, the person or role who owns it, what it blocks, and the steps that close it. A contract this repository owns (`owned: true` on its source) never becomes a gate: the row that needs the operation is the row that defines it.

A gate's tracker status is load-bearing: `open` hides every row that names it from everyone. So write `open` only where work genuinely cannot start. Where the work can proceed against a stand-in, record the decision to do so in the status cell instead, and let the row carry a deferred ticket for the real connection.

A question the sources leave open goes to the decisions register with the id the rows cite, who asked it, and who answers. Where the team can proceed on a working assumption, record the assumption and what a different answer would change; the question stays open, and the rows stop being blocked by it.

Done when every gate has an owner and a status, every `open` gate genuinely stops the rows that name it, and every open question either carries a working assumption or is named as the reason a row is blocked.

## 5. Write the file

Write `backlog:` following [the backlog format](BACKLOG-FORMAT.md), seeded from [the template](../../workflow/templates/backlog.md) when the file does not exist yet.

Updating an existing plan is a reconciliation, not a rewrite: keep every slug already claimed or done exactly as it is, keep the rows they depend on, and add, resequence or retire the rest. A row that turned out to be wrong is deleted with its reason noted in the commit message, not marked with a status column — state is derived from Git.

The plan says **what** is being built and **who waits on whom**. How a feature is planned, implemented, reviewed and completed lives in the workflow contract; restating it here creates a second copy to keep true.

Done when the file holds the milestones, the register, the gate tracker and the decisions register, every claimed and done slug survived unchanged, and nothing in it duplicates the workflow contract.

## 6. Verify and report

```bash
npx collab-swarm status      # every row, its state, and why a blocked row is blocked
npx collab-swarm next        # what the swarm would be offered first
npx collab-swarm validate
```

`status` is the proof: it reads the file back the way every agent will. A row missing from its output has a malformed table or sits under no milestone heading; a row blocked for a reason you did not intend has a gate, decision or dependency cell that says more than you meant.

Report in [plain names](../../workflow/WORKFLOW.md#plain-names): the milestones and what each demonstrates, how many rows each lane can start now, the gates that hold work up with what each waits for and who owns it, the questions still to be answered, and the hand-offs between lanes. Ids trail in parentheses; the sentence must still make sense without them.

Done when `status` lists every row in the intended state, `validate` passes, and the user can see what the swarm will pick up next without opening the file.
