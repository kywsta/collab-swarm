# Feature delivery workflow

**Workflow version:** 1

This is the shared contract for planning and implementing one feature. It keeps the artifacts a developer actually reads: requirements, a technical specification, and executable tickets. Git owns history; tests and reviews verify the result.

It is deliberately language and framework agnostic. What the project uses, where its truth lives, and which commands verify a change all come from `collab-swarm.yml` and from the skill packs installed alongside this file.

## Where features come from

The backlog is one Markdown file — `backlog:` in `collab-swarm.yml` — holding the milestones, the feature register, the human gates and the decisions register. It is the swarm's queue: a row is claimed by a branch, done when its plan is complete on the default branch, and never offered while a dependency, an open gate or an unanswered decision stands in its way. `to-backlog` writes and reorders it from the project's sources, ordered by dependency and cut so every lane has work; `whats-next` reads it.

A row is planned from the [sources](#sources-of-truth), so a capability no source describes is shaped before it is registered: `new-feature` researches what exists, interviews until the behaviour is settled, writes the product, design and API documents, and hands the rows to `to-backlog`. A change to behaviour a source already describes skips that and goes straight to a plan.

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
2. Use `implement`, which applies TDD and the concern skills the ticket names, through the pack's router when it has one.
3. Run the [project checks](#project-checks) with a ticket-focused test path.
4. Mark the ticket `done` only after its behaviour and checks pass.
5. After all tickets are done or deferred, review the full feature diff with `code-review`, and with every review-role skill an installed pack adds, for the surfaces that changed.
6. Repair blocking findings and run the full [project checks](#project-checks).
7. Mark the plan complete and report the delivered behaviour, review result, and commands run.

Use the current checkout unless the user or repository policy asks for another branch or worktree. Parallel ticket work is optional and requires independent tickets; it is not part of the default path.

## Sources of truth

Requirements contain product facts, not implementation design. Where those facts live is declared under `sources:` in `collab-swarm.yml`; read that list first, then read the sources it names.

A source is cited by path and heading, never summarised from memory. For each source kind:

- **product** — the behaviour the feature must have, and how it will be judged. Cite the file and heading.
- **design** — which screens or components a surface must match. An index is a map to the design tool, not a substitute for the design: open the linked node during implementation or review when visual or interaction detail matters.
- **api** — the operations, payloads and error cases the feature works with. Cite each one and where it came from, whether a local contract file or a connected server.
- **domain** — the words to use in code, tests and plans. Add a term before inventing one.
- **decisions** — open product questions and the working assumptions standing behind them.

A project declares the kinds it has, and a kind with no counterpart here is omitted rather than stubbed. A service that renders nothing declares no design source and lists the operations and events it exposes as its interfaces; an app that calls a contract it does not define declares `api` and never edits it.

**Read or owned.** `owned: true` marks a contract this repository *defines*: a feature extends it as part of delivery, and an operation or surface it lacks is the work itself, added here and cited by everything downstream. Every other source is *read*: the contract is taken as given, and something the feature needs but the contract lacks is a gate — planned around with a stand-in and one deferred ticket, never invented. The same `api:` source therefore means opposite things to the service that defines it and the app that calls it, and this flag is what tells them apart. It belongs on a contract a feature reads or extends; the project's own registers — the product documents, the vocabulary, the decisions — are written here whoever else reads them, so they carry no flag, and `validate` reports one that does.

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

`skills` may name only skills whose role is *implements a ticket*. `npx collab-swarm packs` lists them, and the validator rejects any other name — a coordinator, a router, a review skill and a reference skill are each reached another way, not by scheduling them.

A ticket that waits on an external gate the feature can ship without (an API another team owes, a third-party account) is `deferred`, with a `## Deferred` section naming what it waits for and who owns it. Deferred tickets do not block review or completion and are reopened as `planned` when the gate closes. `blocked` is for a ticket that stops the feature until the user decides; it records the decision it needs under `## Blocked`.

## Implementation

Changed behaviour starts with a failing test at a public boundary named in the specification's test plan. Use `tdd` for the loop, and the smallest set of concern skills each slice needs.

Which concern skills exist depends on the installed packs. Read the ticket's `skills` list, and consult `npx collab-swarm packs` when a slice touches a concern the ticket did not anticipate. Generated files remain machine-owned: change the annotated source, then regenerate.

A pack with several concerns ships a **router**: one skill that reads the ticket and selects the smallest applicable set for each slice, so a ticket touching only error handling never loads the navigation skill. Where a router exists, `implement` uses it once per slice instead of reading every concern skill the pack ships. A router is never named in a ticket; nor is a review skill. Only ticket-role skills are.

## Stack skills

The workflow above knows nothing about the stack. What the project is written in, the conventions it has settled on, and the way its libraries are actually used live in a **stack pack**: a router, one skill per concern, path-scoped rules, and the checks they need.

A pack is installed (`npx collab-swarm add collab-swarm-pack-go`) or written for this project from its own code (`to-pack`, which researches the repository and authors one). Either way the skills are vendored into every agent's directory by `sync`, so the same concern is implemented the same way by every developer and every agent.

A project with no pack is not broken — `implement` falls back to TDD and the code already present — but nothing owns any concern, so each agent decides afresh how this project builds an endpoint or a screen. Write the pack once the second feature repeats the first one's decisions.

## Project checks

One command set, run from the repository root through one command. The commands live under `checks:` in `collab-swarm.yml`, so a human, an agent and CI run exactly the same set.

```bash
npx collab-swarm check                       # full set
npx collab-swarm check --focus <test path>   # ticket verification
npx collab-swarm check --ci                  # verify formatting instead of rewriting it
npx collab-swarm check --only test           # one named check
```

A ticket runs it with a focused test path; completion and cross-cutting work run the full set. `npx collab-swarm validate` checks the workflow contract and every plan, and belongs in the same set.

## Review and completion

Review the whole feature against two questions:

1. Does the diff follow repository and architecture standards?
2. Does it deliver the requirements and specification?

Run every review-role skill an installed pack provides, for the surfaces that changed.

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

The names come from the sources themselves: a document's title and headings, the decisions register's question column, the gate tracker's title and owner cells, the milestone headings in the delivery plan, and ticket titles. `npx collab-swarm status` already prints them beside each id. Plan documents keep citing path, heading, and decision id, because they are looked up later; this section governs what is said to the user.

## Session name

A session that has claimed a row is about that feature from then on, and the name it carries in the agent's session list should say so. Sessions opened through `whats-next` otherwise all keep the question that started them — "What's next?", "Find next development task" — and a developer holding six of them cannot tell which one carries the work they want.

Rename on the claim, not before: until a row is claimed the session really is a board reading, and a claim that loses the race renames nothing. Take the name from the claimed row: its title in [plain names](#plain-names), cut to the few words that identify it when the register's title is a whole sentence. "Guest home screen", not "A guest can browse the catalogue before signing in", and not `guest-home`. Add nothing that moves — no stage, no status, no lane, no id — or the name is stale by the next commit.

Do it with whatever the host offers for naming or titling the current session — in the Claude Code desktop app that is `set_session_title` on `self`, and other hosts name theirs differently or have none. Hosts that offer nothing simply skip it: the session name is a convenience for the human's list, it is never what records the claim, and it is never worth asking the user about.

## Escalation

Stop and ask the user when progress requires new product behaviour, conflicting source resolution, a destructive migration, a new secret or external permission, an unresolved security or privacy decision, or meaningful scope expansion. Make reversible local implementation choices autonomously.

## Validation

Run `npx collab-swarm validate` after creating or changing a plan and before reporting completion. Validation checks package shape, required sections, ticket dependencies, statuses, and skill names. It deliberately does not recreate human traceability or evidence bureaucracy: no approval hashes, revision copies, event logs, attempt leases, traceability matrices, or evidence directories.
