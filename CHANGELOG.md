# Changelog

## Unreleased

- The CLI command is now `swarm` (was `collab-swarm`). The npm package, config files, and GitHub repository remain `collab-swarm`. The `cswarm` alias is unchanged.

## 0.1.0

First release. Extracted from the agentic delivery workflow built for the Pocket Customer app, and generalised away from Flutter.

- **Workflow.** `requirements → specification → tickets → implementation → review → complete`, one plan per feature, committed to the repository.
- **Delivery board.** A Markdown feature register joined with Git claims: a pushed branch claims a row, a completed plan on the default branch marks it done, and dependencies, human gates and product decisions derive the blocked state.
- **Validator.** Plan shape, required sections, unfilled template text, ticket front matter, dependency cycles, status coherence, and ticket skills checked against the installed packs.
- **Check runner.** One configured command set that a human, an agent and CI all run, with focused and CI variants.
- **Targets.** Claude Code, the AGENTS.md standard, OpenAI Codex, Cursor, OpenCode and Google Antigravity, chosen at `init`. Targets sharing a directory share one copy of the payload.
- **Packs.** Language and framework skills, rules and checks added after the fact, with roles that decide how each skill may be reached.
- **Sync.** Vendored payload with a manifest, so an upgrade rewrites what it owns, reports what you edited, and removes what an older version left behind.
