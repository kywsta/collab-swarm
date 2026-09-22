---
paths:
  - "lib/core/navigation/**"
  - "lib/**/*_routes.dart"
  - "lib/app.dart"
description: Invariants for routing — routes live in their feature, one GoRouter, gating in one place, deep links survive sign-in.
---

# Navigation rule

Detailed recipe: [`flutter-navigation`](../skills/flutter-navigation/SKILL.md). Apply with [dependency injection](dependency-injection.md) and [state management](state-management.md) for session-driven redirects.

- Keep paths and `GoRoute`s inside the feature; only the router builds `GoRouter`.
- Mount tab features as shell branches and out-of-shell routes at the root. Nest a detail route under its parent and `push` it, so the tab stack survives.
- Declare gated paths on the feature's route set and let the router merge them. Nothing else decides whether a user may reach a page.
- Hold a protected destination through sign-in and consume it exactly once; move the router from the session stream, not from a refresh listenable.

```dart
GoRoute(
  path: CatalogRoutes.items,
  builder: (context, state) => const ItemsPage(),
  routes: [
    GoRoute(
      path: ':id',
      builder: (context, state) => ItemDetailPage(itemId: state.pathParameters['id']!),
    ),
  ],
);
```
