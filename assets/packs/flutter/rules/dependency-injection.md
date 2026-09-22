---
paths:
  - "lib/**/*_provider.dart"
  - "lib/**/*_providers.dart"
  - "lib/bootstrap/**"
  - "lib/core/di/**"
  - "lib/main.dart"
description: Invariants for the provider graph — generated providers only, lifetimes by kind, overrides at the root.
---

# Dependency injection rule

Detailed recipe: [`flutter-dependency-injection`](../skills/flutter-dependency-injection/SKILL.md). Apply whenever another rule introduces a dependency or a state owner.

- Use generated Riverpod providers as the only dependency graph: `ref.watch` while constructing it, `ref.read` inside action handlers. No service locator, no global singleton.
- Keep process resources, repositories, routers and lifecycle modules alive; let page ViewModels auto-dispose.
- Build the `ProviderContainer` locally in `main()` and pass it to `UncontrolledProviderScope`. Nothing exports it.
- Swap adapters only at the composition root, only for an explicitly selected `mock` flavor or in tests, and by overriding API providers and external ports rather than repositories.

```dart
@Riverpod(keepAlive: true)
CatalogRepository catalogRepository(Ref ref) =>
    CatalogRepositoryImpl(api: ref.watch(catalogApiProvider));
```
