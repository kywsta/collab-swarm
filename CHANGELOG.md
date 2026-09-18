# Changelog

## Unreleased

- **Skills for your own stack.** `to-pack` researches the repository — its dependency manifest, its build and lint config, and features already built end to end — and writes the skills and rules that implement in it: a concern router, one skill per concern, path-scoped rules, and the checks they need. The pack lands in `.collab-swarm/packs/<name>/`, is attached with `swarm add`, and is vendored into every agent target by `sync` like any other. `swarm pack new <name>` scaffolds the layout and manifest first, so roles are right before any prose is written.
- **Two new skill roles.** `router` selects the smallest applicable concern set for each red-green slice, so a ticket touching one concern loads one skill rather than the whole pack; `implement` uses it when a pack ships one. `review` reviews a surface a diff cannot judge, and `deliver-change` runs every one at feature review. Neither may be named in a ticket's `skills` — only `ticket` may, as before.
- **`validate` reports a skill with no description and a rule with no `paths`.** The first is never opened by an agent; the second is loaded into every turn. Both were previously silent.
- **`swarm steps`.** The installed skills, read back as an execution map: the sequence each one runs, what finishes each step, which skill it hands work to, which `swarm` commands and plan files it touches, and which rules are in force while it runs. `steps <skill>` opens one in full; `steps --rules` inverts the view to show every step a rule governs and the file that brought it into force. Derived from the payload in the checkout — nothing is recorded, and the workflow still keeps no event log.
- The CLI command is now `swarm` (was `collab-swarm`). The npm package, config files, and GitHub repository remain `collab-swarm`. The `cswarm` alias is unchanged.

## 0.1.0

First release. Extracted from the agentic delivery workflow built and used to deliver apps in production, and generalised away from Flutter.

- **Workflow.** `requirements → specification → tickets → implementation → review → complete`, one plan per feature, committed to the repository.
- **Delivery board.** A Markdown feature register joined with Git claims: a pushed branch claims a row, a completed plan on the default branch marks it done, and dependencies, human gates and product decisions derive the blocked state.
- **Validator.** Plan shape, required sections, unfilled template text, ticket front matter, dependency cycles, status coherence, and ticket skills checked against the installed packs.
- **Check runner.** One configured command set that a human, an agent and CI all run, with focused and CI variants.
- **Targets.** Claude Code, the AGENTS.md standard, OpenAI Codex, Cursor, OpenCode and Google Antigravity, chosen at `init`. Targets sharing a directory share one copy of the payload.
- **Packs.** Language and framework skills, rules and checks added after the fact, with roles that decide how each skill may be reached.
- **Sync.** Vendored payload with a manifest, so an upgrade rewrites what it owns, reports what you edited, and removes what an older version left behind.
