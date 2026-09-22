---
name: flutter-api-integration
description: The Retrofit data stack for one endpoint — endpoint path, API interface, DTO, mapper, domain entity, repository, and its contract test. Triggers on an endpoint, request or response payload, DTO, mapper, domain entity, repository method, or a mock adapter for an API that does not exist yet.
---

# API Integration

Build the stack in order, bottom-up, because each layer's test is written against the one below it. Worked files: [examples.md](examples.md).

```text
Dio client → Retrofit API → DTO → mapper → repository impl → domain repository
```

`Either<Failure, T>` is the return type of every repository method. **`Right` is success, `Left` is a `Failure`** — the conventional orientation, so a `fold` reads `(failure, value)`.

A domain module is not part of this stack. Add one only when it owns policy, invariants, orchestration, rollback or lifecycle; otherwise the ViewModel calls the repository.

## 1. Endpoint paths and the API interface

Path strings live in `<feature>_urls.dart`, one class of `static const`. Shared query keys (page, size, sort) belong in a constants class; a query name only this endpoint uses may stay inline on the `@Query`.

Every remote API is an abstract interface with a `@RestApi` implementation part. Annotations go on the implementation; the interface stays a plain Dart contract, because the interface is what the repository and the tests depend on.

Pick the Dio client the endpoint needs: the unauthenticated one, the authenticated one that carries the bearer token, or a separate one per additional base URL. Token refresh belongs on the authenticated client's interceptor, never on a feature API.

A response wrapped in an envelope (`{status, message, data}`) is typed through one shared wrapper; an unwrapped response returns its DTO directly.

Done when the path is in `<feature>_urls.dart`, the interface names the operation in domain words, and the client matches whether the endpoint needs authentication.

## 2. DTO and entity

The DTO is lenient and the entity is not. That split is the point: the network may send anything, and nothing above the mapper should have to ask whether a field arrived.

- DTO: `@freezed`, **every field nullable**, `fromJson`. It mirrors the payload, including names you would not choose.
- Entity: `@freezed`, fields `required` or `@Default`. A persisted `id` stays nullable, where `null` means *not saved yet*. Domain imports no DTO.
- A closed request body with required fields may be a plain `@JsonSerializable()` class instead.

Done when the DTO tolerates a response with every field missing, and the entity has no nullable field that only exists because the API might omit it.

## 3. Mapper and repository

The mapper is an extension on the DTO in `data/mappers/`, resolving each null to the domain default:

```dart
extension ItemDtoMapper on ItemDto {
  Item toDomain() => Item(id: id, title: title ?? '', price: price ?? 0);
}
```

A write path adds `static ItemDto fromDomain(Item item)`. One DTO that carries two domain values exposes two methods (`toUser()`, `toTokenPair()`) rather than one wide entity.

The repository interface lives in `domain/`, the implementation in `data/`. The implementation calls the API, folds the DTO to domain **inside the guard**, and returns `Either<Failure, T>`. A `toDomain()` can throw — an enum that gained a value, a date that is not a date — and that throw belongs in the same guard as the request, not in the ViewModel. See `flutter-error-handling` for the guard itself.

Done when the domain repository imports no Dio and no DTO, and every fold that can throw is inside the guard.

## 4. Mock adapter, when the API is not there yet

An endpoint the backend has not built is planned against the contract the specification names. Put the deterministic implementation in the **same `*_api.dart`** as the interface and the live implementation, so the three drift together or not at all.

Override the **API provider**, never the repository: the repository is the behaviour under test, and a mocked repository tests nothing. Register the override through the composition root, and only for an explicitly selected `mock` flavor; tests install the same override directly.

A contract test calls every method on the mock and asserts a completed `Either`, so the deterministic stack cannot rot while the live one is being waited on.

Done when the mock lives beside its interface, only the API provider is overridden, and one test exercises every method on it.

## Checklist

- [ ] Paths in `<feature>_urls.dart`; interface plus `@RestApi` implementation
- [ ] DTO fully nullable with `fromJson`; entity without API nullability
- [ ] Mapper in `data/mappers/`, resolving every null
- [ ] Repository returns `Either<Failure, T>`, `Right` for success
- [ ] Domain layer imports neither Dio nor any DTO
- [ ] The DTO-to-domain fold is inside the guard
- [ ] Mock adapter beside its interface, API provider overridden, contract test present
- [ ] `generate` run after the annotated sources changed

## Additional resources

- A worked endpoint, end to end: [examples.md](examples.md)
