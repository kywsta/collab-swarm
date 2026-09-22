# Data persistence — worked stores

## The secure storage instance

One provider, one instance.

```dart
@Riverpod(keepAlive: true)
FlutterSecureStorage secureStorage(Ref ref) => const FlutterSecureStorage(
      aOptions: AndroidOptions(encryptedSharedPreferences: true),
    );
```

## A typed token store

The keys are private. The interceptor depends on this contract, not on the storage API.

```dart
class TokenStore {
  const TokenStore(this._storage);
  final FlutterSecureStorage _storage;

  static const _access = 'auth.access_token';
  static const _refresh = 'auth.refresh_token';

  Future<Either<Failure, TokenPair?>> read() => guard(() async {
        final access = await _storage.read(key: _access);
        final refresh = await _storage.read(key: _refresh);
        if (access == null || refresh == null) return null;
        return TokenPair(access: access, refresh: refresh);
      });

  Future<Either<Failure, void>> write(TokenPair pair) => guard(() async {
        await _storage.write(key: _access, value: pair.access);
        await _storage.write(key: _refresh, value: pair.refresh);
      });

  Future<Either<Failure, void>> clear() => guard(() async {
        await _storage.delete(key: _access);
        await _storage.delete(key: _refresh);
      });
}

@Riverpod(keepAlive: true)
TokenStore tokenStore(Ref ref) => TokenStore(ref.watch(secureStorageProvider));
```

## Preferences

```dart
@Riverpod(keepAlive: true)
Future<SharedPreferences> preferences(Ref ref) => SharedPreferences.getInstance();

class LocaleStore {
  const LocaleStore(this._preferences);
  final SharedPreferences _preferences;

  static const _key = 'locale.selected';

  String? read() => _preferences.getString(_key);
  Future<void> write(String code) => _preferences.setString(_key, code);
}

@Riverpod(keepAlive: true)
Future<LocaleStore> localeStore(Ref ref) async =>
    LocaleStore(await ref.watch(preferencesProvider.future));
```

<!-- swarm:if database=drift -->
## A Drift stack

The local table is not the domain entity.

```dart
class ItemRows extends Table {
  TextColumn get id => text()();
  TextColumn get title => text()();
  IntColumn get price => integer().withDefault(const Constant(0))();
  DateTimeColumn get cachedAt => dateTime()();

  @override
  Set<Column> get primaryKey => {id};
}

@DriftDatabase(tables: [ItemRows])
class AppDatabase extends _$AppDatabase {
  AppDatabase(super.executor);

  @override
  int get schemaVersion => 2;

  @override
  MigrationStrategy get migration => MigrationStrategy(
        onUpgrade: (migrator, from, to) async {
          if (from < 2) await migrator.addColumn(itemRows, itemRows.cachedAt);
        },
      );
}

@Riverpod(keepAlive: true)
Future<AppDatabase> appDatabase(Ref ref) async {
  final directory = await getApplicationDocumentsDirectory();
  final database = AppDatabase(NativeDatabase(File(p.join(directory.path, 'app.sqlite'))));
  ref.onDispose(database.close);
  return database;
}
```

```dart
extension ItemRowMapper on ItemRow {
  Item toEntity() => Item(id: id, title: title, price: price);
}

class ItemCacheDatasource {
  const ItemCacheDatasource(this._database);
  final AppDatabase _database;

  Future<List<Item>> items() async =>
      (await _database.select(_database.itemRows).get()).map((row) => row.toEntity()).toList();
}
```

The migration test is the one that earns its keep:

```dart
test('a v1 database migrates to v2 without losing rows', () async {
  final database = AppDatabase(await schemaAt(1));
  await database.customStatement("INSERT INTO item_rows VALUES ('1', 'First', 100)");

  await verifier.migrateAndValidate(database, 2);

  expect(await database.select(database.itemRows).get(), hasLength(1));
});
```
<!-- swarm:endif -->
<!-- swarm:if database=hive -->
## A Hive stack

The local model is a plain class; the domain entity stays Freezed.

```dart
// hive_adapters.dart — one registration site.
@GenerateAdapters([AdapterSpec<ItemRow>()])
part 'hive_adapters.g.dart';

class ItemRow {
  ItemRow({required this.id, required this.title, required this.price});
  final String id;
  final String title;
  final int price;
}

extension ItemRowMapper on ItemRow {
  Item toEntity() => Item(id: id, title: title, price: price);
  static ItemRow fromEntity(Item item) =>
      ItemRow(id: item.id!, title: item.title, price: item.price);
}
```

```dart
// Initialised once. A second init site is "adapter already registered".
@Riverpod(keepAlive: true)
Future<void> hiveInit(Ref ref) async {
  await Hive.initFlutter();
  registerAdapters();
}

@Riverpod(keepAlive: true)
Future<Box<ItemRow>> itemsBox(Ref ref) async {
  await ref.watch(hiveInitProvider.future);
  return Hive.isBoxOpen('items') ? Hive.box<ItemRow>('items') : Hive.openBox<ItemRow>('items');
}
```
<!-- swarm:endif -->
<!-- swarm:if database=isar -->
## An Isar stack

```dart
@collection
class ItemRow {
  Id get isarId => fastHash(id);

  @Index(unique: true, replace: true)
  late String id;

  @Index()
  late String title;

  late int price;
}

extension ItemRowMapper on ItemRow {
  Item toEntity() => Item(id: id, title: title, price: price);
}

@Riverpod(keepAlive: true)
Future<Isar> isar(Ref ref) async {
  final directory = await getApplicationDocumentsDirectory();
  final isar = await Isar.open([ItemRowSchema], directory: directory.path);
  ref.onDispose(isar.close);
  return isar;
}
```

Anything filtered on is indexed: an unindexed scan over a growing collection is a dropped frame.
<!-- swarm:endif -->

## The repository over it

```dart
class ItemCacheRepositoryImpl implements ItemCacheRepository {
  const ItemCacheRepositoryImpl(this._datasource);
  final ItemCacheDatasource _datasource;

  @override
  Future<Either<Failure, List<Item>>> cached() => guard(_datasource.items);
}
```
