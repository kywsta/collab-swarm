---
if: analytics!=none || crash!=none || logging!=none
paths:
  - "lib/core/observability/**"
  - "lib/core/analytics/**"
  - "lib/core/logging/**"
  - "lib/bootstrap/**"
description: Invariants for analytics, crash reporting and logging — narrow ports, one producer per signal, nothing personal leaves.
---

# Observability rule

Detailed recipe: [`flutter-observability`](../skills/flutter-observability/SKILL.md). Apply with [dependency injection](dependency-injection.md) at the composition root.

- Depend on the port, never the vendor SDK. Bind the adapter at the composition root, before the SDK would initialise, and bind a no-op in tests and the `mock` flavor.
<!-- swarm:if analytics!=none -->
- Declare every event in one catalogue with typed parameters, produce screen views from one hook with the SDK's own tracking off, and assert event names in a test rather than sanitising them.
<!-- swarm:endif -->
<!-- swarm:if crash!=none -->
- Report unclassified errors only. A classified `Failure` is a condition, and reporting it hides the real crashes.
<!-- swarm:endif -->
- Keep personal data, tokens and request bodies out of every event, breadcrumb and log line.

```dart
@Riverpod(keepAlive: true)
AnalyticsSink analyticsSink(Ref ref) {
  final token = ref.watch(envProvider).analyticsToken;
  if (token.isEmpty) return const NoOpAnalyticsSink();
  return {{analytics.sink}}(token);
}
```
