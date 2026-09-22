---
if: notifications!=none
paths:
  - "lib/core/notifications/**"
  - "lib/**/notification*/**"
description: Invariants for push — one delivery module, adapters over transport only, no BuildContext, one route normaliser.
---

# Push notifications rule

Detailed recipe: [`flutter-push-notifications`](../skills/flutter-push-notifications/SKILL.md). Apply with [navigation](navigation.md) for tap routing and [dependency injection](dependency-injection.md) for the ports.

- Keep one delivery module over a source port and a display port. Adapters parse transport; delivery decides what happens.
- Give delivery a narrow `openRoute` callback instead of a `BuildContext`, and let the router decide whether the destination is reachable.
- Register the background handler inside the source's `initialize()`, and keep the background isolate free of providers, session, router and UI.
- Normalise a payload route in one function, used by every path that routes a tap.

```dart
@Riverpod(keepAlive: true)
Future<NotificationDelivery> notificationDelivery(Ref ref) async => NotificationDelivery(
      source: ref.watch(notificationSourceProvider),
      display: ref.watch(notificationDisplayProvider),
      openRoute: ref.watch(appRouterProvider).open,
    )..initialize();
```
