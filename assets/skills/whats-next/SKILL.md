---
name: whats-next
description: Report delivery status and propose the next unclaimed features when the user asks "what's next", "what should I work on", "how's it going", or "where are we"; claim a chosen row so nobody else is offered it.
---

# What's Next

Answer two questions about the delivery plan without the human reading it: **how is it going** and **what should I pick up next**.

The feature register in the project's backlog file is the list of work, and Git is the tracker: a branch named for a row is the **claim** on it, and that row's plan complete on the default branch is **done**. Nothing outside the repository records state, so every developer and every agent sees the same board after one fetch.

The mechanics live in `npx collab-swarm`; this skill runs them and presents the result. It writes no feature code: a claimed row goes to `deliver-change`.

## 1. Read the board

Run one command from the repository root:

```bash
npx collab-swarm status              # "How's it going?" — counts, claims, gates, then the top three
npx collab-swarm next --lane "Dev 2" # "What's next?" — only the top three, the asker's lane first
```

Both fetch the remote with prune first; add `--no-fetch` offline. Pass `--lane` when the user names their lane ("I'm Dev 2", "I'm on backend"); otherwise leave it out and each proposal shows its own lane.

The tool derives every row's state: **done** (plan complete on the default branch), **in progress** (a claim branch on the remote, with holder and plan stage), **available**, or **blocked** (a dependency not done, a gate whose tracker status is open, or a decision with neither an answer nor a working assumption). Proposals are ranked by earliest milestone, the named lane, most rows unblocked, then size.

Done when the command has run and its output is in hand. If it fails, report the error verbatim; do not reconstruct the board by hand. When the project has no backlog file yet, or its register holds no rows, say so and offer `to-backlog`, which writes one from the project's sources.

## 2. Present it

Relay the output in [plain names](../../workflow/WORKFLOW.md#plain-names), in this order, skipping empty parts. The tool prints each gate's title and owner, each milestone's name, and each decision's question beside their ids; carry those names into every bullet and let the id trail in parentheses:

- the one-line summary (milestone, counts);
- who holds what, with plan stage and how long since their last commit, and any **stale** claim or **unpushed** plan visible only in this checkout;
- the gates blocking rows of the current milestone, each as what it waits for and who owns it, such as "Firebase projects per flavor, owned by Dev 1 (G4)";
- the top three, each with what it unblocks and what lets it start, and one sentence on which you recommend and why. When fewer than three are available, say what would free the next row.

Never propose a row the tool lists as claimed or blocked. When the output looks wrong against the backlog (a row missing, a gate misread), say so and point at the table cell; the parser reads the register tables, the gate tracker, and the decisions register verbatim.

Done when the user can choose by reading three bullets that make sense without the backlog open.

## 3. Claim on pick

When the user picks a row ("start 2", "let's do guest-home", "I'll take it"), the working tree must be clean; then:

```bash
npx collab-swarm claim <slug>
```

The tool re-fetches, refuses a row that is claimed, done, blocked, or unknown (relay its reason and offer the next proposal), creates the claim branch from the default branch, commits the plan skeleton at stage `requirements`, and pushes. A rejected push means another developer won the race: the tool restores the checkout and names the winner.

On success the checkout is on the claim branch. Hand off to `deliver-change` with the feature's title and the sources cell from its register row; it resumes the plan the claim created. Start `deliver-change` in the same turn when the user asked to begin work, not only to claim.

Done is automatic: merging the pull request puts the complete plan on the default branch, and the next fetch shows the row as done.
