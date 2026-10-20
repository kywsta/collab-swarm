# Rule set format

A rule set is the conventions one repository is built by, kept in the hub that coordinates it. `to-rules` owns the process; this file owns the shapes.

## Layout

```text
.collab-swarm/rules/<name>/
├── STACK.md          # the stack profile
├── rules/
│   └── <concern>.md  # one path-scoped rule per concern
├── skills/           # optional, rarely needed
│   └── <name>-<concern>/SKILL.md
└── research.json     # written by `npx collab-swarm rules <name> --record`, never by hand
```

`<name>` is a repository under `repositories:` in `collab-swarm.yml`, or `root` for the repository holding the configuration. `npx collab-swarm sync` publishes every rule set into each agent target; nothing under `.collab-swarm/rules/` is read by an agent directly.

## Paths are relative to the repository

Every glob in a rule set is written as it would be inside the repository it governs: `app/Http/**`, not `repositories/api/app/Http/**`. Publishing adds the repository's path, renames the rule after it (`api-http-endpoints.md`), and confines a rule with no `paths` to that repository rather than every file in the hub. `validate` reports a glob that repeats the repository's path.

## `STACK.md`

What the repository is built with and what holds everywhere in it. A coordinated repository's profile is published as a rule loaded for its files only; the root's goes into the always-loaded block. Keep it short enough that loading it every time is cheap.

```markdown
---
description: Laravel 12 API on PHP 8.4 — thin controllers, actions for the work, Pest feature tests.
---

Laravel 12 on PHP 8.4, served as a JSON API to the dashboard and the apps.

## Built with

| Library or tool | Version | Used for |
| --- | --- | --- |
| `laravel/framework` | ^12.0 | the application |
| `laravel/sanctum` | ^4.0 | token auth for the apps |
| `pestphp/pest` | ^3.0 | feature and unit tests |

## Layout

<The directories that matter, as a short tree, with what lives in each.>

## Conventions

- <A convention that holds in every file of the repository, in this repository's own identifiers.>

## Sources

- <Each external source a rule rests on: title, URL, the version it describes.>
```

`## Sources` lists what the research read outside the repository. A rule that rests on one of them says so in a line, so a later pass can tell a rule copied from the code from a rule adopted from guidance.

## A rule

```markdown
---
paths:
  - "app/Http/**"
  - "routes/api.php"
description: Invariants for HTTP endpoints — validated requests, resources out, one error shape.
origin: research
---

# HTTP endpoints

- <Invariant, as the behaviour to produce, naming this repository's parts.>
- <Invariant.>
- <Invariant.>
```

- **`paths`** — the directories the concern actually owns, relative to the repository. Required: a rule earns its place by being narrow.
- **`origin`** — `research` when `to-rules` wrote it, `team` when a person did, or a person changed one research wrote. A research pass may revise a `research` rule; it proposes a change to a `team` rule and waits for the user's agreement.
- **`description`** — the line a tool shows when it decides whether the rule applies.
- **Three to six invariants.** The ones a reviewer would catch and a newcomer would miss. A rule that restates the framework's documentation costs tokens on every matching file and teaches nothing.

A rule with the same file name as a rule of the repository's baseline pack replaces it. That is how a rule set builds on a pack: keep the pack's rules that hold, override the ones this repository does differently, and add what the pack does not cover.

## A skill

Only for a concern whose work has an order — the steps a new queue job, migration or screen always goes through — that a rule cannot hold. Follow [the skill formats](SKILL-FORMATS.md): a concern skill with its checklist, and its rule linking to it as the recipe. Name it after the repository, set `role:` in its front matter when it is not `ticket`, and give it a description, which is the only part every agent reads.

## `research.json`

What the repository depended on when the set was last researched: its manifests, and each package with the version it declared. `npx collab-swarm rules <name> --record` writes it from the repository as it is; `npx collab-swarm rules` compares the two and reports added, removed and major-upgraded packages, and rules whose globs match no file. Record it as the last step of a research pass, and commit it with the rule set.
