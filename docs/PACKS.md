# Writing a skill pack

The core workflow is deliberately ignorant of your stack. It knows how to turn a request into requirements, a specification, tickets, and a reviewed diff — but nothing about HTTP handlers, Riverpod providers, Django models, or Terraform state. A **pack** supplies that.

Two kinds of pack, same format:

- **A published pack** for a stack somebody has already packaged — installed with `npm install -D collab-swarm-pack-go && npx swarm add collab-swarm-pack-go`, and written to be true of every project using that stack. This document is how you write one.
- **A stack pack for one project**, written from that project's own code: the call adapter everything routes through, the base class every handler extends, the wrapper used instead of raw exceptions. None of that generalises, so it is authored in the repository rather than installed. Ask an agent to run the `to-pack` skill, which researches the codebase and writes it into `.collab-swarm/packs/<name>/`. Everything below still applies — `to-pack` follows this format.

## What a pack contributes

Three things, all optional except the first:

| Contribution | Effect |
| --- | --- |
| **Skills** | New capabilities, published into every configured agent target |
| **Rules** | Path-scoped invariants, loaded only while matching files are open |
| **Checks** | Commands offered for `collab-swarm.yml` when the pack is added |

## Layout

```text
collab-swarm-pack-<name>/
├── collab-swarm-pack.json      # the manifest (required)
├── package.json                # only if published to npm
├── skills/
│   └── <skill-name>/
│       ├── SKILL.md            # required; its front matter `name` must match the folder
│       └── examples.md         # optional companions, published alongside
└── rules/
    └── <rule-name>.md          # optional
```

## The manifest

```json
{
  "name": "go",
  "title": "Go",
  "description": "Go concerns: HTTP endpoints, sqlc queries, and worker jobs.",
  "collabSwarm": 1,
  "skills": [
    { "name": "http-endpoint", "role": "ticket" },
    { "name": "sqlc-query", "role": "ticket" },
    { "name": "go-concurrency", "role": "reference" }
  ],
  "checks": [
    { "name": "vet", "run": "go vet ./..." },
    { "name": "test", "run": "go test ./...", "focus": "go test {path}" }
  ]
}
```

A skill directory with no manifest entry defaults to `role: ticket`.

### Roles

Role is the pack's most important decision: it decides how a skill can be reached, and the validator enforces it.

| Role | Meaning | Reached by | May a ticket name it? |
| --- | --- | --- | --- |
| `coordinator` | Owns a feature end to end | the user | No |
| `stage` | Runs one stage of the workflow | the workflow | No |
| `router` | Selects the concern skills a slice needs | `implement`, per slice | No |
| `ticket` | Implements one concern of a slice | a ticket's `skills` | **Yes** |
| `review` | Reviews one surface a diff cannot judge | `deliver-change`, at review | No |
| `reference` | Vocabulary consulted while deciding | being read | No |

Most pack skills are `ticket`. Use `reference` for a skill that shapes a decision but never owns a slice of work — a design vocabulary, a concurrency model, a house style. A reference skill listed in a ticket's `skills` is a validation error, because scheduling it implies an owner it does not have.

Ship a **router** once the pack has four or more concerns. Without one, an agent reads every concern skill on every slice; with one, it reads the router and then only what the slice needs. `swarm doctor` says so when a pack crosses that line.

Ship a **review** skill for a surface whose correctness a diff cannot show — a rendered screen against its design, a query plan, an accessibility pass. `deliver-change` runs every review-role skill at feature review, for the surfaces that changed.

Packs may not add `coordinator` or `stage` skills that replace the core ones; a later pack overriding a core skill name replaces its file, which is how you customise `code-review` for a house standard.

### Checks

Checks are *suggested*, not imposed: `swarm add` shows them and asks before appending to `collab-swarm.yml`. A check whose `name` the project already uses is skipped, so a pack never silently replaces a command the team tuned.

