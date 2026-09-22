# State management — worked listings

## A paginated page ViewModel

`features/catalog/presentation/view_models/items_view_model.dart`

```dart
@freezed
abstract class ItemsState with _$ItemsState {
  const factory ItemsState({
    @Default([]) List<Item> items,
    @Default(false) bool isLoading,
    @Default(1) int page,
    @Default(true) bool hasMore,
    @Default('') String query,
    Failure? failure,
  }) = _ItemsState;

  const ItemsState._();

  bool get isInitialLoading => isLoading && items.isEmpty;
  bool get isLoadingMore => isLoading && items.isNotEmpty;
  bool get isEmpty => items.isEmpty && failure == null && !isLoading;
  Failure? get initialFailure => items.isEmpty && failure != null ? failure : null;
  Failure? get loadMoreFailure => items.isNotEmpty && failure != null ? failure : null;
}

@riverpod
class ItemsViewModel extends _$ItemsViewModel {
  Timer? _debounce;
  int _epoch = 0;

  @override
  ItemsState build() {
    ref.onDispose(() => _debounce?.cancel());
    Future.microtask(refresh);
    return const ItemsState();
  }

  Future<void> refresh() => _load(page: 1, replace: true);

  Future<void> onNearEnd() async {
    if (state.isLoading || !state.hasMore) return;
    await _load(page: state.page + 1, replace: false);
  }

  /// The page sends the raw text. Trimming and debounce belong here.
  void onQueryChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      state = state.copyWith(query: value.trim());
      refresh();
    });
  }

  void clearFailure() => state = state.copyWith(failure: null);

  Future<void> _load({required int page, required bool replace}) async {
    final epoch = ++_epoch;
    state = state.copyWith(isLoading: true, failure: null);

    final result = await ref
        .read(catalogRepositoryProvider)
        .items(page: page, query: state.query.isEmpty ? null : state.query);

    // A slower earlier request must not overwrite a newer one.
    if (epoch != _epoch) return;

    state = result.fold(
      (failure) => state.copyWith(isLoading: false, failure: failure),
      (items) => state.copyWith(
        isLoading: false,
        items: replace ? items : [...state.items, ...items],
        page: page,
        hasMore: items.isNotEmpty,
      ),
    );
  }
}
```

Its test needs no widget:

```dart
test('a slow first page does not overwrite a fast second search', () async {
  final container = ProviderContainer(overrides: [
    catalogRepositoryProvider.overrideWithValue(SlowThenFastRepository()),
  ]);
  final notifier = container.read(itemsViewModelProvider.notifier);

  final slow = notifier.refresh();
  notifier.onQueryChanged('second');
  await slow;

  expect(container.read(itemsViewModelProvider).query, 'second');
});

test('an empty result is empty, and a failed load is not', () {
  const loaded = ItemsState(items: []);
  const failed = ItemsState(items: [], failure: NetworkFailure());
  expect(loaded.isEmpty, isTrue);
  expect(failed.isEmpty, isFalse);
  expect(failed.initialFailure, isNotNull);
});
```

## An account lifecycle module

`core/session/account_module.dart`

```dart
class AccountModule {
  AccountModule({required AccountRepository repository}) : _repository = repository;

  final AccountRepository _repository;
  final _controller = StreamController<Account>.broadcast();
  Account _state = const Account.guest();
  int _epoch = 0;

  Account get state => _state;

  /// Replays the current value to each new listener: a page mounted after
  /// sign-in must not wait for the next transition to learn who is signed in.
  Stream<Account> get states => Stream.multi((listener) {
        listener.add(_state);
        final subscription = _controller.stream.listen(listener.add);
        listener.onCancel = subscription.cancel;
      });

  Future<void> restore() => _transition(() => _repository.restore());
  Future<void> signIn(Credentials credentials) => _transition(() => _repository.signIn(credentials));
  Future<void> revoke() => _transition(() async => const Right(Account.guest()));

  Future<void> _transition(Future<Either<Failure, Account>> Function() step) async {
    final epoch = ++_epoch;
    final result = await step();
    if (epoch != _epoch) return; // A newer transition already won.
    result.fold((_) {}, _emit);
  }

  void _emit(Account account) {
    _state = account;
    _controller.add(account);
  }

  void dispose() => _controller.close();
}
```

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

Reading it, with the snapshot as the pre-first-emission fallback:

```dart
final account = ref.watch(accountStatesProvider).asData?.value ?? ref.read(accountProvider).state;
```

## A form as a union

Exclusive states, so "submitting with a validation error showing" cannot be built.

```dart
@freezed
sealed class SignInState with _$SignInState {
  const factory SignInState.editing({@Default('') String number, String? numberError}) = SignInEditing;
  const factory SignInState.submitting() = SignInSubmitting;
  const factory SignInState.failed(Failure failure) = SignInFailed;
  const factory SignInState.succeeded() = SignInSucceeded;
}
```
