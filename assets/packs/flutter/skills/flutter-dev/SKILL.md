---
name: flutter-dev
description: Route an approved Flutter ticket to only the implementation skills its slice needs — API and data stack, Riverpod state, failures, UI, navigation, storage, and the integrations this project chose. Use at the start of every Flutter ticket, and again whenever the diff grows a concern the ticket did not name.
---

# Flutter Development Router

This pack owns how a Flutter feature is built: the layers it is split into, the seam each one returns across, and the library that serves each concern. It does not own product behaviour — that comes from the plan — and it does not own the design system, which belongs to the project.

Read the ticket and the feature specification before selecting anything. The ticket's `skills` list is the plan; the diff decides whether another concern became necessary.

## 1. Select the concern set

| Ticket concern | Use |
| --- | --- |
| Endpoint, DTO, mapper, entity, repository, contract test | `flutter-api-integration` |
| ViewModel, lifecycle, page state, debounce, pagination | `flutter-state-management` |
| Provider, lifetime, override, composition root, flavor | `flutter-dependency-injection` |
| Failure subtype, capture, classification, response policy | `flutter-error-handling` |
| Page, widget, rendered state, loading or empty layout | `flutter-ui-implement` |
| Route, shell branch, redirect, deep link, gated path | `flutter-navigation` |
| Token store, preference key, cached rows, local model | `flutter-data-persistence` |
<!-- swarm:if analytics!=none || crash!=none || logging!=none -->
| Event, screen view, crash report, log line, user property | `flutter-observability` |
<!-- swarm:endif -->
<!-- swarm:if notifications!=none -->
| Push token, permission, notification tap, topic, background message | `flutter-push-notifications` |
<!-- swarm:endif -->
<!-- swarm:if i18n!=none -->
| Translation key, plural, locale switch, new user-visible string | `flutter-localization` |
<!-- swarm:endif -->

Read [`flutter-architecture`](../flutter-architecture/SKILL.md) when the ticket adds a feature folder, promotes something into the shared core, or raises a question about which layer a file belongs in. Consult `codebase-design` when the public interface or seam shape is still a technical design problem, and `domain-modeling` when implementation exposes a domain-language conflict or a load-bearing architecture decision. Those are reference skills: read them, never list them in a ticket's `skills`.

Select the **smallest applicable set**. A ticket that only adds a preference key loads one skill. A ticket that reaches four concerns is usually two tickets.

Return to `deliver-change` when implementation contradicts an approved decision, when the specification names an operation the API contract does not offer, or when a concern appears that no skill in this table owns.

Done when every concern the ticket names maps to exactly one skill, and nothing outside the slice was selected.

## 2. Apply the selected skills

For each red-green slice, open the selected skills before editing their concern, and follow the [TDD contract](../../workflow/WORKFLOW.md). Build bottom-up within a slice — the seam and its test first, then the state that folds it, then the widget that renders it — because each layer's test is written against the one below it.

Accumulate every selected skill's completion checks. `implement` owns running the resulting verification set, including the project's `generate` check after any annotated source changed.

Done when every changed concern was written with its own skill open, and the accumulated checks are handed to `implement`.

## 3. Hand back

Report, in plain names:

- the skills selected and why each applied;
- the specification decisions and seams exercised;
- any generator that now has to run, and what triggers it;
- the concern-specific checks required;
- any scope or contract conflict that needs escalation.

Done when every changed concern maps to one skill, every selected skill's completion criteria are satisfied, and no unapproved concern is hiding in the diff.
