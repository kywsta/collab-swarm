---
name: flutter-push-notifications
description: Push delivery — the source and display adapters, token and permission handling, and routing a notification tap to the right screen. Triggers on push setup, a device token, a notification permission prompt, a topic, a background message, or a tap that has to open a specific page.
---

# Push Notifications

One **delivery** module owns push. An in-app message inbox — a list the user opens and reads — is an ordinary REST feature and has nothing to do with this skill.

```text
NotificationSource  ─┐
                     ├→ NotificationDelivery → normalise route → open route
NotificationDisplay ─┘                      └→ local display
```

Adapters parse transport. Delivery decides what happens. That split is what lets the whole thing be tested without a device: delivery takes fakes for both ports.

## 1. The seams

- **`NotificationSource`** — `{{notifications.source}}`, over `{{notifications.sdk}}`: incoming messages, the device token and its changes, topics, and the permission request.
- **`NotificationDisplay`** — showing a message as a system notification while the app is in the foreground, and reporting the payload when the user taps one.
- **`NotificationDelivery`** — maps a payload to a domain notification, normalises its route in **one** function, and decides display against navigation.

Delivery is a keepAlive `Future<NotificationDelivery>`. It receives a narrow `openRoute` callback — the router's own gated entry point — so it never holds a `BuildContext` and never decides whether the user may see the destination.

Done when delivery depends only on its two ports and one callback, and could be constructed in a unit test.

## 2. Initialise in the right order

Resolve the adapter policy and validate configuration first. Then:

1. Initialise the SDK<!-- swarm:if notifications=firebase --> — Firebase's app initialisation runs **before** the provider container<!-- swarm:endif -->.
2. Build the container and await the delivery provider.
3. `runApp`.
4. Request permission, unawaited, so a user who dismisses the prompt does not block the first frame.

Register the background message handler inside the source's own `initialize()`, not in `main()`: it is a transport concern, and `main()` should not know the SDK exists.

An explicitly selected `mock` flavor uses service-independent ports and initialises no SDK. An unconfigured live flavor shows its configuration-required state rather than starting delivery with an empty key.

Done when the order above holds and no SDK is initialised in a flavor that has no configuration for it.

## 3. The message matrix

| Event | What happens |
| --- | --- |
| Arrives in the foreground | map → local display |
| Tapped, opened, or launched the app from terminated | map → normalise route → open route |
| Route missing or malformed | ignore, and log it |
| Unknown message type | fall back to a default type rather than dropping it |

One normalisation function, called from every row that routes. Two would disagree on the first URL with a trailing slash.

## 4. The background isolate

The background handler runs in its own isolate: no provider container, no session, no router, no UI. It may initialise the SDK and do transport work, and nothing else. Anything it appears to need from the app is a sign the work belongs in the foreground handler.

## 5. Token and topics

The token, its change stream, and topic subscription all go through delivery, so a feature that needs to register a token depends on delivery rather than the SDK. Re-read the token after permission is granted — on iOS it does not exist before then.

## Checklist

- [ ] One delivery module; adapters receive ports, not the SDK
- [ ] Delivery holds no `BuildContext` and makes no gating decision
- [ ] Background handler registered inside the source's `initialize()`
- [ ] Background isolate touches no provider, session, router or UI
- [ ] One route-normalisation function, used by every routing path
- [ ] Permission requested after `runApp`, unawaited
- [ ] `mock` and tests inject deterministic source and display adapters
- [ ] A tap on a gated destination goes through the router's gated entry point
