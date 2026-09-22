# Dependency injection — worked wiring

## Provider shapes

```dart
// A process resource: one Dio for the lifetime of the app.
@Riverpod(keepAlive: true)
Dio privateApiClient(Ref ref) {
  final dio = Dio(BaseOptions(baseUrl: ref.watch(envProvider).apiBaseUrl))
    ..interceptors.add(ref.watch(authInterceptorProvider));
  ref.onDispose(dio.close);
  return dio;
}

// Built from lower providers only.
@Riverpod(keepAlive: true)
CatalogRepository catalogRepository(Ref ref) =>
    CatalogRepositoryImpl(api: ref.watch(catalogApiProvider));

// Async keepAlive: construction genuinely awaits.
@Riverpod(keepAlive: true)
Future<SharedPreferences> preferences(Ref ref) => SharedPreferences.getInstance();

// A page ViewModel: auto-dispose, released when the page unsubscribes.
@riverpod
class ItemsViewModel extends _$ItemsViewModel {
  @override
  ItemsState build() => const ItemsState();
}
```

## A lifecycle pair

The module and its replaying stream live in one file, because they are one unit.

```dart
@Riverpod(keepAlive: true)
AccountModule account(Ref ref) {
  final module = AccountModule(repository: ref.watch(accountRepositoryProvider));
  ref.onDispose(module.dispose);
  return module;
}

@Riverpod(keepAlive: true)
Stream<Account> accountStates(Ref ref) => ref.watch(accountProvider).states;
```

## The composition root

`main.dart`. The container is local; nothing exports it.

```dart
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final flavor = Flavor.fromNative();
  final env = EnvConfig.of(flavor);

  // A live flavor fails closed rather than silently serving fake data.
  if (flavor != Flavor.mock) env.validate();

  await runZonedGuarded(() async {
    if (flavor != Flavor.mock) await initialiseServices(env);

    final container = ProviderContainer(overrides: buildOverrides(flavor, env));
    await container.read(accountProvider).restore();

    runApp(UncontrolledProviderScope(container: container, child: const App()));
  }, (error, stackTrace) => container.read(crashReporterProvider).recordError(error, stackTrace));
}
```

`core/di/flavor_overrides.dart`. Every swap the app makes, in one readable list.

```dart
List<Override> buildOverrides(Flavor flavor, EnvConfig env) => switch (flavor) {
      // API providers, not repositories: the repository is the behaviour under test.
      Flavor.mock => [
          catalogApiProvider.overrideWith((ref) => MockCatalogApi()),
          accountApiProvider.overrideWith((ref) => MockAccountApi()),
          // External ports replaced before any SDK would initialise.
          analyticsSinkProvider.overrideWithValue(const NoOpAnalyticsSink()),
          crashReporterProvider.overrideWithValue(const NoOpCrashReporter()),
        ],
      _ => [envProvider.overrideWithValue(env)],
    };
```

## The same overrides in a test

```dart
ProviderContainer harness({List<Override> overrides = const []}) {
  final container = ProviderContainer(
    overrides: [...buildOverrides(Flavor.mock, EnvConfig.test), ...overrides],
  );
  addTearDown(container.dispose);
  return container;
}
```

## A narrow port for out-of-tree code

A platform callback cannot reach the graph, so it receives a function instead of looking one up.

```dart
@Riverpod(keepAlive: true)
Future<NotificationDelivery> notificationDelivery(Ref ref) async {
  final router = ref.watch(appRouterProvider);
  return NotificationDelivery(
    source: ref.watch(notificationSourceProvider),
    display: ref.watch(notificationDisplayProvider),
    // The port, not the router: delivery stays independent of navigation.
    openRoute: router.open,
  )..initialize();
}
```
