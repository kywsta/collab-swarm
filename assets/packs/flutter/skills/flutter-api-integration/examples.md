# API integration — a worked endpoint

One catalog endpoint, every file it touches, in build order. Names are placeholders; the shapes are not.

## `features/catalog/catalog_urls.dart`

```dart
class CatalogUrls {
  static const items = '/catalog/items';
  static const item = '/catalog/items/{id}';
}
```

## `features/catalog/data/api/catalog_api.dart`

Interface, live implementation, and the deterministic one, in that order, in one file.

```dart
part 'catalog_api.g.dart';

abstract class CatalogApi {
  Future<ApiResponse<List<ItemDto>>> getItems({int page, int size, String? query});
  Future<ApiResponse<ItemDto>> getItem(String id);
}

@RestApi()
abstract class CatalogApiClient implements CatalogApi {
  factory CatalogApiClient(Dio dio) = _CatalogApiClient;

  @override
  @GET(CatalogUrls.items)
  Future<ApiResponse<List<ItemDto>>> getItems({
    @Query('page') int page = 1,
    @Query('size') int size = 20,
    @Query('q') String? query,
  });

  @override
  @GET(CatalogUrls.item)
  Future<ApiResponse<ItemDto>> getItem(@Path('id') String id);
}

/// Deterministic values for the `mock` flavor and for tests. Same file as the
/// interface on purpose: a method added above has to be answered here.
class MockCatalogApi implements CatalogApi {
  @override
  Future<ApiResponse<List<ItemDto>>> getItems({int page = 1, int size = 20, String? query}) async =>
      ApiResponse(data: _items.where((item) => query == null || item.title!.contains(query)).toList());

  @override
  Future<ApiResponse<ItemDto>> getItem(String id) async =>
      ApiResponse(data: _items.firstWhere((item) => item.id == id));

  static const _items = [
    ItemDto(id: '1', title: 'First', price: 1200),
    ItemDto(id: '2', title: 'Second', price: 3400),
  ];
}
```

## `features/catalog/data/dto/item_dto.dart`

Every field nullable. The payload is not a contract you control.

```dart
@freezed
abstract class ItemDto with _$ItemDto {
  const factory ItemDto({
    String? id,
    String? title,
    int? price,
    String? imageUrl,
    @JsonKey(name: 'is_active') bool? isActive,
  }) = _ItemDto;

  factory ItemDto.fromJson(Map<String, dynamic> json) => _$ItemDtoFromJson(json);
}
```

## `features/catalog/domain/entities/item.dart`

```dart
@freezed
abstract class Item with _$Item {
  const factory Item({
    /// Null means not persisted yet.
    String? id,
    required String title,
    @Default(0) int price,
    @Default('') String imageUrl,
    @Default(true) bool isActive,
  }) = _Item;

  const Item._();

  bool get isNew => id == null;
}
```

## `features/catalog/data/mappers/item_mapper.dart`

```dart
extension ItemDtoMapper on ItemDto {
  Item toDomain() => Item(
        id: id,
        title: title ?? '',
        price: price ?? 0,
        imageUrl: imageUrl ?? '',
        isActive: isActive ?? true,
      );

  static ItemDto fromDomain(Item item) =>
      ItemDto(id: item.id, title: item.title, price: item.price, isActive: item.isActive);
}
```

## `features/catalog/domain/repositories/catalog_repository.dart`

```dart
abstract class CatalogRepository {
  Future<Either<Failure, List<Item>>> items({int page, int size, String? query});
  Future<Either<Failure, Item>> item(String id);
}
```

## `features/catalog/data/repositories/catalog_repository_impl.dart`

The guard wraps the request **and** the fold, because `toDomain()` can throw too.

```dart
class CatalogRepositoryImpl implements CatalogRepository {
  CatalogRepositoryImpl({required CatalogApi api}) : _api = api;
  final CatalogApi _api;

  @override
  Future<Either<Failure, List<Item>>> items({int page = 1, int size = 20, String? query}) =>
      guard(() async {
        final response = await _api.getItems(page: page, size: size, query: query);
        return response.data.map((dto) => dto.toDomain()).toList();
      });

  @override
  Future<Either<Failure, Item>> item(String id) =>
      guard(() async => (await _api.getItem(id)).data.toDomain());
}
```

## `features/catalog/data/api/catalog_api_provider.dart`

```dart
@Riverpod(keepAlive: true)
CatalogApi catalogApi(Ref ref) => CatalogApiClient(ref.watch(privateApiClientProvider));

@Riverpod(keepAlive: true)
CatalogRepository catalogRepository(Ref ref) =>
    CatalogRepositoryImpl(api: ref.watch(catalogApiProvider));
```

## `test/features/catalog/catalog_api_contract_test.dart`

```dart
void main() {
  test('every deterministic method completes with a value', () async {
    final api = MockCatalogApi();
    expect((await api.getItems()).data, isNotEmpty);
    expect((await api.getItem('1')).data.id, '1');
  });

  test('a response missing every optional field still maps', () {
    expect(const ItemDto(id: '1').toDomain().title, '');
  });
}
```
