import { createApi } from '@workoffdesk/client/base/api';
import { createReleaseWatch } from '@workoffdesk/client/base/release';

export * from '@workoffdesk/client/base/api';

// The server's release: when it moves on, there may be a newer build of this page (see freshness.ts).
export const release = createReleaseWatch();

// The page talks to the server it was loaded from, signed in by its cookie.
export const { api, wsUrl } = createApi({
  base: () => location.origin,
  onVersion: release.saw,
  onUnauthorized: () => {
    if (location.pathname !== '/login') location.assign(`/login?next=${encodeURIComponent(location.pathname)}`);
  },
});
