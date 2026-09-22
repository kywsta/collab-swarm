---
name: flutter-ui-implement
description: Building a Flutter page — widget type, build() structure, listen-before-watch, and the terminal states every screen has to render. Triggers on a new page or widget, a loading, empty or error layout, a listener that reacts to state, or a literal colour, size or string in the tree.
---

# UI Implementation

`build()` is an assembly view: it registers listeners, reads state, and composes named sections. Each section is a named builder or a private widget. Worked pages: [examples.md](examples.md).

## 1. Pick the widget type

| Type | When |
| --- | --- |
| `ConsumerWidget` | Needs `ref`, owns no controller |
| `ConsumerStatefulWidget` | Owns a `TextEditingController`, `ScrollController`, ticker or animation |
| `StatelessWidget` | Presentational chrome with no `ref` at all |

A `ConsumerState` reads in a fixed order, so a reviewer always knows where to look: controllers, computed getters, `initState`/`dispose`, `build()`, named builders, handlers.

Done when the widget type follows from whether a controller exists, not from habit.

## 2. Listen, then watch

Register `ref.listen` **before** `ref.watch` on the same provider, or the first rebuild is missed. A listener is for side effects only — navigation, a snackbar, a dialog. Compare previous and next before acting, so the same value is not answered twice.

`build()` starts no async work and makes no business call. Cleanup for provider-owned resources lives in the notifier's `ref.onDispose`; the State's `dispose()` releases **widget** controllers only.

`addPostFrameCallback` only when something genuinely needs the first frame to exist.

Done when no listener fires twice for one value, and `build()` has no side effect.

## 3. Tokens and strings

Every colour, text style, spacing, radius and duration comes from the theme. A literal in the widget tree is a value that cannot be changed centrally and will not survive a dark-mode pass.

<!-- swarm:if i18n!=none -->
Every user-visible string is a `{{i18n.sdk}}` key — `{{i18n.call}}` — with a value in every supported locale. A literal string in the tree is a string that ships untranslated.
<!-- swarm:else -->
Every user-visible string comes from `{{i18n.source}}` through `{{i18n.call}}`, never a literal in the tree. One place to change copy is worth the indirection even in a single-locale app.
<!-- swarm:endif -->

The screen must survive the viewport and text-scale range the project supports. A row of fixed-width boxes and an unwrapped `Text` in a `Row` are the two that break first.

Done when the tree contains no literal colour, size or user-visible string.

## 4. Render every terminal state

A list page has four, and they are four different screens:

- `isInitialLoading` → a progress indicator
- `initialFailure` → an inline error with retry
- `isEmpty` → the empty view, with whatever action makes it not empty
- otherwise → the list, with append failures going through the shared handler

Inside a `CustomScrollView`, the first three are a `SliverFillRemaining`, not a `Column` that overflows.

A detail page has three: loading while the entity is null, not-found, then content.

Intents go to the ViewModel as raw values — the text that was typed, the fact that the list neared its end. Debounce, trimming and paging guards live there, not in the widget.

Done when each terminal state can be reached in a widget test, and an empty result does not render as a failure.

## Checklist

- [ ] Widget type matches whether it owns a controller
- [ ] `ref.listen` registered before `ref.watch` on the same provider
- [ ] Each distinct section is a named builder or private widget
- [ ] No async work, business call or `try`/`catch` in `build()`
- [ ] Initial failure is inline; append failure goes through the shared handler
- [ ] No literal colour, size or user-visible string in the tree
- [ ] `dispose()` releases widget controllers only

## Additional resources

- A list page and a detail page, in full: [examples.md](examples.md)
