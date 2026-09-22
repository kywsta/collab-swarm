# Navigation — worked files

## A feature's route set

`features/catalog/catalog_routes.dart`

```dart
class CatalogRoutes {
  static const items = '/items';
  static const saved = '/items/saved';

  static final routeSet = FeatureRouteSet(
    routes: [
      GoRoute(
        path: items,
        builder: (context, state) => const ItemsPage(),
        routes: [
          // Nested: pushing this keeps the tab stack.
          GoRoute(
            path: ':id',
            builder: (context, state) => ItemDetailPage(itemId: state.pathParameters['id']!),
          ),
        ],
      ),
      GoRoute(path: saved, builder: (context, state) => const SavedItemsPage()),
    ],
    // A gated path gates everything under it.
    protectedPaths: {saved},
    screenNames: {items: 'items', saved: 'saved_items'},
  );
}
```

`core/navigation/feature_route_set.dart`

```dart
class FeatureRouteSet {
  const FeatureRouteSet({
    required this.routes,
    this.protectedPaths = const {},
    this.screenNames = const {},
  });

  final List<RouteBase> routes;
  final Set<String> protectedPaths;
  final Map<String, String> screenNames;
}
```

## The router

`core/navigation/app_router.dart`

```dart
@Riverpod(keepAlive: true)
AppRouter appRouter(Ref ref) {
  final router = AppRouter(ref);
  ref.onDispose(router.dispose);
  return router;
}

class AppRouter {
  AppRouter(this._ref) {
    _router = GoRouter(
      navigatorKey: navigatorKey,
      initialLocation: HomeRoutes.home,
      routes: [AppShellRoutes.shell, ...AppShellRoutes.rootSets.expand((set) => set.routes)],
      redirect: _redirect,
    );

    // Subscribed, not a refreshListenable: a refresh re-parses the base
    // location and would restore a pushed sign-in that was just popped.
    _session = _ref.listen(accountStatesProvider, (previous, next) {
      final account = next.asData?.value;
      if (account == null) return;
      account.isSignedIn ? _onSignedIn() : _onSignedOut();
    });
  }

  final Ref _ref;
  final navigatorKey = GlobalKey<NavigatorState>();
  late final GoRouter _router;
  late final ProviderSubscription<AsyncValue<Account>> _session;
  String? _pending;

  GoRouter get router => _router;

  Set<String> get _gated => {
        for (final set in AppShellRoutes.allSets) ...set.protectedPaths,
      };

  bool _isGated(String location) =>
      _gated.any((path) => location == path || location.startsWith('$path/'));

  /// Every in-app navigation goes through here, so gating has one implementation.
  void open(String location) {
    final context = navigatorKey.currentContext!;
    if (_isGated(location) && !_signedIn) {
      _pending = location;
      // Pushed, not go: the shell and every tab stack stay mounted.
      context.push(AuthRoutes.signIn);
      return;
    }
    context.go(location);
  }

  void leaveSignIn() {
    _pending = null;
    final context = navigatorKey.currentContext!;
    context.canPop() ? context.pop() : context.go(HomeRoutes.home);
  }

  /// Only the outside door: a deep link or a cold start.
  String? _redirect(BuildContext context, GoRouterState state) {
    final location = state.matchedLocation;
    if (location == AuthRoutes.signIn) return _signedIn ? HomeRoutes.home : null;
    if (_isGated(location) && !_signedIn) {
      _pending = location;
      return AuthRoutes.signIn;
    }
    return null;
  }

  void _onSignedIn() {
    final destination = _pending;
    _pending = null;
    destination != null ? _router.go(destination) : leaveSignIn();
  }

  void _onSignedOut() {
    if (_isGated(_router.state.matchedLocation)) _router.go(HomeRoutes.home);
  }

  void dispose() => _session.close();
}
```

## The shell

`features/shell/shell_routes.dart`

```dart
class AppShellRoutes {
  static final tabSets = [
    HomeRoutes.routeSet,
    CatalogRoutes.routeSet,
    ProfileRoutes.routeSet,
  ];

  static final rootSets = [AuthRoutes.routeSet, OnboardingRoutes.routeSet];

  static List<FeatureRouteSet> get allSets => [...tabSets, ...rootSets];

  static final shell = StatefulShellRoute.indexedStack(
    builder: (context, state, navigationShell) => AppShellPage(navigationShell: navigationShell),
    branches: [
      for (final set in tabSets) StatefulShellBranch(routes: set.routes),
    ],
  );
}
```

## The test that matters

```dart
testWidgets('a guest deep-linking to a gated page lands there after signing in', (tester) async {
  final container = harness();
  final router = container.read(appRouterProvider);

  router.router.go(CatalogRoutes.saved);
  await tester.pumpAndSettle();
  expect(find.byType(SignInPage), findsOneWidget);

  await container.read(accountProvider).signIn(validCredentials);
  await tester.pumpAndSettle();

  expect(find.byType(SavedItemsPage), findsOneWidget);
});
```
