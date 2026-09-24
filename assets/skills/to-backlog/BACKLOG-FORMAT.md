# Backlog format

The file at `backlog:` in `collab-swarm.yml` is Markdown a team edits by hand, and a parser reads. Everything below is what the parser requires; prose, tables and sections beyond it are free. Start from [the template](../../workflow/templates/backlog.md).

## Document shape

```markdown
# <Project> delivery plan          — how the board reads this file
## Where the project stands        — what is already built, so sizes mean something
## Delivery principles             — the few rules every row obeys
## Human gates                     — one section per gate, then the gate tracker
## Decisions register              — open questions, then working assumptions
## Milestones and feature register — one heading and one table per milestone
## Dependency graph                — the chains and the cross-lane hand-offs, at a glance
## Risks                           — what would break the order, and the mitigation
## Maintaining this plan           — what to update the day it changes
```

Sections are keyed by the reader's need, not by the parser: only the milestone headings and the three table kinds are read. The template seeds the gates, the decisions and the register; the rest is added as the project grows enough to need it.

## Milestone headings

```markdown
### M2 · Discovery (weeks 9–14)
```

A heading of two to four `#` that starts with `M<number>` opens a milestone. The rest of the line is its name, after an optional separator (`·`, `:`, `—`, `-`), with one trailing parenthetical dropped — that heading is read as `M2 Discovery`. Every register table must sit under one of these; a table under any other heading belongs to no milestone and sorts ahead of `M0`.

## Feature register

```markdown
| Slug | Title | Sources | Owner | Size | Depends on |
| --- | --- | --- | --- | --- | --- |
| `pin-sign-in` | Sign in with a mobile number and PIN | docs/prd/02-auth.md §2 | Dev 1 | M | `app-shell`, G3, D9 |
```

Columns are matched by header name, so they may be renamed and reordered. `Slug` and `Title` are required; the rest are optional and each accepts aliases:

| Column | Aliases accepted | Read as |
| --- | --- | --- |
| Slug | id, feature, key | the plan directory and the branch name |
| Title | name, summary, description, outcome | one sentence naming the outcome a user gets |
| Sources | source, prd, prd/figma, spec, refs, references | where the behaviour is written, by path and heading |
| Owner | lane, assignee, dev, who, team | the lane, matching a name in `lanes:` |
| Size | estimate, points, effort | `XS`, `S`, `M`, `L`, `XL` |
| Depends on | depends, dependencies, blocked by, waits on, needs | everything the row waits for |

The slug cell is kebab-case, normally in backticks. `Depends on` mixes three kinds of blocker in one cell, each resolved differently:

- **`` `other-slug` ``** — another row, freed when its plan is complete on the default branch. Backticks are what mark it as a slug.
- **`G<n>`** — a human gate, freed when the tracker's status stops saying `open`.
- **`D<n>`** — a product decision, freed by an answer or by a recorded working assumption.

The phrase *every earlier feature* (or *all features*) in that cell expands to every row in an earlier milestone, which is how a release-readiness row waits for the whole backlog without listing it.

Add no status column: a row's state is derived from Git — claimed by a branch, done by a complete plan on the default branch — and a hand-maintained status cell only contradicts it.

## Gate tracker

```markdown
| Gate | Owner | Blocks | Status | Closed on |
| --- | --- | --- | --- | --- |
| G4 Firebase projects per flavor | Dev 1 | M0 exit | closed | 2026-09-11: four flavors registered; residual work rides a deferred ticket |
| G2 Customer API contract | Backend | M2+ live adapters | decided: mock-first, one deferred connection ticket per row | 2026-09-08 |
```

Any table with a `Gate` column is read as the tracker. The cell carries the id and the gate's title; `Owner` and `Status` are read, the rest is for the reader.

**Status is the switch.** Empty or starting with `open` blocks every row naming the gate. Anything else — `closed`, `decided: …` — does not. A gate named by a row but absent from the tracker blocks, because nobody has said otherwise.

Write each gate's steps above the tracker, under its own heading, so the owner can act without asking what "closed" means.

## Decisions register

```markdown
| Decision | Question | Asked by | Status | Answer |
| --- | --- | --- | --- | --- |
| D1 | Which of listings, details and search are open to a signed-out visitor? | Dev 2 | open | |
| D8 | Confirm the supported viewports and text-scale ceiling. | Developers | decided | The proposed values stand; the design document is the policy. |

### Working assumptions

| Decision | Working assumption | What a different answer changes |
| --- | --- | --- |
| D1 | Listings and details are open; only holdings and payment require an account. | One redirect rule and the guest home's entry points. |
```

Any table with a `Decision` or `Question` column is read as a decisions table. A question is settled — and stops blocking — when its `Status` says anything other than `open`, when its `Answer` cell is filled, or when it appears under a heading mentioning **working assumption**. The distinction is reported back to the reader, so an assumption is never mistaken for an answer.

A separate decisions file configured under `sources: decisions:` is parsed the same way and merged with this one, so a question settled in either is settled. Two files mean two places to look, so keep the questions in one of them and let the other hold none.

## Reserved column names

A table is classified by its headers before its rows are read: a `Gate` column makes it the gate tracker, a `Decision` or `Question` column makes it a decisions table. Keep those words out of the feature register's headers, or its rows disappear from the board.

## Keep out

Secrets and credentials, ticket numbers from an external tracker, revision tables and changelogs (Git is the history), per-row status columns, and any restatement of how a feature is planned and built — that contract lives in `WORKFLOW.md` and has to stay true in one place.
