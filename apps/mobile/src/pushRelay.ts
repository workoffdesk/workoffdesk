// What the iPhone app tells a Mac about itself for notifications (notifications.ts). A published build adds
// the relay its notifications come through and the key the Mac seals them with, which only this phone and
// that Mac hold (docs/design/2026-10-16-app-store-build.md).

export type Relay = { url: string; key: string };

export const deviceOf = (token: string, topic: string, words: object, relay?: Relay) => ({ token, topic, words, ...(relay ? { relay } : {}) });

// Asks whether the Mac can reach this app: with its own key, or through the relay.
export const readyPath = (relay: string | undefined) => (relay ? '/api/push/apns?relay=1' : '/api/push/apns');

export const keyText = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
