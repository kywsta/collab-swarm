---
name: code-review
description: "Review a Git diff along two axes: repository standards and the originating requirements and specification. Runs both reviews in parallel read-only sub-agents and reports them side by side."
---

# Two-Axis Code Review

Review one fixed diff:

- **Standards:** does the change follow repository and architecture rules?
- **Feature:** does it deliver the requirements, specification, and tickets?

Both axes run as parallel read-only sub-agents so one concern does not mask the other: launch two read-only exploration agents in a single message, one per axis, and wait for both reports. When the host has no sub-agent facility, run the two passes yourself in sequence and keep the findings separate. Read the shared [review and completion contract](../../workflow/WORKFLOW.md#review-and-completion). This skill reports findings and does not repair them.

## 1. Fix the diff

For a feature plan, use `implementation_base_sha` from `plan.yml`. In standalone use, use the ref supplied by the user or the feature branch's merge base. Review committed and tracked working-tree changes with `git diff <base>`, list commits with `git log <base>..HEAD --oneline`, and include untracked files reported by `git status --short`.

Confirm the base resolves and the diff is non-empty.

Done when both reviewers will inspect the same complete diff.

## 2. Load the feature contract

Use the matching `requirements.md`, `specification.md`, and ticket files. If no feature plan exists, use the issue or specification the user supplied. Skip the Feature axis only when no contract can be found, and state that limitation.

Done when the requested behaviour and scope are explicit.

## 3. Load standards

Read the root instruction file (`AGENTS.md` or `CLAUDE.md`), the rule files installed for this repository, contributor guidance, documented coding standards, and the domain vocabulary and architecture decisions when they exist. Also use these Fowler-style smell heuristics as judgement calls, with repository rules taking precedence:

- **Mysterious Name:** a name hides its purpose.
- **Duplicated Code:** the same logic shape occurs more than once.
- **Feature Envy:** behaviour reaches into another object's data more than its own.
- **Data Clumps:** the same fields repeatedly travel together.
- **Primitive Obsession:** a primitive stands in for a domain concept.
- **Repeated Switches:** the same conditional dispatch repeats.
- **Shotgun Surgery:** one change requires scattered edits.
- **Divergent Change:** one module changes for unrelated reasons.
- **Speculative Generality:** abstractions serve no current requirement.
- **Message Chains:** callers navigate through collaborator internals.
- **Middle Man:** a type mainly delegates without adding policy.
- **Refused Bequest:** inheritance supplies behaviour the subtype rejects.

Skip findings a passing formatter or analyzer already enforces.

Done when both documented rules and relevant design smells are available to the Standards reviewer.

## 4. Run parallel read-only reviews

The Standards reviewer receives the fixed diff, untracked files, commit list, standards sources, and smell list. It reports every documented-rule violation and relevant smell with file and hunk.

The Feature reviewer receives the same diff plus requirements, specification, and tickets. It reports missing or partial behaviour, work outside scope, incorrect implementation, and missing tests or required states. It cites descriptive headings or criterion names rather than workflow ids.

Each reviewer proposes `blocking` or `advisory` severity and stays under 400 words.

Done when both independent reports are returned, or the missing Feature contract is explicitly reported.

## 5. Aggregate

Keep findings under `Standards` and `Feature`. Use:

```text
[blocking|advisory] Short title
Source: <rule, requirement name, specification section, or ticket title>
Location: <file and hunk>
Impact: <consequence>
```

Write `Source` and `Impact` in [plain names](../../workflow/WORKFLOW.md#plain-names): the rule, criterion, or heading as written, never a register id alone. End with counts by severity. The implementation owner classifies disputed findings, repairs blocking findings, reruns affected checks, and requests re-review.
