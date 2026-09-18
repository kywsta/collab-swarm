---
name: to-pack
description: Research this project's language, framework and libraries, then write the skills and rules that implement in them — a concern router, one skill per concern, path-scoped rules, and the checks they need. Use when a project has no skills for its own stack, when a new framework or library becomes load-bearing, or when the same implementation mistake keeps returning because nothing writes the rule down.
---

# Write the Stack Pack

Turn what this repository already knows about itself — its libraries, its layout, its conventions — into the skills an agent implements with. Read the [workflow contract](../../workflow/WORKFLOW.md), the [pack format](PACK-FORMAT.md), and `writing-for-agents` before writing anything.

The core workflow is stack-agnostic on purpose: `implement` runs TDD and hands each concern to the skill that owns it. Where no pack is installed, no skill owns any concern, so every agent implements from its own priors and the codebase drifts a little further apart with each ticket. This closes that gap once.

Work from the repository, never from general knowledge of the framework. A skill that repeats the framework's documentation costs tokens on every turn and earns nothing; a skill that says *what this codebase does* is the whole value.

## 1. Read the stack

Read the dependency manifest and its lockfile, the build and generation config, the analyzer or linter config, and the test setup. Then read the code: pick two or three features already built end to end and follow each one through every layer it touches.

Record, for each load-bearing library: what this project uses it for, which directories it lives in, and the convention this project has settled on that the library does not require. That last one is the valuable part — the call adapter everything routes through, the base class every handler extends, the wrapper the codebase uses instead of raw exceptions.

Ask the user about anything the code leaves genuinely ambiguous, such as a convention that appears twice in two shapes. Do not ask about anything the code answers.

Done when every load-bearing library is named with its purpose, its directories, and the convention this project holds it to, and the reader could rebuild an existing feature from the notes.

## 2. Name the concerns and scaffold the pack

A concern earns its own skill when it has invariants of its own, files of its own, and its own way of going wrong. Merge two concerns that are always changed together; split one whose skill would otherwise need two unrelated checklists. Most stacks land between four and ten.

Name the router `<stack>-dev` and each concern `<stack>-<concern>`. Add a `review` skill only for a surface whose correctness a diff cannot show.

Show the user the proposed concerns, one line each, and the checks the pack will suggest. Confirm before writing: this is the shape everything else inherits.

```bash
npx swarm pack new <stack> --title "<Stack>" --description "<one line>" \
  --router <stack>-dev \
  --skills <stack>-<concern>,<stack>-<concern> \
  --reviews <stack>-<surface>-review \
  --rules <concern>,<concern>
```

Done when the user has agreed the concern list and the scaffold exists with every skill carrying the role it will keep.

## 3. Write each concern skill and its rule

Follow the [pack format](PACK-FORMAT.md). One skill at a time, and for each: the build order, the steps in this project's real identifiers, and a checklist of observable completion conditions. Put worked files in `examples.md` beside the skill rather than in the recipe.

Then write that concern's rule: three or four invariants, scoped with `paths` to the directories the concern actually owns, linking back to the skill as its recipe.

Every claim must be true of this repository right now. Where the codebase does the same thing two ways, say which one is current and treat the other as legacy, naming it so an agent recognises it while reading; where it is genuinely free, say so rather than inventing a constraint.

Done when each concern skill names the parts a developer would open, each rule's globs match real directories, and no sentence would still be true after pasting it into a different project.

## 4. Write the router

Write the routing table last, from the skills that now exist. Its left column is the vocabulary a ticket is written in — the words a ticket actually uses — and its right column is the one skill that owns that concern. Add the reference skills to consult and the conditions that return to `deliver-change`.

The router selects the **smallest applicable set**. A ticket touching one concern must load one skill.

Done when every concern maps to exactly one skill, no two rows claim the same concern, and the table's left column reads like ticket text rather than a list of file types.

## 5. Attach, verify and report

```bash
npx swarm add .collab-swarm/packs/<stack>   # attaches the pack and offers its checks
npx swarm packs                             # every skill carries a description and the role you intended
npx swarm steps <stack>-dev                 # the router and its steps, read back
npx swarm steps --rules                     # each rule, and the steps it governs
npx swarm validate                          # a ticket may now name the concern skills
```

`steps` is the check that matters: it reads the pack back the way an agent will. A skill whose steps report no completion criterion never stated one. A rule reported as governing nothing has globs that match no directory in this repository.

Then exercise it. Take one small real ticket, or write one, and run `implement` against it; the router should select fewer skills than the pack contains. A router that always selects everything has concerns that were never really separate.

Report, in [plain names](../../workflow/WORKFLOW.md#plain-names), the concerns the pack now owns and what each covers, the conventions it pinned down, the checks it added, anything the code left ambiguous that the user should settle, and the ticket used to exercise it.

Done when the pack is attached, every command above passes, one real ticket has been routed through it, and a teammate could add the next concern by following what is already there.
