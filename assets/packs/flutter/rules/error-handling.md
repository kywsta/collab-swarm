---
paths:
  - "lib/core/error/**"
  - "lib/**/data/**"
  - "lib/**/view_models/**"
  - "lib/**/presentation/**"
description: Invariants for failures — one guard per seam, no catch above data, one response per failure.
---

# Error handling rule

Detailed recipe: [`flutter-error-handling`](../skills/flutter-error-handling/SKILL.md). Apply at the [API](api-integration.md), [persistence](data-persistence.md), [state](state-management.md) and [UI](ui-implement.md) boundaries.

- Model a user-correctable outcome the feature owns as feature state. Add a `Failure` subtype only when classification or shared policy differs.
- Capture at the seam, once, and return `Either<Failure, T>`. No `try`/`catch` appears above the data layer.
- Render an initial-load failure inline with a retry; send a later failure to the shared handler. A local handler returns `true` only after it has produced the complete response.
- Clear a handled failure held on a state object, so a rebuild cannot answer it twice.

```dart
Future<Either<Failure, T>> guard<T>(Future<T> Function() body) async {
  try {
    return Right(await body());
  } catch (error, stackTrace) {
    return Left(capture(error, stackTrace));
  }
}
```
