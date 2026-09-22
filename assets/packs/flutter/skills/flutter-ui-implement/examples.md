# UI implementation — worked pages

## A list page

Every terminal state, a listener registered before the watch, and no literal in the tree.

```dart
class ItemsPage extends ConsumerStatefulWidget {
  const ItemsPage({super.key});

  @override
  ConsumerState<ItemsPage> createState() => _ItemsPageState();
}

class _ItemsPageState extends ConsumerState<ItemsPage> {
  // 1. Controllers.
  final _scroll = ScrollController();
  final _search = TextEditingController();

  // 2. Computed getters.
  bool get _nearEnd => _scroll.position.extentAfter < 400;

  // 3. Lifecycle.
  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
  }

  @override
  void dispose() {
    // Widget controllers only. The ViewModel's timer is released in its
    // own ref.onDispose.
    _scroll
      ..removeListener(_onScroll)
      ..dispose();
    _search.dispose();
    super.dispose();
  }

  // 4. build(): listeners, then watches, then the tree.
  @override
  Widget build(BuildContext context) {
    ref.listen(itemsViewModelProvider.select((state) => state.loadMoreFailure), (previous, next) {
      if (next == null || next == previous) return;
      ref.read(failureHandlerProvider).handle(context, next);
      ref.read(itemsViewModelProvider.notifier).clearFailure();
    });

    final state = ref.watch(itemsViewModelProvider);

    return Scaffold(
      appBar: AppBar(title: Text(t.items.title)),
      body: RefreshIndicator(
        onRefresh: ref.read(itemsViewModelProvider.notifier).refresh,
        child: CustomScrollView(
          controller: _scroll,
          slivers: [_buildSearch(), _buildBody(state)],
        ),
      ),
    );
  }

  // 5. Named builders, one per section.
  Widget _buildSearch() => SliverToBoxAdapter(
        child: Padding(
          padding: EdgeInsets.all(context.spacing.md),
          child: SearchField(
            controller: _search,
            hintText: t.items.searchHint,
            // Raw intent. Debounce and trimming belong to the ViewModel.
            onChanged: ref.read(itemsViewModelProvider.notifier).onQueryChanged,
          ),
        ),
      );

  Widget _buildBody(ItemsState state) {
    if (state.isInitialLoading) {
      return const SliverFillRemaining(child: Center(child: CircularProgressIndicator()));
    }
    if (state.initialFailure != null) {
      return SliverFillRemaining(
        child: ErrorView(
          message: ref.read(failurePresentationProvider).message(state.initialFailure!),
          onRetry: ref.read(itemsViewModelProvider.notifier).refresh,
        ),
      );
    }
    if (state.isEmpty) {
      return SliverFillRemaining(child: EmptyView(message: t.items.empty));
    }
    return SliverList.separated(
      itemCount: state.items.length + (state.isLoadingMore ? 1 : 0),
      separatorBuilder: (_, __) => SizedBox(height: context.spacing.sm),
      itemBuilder: (context, index) => index >= state.items.length
          ? const LoadingRow()
          : _buildRow(state.items[index]),
    );
  }

  Widget _buildRow(Item item) => ItemCard(
        item: item,
        onTap: () => context.push('${CatalogRoutes.items}/${item.id}'),
      );

  // 6. Handlers.
  void _onScroll() {
    if (_nearEnd) ref.read(itemsViewModelProvider.notifier).onNearEnd();
  }
}
```

## A detail page

Three states, no controllers, so `ConsumerWidget`.

```dart
class ItemDetailPage extends ConsumerWidget {
  const ItemDetailPage({required this.itemId, super.key});
  final String itemId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(itemDetailViewModelProvider(itemId));

    return Scaffold(
      appBar: AppBar(title: Text(state.item?.title ?? t.items.detailTitle)),
      body: switch (state) {
        ItemDetailState(isLoading: true) => const Center(child: CircularProgressIndicator()),
        ItemDetailState(item: null) => EmptyView(message: t.items.notFound),
        ItemDetailState(item: final item?) => _Content(item: item),
      },
    );
  }
}

class _Content extends StatelessWidget {
  const _Content({required this.item});
  final Item item;

  @override
  Widget build(BuildContext context) => ListView(
        padding: EdgeInsets.all(context.spacing.md),
        children: [
          Text(item.title, style: context.textStyles.titleLarge),
          SizedBox(height: context.spacing.sm),
          Text(item.price.asCurrency, style: context.textStyles.bodyMedium),
        ],
      );
}
```

## Its widget test

Each terminal state is reachable by overriding one provider.

```dart
Widget harness(List<Override> overrides) => ProviderScope(
      overrides: overrides,
      child: const MaterialApp(home: ItemsPage()),
    );

testWidgets('an empty result shows the empty view, not the error view', (tester) async {
  await tester.pumpWidget(harness([
    catalogRepositoryProvider.overrideWithValue(EmptyCatalogRepository()),
  ]));
  await tester.pumpAndSettle();

  expect(find.byType(EmptyView), findsOneWidget);
  expect(find.byType(ErrorView), findsNothing);
});

testWidgets('a failed first load shows the error view with a retry', (tester) async {
  await tester.pumpWidget(harness([
    catalogRepositoryProvider.overrideWithValue(FailingCatalogRepository()),
  ]));
  await tester.pumpAndSettle();

  expect(find.byType(ErrorView), findsOneWidget);
  expect(find.byType(EmptyView), findsNothing);
});
```
