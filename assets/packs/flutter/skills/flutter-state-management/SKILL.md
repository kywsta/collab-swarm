---
name: flutter-state-management
description: Choosing the owner of a piece of state and implementing it — app lifecycle modules, page ViewModels, and the state objects they expose. Triggers on a ViewModel, a value more than one page reads, page state, a derived getter, debounce, pagination, or a stale response overwriting a newer one.
---

# State Management

Pick the smallest owner that can enforce the behaviour, implement that owner, and wire it with generated Riverpod. Full listings: [examples.md](examples.md).

## 1. Pick the owner

| Kind | When | Shape |
| --- | --- | --- |
| **Lifecycle module** | An app-wide value with invariants or multi-step transitions: the signed-in account, the selected locale | A class holding a snapshot plus a stream that replays the current value to each new listener. Two keepAlive providers: the module, and the stream. |
| **ViewModel** | Anything interactive on one page: a list, a search, a form, pagination | `@riverpod` auto-dispose `Notifier` over an immutable state object |
| **Widget state** | Controllers and visuals with no domain meaning | Fields on a `ConsumerState` |

One lifecycle, one owner. A page **derives** from it; a second notifier holding a copy of the same account, locale or token is a duplicate owner, and the bug it causes is the two disagreeing.

A page that only sends intents to a lifecycle — sign in, change locale — calls the module directly. It does not grow a pass-through ViewModel whose every method forwards one call.

Done when each value named in the ticket has exactly one owner, and you can say what would go wrong if a second one existed.

## 2. Implement a lifecycle module

1. Hold `_state`, expose `state`, and emit on a stream that **replays**: a listener subscribing after a transition must receive the current value, not wait for the next one.
2. Put every transition on the module — restore, sign in, sign out, revoke — so the invariant lives with the data.
3. Guard racing transitions with an epoch counter when two callers can start work at once.
4. Register two keepAlive providers: the module, and a `Stream<T>` that yields from it.

Consumers read the stream and fall back to the module's snapshot before the first emission. The stream is an `AsyncValue`, so `.asData?.value` first, then the snapshot.

Done when the value has one owner, a late listener sees the current value, and concurrent transitions cannot interleave into a state neither of them meant.

## 3. Implement a page ViewModel

1. `@riverpod class ItemsViewModel extends _$ItemsViewModel`.
2. `build()` returns the initial state **synchronously**, registers `ref.onDispose` for every timer and subscription, and kicks off the first load in a microtask. A `build()` that awaits gives the page an `AsyncValue` wrapper it then has to unwrap on every read.
3. The page sends raw intents — `onQueryChanged`, `onNearEnd`, `onRefresh`. The ViewModel owns debounce, trimming, the pagination guard, and the difference between a fetch and a search.
4. Actions `ref.read` a repository or a module, then fold the `Either` into state. The ViewModel never catches: the seam already turned the exception into a value.
5. Increment an epoch before every `await` and drop the result if the epoch moved. Without it a slow first request lands after a fast second one and overwrites it.

Done when the page sends only intents, every timer is disposed, and a slow response cannot overwrite a newer one.

## 4. Design the state object

A paginated list has four states that must never contradict each other. Derive them rather than storing them, so an impossible combination cannot be constructed:

```dart
bool get isInitialLoading => isLoading && items.isEmpty;
bool get isLoadingMore   => isLoading && items.isNotEmpty;
bool get isEmpty         => items.isEmpty && failure == null && !isLoading;
Failure? get initialFailure  => items.isEmpty && failure != null ? failure : null;
Failure? get loadMoreFailure => items.isNotEmpty && failure != null ? failure : null;
```

The distinction that matters: **an empty list and a failed load are different screens**. A state that cannot tell them apart renders "nothing here" when the network is down.

A form is usually a Freezed union — `initial | submitting | invalid | failed` — because its states are genuinely exclusive.

Done when loading, empty, initial failure, append failure and content are each reachable and mutually exclusive.

## Checklist

- [ ] Every value has one owner; no second notifier copies it
- [ ] `build()` is synchronous; first work runs in a microtask
- [ ] Every timer and subscription is released in `ref.onDispose`
- [ ] Debounce and pagination guards live in the ViewModel, not the widget
- [ ] An epoch drops stale responses
- [ ] Empty and initial-failure are distinguishable from the state alone
- [ ] The ViewModel contains no `try`/`catch` and no `BuildContext`

## Additional resources

- A paginated ViewModel, an account lifecycle, and a form union: [examples.md](examples.md)
