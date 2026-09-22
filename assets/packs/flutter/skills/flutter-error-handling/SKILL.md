---
name: flutter-error-handling
description: Failures as values — the guard at each seam, the Failure taxonomy, and the one place each kind is answered in the UI. Triggers on a new Failure subtype, an exception that has to be captured, a retry or error state, a response policy, or an unhandled exception reaching the user.
---

# Error Handling

Two flows, and the first mistake is putting something in the wrong one.

```text
Expected outcome the feature owns  →  feature state  →  the feature's own UI
Exception at a seam                →  capture → Failure → policy → shared response
```

A `Failure` is classification plus reporting data. It carries no user-facing copy: the words live in the presentation layer, so one taxonomy serves every locale and every screen. Worked snippets: [examples.md](examples.md).

## 1. Classify the outcome first

A user-correctable rejection the feature owns — a field the form must mark, a code that can be retyped, a shake on a wrong PIN — is **feature state**. Modelling it as a `Failure` sends a local problem through a global handler, and the feature loses the ability to answer it well.

A failure every screen must treat the same way — no network, session expired, server rejected, app must update — is a **`Failure` subtype**. Add a subtype only when classification or response policy actually differs; a subtype nobody branches on is a comment with a constructor.

Done when the outcome is in exactly one of the two flows, and you can say which screens would answer it differently.

## 2. Capture at the seam, once

| Seam | Wrapper |
| --- | --- |
| HTTP call | the Dio/Retrofit call adapter |
| Local storage or file | the storage guard |
| DTO → domain fold | inside the same guard as the call |
| Platform channel or SDK | the port's own adapter |

Each wrapper catches, maps the exception to a `Failure`, reports it once if it is technical, and returns `Left`. Nothing above the seam catches: ViewModels and widgets have no `try`, and the absence of `catch` above the data layer is the invariant to check in review.

Below the seam, throw freely. The guard is the boundary, and a layer that both throws and returns `Either` has two error channels and no rule about which to read.

Done when every path into the feature crosses exactly one guard, and no `catch` appears above the data layer.

## 3. Answer locally, then fall through

A `Failure` reaches the page as a value. The page decides whether it owns the answer:

- **Initial load failed** — the list has no rows to show, so render the error *inline* with a retry. This never goes to the shared handler; a snackbar over an empty screen tells the user nothing about what to do.
- **A later page failed** — rows are already on screen, so the shared handler shows a transient message and the list stays usable.
- **The feature has nothing useful to say** — fall through to the shared policy.

The shared policy is a pure function from `Failure` to a response kind, and it is unit-tested. The handler that runs it is the only place a dialog or snackbar is raised for a `Failure`. Kinds the feature may never override: a cancelled request is ignored, an expired session revokes the account lifecycle, a maintenance window blocks, a failed integrity check halts.

After a handled `Failure` held on a state object, **clear it**, or the next rebuild answers it again.

Done when each emitted `Failure` produces exactly one user-visible response and at most one report.

## 4. Adding a Failure

1. Confirm it is not feature state.
2. Add the subtype only if classification or policy is genuinely new.
3. Map the exception to it in the capture function.
4. Add its copy in the presentation layer<!-- swarm:if i18n!=none -->, as a `{{i18n.sdk}}` key with a value in every locale<!-- swarm:endif -->.
5. Add a policy row, or a local handler in the one feature that answers it differently.
6. Test the policy row. The policy is pure, so this is a table test, not a widget test.

Done when the new subtype has a mapping, copy, a response, and a test asserting the response.

## Checklist

- [ ] Expected rejections are feature state; shared ones are `Failure` subtypes
- [ ] Exactly one guard per seam; no `catch` above the data layer
- [ ] No raw exception crosses into presentation
- [ ] Initial failure renders inline; later failures go through the shared handler
- [ ] Mandatory kinds cannot be overridden locally, and are covered by policy tests
- [ ] A handled `Failure` held on state is cleared
- [ ] `Failure` carries no user-facing string

## Additional resources

- Taxonomy, guard, policy table and a local handler: [examples.md](examples.md)
