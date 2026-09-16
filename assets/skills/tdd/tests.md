# Good and Bad Tests

Examples are written in neutral pseudocode. Translate them into whatever the project already uses: the rules do not change with the language, the framework, or the test level.

## Good tests

**Integration-style**: test through real interfaces, not mocks of internal parts.

```text
// GOOD: tests observable behaviour
test("user can checkout with a valid cart"):
    cart = Cart().add(product)
    result = checkout(cart, paymentMethod)
    expect(result.status).toBe(CONFIRMED)
```

Characteristics:

- tests behaviour users or callers care about;
- uses the public interface only;
- survives internal refactors;
- describes WHAT, not HOW;
- one logical assertion per test.

## Bad tests

**Implementation-detail tests**: coupled to internal structure.

```text
// BAD: tests implementation details
test("checkout calls paymentService.process"):
    payment = RecordingPaymentService()
    checkout(cart, payment)
    expect(payment.processCalls).toEqual([cart.total])
```

Red flags:

- mocking internal collaborators;
- testing private methods;
- asserting on call counts or call order;
- the test breaks when you refactor without changing behaviour;
- the test name describes HOW, not WHAT;
- verifying through a side channel instead of through the interface.

```text
// BAD: bypasses the interface to verify
test("createUser saves to storage"):
    repository.createUser(name: "Alice")
    raw = storage.read("users")
    expect(raw).toContain("Alice")

// GOOD: verifies through the interface
test("createUser makes the user retrievable"):
    user = repository.createUser(name: "Alice")
    retrieved = repository.getUser(user.id)
    expect(retrieved.name).toBe("Alice")
```

**Tautological tests**: the expected value restates the implementation, so the test passes by construction and can never disagree with the code.

```text
// BAD: the expected value is recomputed the way the code computes it
test("calculateTotal sums line items"):
    items = [LineItem(price: 10), LineItem(price: 5)]
    expected = items.reduce((sum, item) => sum + item.price, 0)
    expect(calculateTotal(items)).toBe(expected)

// GOOD: the expected value is an independent, known literal
test("calculateTotal sums line items"):
    expect(calculateTotal([LineItem(price: 10), LineItem(price: 5)])).toBe(15)
```

## Choosing the level

Pick the cheapest level that can still observe the behaviour the specification names:

- **unit** when the behaviour lives inside one module and its inputs are values;
- **integration** when the behaviour *is* the collaboration: a request mapped to a stored record, a state machine driven by events;
- **end-to-end** only for the few paths where the wiring itself is the risk. They are the slowest and the flakiest, and a suite that leans on them stops being run.

Name the level in the specification's test plan so the ticket does not have to guess.

## Testing a stateful component

When a component exposes state rather than returning values — a view model, a store, a reducer, a long-lived service — build it with fakes at its boundaries, drive it through its public entry points, and assert on the state it exposes. Never reach into its internals: the exposed state is the contract, and the internals are what you want to stay free to change.

## Match the project's conventions

Before writing the first test, read two or three existing tests near the code you are changing, and match their naming, setup helpers, and assertion style. A test that is correct but foreign is still a cost: the next reader has to learn two dialects.
