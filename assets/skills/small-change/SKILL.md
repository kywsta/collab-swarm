---
name: small-change
description: Make a small, bounded change — a fix, a tweak, a copy or config change — without a full feature plan, when the user asks for one directly and it fits in a single ticket. States a short contract, asks whether to record it, builds test-first, and reviews the diff against that contract.
---

# Small Change

Deliver one small change without requirements, specification and tickets. The change still has a contract — what changes, why, and how a reviewer knows it is right — because `code-review` judges a diff against one; it is just short, and the user decides whether it is committed. Read the [workflow contract](../../workflow/WORKFLOW.md#small-changes).

A small change is not on the delivery board: it claims no row and is never offered by `whats-next`.

## 1. Confirm it is small

Read `collab-swarm.yml` for the plans directory, the sources, and the check commands. Find the code the request touches before judging its size.

It is small only when every one of these holds:

- it fits one ticket: one outcome, one focused agent context;
- it changes no behaviour that no source describes, or only behaviour the user has just stated exactly and a source does not contradict;
- it needs no new secret, external permission, destructive migration, or operation another team owes;
- it does not continue an open feature plan — work that belongs to a plan under `<plans>/` goes to `deliver-change`.

When one fails, say which in [plain names](../../workflow/WORKFLOW.md#plain-names) and hand the request to `deliver-change`, or to `new-feature` when no source describes the behaviour. Do not start a plan the user did not ask for.

Done when the change is confirmed small, or handed off with the reason.

## 2. State the contract and ask whether to record it

Write the contract in a few lines:

- **What changes** — the observable behaviour after the change.
- **Why** — the defect, request, or source heading that motivates it.
- **Acceptance criteria** — one to three named, observable statements.
- **Out of scope** — what a reviewer should not expect, when that is not obvious.
- **Tests** — the public boundary where the change will be tested, or why it needs no new test.

Present it and ask the user two things in one message: whether the contract is right, and whether to record it in the repository. Recording suits a change someone will later ask "why did this change?" about, or one another session may resume; an unrecorded change keeps its contract in the conversation and the commit message. Never decide for the user, and ask again on every small change — one answer is not a standing preference unless the user says it is.

Done when the user has confirmed the contract and said whether to record it.

## 3. Open the change

Record the current Git SHA as the review base before any code change.

When the user chose to record, create `<plans>/<change-slug>/change.md` from the [change template](../../workflow/templates/change.md), with `status: in-progress` and the base SHA, and run `npx collab-swarm validate`. Use a readable kebab-case slug that names the outcome, not a sequence number. When the user chose not to, keep the contract and base SHA in the conversation.

Work in the current checkout. If the repository's policy wants a branch, name it for the change and avoid the claim prefix in `collab-swarm.yml`, which marks a row on the delivery board.

Done when the change has a stable review base and, if recorded, a valid `change.md`.

## 4. Build it

Use `tdd` for each changed behaviour, and the installed pack's router when it has one, exactly as `implement` would for a one-ticket plan. Documentation, generated output, mechanical configuration, and visual-only changes may skip a new failing test when the contract's **Tests** says why.

Run the [project checks](../../workflow/WORKFLOW.md#project-checks) with a focused path:

```bash
npx collab-swarm check --focus <test path>
```

If the work outgrows the contract — a second outcome, a product question, a concern the contract did not anticipate — stop, tell the user what grew, and either amend the contract with their agreement or hand the work to `deliver-change`.

Done when the acceptance criteria are observable through the named boundary and the focused checks pass.

## 5. Review against the contract

Run `code-review` over the diff from the recorded base. Give the Feature reviewer the contract: the recorded `change.md`, or the confirmed contract from the conversation. A review without it is a standards review only, which is not enough. Run every review-role skill an installed pack provides for the surfaces the diff touched.

Fix every blocking finding and repeat affected checks and reviews. Then run the full set:

```bash
npx collab-swarm check
```

Update a source marked `owned: true` in the same diff when the change altered what it describes, and the domain vocabulary or architecture decisions when it altered those.

Done when no blocking finding remains and the full check set passes.

## 6. Finish

When recorded, set `status: complete` in `change.md` and run `npx collab-swarm validate`. When not, put the contract's what and why in the commit message or pull request body, so the reason survives the conversation.

Report, in [plain names](../../workflow/WORKFLOW.md#plain-names), the delivered behaviour, the tests and checks run, the review outcome, advisory follow-ups, and any commit, merge or deployment action still owned by the user.

Done when the change is implemented, reviewed against its contract, verified, and accurately reported.
