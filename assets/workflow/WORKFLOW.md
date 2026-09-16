# Feature delivery workflow

**Workflow version:** 1

This is the shared contract for planning and implementing one feature. It keeps the artifacts a developer actually reads: requirements, a technical specification, and executable tickets. Git owns history; tests and reviews verify the result.

It is deliberately language and framework agnostic. What the project uses, where its truth lives, and which commands verify a change all come from `collab-swarm.yml` and from the skill packs installed alongside this file.

## Package

One feature plan lives at `<plans>/<feature-slug>/`, where `<plans>` is the `plans:` directory in `collab-swarm.yml` (`.docs/changes` by default):

```text
.docs/changes/password-recovery/
├── plan.yml
├── requirements.md
├── specification.md
└── tickets/
    ├── request-reset-email.md
    └── handle-reset-result.md
```

Use a short kebab-case feature slug. Reuse an existing open plan when it describes the same outcome. Create another plan only for a distinct outcome.

`plan.yml` records where work should resume. `deliver-change` owns its stage and status and each ticket's status. The content skills own their Markdown files.

## Flow

The normal path is:

```text
requirements → specification → tickets → implementation → review → complete
```

Planning is one uninterrupted pass:

1. `to-requirements` grounds the feature in the project's configured sources.
2. `to-spec` decides how the current codebase will implement it.
3. `to-tickets` splits it into small vertical outcomes.
4. `deliver-change` presents the complete plan in [plain names](#plain-names).

When the user asked only for a plan, stop after presenting it. "Implement", "proceed", or an equivalent instruction starts implementation. A material product ambiguity blocks planning; a local technical choice does not.

Implementation follows the ticket order and dependency names:

1. Mark the next unblocked ticket `in-progress`.
2. Use `implement`, which applies TDD and the concern skills the ticket names.
3. Run the [project checks](#project-checks) with a ticket-focused test path.
4. Mark the ticket `done` only after its behaviour and checks pass.
5. After all tickets are done or deferred, review the full feature diff with `code-review`, and with any review skill an installed pack adds for the surfaces that changed.
6. Repair blocking findings and run the full [project checks](#project-checks).
7. Mark the plan complete and report the delivered behaviour, review result, and commands run.

Use the current checkout unless the user or repository policy asks for another branch or worktree. Parallel ticket work is optional and requires independent tickets; it is not part of the default path.

## Sources of truth

Requirements contain product facts, not implementation design. Where those facts live is declared under `sources:` in `collab-swarm.yml`; read that list first, then read the sources it names.

A source is cited by path and heading, never summarised from memory. For each source kind:

- **product** — the behaviour the feature must have, and how it will be judged. Cite the file and heading.
- **design** — which screens or components a surface must match. An index is a map to the design tool, not a substitute for the design: open the linked node during implementation or review when visual or interaction detail matters.
- **api** — the operations, payloads and error cases the feature may use. Cite each required operation and where it came from, whether a local contract file or a connected server.
- **domain** — the words to use in code, tests and plans. Add a term before inventing one.
- **decisions** — open product questions and the working assumptions standing behind them.

A source marked `required: true` must be read before planning proceeds. A project that declares no sources plans from the user's request and the code already present, and says so.

Write acceptance criteria as named, observable statements. Names such as **Unknown email privacy** are useful to humans and can be linked from tickets. Numeric traceability IDs are not part of this workflow.

If a required source is missing or contradictory, write the question under `Constraints and open questions`. When the decisions register records a working assumption for that question, plan on the assumption, mark the affected criteria as assumed with the decision id, and continue; otherwise stop before technical planning. Mark unrelated concerns `Not applicable` with a short reason.

## Specification

The specification turns requirements into engineering decisions. It covers only relevant concerns: domain boundaries, data and integration mapping, dependency graph and lifetimes, state and concurrency, failure behaviour, interface and interaction, security, observability, performance, accessibility, localization, migration, and rollback. A concern an installed pack owns is decided in that pack's vocabulary.

The `Test plan` names the public boundaries where behaviour will be tested. These are ordinary interface or feature names, not seam identifiers. If implementation exposes a product ambiguity, return to requirements. If it exposes a materially different architecture choice, update the specification before continuing.

## Tickets

A ticket is a vertical outcome that fits one focused agent context. Its filename is its descriptive slug. Frontmatter contains only title, status, dependencies, and applicable skills.

Tickets link to named requirements and specification sections where useful. Each ticket states:

- the behaviour to deliver;
- the relevant requirements;
- implementation constraints;
- tests and checks;
- a concrete done condition.

Dependencies use ticket slugs. The graph must be acyclic, and a ticket starts only when its dependencies are done. Prefer a short sequential list over an elaborate graph unless the feature is genuinely parallel.

`skills` may name only skills whose role is *implements a ticket*. `npx swarm packs` lists them, and the validator rejects any other name — coordination and reference skills are reached by reading them, not by scheduling them.

A ticket that waits on an external gate the feature can ship without (an API another team owes, a third-party account) is `deferred`, with a `## Deferred` section naming what it waits for and who owns it. Deferred tickets do not block review or completion and are reopened as `planned` when the gate closes. `blocked` is for a ticket that stops the feature until the user decides; it records the decision it needs under `## Blocked`.

## Implementation

Changed behaviour starts with a failing test at a public boundary named in the specification's test plan. Use `tdd` for the loop, and the smallest set of concern skills each slice needs.

Which concern skills exist depends on the installed packs. Read the ticket's `skills` list, and consult `npx swarm packs` when a slice touches a concern the ticket did not anticipate. Generated files remain machine-owned: change the annotated source, then regenerate.

## Project checks

One command set, run from the repository root through one command. The commands live under `checks:` in `collab-swarm.yml`, so a human, an agent and CI run exactly the same set.

```bash
npx swarm check                       # full set
npx swarm check --focus <test path>   # ticket verification
npx swarm check --ci                  # verify formatting instead of rewriting it
npx swarm check --only test           # one named check
```

A ticket runs it with a focused test path; completion and cross-cutting work run the full set. `npx swarm validate` checks the workflow contract and every plan, and belongs in the same set.

## Review and completion

Review the whole feature against two questions:

1. Does the diff follow repository and architecture standards?
2. Does it deliver the requirements and specification?

Run any additional review an installed pack provides for the surfaces that changed.

Blocking findings are correctness, security, privacy, data-loss, architecture, accessibility, requirement, or failing-check problems. Fix them before completion. Advisory findings may be reported as follow-up work.

Completion requires every ticket done or deferred, no blocking review finding, generated sources current, and the full check set passing. Update the domain vocabulary, architecture decisions, routing instructions, or design system when the delivered change alters those contracts.

## Plain names

Everything said to the user in conversation — a plan presentation, the delivery board, a ticket handback, a review, or a completion report — is written for someone who has never opened the registers. The registers key their rows with short ids: document numbers, decisions such as `D6`, gates such as `G2`, milestones such as `M6`. Inside a document those keys are citations a reader can follow; in conversation they are noise. Speak in **plain names**: say what the row is about, and let the key trail once in parentheses as the handle for finding it. The check is to delete every id from the sentence: it must still tell the reader what is meant.

| Register key | Plain name |
| --- | --- |
| a document and section number | the document and the heading: "the analytics requirements, under *Acceptance criteria*" |
| `D6` | the question itself and who answers it: "Product has not yet said which unmeasured metrics the rewrite must instrument (D6)" |
| `G2` | what is awaited and who owns it: "the customer API contract from Backend (gate G2)" |
| `M6` | the milestone by name: "the account and measurement milestone (M6)" |
| a working assumption | what is assumed now, and what the answer would change |
| a ticket slug | the ticket's title |

A plan presentation, before and after:

> Sources. Requirements 23 sections 2.2, 3.2, 4.1 and 5, plus delivery principle 5. Open questions. D6 stays open and the plan follows its working assumption. I raised D22 in the decisions register.

> Sources. The analytics requirements: their acceptance criteria, the browsing events, the defects in what fires today, and the data and privacy rules, plus the delivery plan's principle that analytics is designed in from the first milestone. Nothing from the design index or the API contract, since the feature renders nothing and events leave through adapters that arrive with the account and measurement milestone. Open questions. Product has not yet said which unmeasured metrics the rewrite must instrument (D6); the plan builds on the developers' working assumption, the current taxonomy, so a different answer changes one routing row or one key. I added a question to the decisions register (D22): the requirements require failure events but never say which event family they belong to. It does not block this port, and Product must answer it before the instrumentation feature names its first failure event.

The names come from the sources themselves: a document's title and headings, the decisions register's question column, the gate tracker's title and owner cells, the milestone headings in the delivery plan, and ticket titles. `npx swarm status` already prints them beside each id. Plan documents keep citing path, heading, and decision id, because they are looked up later; this section governs what is said to the user.

## Escalation

Stop and ask the user when progress requires new product behaviour, conflicting source resolution, a destructive migration, a new secret or external permission, an unresolved security or privacy decision, or meaningful scope expansion. Make reversible local implementation choices autonomously.

## Validation

Run `npx swarm validate` after creating or changing a plan and before reporting completion. Validation checks package shape, required sections, ticket dependencies, statuses, and skill names. It deliberately does not recreate human traceability or evidence bureaucracy: no approval hashes, revision copies, event logs, attempt leases, traceability matrices, or evidence directories.
