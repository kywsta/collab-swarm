---
paths:
  - "lib/**/presentation/**"
  - "lib/shared/widgets/**"
  - "lib/shared/theme/**"
  - "lib/app.dart"
description: Invariants for pages — build() assembles, listen before watch, tokens not literals, every terminal state rendered.
---

# UI implementation rule

Detailed recipe: [`flutter-ui-implement`](../skills/flutter-ui-implement/SKILL.md). Apply with [state management](state-management.md), [error handling](error-handling.md) and [navigation](navigation.md).

- Keep `build()` an assembly view: each distinct section is a named builder or a private widget, and no async work or business call happens there.
- Register `ref.listen` before `ref.watch` on the same provider, and compare previous to next before acting.
- Resolve every colour, text style, spacing, radius and duration from a theme token, and every user-visible string from the string source. No literals in the tree.
- Render loading, empty, initial failure, append failure and content as distinct states; an empty result never renders as a failure, or the reverse.

```dart
@override
Widget build(BuildContext context, WidgetRef ref) {
  ref.listen(itemsViewModelProvider.select((state) => state.loadMoreFailure), _onFailure);
  final state = ref.watch(itemsViewModelProvider);
  return Scaffold(body: _buildBody(state));
}
```
