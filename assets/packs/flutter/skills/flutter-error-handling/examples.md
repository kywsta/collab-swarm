# Error handling — worked snippets

## The taxonomy

`core/error/failure.dart`. Sealed, so the policy's `switch` is exhaustive and a new subtype fails the build until it is answered.

```dart
sealed class Failure extends Equatable {
  const Failure({this.cause, this.stackTrace});
  final Object? cause;
  final StackTrace? stackTrace;

  @override
  List<Object?> get props => [runtimeType, cause];
}

class NetworkFailure extends Failure {
  const NetworkFailure({super.cause, super.stackTrace});
}

class UnauthorizedFailure extends Failure {
  const UnauthorizedFailure({super.cause, super.stackTrace});
}

class ServerFailure extends Failure {
  const ServerFailure({required this.status, this.message, super.cause, super.stackTrace});
  final int status;
  final String? message;

  @override
  List<Object?> get props => [runtimeType, status, message];
}

class CancelledFailure extends Failure {
  const CancelledFailure();
}

/// Anything unmapped: a bug, not a condition. Always reported.
class TechnicalFailure extends Failure {
  const TechnicalFailure({super.cause, super.stackTrace});
}
```

No `String message` for the user anywhere in here. `ServerFailure.message` is the server's diagnostic, for the log — not something to render.

## Capture

`core/error/capture.dart`. One function, so a new exception type is mapped in one place.

```dart
Failure capture(Object error, StackTrace stackTrace) {
  final failure = switch (error) {
    DioException(type: DioExceptionType.cancel) => const CancelledFailure(),
    DioException(type: DioExceptionType.connectionError) ||
    DioException(type: DioExceptionType.connectionTimeout) =>
      NetworkFailure(cause: error, stackTrace: stackTrace),
    DioException(response: final Response<dynamic> response?) when response.statusCode == 401 =>
      UnauthorizedFailure(cause: error, stackTrace: stackTrace),
    DioException(response: final Response<dynamic> response?) => ServerFailure(
        status: response.statusCode ?? 0,
        message: response.statusMessage,
        cause: error,
        stackTrace: stackTrace,
      ),
    _ => TechnicalFailure(cause: error, stackTrace: stackTrace),
  };

  // A technical failure is a bug: report it. A classified one is a condition.
  if (failure is TechnicalFailure) {
    reporter.recordError(error, stackTrace);
  }
  return failure;
}
```

## The guard

`core/error/guard.dart`. The only place an exception becomes a value.

```dart
Future<Either<Failure, T>> guard<T>(Future<T> Function() body) async {
  try {
    return Right(await body());
  } catch (error, stackTrace) {
    return Left(capture(error, stackTrace));
  }
}
```

## The policy

`core/error/failure_response_policy.dart`. Pure, so it is table-tested.

```dart
enum FailureResponseKind { ignore, snackbar, dialog, revokeSession, halt }

class FailureResponse {
  const FailureResponse(this.kind, {this.allowsLocalHandling = true});
  final FailureResponseKind kind;

  /// False for the kinds a feature may never answer on its own.
  final bool allowsLocalHandling;
}

FailureResponse decide(Failure failure) => switch (failure) {
      CancelledFailure() => const FailureResponse(FailureResponseKind.ignore, allowsLocalHandling: false),
      UnauthorizedFailure() =>
        const FailureResponse(FailureResponseKind.revokeSession, allowsLocalHandling: false),
      NetworkFailure() => const FailureResponse(FailureResponseKind.snackbar),
      ServerFailure() => const FailureResponse(FailureResponseKind.dialog),
      TechnicalFailure() => const FailureResponse(FailureResponseKind.dialog),
    };
```

```dart
test('a cancelled request is never shown to the user', () {
  final response = decide(const CancelledFailure());
  expect(response.kind, FailureResponseKind.ignore);
  expect(response.allowsLocalHandling, isFalse);
});
```

## The handler, and a local override

`localHandler` returns `true` only once the feature has produced its **complete** answer. Returning `true` and doing nothing swallows the failure.

```dart
class FailureResponseHandler {
  const FailureResponseHandler(this._presentation);
  final FailurePresentation _presentation;

  Future<void> handle(
    BuildContext context,
    Failure failure, {
    bool Function(Failure failure)? localHandler,
  }) async {
    final response = decide(failure);
    if (response.allowsLocalHandling && (localHandler?.call(failure) ?? false)) return;

    switch (response.kind) {
      case FailureResponseKind.ignore:
        return;
      case FailureResponseKind.snackbar:
        _showSnackBar(context, _presentation.message(failure));
      case FailureResponseKind.dialog:
        await _showDialog(context, _presentation.message(failure));
      case FailureResponseKind.revokeSession:
        await _showDialog(context, _presentation.sessionExpired);
        await _account.revoke();
      case FailureResponseKind.halt:
        await _showBlockingDialog(context, _presentation.message(failure));
    }
  }
}
```

The copy lives apart from the taxonomy:

```dart
class FailurePresentation {
  String message(Failure failure) => switch (failure) {
        NetworkFailure() => t.errors.offline,
        UnauthorizedFailure() => t.errors.sessionExpired,
        ServerFailure() => t.errors.serverBusy,
        _ => t.errors.unexpected,
      };
}
```

## In the page

Initial failure inline, later failure through the handler, then cleared.

```dart
@override
Widget build(BuildContext context, WidgetRef ref) {
  ref.listen(itemsViewModelProvider.select((state) => state.loadMoreFailure), (previous, next) {
    if (next == null || next == previous) return;
    handler.handle(context, next);
    ref.read(itemsViewModelProvider.notifier).clearFailure();
  });

  final state = ref.watch(itemsViewModelProvider);
  if (state.initialFailure != null) {
    return ErrorView(
      message: presentation.message(state.initialFailure!),
      onRetry: ref.read(itemsViewModelProvider.notifier).refresh,
    );
  }
  return _buildList(state);
}
```
