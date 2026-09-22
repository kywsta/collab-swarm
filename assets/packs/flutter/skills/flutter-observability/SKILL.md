---
name: flutter-observability
description: Analytics events, crash reporting and structured logging behind narrow ports. Triggers on a new event or screen view, a user property, a crash or non-fatal report, a log line, or anything that would send personal data to a third party.
---

# Observability

Three destinations, one shape: a **port** in `core/observability/`, an adapter per SDK at the composition root, and a no-op adapter that every test and the `mock` flavor use. Nothing above the port knows which vendor is behind it, which is what makes swapping one a configuration change rather than a refactor.

```text
feature → port (AnalyticsSink / CrashReporter / AppLogger) → adapter → SDK
```

<!-- swarm:if analytics!=none -->
## 1. Analytics — {{analytics.label}}

Events are a contract, not free text. Declare each one in a single catalogue — name plus typed parameters — and let features call the catalogue. A `track('item_viewed')` written inline is a name nobody can rename safely and a typo nobody notices until the dashboard is empty.

Name events in the destination's own convention and **assert the names in a test** rather than sanitising them at runtime; a silently renamed event breaks the comparison against history, which is the only thing the data was for.

Screen views come from one hook on the router, not from `initState`. One producer means one event per navigation, and the vendor SDK's own automatic screen tracking is turned **off** so it cannot become a second one.

Personal data does not go to a destination. Keep user identifiers out of event parameters and do not give the adapter a user-property or profile method: a method that does not exist cannot be called by accident.

The sink is `{{analytics.sink}}`, built over `{{analytics.sdk}}`. Bind it only when its credential is configured; an empty token binds the no-op sink and says so in the log, rather than failing at the first event.

Done when every event comes from the catalogue, screen views have exactly one producer, and no personal data can reach the adapter.
<!-- swarm:endif -->

<!-- swarm:if crash!=none -->
## 2. Crash reporting — {{crash.label}}

`{{crash.reporter}}` implements the `CrashReporter` port over `{{crash.sdk}}`. Three entry points and no more:

- the zone guard around `runApp`, for an uncaught asynchronous error;
- `FlutterError.onError`, for a framework error;
- the failure capture function, for a technical failure at a seam.

A classified failure — offline, unauthorised, a server 4xx — is a condition, not a bug. Reporting it fills the dashboard with noise until the real crashes are invisible. Report the unclassified ones.

Attach the breadcrumb a report needs to be actionable: the current route, the flavor, the build number. Never attach a token, a credential, or the body of a request.

Done when every uncaught error has one route to the reporter, and no classified failure is reported.
<!-- swarm:endif -->

<!-- swarm:if logging!=none -->
## 3. Logging — {{logging.label}}

`{{logging.impl}}` implements the `AppLogger` port over `{{logging.sdk}}`. Features depend on the port, so a log line in a test asserts against a recording fake instead of scraping stdout.

Levels mean something: `debug` for a developer tracing a flow, `info` for a lifecycle transition worth seeing in a release, `warning` for a recovered problem, `error` for one that reached the user. A release build ships nothing below `info`.

Secrets, tokens and personal data never appear in a log line, including inside a logged request or response.

Done when features log through the port, levels are used as defined, and nothing sensitive is logged.
<!-- swarm:endif -->

## Wiring

Every port is a keepAlive provider bound at the composition root, **before** the SDK would initialise. An explicitly selected `mock` flavor binds the no-op adapters and loads no vendor SDK at all; every other flavor validates its configuration and reports which destinations are bound.

A destination that is configured but unclaimed by any adapter is a silent hole: log the binding at startup so a missing one is visible in the first ten lines rather than at the next review of the dashboard.

## Checklist

<!-- swarm:if analytics!=none -->
- [ ] Events come from one catalogue with typed parameters; names asserted in a test
- [ ] Screen views produced in one place; SDK auto-tracking off
- [ ] No personal data reachable through the analytics adapter
<!-- swarm:endif -->
<!-- swarm:if crash!=none -->
- [ ] Zone guard, `FlutterError.onError` and capture all reach the reporter
- [ ] Classified failures are not reported
<!-- swarm:endif -->
<!-- swarm:if logging!=none -->
- [ ] Features log through the port, never the SDK
- [ ] Nothing sensitive in a log line, including request bodies
<!-- swarm:endif -->
- [ ] Ports bound at the composition root before SDK initialisation
- [ ] `mock` and tests get no-op adapters and load no vendor SDK
