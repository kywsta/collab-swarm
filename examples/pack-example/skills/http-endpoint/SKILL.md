---
name: http-endpoint
description: Add or change an HTTP endpoint — route, request and response types, validation, error mapping, and its contract test. Triggers on an endpoint, handler, payload schema, or status-code decision.
---

# HTTP Endpoint

Deliver one endpoint as a vertical slice: the route, the types either side of it, the validation, the failure mapping, and the test that pins the contract.

## 1. Fix the contract

Read the operation in the project's API source before writing anything: path, method, request shape, response shape, and every documented error. When the operation exists in no contract, the ticket says so and names the shape being built against.

Done when the request and response shapes and the full status-code list are written down.

## 2. Write the contract test first

The failing test asserts the response for one documented case, through the same entry point a client uses. Assert the status code and the body's shape, never the handler's internals.

Done when one test fails for the right reason.

## 3. Implement the slice

Validate at the edge and reject with the documented status before any work begins. Map a domain failure onto its documented status exactly once, in one place, so two endpoints cannot disagree about what a missing record means. Return the response type the contract names, not the storage type.

Done when the failing test passes and no other test changed.

## 4. Cover the failures

Add one test per documented error the endpoint can actually produce. An undocumented status reaching a client is a contract break, not an implementation detail.

Done when every status the contract lists is either tested or explained as unreachable.
