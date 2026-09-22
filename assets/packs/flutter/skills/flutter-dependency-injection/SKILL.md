---
name: flutter-dependency-injection
description: The Riverpod provider graph — annotating a dependency, choosing keepAlive against auto-dispose, where the provider file lives, and how the composition root swaps adapters per flavor. Triggers on a new provider, a lifetime change, a mock override, a flavor switch, or anything that reaches for a global or a service locator.
---

# Dependency Injection

Generated Riverpod is the only dependency graph. There is no service locator and no global singleton: a dependency that is not a provider cannot be overridden in a test, which is the whole reason for the graph. Examples: [examples.md](examples.md).

## 1. Annotate

`@riverpod` for auto-dispose, `@Riverpod(keepAlive: true)` for a process resource. Add `part '<filename>.g.dart';` and let the generator write the provider.

`ref.watch` while the graph is being constructed — inside a provider factory, inside a notifier's `build()`. `ref.read` inside an action method, where watching would rebuild on every change to something the action only needed once.

Done when the dependency is reachable as a provider and nothing constructs it directly.

## 2. Choose the lifetime

**keepAlive** — anything whose construction is expensive or whose identity must not change under the app:

- Dio clients, interceptors, API clients, repositories
- secure storage, preferences<!-- swarm:if database!=none -->, the {{database.store}} and anything holding it open<!-- swarm:endif -->
- the router, lifecycle modules and their state streams
- observability ports, security guards<!-- swarm:if notifications!=none -->, push delivery<!-- swarm:endif -->

**auto-dispose (`@riverpod`)** — page ViewModels, released when the page unsubscribes. A ViewModel that must be keepAlive is usually a lifecycle module wearing the wrong hat.

An async keepAlive provider (`Future<T>`) is correct when construction awaits: restoring a session, opening a store, initialising an SDK.

Done when every process resource is keepAlive, every page ViewModel auto-disposes, and neither is the other.

## 3. Place the file

Prefer `<thing>_provider.dart` beside the implementation it builds. A module and its state stream may share one file, because they are one unit. A provider for a type that only the composition root builds may live in that type's own file.

Done when the provider is findable from the type it provides.

## 4. Compose at the root, per flavor

`main()` builds a **local** `ProviderContainer` with the overrides the flavor needs and passes it to `UncontrolledProviderScope`. Local, not global: an exported container is a service locator with extra steps, and tests build their own.

Adapter swaps happen here and nowhere else. The rules:

- Override the **API provider**, never the repository — the repository is the behaviour under test.
- Replace external service ports (push, analytics, crash) **before** their SDKs would initialise.
- Only an explicitly selected `mock` flavor installs deterministic adapters. A flavor named `dev` is a live environment with different configuration, and must fail closed when configuration is missing rather than quietly serving fake data.
- Tests install the same overrides directly, so the deterministic path is the one that is actually exercised.

Done when the container is local, the overrides are in one function, and no flavor other than `mock` reaches a deterministic adapter.

## 5. Keep the graph pointing one way

Dependencies point inward and downward. An API or repository provider watches only lower or same-layer providers. The one legitimate upward edge is at the composition root: a token interceptor watching the account lifecycle to refresh or revoke. That edge is in `core/`, not in a feature.

Platform callbacks are adapted at the root into narrow ports, and out-of-tree code receives a port. Code that looks a provider up for itself has escaped the graph, and cannot be tested without booting the app.

Done when no feature provider watches upward, and nothing outside the tree reads a provider.

## 6. Generate

Run the project's `generate` check after adding or changing a provider. A missing `.g.dart` is an analyzer error, not a runtime surprise — but only once the generator has run.

## Checklist

- [ ] Every stateful dependency is a generated provider; no service locator, no global
- [ ] Process resources keepAlive, page ViewModels auto-dispose
- [ ] `ref.watch` while constructing, `ref.read` in actions
- [ ] `ProviderContainer` built in `main()`, not exported
- [ ] Overrides replace API providers and external ports, not repositories
- [ ] Only an explicit `mock` flavor gets deterministic adapters
- [ ] `generate` run; analyzer clean on the generated parts

## Additional resources

- Provider shapes, a lifecycle pair, and `main()` in full: [examples.md](examples.md)
