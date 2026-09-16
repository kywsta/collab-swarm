# {{project}} delivery plan

The feature register below is the backlog every human and agent picks from, and Git is the tracker. Nothing outside this repository records state.

- A row is **claimed** by the branch `{{branchPrefix}}<slug>` on `{{remote}}`.
- A row is **done** when `{{plans}}/<slug>/plan.yml` is complete on `{{defaultBranch}}`.
- A row is **blocked** while a dependency is not done, a gate it names is open, or a decision it names has neither an answer nor a working assumption.

```bash
npx collab-swarm status      # the whole board
npx collab-swarm next        # the best unclaimed rows
npx collab-swarm claim <slug>
```

## Delivery principles

1. One feature is one plan. No plan, no code.
2. Behaviour comes from the sources, not from invention. A question the sources leave open is recorded here, not answered in code.
3. A missing external dependency is planned around, never waited on: build against a stand-in and carry one deferred ticket for the real connection.

## Human gates

A gate is work only a human can do: an account, a credential, a contract another team owes, a decision someone must make. A row that names an open gate is not offered to anyone.

### Gate tracker

| Gate | Owner | Blocks | Status | Closed on |
| --- | --- | --- | --- | --- |
| G1 Example: production credentials | Ops | the release milestone | open | |

Status values: `open` blocks; anything else (`decided`, `closed`, a note) does not. Delete the example row once the real gates are listed.

## Decisions register

Developers append questions here; only the decider answers them. A question with a working assumption stops blocking, and the assumption says what a different answer would change.

| Decision | Question | Asked by | Status | Answer |
| --- | --- | --- | --- | --- |
| D1 | Example: which plan tiers may redeem a voucher? | Dev 1 | open | |

### Working assumptions

A row listed here is treated as settled for planning even while its question stays open.

| Decision | Working assumption | What a different answer changes |
| --- | --- | --- |

## Feature register

One row per feature. The `Slug` cell is the plan directory and the branch name, so keep it short, kebab-case, and stable. `Depends on` may name other slugs in backticks, gate ids, and decision ids together.

Column headers are matched by name, so add or reorder columns freely; `Slug` and `Title` are the two the board requires.

### M0 · Foundation

Goal: state what "this milestone is finished" means, in one sentence.

| Slug | Title | Sources | Owner | Size | Depends on |
| --- | --- | --- | --- | --- | --- |
| `example-feature` | One sentence naming the outcome a user gets | where its requirements live | Dev 1 | S | G1 |

### M1 · Next milestone

| Slug | Title | Sources | Owner | Size | Depends on |
| --- | --- | --- | --- | --- | --- |
| `another-feature` | Another outcome | where its requirements live | Dev 2 | M | `example-feature` |

## Maintaining this plan

Update a gate's status the day it changes; a stale `open` row hides work the swarm could already start. Add a register row before starting the work, not after: the row is how everyone else learns the work exists.
