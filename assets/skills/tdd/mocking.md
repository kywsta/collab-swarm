# When to Mock

Mock at **system boundaries** only:

- external services the project does not own (HTTP APIs, payment providers, push services);
- platform stores (secure storage, preferences, databases) when a real instance is impractical;
- time and randomness;
- the file system, sometimes.

Don't mock:

- your own classes and modules;
- internal collaborators (repositories, view models, mappers, handlers);
- anything you control.

Prefer a **hand-written fake** that implements the boundary interface over a mocking library. A fake is a real implementation with a simple in-memory body: it type-checks, it fails loudly when the interface changes, and it reads as an example of how the boundary behaves. Reach for a mocking library only when the interface is large and the project already depends on one.

Install fakes the same way production code installs the real thing — through whatever dependency injection the project uses — so the test exercises the same wiring as production.

## Designing for mockability

At system boundaries, design interfaces that are easy to fake.

**1. Inject external dependencies**

Pass them in rather than constructing them internally:

```text
// Easy to fake
class PaymentRepository(client: PaymentClient):
    pay(order) -> client.charge(order.total)

// Hard to fake
class PaymentRepository:
    pay(order) -> StripeClient(config.stripeKey).charge(order.total)
```

**2. Prefer SDK-style interfaces over generic fetchers**

One method per external operation, instead of one generic method with conditional logic:

```text
// GOOD: each method is independently fakeable
interface UserApi:
    getUser(id) -> User
    getOrders(userId) -> Order[]
    createOrder(request) -> Order

// BAD: faking requires conditional logic inside the fake
interface UserApi:
    call(endpoint, body?) -> Response
```

The SDK shape means each fake returns one specific value, no conditional logic in test setup, an obvious list of which operations a test exercises, and type safety per operation.

**3. Make the fake deterministic**

A fake that returns a fixed value is a fixture. A fake that also records what it was asked is a temptation to assert on calls — which is an implementation-detail test. Record only when the call itself is the behaviour under test, such as "an idempotent retry sends exactly one charge".
