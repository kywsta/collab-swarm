---
paths:
  - "lib/**/data/**"
  - "lib/**/domain/**"
  - "lib/**/*_urls.dart"
  - "lib/core/network/**"
description: Invariants for the data stack — one direction of flow, lenient DTOs, failures as values, mocks beside their interface.
---

# API integration rule

Detailed recipe: [`flutter-api-integration`](../skills/flutter-api-integration/SKILL.md). Apply with [error handling](error-handling.md) and [dependency injection](dependency-injection.md).

- Keep the flow `API → DTO → mapper → repository → domain`. A file under `domain/` imports neither Dio nor any DTO.
- Make every DTO field nullable and resolve the defaults in the mapper. A persisted `id` stays nullable, where `null` means not saved yet.
- Return `Either<Failure, T>` from every repository method, with `Right` for success, and put the DTO-to-domain fold inside the same guard as the call.
- Keep a deterministic API implementation in the same `*_api.dart` as its interface, and override the API provider — never the repository.

```dart
extension ItemDtoMapper on ItemDto {
  Item toDomain() => Item(id: id, title: title ?? '');
}

Future<Either<Failure, Item>> item(String id) =>
    guard(() async => (await _api.getItem(id)).data.toDomain());
```
