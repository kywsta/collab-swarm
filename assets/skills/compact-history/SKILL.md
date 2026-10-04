---
name: compact-history
description: Compact the project's finished work — completed feature plans, recorded small changes, superseded or abandoned plans, delivered milestones, closed gates and answered questions — into one short delivery history, and remove what it replaces. Use when the user asks to clean up, compact, archive or summarise the project history, or says the plans directory or the backlog has grown hard to read.
---

# Compact History

Turn the pile of finished plans into one short [delivery history](../../workflow/ARTIFACTS.md#delivery-history), and clear what it replaces out of the places where live work is looked for. Read the [workflow contract](../../workflow/WORKFLOW.md#compacting-history) first: it says what compacting may touch and what it never does.

This skill deletes files, so it is held to one standard throughout: **nothing is removed that Git cannot give back, that the board still needs, or that the user has not agreed to.** It writes no feature code and plans no feature.

## 1. Survey

Read `collab-swarm.yml` for `plans`, `backlog`, `sources` and the Git settings. Start from an up-to-date default branch with a clean working tree, and create a branch for this pass whose name does not start with `branchPrefix` from the config, which the board would read as a claim — a chore branch such as chore/compact-history.

```bash
npx collab-swarm history          # the history, every plan directory's verdict, what the backlog can retire
npx collab-swarm history --json   # the same, with every commit and count, for writing rows
npx collab-swarm status --json    # the board before: the picture that must not change
```

`history` gives each directory under the plans a verdict. **Ready** is complete, held by the default branch exactly as it is here, and owes nothing. **Deferred work** is complete but still owes a deferred ticket. **Orphaned** never finished, has no backlog row, and has not been touched for weeks. **Unmerged** is complete here but not on the default branch. **Live** is in progress. It also lists the milestones whose every row is done, the gates no longer open that nothing unfinished names, and the questions answered that nothing unfinished cites. A history row it marks with ✗ names a commit that cannot give its plan back: fix that row before adding any.

Then look past the plans for documents that have outlived their use: notes, drafts and one-off plans committed beside the sources — anything no source declares, no live document links to, and the code no longer bears out. List them with the reason; never list a file declared under `sources:`.

Done when every directory's verdict and every retirable backlog entry is in hand, and the board's current state is recorded.

## 2. Judge what each one is

The verdicts are mechanical; three questions are not, and each needs the plan read, not just listed.

**Was it superseded?** A ready plan whose behaviour a later plan, a small change, or the current code has since replaced — the same screen rebuilt, the same endpoint re-shaped, a flow removed. Check later plans' requirements and the code the plan's tickets touched. A superseded plan is the most important one to compact: its requirements still read as true and are not. Name what replaced it.

**What lasts?** A plan holds three kinds of content, and only two of them outlive it:

- *Product facts.* Normally already in the sources the requirements cite. A behaviour the requirements state, the code delivers, and no source holds — settled in an interview, or a working assumption that became the behaviour — would be lost with the plan.
- *Lasting engineering decisions.* A specification choice that still constrains the code, such as an invariant, a boundary or a library committed to, belongs in the architecture decisions. Check whether delivery already recorded it there.
- *Everything else* — the ticket breakdown, sequencing, the test plan, answered questions about scope — is spent. Git keeps it; the history does not repeat it.

**What is owed?** For each **deferred work** directory, the deferred ticket's gate, owner, and what it would deliver. It can become a backlog row of its own (its gate in `Depends on`, sized from the ticket), after which the plan is ready; or the plan stays until the gate closes.

For each **orphaned** directory, read why it stopped: superseded by another plan, abandoned with the user's agreement, or simply stalled. Only the first two are compactable, as `superseded` or `dropped`; a stalled plan is reported, not compacted.

Done when every candidate is judged superseded, delivered, dropped, or kept, and every product fact, lasting decision and owed ticket that would be lost has a named destination.

## 3. Agree the scope

Present the whole proposal in one message, in [plain names](../../workflow/WORKFLOW.md#plain-names), and ask for one answer:

- the plans and small changes to compact, grouped by milestone, with each superseded one and what replaced it;
- the orphaned plans proposed as dropped or superseded, with why;
- the deferred tickets to lift into the backlog as rows, and which plans stay because their tickets are kept;
- the product facts and decisions to promote, and where each goes;
- the milestones, gates and questions to retire from the backlog;
- the documents outside the plans proposed for deletion, each with its reason;
- and the size of the result: directories and lines removed, rows the history gains.

Never decide a supersession, a drop, a promotion into a source, or a deletion outside the plans on the user's behalf. A user who agrees to part of it gets exactly that part.

Done when the user has said which of the proposal to carry out.

## 4. Promote what lasts

Before anything is deleted, move what the user agreed to keep:

- a lasting engineering decision into the architecture decisions, in `domain-modeling`'s [ADR format](../domain-modeling/ADR-FORMAT.md), citing the plan by its commit;
- a product fact into the product source, only where that source is this project's own, worded as behaviour and not as history;
- a lifted deferred ticket into the backlog as a row, following the [backlog format](../to-backlog/BACKLOG-FORMAT.md): a new slug naming the outcome, the plan's lane, its gate in `Depends on`, and its sources cell pointing at the plan's commit. Then the ticket is deleted with the plan, and the plan is ready.

Done when every agreed promotion is written, and every directory the user agreed to compact is ready or settled as superseded or dropped.

## 5. Write the history

Create `<plans>/HISTORY.md` from the [history template](../../workflow/templates/history.md) when it does not exist, and add one row per compacted directory, in the [format](../../workflow/ARTIFACTS.md#delivery-history):

- **Commit** — exactly the commit `history --json` reports for that directory: the last commit on the default branch that touched it.
- **Completed** — the date of that commit.
- **Status** — `delivered`, `superseded`, or `dropped`, as agreed.
- **Notes** — one line a reader could not get from the title: what replaced it, where its lasting decision went, which row its deferred work became. Leave it empty rather than restating the title.

Group plan rows under the backlog's milestone headings, oldest first, and give each milestone one sentence saying what it demonstrated once its rows are all here. Small changes go under `## Small changes`. Questions retired from the backlog go under `## Settled questions` with the answer and where it is now recorded, so the board still reads them as answered; gates go under `## Closed gates`.

The history must stay short enough to read in a minute. A row is one line; a milestone is one sentence. Anything longer belongs in the source it was promoted to, or in Git.

Done when every agreed directory has exactly one row, each with a commit that holds it.

## 6. Remove and retire

Delete each compacted directory with `git rm -r`, so the deletion is staged with the history that replaces it, and delete the documents outside the plans the user agreed to.

Then reconcile the backlog, changing nothing a live row needs:

- a milestone whose every row is delivered loses its table, and its heading keeps one line pointing at its section of the history;
- a gate or question on the retirable list leaves its table, together with the steps written under that gate's heading;
- a working assumption whose question is now answered is removed.

Keep every row of a milestone that is still in progress, done or not: the board shows a milestone's progress from them. Never renumber an id or rename a slug.

Done when every compacted directory is gone, the backlog holds only what the board still needs, and nothing outside the agreed scope changed.

## 7. Verify and report

```bash
npx collab-swarm validate
npx collab-swarm history
npx collab-swarm status --json
```

`validate` must pass, and `history` must show no ✗ row and none of the compacted directories. Compare `status` with the picture from step 1: every row still in the backlog keeps its state, and every row removed was done. A row that changed state means something it depended on was retired; restore it before going further.

Report in [plain names](../../workflow/WORKFLOW.md#plain-names): how many plans and changes were compacted and how many lines removed, which were superseded or dropped and why, where each promoted decision and fact now lives, which deferred tickets became rows, what the backlog retired, and what was kept and why. Committing and opening the pull request stay the user's call; the commit message says what was compacted, since the diff is mostly deletions.

Done when validation passes, the board is unchanged for every live row, and the user can see what went where without opening the history.
