---
name: quick-question
description: Answer a question about how this project works — "how does X work", "where is X", "how long / how many / what value is X", "what does <term> mean", "why did we X", "what calls X" — quickly, from the project's records and its code, with every claim cited. Read-only.
---

# Quick Question

Answer one question about the project as fast as a colleague who knows it would: a direct answer first, then just enough structure to trust it, every claim cited to a line you read in this session. The project's records and code are the **evidence**; anything you have not read is a guess, and a guess is labelled or left out.

This skill only reads. It edits no file, claims no row, starts no plan, and runs no build; its Git commands are `status`, `branch`, `log`, `diff` and `show`. When the question turns into a request to change something, answer it, then hand the change to `small-change` or `deliver-change`.

## 1. Read the question

Name its **kind**, since the kind decides where the evidence is and how the answer is shaped:

| Kind | Sounds like | Evidence first |
| --- | --- | --- |
| **fact** | "How long does the auth token last?", "What is the retry limit?" | the code and config that set the value |
| **flow** | "How does auth work?", "What happens when an order is paid?" | the code path, entry point to effect |
| **term** | "What is a voucher here?" | the vocabulary, then where the code names it |
| **why** | "Why JWT and not sessions?" | decisions, specifications, the delivery history |
| **impact** | "What calls `refreshToken`?", "What breaks if I change X?" | callers and dependents in the code |

A question that spans two kinds ("how does auth work and how long does the token last") gets one answer with both parts.

Settle the **scope** without asking when the code can settle it:

- **Which repository.** In a [hub](../../workflow/WORKFLOW.md#code-repositories), answer from the repository that *owns* the behaviour — the one that sets the value or makes the decision, usually the backend — and name the repositories that consume it, offering to follow them. Ask only when no repository clearly owns it.
- **Which one of several.** When "the token" or "the limit" is really several (one per app, per role, per environment), answer all of them in one table rather than asking which.
- **Which branch.** Answers describe this checkout, not what is deployed. Note the branch the owning repository is on (`git -C <repository> branch --show-current`). When it is not the repository's own `defaultBranch` — in `repositories:` for a code repository, `git:` otherwise — read what the branch changed in the files the answer rests on with `git -C <repository> diff <defaultBranch>...HEAD -- <paths>`, and `git -C <repository> status --short -- <paths>` for edits not yet committed. In a hub, the hub's own branch matters only for the plan it carries (step 2).

Done when the kind, the owning repository and its branch are known.

## 2. Read the records

Read `collab-swarm.yml`. The records are what it names:

- **`sources:`** — pick by each source's `use:` line, not its key: a project names its own kinds. The vocabulary and the contract are first for a term and a fact; the product and technical sources say what a flow or a value is meant to be.
- **The backlog** — its decisions register holds the answered questions and working assumptions that often fix a value or explain a choice.
- **`plans:`** — a plan whose slug matches the checked-out branch, after any prefix such as `feat/` or `change/`, says what that branch changes and why; `HISTORY.md` beside the plans says what was delivered, and when.
- **Beside the code** — `CONTEXT.md` (layout in [`domain-modeling`](../domain-modeling/SKILL.md#file-structure)), `docs/adr/`, the rule set's `STACK.md` under `.collab-swarm/rules/<repository>/`, and the owning repository's README and contract files (an OpenAPI or schema file), which stand in for a contract `sources:` does not name. A hand-written README section usually explains a flow better than a generated contract does.

Search the records in the project's own words, which may not be the asker's — "auth" is "sign-in", "session" or "token" in one project and "login" in another — and open only the sections that match. A register or change log may hold paragraphs on one line, so cap each hit: `grep -o '.\{0,150\}<term>.\{0,150\}'`.

Records say what the project *intends*; the code says what it *does*. A fact or flow found only in a record is still checked against the code in step 3, or cited to the record and listed as not verified. Where they disagree, or where a newer decision overrides an older document the code no longer follows, that is part of the answer. A record that only quotes another is cited as the quote: "PRD-01 sets 60 minutes, as D135 quotes it".

Done when the records that bear on the question are read, or none do.

## 3. Find it in the code

Locate first, then read only what the answer needs. **Reading** is opening a file or a range of it, which counts once however many ranges you open; a line a search or a diff prints is read and may be cited, and searches are free. The skill is **quick** by its budget: about a dozen files opened, records and code together, with a few more for a flow with several entry points. When the budget runs out, answer from what you have verified and name what you have not. A question with several entry points spends the budget across them before going deep in any one.

**With a graph.** When `graphify-out/graph.json` exists in the owning repository and `graphify` is on the path, use it to locate:

```bash
graphify query "<question in the project's words>"   # flow, term: the relevant subgraph
graphify path "<from>" "<to>"                        # flow: how one thing reaches another
graphify explain "<symbol or concept>"               # term, impact: what it is and what touches it
```

The graph is a **map**: it says where to look, never what is true. Read every file you cite from it. Exit code 3 means the name is ambiguous — retry with a fuller name from its output; 4 means no match — search instead. A file the graph names that no longer exists means the graph is stale: search instead, and say once, at the end, that `graphify update .` refreshes it. Never build, update or install the graph yourself.

**Without one.** Search for the project's own words for the thing — the vocabulary's term, the contract's operation name, then the likely identifiers (`lifetime`, `expires`, `exp`, `ttl`, `maxAge`, `idle` for a lifetime) — and follow imports and calls from the best hit. For a fact, find where the value is *set* and every place that *overrides* it: environment variables, config per environment, defaults in code, and the infrastructure that sets those variables when `sources:` names it. Having looked and found none is a finding: say that nothing overrides it.

Done when every claim the answer will make points at a line you have read.

## 4. Answer

Lead with the answer itself in one or two sentences, in [plain names](../../workflow/WORKFLOW.md#plain-names): say what a register key is about, and let the key trail in parentheses — "staff may stay signed in for five days (D135)". When the branch changes the answer, say so straight after the lead, with what the default branch has instead.

Then the shape the kind calls for:

- **fact** — the value, then a table when it varies: what, value, where it is set, what extends or overrides it.
- **flow** — numbered steps, each naming the module and its `file:line`; for several entry points, one short list per entry point after the part they share. Past four steps or two modules, add a diagram as an arrow chain in a `text` block, which reads the same in every terminal; use Mermaid only when the user asks for it.
- **term** — the definition from the vocabulary, then where the code names it and any synonym it uses instead.
- **why** — the decision, the alternative it rejected, and the record that holds it.
- **impact** — a table of callers or dependents: what, where, how it uses the thing.

In a hub, name the owning repository once and cite its paths relative to it; prefix the hub's own records with `hub:`.

Then, in this order and only when they have content:

- **Records and code disagree** — what each says, with both citations. This is often the most useful line in the answer.
- **Not verified** — what you inferred without reading, took from a record without checking the code, left unread when the budget ran out, or left in a repository you did not follow; and what is deployed, when the asker may mean production.
- **Sources** — the `file:line` links the answer rests on, when the body has not already cited them inline.

Aim for one screen; a flow with several entry points may take two. Close with a one-line offer to go deeper when there is more to say.

Done when the first sentence answers the question and every claim after it is cited or marked not verified.
