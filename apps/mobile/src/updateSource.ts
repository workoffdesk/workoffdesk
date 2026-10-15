// Where the app's JS updates come from (appUpdate.ts): the server a published build names (fixed), or else
// the server it is signed in to.

// Only where the transport keeps others from swapping the JS: https, or this phone's own loopback.
const SAFE_SERVER = /^(?:https:\/\/|http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$))/i;

export const updateUrlOf = (login: { server: string } | null, fixed?: string): string | null =>
  fixed ?? (login && SAFE_SERVER.test(login.server) ? `${login.server.replace(/\/+$/, '')}/api/app-update/manifest` : null);
