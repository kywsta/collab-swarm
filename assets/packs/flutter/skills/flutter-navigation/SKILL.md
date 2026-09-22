---
name: flutter-navigation
description: go_router routing — where a feature's routes live, mounting them on a shell branch or the root, typed helpers, and gating a path behind sign-in without losing the destination. Triggers on a new page route, a nested path, a tab, a protected URL, a deep link, or a redirect.
---

# Navigation

A feature owns its routes; one file owns the router. That split is what keeps a new feature from editing a file three other people are editing. Worked files: [examples.md](examples.md).

```text
features/<feature>/<feature>_routes.dart   # paths + GoRoutes + which of them are gated
core/navigation/app_router.dart            # the one GoRouter, redirect, navigator key
```

## 1. Declare the feature's routes

The feature exports a route set: its `GoRoute`s, the paths that require a signed-in user, and any analytics screen names. It does **not** construct a `GoRouter`.

Paths are `static const` on one class, so a caller interpolates a constant rather than retyping a string. A child route (`:id`, `new`) nests under its parent's path, because nesting is what makes the back stack right.

Done when the feature's paths and routes are in its own file and nothing outside it names a string literal path.

## 2. Mount it

- **A tab** is a branch of the shell route. The shell is built in one place from the tab features' route sets; a tab is never spread onto the root.
- **Anything outside the tabs** — sign-in, onboarding, a full-screen flow — is spread onto the router's root routes, beside the shell.

Switching tabs goes through the shell's own navigation, so each tab keeps its stack. Pushing a detail page uses `push` so the tab stack is preserved; replacing the current location — going back to a parent, landing after sign-in — uses `go`.

The router provider is keepAlive and owns the root navigator key, so a snackbar or dialog raised from outside a page has a context to use.

Done when a tab change preserves every tab's stack, and a detail page pushed inside a tab returns to that tab.

## 3. Typed helpers

A helper is an extension that interpolates a location, not a second source of truth for the path:

```dart
void goToItem(BuildContext context, String id) => context.push('${CatalogRoutes.items}/$id');
```

Write one for a destination that leaves the current tab or pushes a child. A plain `context.go(FooRoutes.path)` needs no helper.

Done when no caller builds a path by string concatenation of literals.

## 4. Gate a path, and keep the destination

A feature declares its own gated paths; a gated path gates everything under it. The router merges the declarations, and nothing else decides gating — a widget that checks `isSignedIn` before navigating is a second gate that will disagree with the first.

Two doors, one held destination:

- **From inside the app** — a tab tap, a helper, a notification tap. Route through the router's own `open(location)`. A guest asking for a gated location gets sign-in **pushed** over the current screen, with the location held, so the shell and every tab stack stay mounted and backing out returns the user where they were.
- **From outside** — a deep link, a cold start. The top-level `redirect` holds the location and returns sign-in. Sign-in is open to guests; a signed-in user landing on it goes home.

Move the router on a session change by subscribing to the session stream, not by refreshing on it. A refresh re-parses the base location and cannot see a pushed sign-in, so it restores the one just popped. On sign-in, go to the held destination once; on sign-out, go home if a gated page is on screen. Leaving sign-in deliberately drops the hold.

Done when a guest deep-linking to a gated page lands there after signing in, and backing out of sign-in returns to where they were rather than to home.

## Checklist

- [ ] Paths and `GoRoute`s in `<feature>_routes.dart`; only the router builds `GoRouter`
- [ ] Children nested under the parent path
- [ ] Tab features mounted as shell branches; out-of-shell routes at the root
- [ ] `push` for a child inside a tab, `go` to replace
- [ ] Gated paths declared by the feature, merged by the router, checked nowhere else
- [ ] A held destination survives sign-in and is consumed exactly once

## Additional resources

- A feature route set, the router, and the held-destination flow: [examples.md](examples.md)
