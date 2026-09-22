---
paths:
  - "lib/**/view_models/**"
  - "lib/**/domain/**/*_module.dart"
  - "lib/**/domain/**/*_state.dart"
  - "lib/**/presentation/**"
description: Invariants for state — one owner per value, synchronous build, derived terminal states, no stale writes.
---

# State management rule

Detailed recipe: [`flutter-state-management`](../skills/flutter-state-management/SKILL.md). Apply with [dependency injection](dependency-injection.md) and [error handling](error-handling.md).

- Give each value one owner: a replaying snapshot-and-stream module for app state, an auto-dispose ViewModel for page behaviour, widget state for visual ephemera.
- Return the initial state synchronously from `build()`, start the first work in a microtask, and release every timer and subscription in `ref.onDispose`.
- Keep debounce, pagination guards and stale-response protection in the ViewModel; the widget sends raw intents.
- Derive loading, empty, initial-failure and append-failure from the state so they cannot contradict each other.

```dart
bool get isEmpty => items.isEmpty && failure == null && !isLoading;
Failure? get initialFailure => items.isEmpty && failure != null ? failure : null;
```
