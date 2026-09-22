---
name: flutter-data-persistence
description: Choosing a local store and implementing the seam over it — secure storage for secrets, preferences for scalars, files for blobs, and the project's structured database. Triggers on a token or credential that must survive a restart, a preference key, cached rows, an offline read, or a widget reaching for a storage API directly.
---

# Data Persistence

Pick the store first, because the wrong one is a security bug or a migration. Worked files: [examples.md](examples.md).

| Store | For | Never for |
| --- | --- | --- |
| **Secure storage** | Tokens, credentials, anything whose leak is an incident | Bulk data; it is slow and small |
| **Preferences** | Small non-sensitive scalars: selected locale, onboarding seen, last tab | Anything secret; anything structured |
<!-- swarm:if database!=none -->
| **{{database.label}}** | Structured non-sensitive objects: cached rows, drafts, offline reads | Secrets; large binaries |
<!-- swarm:endif -->
| **Files** | Large or versioned blobs: downloaded documents, translation bundles | Anything you need to query |

One typed wrapper per concern. A widget reads a repository or a lifecycle module, never a storage API: a `SharedPreferences` call in a widget is a dependency that cannot be faked and a key that will be misspelled somewhere else.

Every local read and write goes through the same guard as a remote one, so a corrupt value becomes a `Failure` rather than an exception two layers up. See `flutter-error-handling`.

## 1. Secure storage

Construct the secure storage instance in **one** keepAlive provider. Typed store classes hold the key strings privately; nothing else names a key.

A token pair the HTTP layer refreshes implements whatever interface that layer expects, so the interceptor reads tokens through a contract rather than the storage API. A stored profile is a second typed store over the same instance, not a second raw client at the call site.

Done when no key string appears outside its store class, and no widget or ViewModel holds a secure storage instance.

## 2. Preferences

One keepAlive `Future<SharedPreferences>` entry point, awaited by the stores that need it. Each feature's keys belong to a small store class owned by the lifecycle that cares about them — the locale store belongs to the locale module.

A value that is only needed while the app runs stays in memory on a keepAlive notifier. Persist it when the product asks for it to survive a restart, not before.

Done when preferences are reached through one provider and each key has exactly one owner.

<!-- swarm:if database!=none -->
## 3. {{database.label}}

<!-- swarm:if database=drift -->
Tables are declared in Dart and the database class is generated. Keep the generated database behind a datasource: the repository depends on the datasource, not on generated query code, so a schema change does not reach the domain layer.

Open the database once, from a keepAlive provider that resolves the file path through `path_provider`. Every schema change needs a migration **and** a test that opens the previous schema and migrates it — a migration nobody ran against real data is a crash on the next release.
<!-- swarm:endif -->
<!-- swarm:if database=hive -->
Local models are plain classes registered through the generator's adapter specification; they are not the domain entity. Keep them apart and map with `toEntity` / `fromEntity`, so a stored shape can change without changing the domain.

Initialise Hive and register adapters **once**, then open each box from its own keepAlive provider. A second initialisation site is the bug that shows up as "adapter already registered" in one flavor only.
<!-- swarm:endif -->
<!-- swarm:if database=isar -->
Collections are annotated classes the generator turns into schemas; they are not the domain entity. Keep them apart and map at the datasource boundary.

Open the Isar instance once, from a keepAlive provider resolving its directory through `path_provider`, and pass the same instance everywhere. Index anything you query on: an unindexed `filter()` over a growing collection is the slow frame nobody attributes to storage.
<!-- swarm:endif -->

The datasource wraps the {{database.store}} and exposes domain-shaped methods. The repository wraps every datasource call in the storage guard and returns `Either<Failure, T>`. Run the project's `generate` check after any local model changes.

Done when the local model is separate from the domain entity, the store is opened in one place, and every call from the repository is guarded.
<!-- swarm:endif -->

## Checklist

- [ ] Secrets in secure storage; scalars in preferences; blobs in files
- [ ] One provider per store instance, keepAlive
- [ ] Key strings confined to their store class
- [ ] Widgets and ViewModels depend on repositories or modules, not storage APIs
- [ ] Every local call is guarded and returns `Either<Failure, T>`
<!-- swarm:if database!=none -->
- [ ] Local models are separate from domain entities, with a mapper between
- [ ] {{database.store}} opened once, from its keepAlive provider
<!-- swarm:endif -->
<!-- swarm:if database=drift -->
- [ ] Every schema change has a migration and a test that runs it
<!-- swarm:endif -->

## Additional resources

- Token store, preferences store<!-- swarm:if database!=none -->, and a {{database.label}} stack<!-- swarm:endif -->: [examples.md](examples.md)