Fields: `run` (required), `name`, `focus` (`{path}` is substituted by `check --focus`), `ci` (used by `check --ci`), and `when` (a path that must exist for the check to run).

## Writing the skill

Read the `writing-for-agents` skill the core pack installs — it is the reference for this exact task. The short version:

**The description is the trigger.** It is the only part loaded on every turn, and it decides whether the skill is ever read. Front-load what the skill does, then list the distinct cases that should reach it:

```yaml
---
name: http-endpoint
description: Add or change an HTTP endpoint — route, request and response types, validation, error mapping, and its contract test. Triggers on an endpoint, handler, payload schema, or status-code decision.
---
```

**Write the process, not the output.** A skill that produces a good result once is a template. A skill that makes the agent take the same *steps* every run is a skill. Give each step a "Done when" that names an observable condition.

**Keep the body short and put the bulk behind a pointer.** A 500-line `SKILL.md` is read once and skimmed thereafter. Put the recipe in `SKILL.md` and the worked examples in a companion file the skill links to.

**Never reference a specific repository.** A pack is installed into repositories you have not seen. Say "the project's API source", not `docs/api-specs.yaml`; the project declares where that is under `sources:` in `collab-swarm.yml`, and the agent reads it there.

## Writing the rule

A rule is the always-available short form of a skill: the three or four invariants a reviewer would catch, scoped to the files they apply to.

```markdown
---
paths:
  - "src/**/routes/**"
  - "src/**/handlers/**"
description: Invariants for HTTP endpoints — validation at the edge, one failure mapping, contract-shaped responses.
---

# HTTP endpoint rule

Recipe: [`http-endpoint`](../skills/http-endpoint/SKILL.md).

- Validate at the edge and reject with the documented status before doing any work.
- Map a domain failure onto its status in one place.
- Return the response type the contract names, never the storage type.
```

`paths` is required and must match something. The emitter translates it per target: Claude Code keeps `paths`, Cursor gets `globs` plus `alwaysApply`, and links to the workflow documents are repointed so they resolve from wherever that target keeps its rules.

Keep the `Recipe:` link to the skill that satisfies the rule. It is how a reader gets from the invariant to the procedure, and `npx swarm steps` reads it too: a rule that links to a skill is reported as in force for every step of it, which is the only way an invariant scoped to source files can be tied to the work that writes them.

## Testing a pack

```bash
# From a scratch repository with collab-swarm already installed:
npx swarm add ../path/to/your-pack
npx swarm packs          # roles and rule scopes, as installed
npx swarm steps <skill>  # your steps, their completion criteria, and the rules in force
npx swarm validate       # a ticket may now name your ticket skills
```

Confirm four things:

1. Your ticket skills appear under *implements a ticket* in `packs` output and in the generated `AGENTS.md`.
2. A ticket naming one of them validates; a ticket naming a reference skill does not.
3. `steps` reads back the sequence you wrote, every step closing on a completion criterion, and `steps --rules` shows your rule in force where you meant it. A step that reports no criterion is usually one that never stated one.
4. Every link in your `SKILL.md` and rule resolves from its published location, in each target you support.

## Publishing

Name the package `collab-swarm-pack-<name>` (or scope it, `@acme/collab-swarm-pack-<name>`) so it is findable, and include `collab-swarm-pack.json`, `skills/` and `rules/` in `files`. Consumers then:

```bash
npm install -D collab-swarm-pack-go
npx swarm add collab-swarm-pack-go
```

The pack spec is recorded in `collab-swarm.yml`, so a teammate's `npm install && npx swarm sync` reproduces the same agent files exactly.

## Porting an existing skill set

If you already have skills in `.claude/skills/`, a pack is mostly a move:

1. Copy the skill directories into `skills/`.
2. Write the manifest, assigning a role to each.
3. Replace every repository-specific path with the source kind it stands for (`docs/prd/**` becomes "the project's product source").
4. Replace project-specific commands with `npx swarm check`.
5. Move the always-on invariants into `rules/`, scoped with `paths`.
