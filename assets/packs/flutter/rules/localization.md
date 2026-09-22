---
if: i18n!=none
paths:
  - "lib/i18n/**"
  - "lib/l10n/**"
  - "lib/**/presentation/**"
description: Invariants for translated strings — keys not literals, every locale in the same commit, parameters not concatenation.
---

# Localization rule

Detailed recipe: [`flutter-localization`](../skills/flutter-localization/SKILL.md). Apply with [UI implementation](ui-implement.md).

- Read every user-visible string from the string source as `{{i18n.call}}`. A literal in a widget tree is a defect, not a shortcut.
- Add a new key to every supported locale in the same commit, named after its screen and role rather than its current wording.
- Pass values as parameters and counts through a plural form; never assemble a sentence by concatenation. Format dates, numbers and currency against the active locale.
- Keep translated text out of state: state holds the value, the widget formats it.

```dart
Text({{i18n.call}})
```
