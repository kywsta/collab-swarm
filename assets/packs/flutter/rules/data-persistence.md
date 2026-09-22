---
paths:
  - "lib/core/storage/**"
  - "lib/**/data/**local**"
  - "lib/**/data/datasources/**"
description: Invariants for local storage — the right store per kind of data, one typed wrapper, guarded calls.
---

# Data persistence rule

Detailed recipe: [`flutter-data-persistence`](../skills/flutter-data-persistence/SKILL.md). Apply with [error handling](error-handling.md) and [dependency injection](dependency-injection.md).

- Put secrets in secure storage, small non-sensitive scalars in preferences<!-- swarm:if database!=none -->, structured objects in the {{database.store}}<!-- swarm:endif -->, and large blobs in files.
- Hide each store behind one typed wrapper that owns its key strings. Widgets and ViewModels depend on repositories or lifecycle modules, never a storage API.
- Open every store from a keepAlive provider, once.
- Guard every local read and write, so a corrupt or missing value becomes a `Failure` rather than an exception two layers up.
<!-- swarm:if database!=none -->
- Keep the local model separate from the domain entity and map between them at the datasource boundary.
<!-- swarm:endif -->

```dart
@Riverpod(keepAlive: true)
TokenStore tokenStore(Ref ref) => TokenStore(ref.watch(secureStorageProvider));

Future<Either<Failure, List<Item>>> cached() => guard(_datasource.items);
```
