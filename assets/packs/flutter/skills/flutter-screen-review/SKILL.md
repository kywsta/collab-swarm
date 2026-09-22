---
name: flutter-screen-review
description: Review rendered Flutter screens against what a diff cannot show — every terminal state, layout under the supported viewports and text scales, theme tokens instead of literals, locale handling, and accessibility. Runs during feature review, on the screens the diff touched.
---

# Screen Review

A diff shows that a widget changed. It does not show whether the screen still works at 320 points wide, at 1.5× text scale, in the other locale, with an empty list, or for someone using a screen reader. This is that pass.

It **reports**; it does not repair. Findings go back to `deliver-change` as `blocking` or `advisory`, in the same shape `code-review` uses.

## 1. Fix the surfaces in scope

A screen is in scope when the diff touched its page, one of its widgets, the state it renders, or a theme token it uses. A shared widget that changed puts every screen using it in scope — that is usually where the regression is.

List them before looking at any of them, so the pass is bounded and nothing is reviewed twice.

Done when the set of screens is written down and each one is traceable to a changed file.

## 2. Terminal states

For each screen, reach every state and look at it. Not "is it handled" — what does it look like:

- **Loading** — is it the initial load or a refresh, and does the existing content stay visible when it should?
- **Empty** — does it say what would make it not empty, and offer the action that does?
- **Initial failure** — is it inline, with a retry that actually retries?
- **Append failure** — transient, with the loaded rows still usable?
- **Content** — at one item and at many.

The failure that matters most: an empty result and a failed load rendering as the same screen. A user who is offline is told there is nothing here.

Done when every state has been seen, and empty is distinguishable from failed.

## 3. Layout

Check each screen at the narrowest and widest viewport the project supports, and at the largest text scale. The things that break, in order of frequency: a `Row` of `Text` with no `Expanded`, a fixed height that clips at a larger scale, a bottom sheet taller than a short screen, and a horizontally scrolling page that should never scroll horizontally.

Then check the theme: every colour, text style, spacing, radius and duration resolved from a token. A literal is a finding even when it looks right today, because it will not follow the next theme change.

Done when each screen has been seen at the extremes of the supported range with no overflow, clipping, or unintended horizontal scroll.

## 4. Locale and accessibility

Every user-visible string comes from the string source, in every supported locale. Render the screen in the longest locale the project supports: text that fits in English is the most common overflow.

Accessibility: tap targets at least 48 points, a semantic label on every icon-only control, a contrast ratio that passes for body text, focus order that follows the reading order, and a screen reader that announces a state change rather than leaving the user on a screen that silently changed.

Done when no string is a literal, the longest locale fits, and every interactive element is reachable and labelled.

## 5. Report

One entry per finding: **severity** (`blocking` or `advisory`), **screen and state**, **what is wrong**, and **what the user experiences**. A finding without the last part is a preference, not a defect.

Blocking: an unreachable state, an overflow inside the supported range, an unlabelled control, a missing locale, a failure rendered as empty. Advisory: spacing that is off-token but harmless, a transition that could be smoother.

Done when every in-scope screen is judged, every finding carries severity, location and consequence, and the screens with no findings are named as reviewed.
