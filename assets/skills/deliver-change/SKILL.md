---
name: deliver-change
description: Plan or implement one feature when the user asks for an implementation plan, feature delivery, or resumption of an existing feature plan.
---

# Deliver Feature

Coordinate one feature through requirements, specification, tickets, implementation, and review. Read the [workflow contract](../../workflow/WORKFLOW.md) and [artifact formats](../../workflow/ARTIFACTS.md). This skill owns `plan.yml` and ticket statuses; stage skills own their document content.

## 1. Open the plan

Read `collab-swarm.yml` for the plans directory, the sources, and the check commands. Search that directory for the same feature outcome.

Resume a matching open plan, including a lone `plan.yml` at stage `requirements` left by `npx collab-swarm claim`. Otherwise create `<plans>/<feature-slug>/` from the shared templates. Use a readable kebab-case slug, not a sequence number.

A plan is written from the sources, so a request whose behaviour no source describes goes to `new-feature` first, which interviews the user, writes the product, design and API documents, and registers the feature. A request that changes behaviour a source already describes is planned here.

Run `npx collab-swarm validate` before resuming an existing plan.

Done when one package owns the feature and its current stage is known.

## 2. Build the complete plan

Run all planning stages in one pass:

1. Use `to-requirements` to write `requirements.md` from the configured sources and applicable project constraints.
2. Use `to-spec` to write `specification.md` from the requirements and current codebase.
3. Use `to-tickets` to write descriptive vertical tickets.
4. Set the plan to `stage: tickets` and `status: ready`, validate it, and present the plan by feature outcome, interfaces, data, approach, ticket order, risks, and open questions, in [plain names](../../workflow/WORKFLOW.md#plain-names): document headings, the question a decision asks, what a gate waits for and who owns it, milestone names, ticket titles.

Stop when a required source is missing or contradictory. Continue through local technical choices that the specification can safely own.

Done when the user can judge the whole plan without opening a register: every sentence still says what it means with its ids removed, and no internal workflow state is shown.

## 3. Respect the requested boundary

When the user asked only to plan, stop after presenting the complete plan. Start implementation when the request already includes delivery or the user says to implement or proceed.

Before code changes, record the current Git SHA as `implementation_base_sha`, then set `stage: implementation` and `status: in-progress`.

Done when either the plan is ready for the user or implementation has a stable review base.

## 4. Implement tickets

Select the next ticket whose named dependencies are `done`. Mark it `in-progress`, use `implement`, then mark it `done` only after its behaviour and checks pass.

Mark a ticket `blocked` when it cannot proceed, record the decision it needs under `## Blocked`, and report that decision to the user. Mark it `deferred` with a `## Deferred` section when it waits on an external gate the feature can ship without, such as an API another team owes; deferred tickets do not block review.

Work sequentially in the current checkout by default. Use separate branches or worktrees only when the user or repository policy requests them, or when genuinely independent tickets justify the coordination cost.

Done when every ticket is done or deferred, or a concrete user decision blocks the feature.

## 5. Review and finish

Set `stage: review`. Run `code-review` over the full diff from `implementation_base_sha`. Then run every skill an installed pack provides whose role is *reviews one surface*, for the surfaces the diff touched — `npx collab-swarm packs` lists them with their roles. Fix every blocking finding and repeat affected checks and reviews.

Run the full [project checks](../../workflow/WORKFLOW.md#project-checks) with `npx collab-swarm check`. Synchronise affected domain, architecture, routing, and design documentation when the delivered change altered those contracts.

Set `stage: complete` and `status: complete`. Report, in [plain names](../../workflow/WORKFLOW.md#plain-names), the delivered behaviour, tests and checks, review outcome, advisory follow-ups, deferred tickets with what each waits for and who owns it, and any merge or deployment action still owned by the user.

Done when the feature is implemented, reviewed, verified, documented, and accurately reported.
