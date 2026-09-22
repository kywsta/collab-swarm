---
name: to-spec
description: Turn a feature requirements file into a technical specification with explicit architecture, data, lifecycle, failure, interface, and test decisions for the current codebase.
---

# Write Feature Specification

Read the [workflow contract](../../workflow/WORKFLOW.md), [specification format](SPEC-FORMAT.md), `requirements.md`, the relevant source contracts, and the current code and tests.

## 1. Verify the requirements

Confirm that the feature description, stories, acceptance criteria, interfaces, operations, and open questions are coherent. Return unresolved product behaviour to `to-requirements`.

Done when technical design can proceed without guessing product intent.

## 2. Design the implementation

Prefer the deep modules and boundaries the codebase already has over new ones. Read the relevant concern skills of the installed packs before deciding a concern they own — `npx collab-swarm packs` lists them — so the specification and the implementation use the same vocabulary.

For an operation the requirements recorded as missing, map the types and the deterministic stand-in to the shape the feature will build against, including its error cases.

Decide only relevant concerns: domain rules and interfaces, data and integration mapping, the dependency graph and lifetimes, state and concurrency, failure behaviour, interface composition and interaction, security, observability, performance, accessibility, localization, compatibility, migration, and rollback.

Consult `codebase-design` as a reference when a public interface remains genuinely unsettled; it is a vocabulary, not a stage. Use descriptive headings and names; do not create decision or seam numbers.

Done when implementation requires no important unrecorded technical choice.

## 3. Define the test plan

Name the public boundary, observable behaviour, and test level for each important behaviour. Prefer feature or module interfaces that survive internal refactoring. State any behaviour that needs manual evidence, and why it cannot be executed.

Done when TDD can start at clear public boundaries and every acceptance criterion is covered by the plan as a whole.

## 4. Hand back

Write `<plans>/<feature-slug>/specification.md`. Report readiness to `deliver-change`; it records the plan stage. Run `npx collab-swarm validate`.

Done when the specification validates and is concrete enough to split into vertical tickets.
