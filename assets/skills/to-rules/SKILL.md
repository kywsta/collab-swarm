---
name: to-rules
description: Research and write the rule set one repository is built by — its stack profile and path-scoped rules, from its own code and from best practice for the exact versions it uses — or bring an existing set up to date. Use when a repository has no rule set, when `npx collab-swarm rules` reports one behind its code, when a framework or library becomes load-bearing, or when the same review finding keeps returning.
---

# Research the Rule Set

Write down what one repository is built by, so every agent working in it follows the same conventions instead of its own priors. Read the [workflow contract](../../workflow/WORKFLOW.md), the [rule set format](RULESET-FORMAT.md), and `writing-for-agents` before writing anything.

A rule set is written from evidence: what the code already does, and what the official guidance says for the versions in its lockfile. A rule that would still be true pasted into another project restates documentation and costs tokens on every matching file; a rule that names this repository's parts is the whole value. The set is meant to be researched again as the repository grows — each pass starts from what the last one recorded.

## 1. Choose the repository and read where it stands

Name the repository from `repositories:` in `collab-swarm.yml`, or `root` for this one. When the user did not say which, run `npx collab-swarm rules` and propose the one most behind.

```bash
npx collab-swarm rules <name>
```

It says whether this is a first pass or a revisit and, for a revisit, what moved since the last one: packages added, removed or moved a major version, and rules whose globs match no file. Read the existing set under `.collab-swarm/rules/<name>/`. When the repository has a baseline pack (`packs:` under it), read that pack's rules too: the set builds on them and overrides one only by writing a rule of the same file name.

Done when the repository, its directory, its baseline, and the scope of this pass — everything, or only what moved — are known.

## 2. Read the repository

Work in the repository's own directory. Read, in order:

1. The dependency manifests and lockfiles: the exact versions in use.
2. The build, format, lint, analysis and test configuration, and the CI pipeline: what the repository already enforces mechanically, which a rule must not repeat.
3. The agent instructions it already carries — `AGENTS.md`, `CLAUDE.md`, `.cursor/rules`, framework guidelines such as Laravel Boost's. They are evidence of intent: align with them, and never copy them into the set.
4. The code: two or three features built end to end, followed through every layer they touch.

Record, for each load-bearing library: what this repository uses it for, which directories it lives in, and the convention the code holds it to that the library does not require. Where the code does one thing two ways, note which is newer. On a revisit, read only what moved, plus the files the dead rules were meant to cover.

Done when every load-bearing library is named with its version, purpose, directories and convention, and the notes could rebuild an existing feature.

## 3. Research best practice for these versions

For each load-bearing framework and library, read its official documentation for the version in the lockfile, and the upgrade guide or release notes for any major version that moved since the last pass. Prefer primary sources — the project's own docs, its maintainers' guidance, the configuration of its own linters — over articles and summaries. Note each source with its title, URL and the version it describes.

Sort what you find against the code:

- **Already done here** — the rule records this repository's own form of it.
- **Not done, and harmless to start** — a candidate rule for new code.
- **Contradicts what the code does** — a question for the user, never a rule decided here: adopt it for new code, keep the current convention, or plan a migration.

When the session has no web access, say so, research from the repository alone, and mark the set so the next pass completes it.

Done when every candidate rule has evidence from the code, a cited source, or both, and every conflict is written down as a question.

## 4. Propose the set

Present it in one message before writing anything, in [plain names](../../workflow/WORKFLOW.md#plain-names):

- the stack profile, in a few lines;
- each rule to add, change or retire: its concern, the directories it covers, its invariants in a line, and its evidence;
- each conflict between best practice and the code, with the options;
- any skill worth writing, and why a rule cannot hold it — usually none.

A rule whose `origin` is `team` is shown with the change proposed and left as it is unless the user agrees. Ask about anything the code leaves genuinely ambiguous; ask nothing the code answers.

Done when the user has agreed the rules, the answer to every conflict, and any skill.

## 5. Write it

Write `.collab-swarm/rules/<name>/` following the [rule set format](RULESET-FORMAT.md): `STACK.md`, one rule per concern with `origin: research`, and a skill only where step 4 agreed one. Globs are relative to the repository. Retire a rule by deleting its file, and say why in the commit message.

Done when every agreed rule and the profile are written, and nothing that was not agreed is.

## 6. Verify and record

```bash
npx collab-swarm sync                 # publish the set into every agent target
npx collab-swarm validate             # origins known, globs not doubled, no name clashes
npx collab-swarm steps --rules        # each rule, and the steps it governs
npx collab-swarm rules <name>         # no rule matching no file
npx collab-swarm rules <name> --record
```

`--record` notes what the repository depends on now, so the next `npx collab-swarm rules` reports only what moves after this pass. Run it last, once everything above passes.

Report, in [plain names](../../workflow/WORKFLOW.md#plain-names), the conventions the set now holds and where each applies, what was adopted from guidance and its source, the conflicts and how the user settled them, what was left for a later pass, and the commands run. Commit the rule set, its `research.json` and the published files together.

Done when the set is published, every command above passes, the research is recorded, and the user knows what changed.
