---
name: flutter-architecture
description: Where a file belongs in this Flutter project, and what its layer may import — feature folders, the core modules, layer direction, naming, generated output, and flavors. Read when adding a feature, deciding between a feature folder and core, naming a new type, or wiring a per-flavor value.
---

# Flutter Architecture

The shape of the project, and the four rules that keep it that shape. This is vocabulary, not a procedure: read it to place a file or settle an argument, then go back to the concern skill that owns the work.

## Layers

```text
presentation  →  domain  →  data (ports)
   pages           entities      api + dto + mappers
   widgets         repository    repository impls
   view models     interfaces    local sources
```

Dependencies point inward. `presentation` may import `domain`; `data` may import `domain`; `domain` imports neither of them, and imports no package that is a transport or a framework detail — no `dio`, no DTO, no `package:flutter/material.dart`. A domain file that needs one of those is a domain file that was put in the wrong layer, or a concept that was never domain.

The composition root is the one place the direction is allowed to look sideways: `bootstrap/` and `core/di/` know every layer, because choosing implementations is exactly their job.

## Where a file goes

| The thing | Where |
| --- | --- |
| Anything one feature uses | `features/<feature>/<layer>/` |
| The same thing, needed by a second feature | move to `core/` or `shared/`, in that commit |
| A cross-cutting capability with a port and adapters | `core/<capability>/` |
| A widget or token with no domain meaning | `shared/widgets/`, `shared/theme/` |
| Routes and endpoint paths | `features/<feature>/<feature>_routes.dart`, `_urls.dart` |
| Provider for a type | `<thing>_provider.dart` beside the implementation |

A new feature is a new folder under `features/`, not a new layer under `core/`. Something earns a place in `core/` when a second feature needs it — not when you expect a second feature to need it. Moving it later is a rename; guessing wrong is a dependency nobody can remove.

A domain module earns its place when it owns policy, invariants, multi-step orchestration, rollback or lifecycle. A one-method class that forwards to a repository fails the deletion test: delete it and have the ViewModel call the repository.

## Naming

- Files are `snake_case.dart` and named after the type they hold: `item_repository.dart` holds `ItemRepository`.
- Types are `UpperCamelCase`; a DTO ends `Dto`, an implementation ends `Impl`, a page ends `Page`, a view model ends `ViewModel`.
- A test mirrors its subject's path under `test/`, with `_test.dart` appended.
- Private widgets and helpers are `_LeadingUnderscore`, in the file that uses them.

## Generated output

Every generator writes beside its source: `*.g.dart` and `*.freezed.dart` are machine-owned. Never edit one. Edit the annotated source and run the project's `generate` check.

Generation is triggered by a change to: a `@freezed` class, a `@JsonSerializable` DTO, a `@RestApi` interface, a `@riverpod` provider<!-- swarm:if i18n=slang -->, a translation source<!-- swarm:endif --><!-- swarm:if env=envied -->, an `@Envied` class<!-- swarm:endif --><!-- swarm:if database=drift || database=isar || database=hive -->, a local model or schema<!-- swarm:endif -->. A diff that changes one of those and no generated file is an unrun generator, not a small change.

## Flavors and configuration

The app has flavors — at least `dev` and `prod`, usually a `mock` as well — selected natively and read through one accessor in `flavors.dart`. A flavor decides configuration and which adapters the composition root installs. It does not decide behaviour anywhere else: a widget or repository that branches on the flavor has moved a composition-root decision into a leaf.

<!-- swarm:if env=envied -->
Per-flavor values live in `{{env.source}}` and reach the app as generated `@Envied` constants, obfuscated in the build. The `.env` files are never committed; a committed `.env.example` lists the keys with empty values so a new checkout knows what it needs.
<!-- swarm:else -->
Per-flavor values live in `{{env.source}}` and reach the app through `--dart-define-from-file`, read once into a configuration class rather than scattered `String.fromEnvironment` calls. The files holding real values are never committed; a committed example file lists the keys with empty values.
<!-- swarm:endif -->

Only an explicitly selected `mock` flavor may install deterministic adapters. Every other flavor validates its configuration at startup and fails closed on a missing value — a `dev` build that silently falls back to fake data is how a broken integration reaches a release.

Secrets never enter Git, a plan document, a log line, or an analytics event.
