import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('scripts/build-app-update.mjs', () => {
  // A build without an app of its own to serve: an update stamped with the placeholder bundle id would carry
  // a push topic no one's phone can receive on.
  it('builds no iPhone update without a bundle id, and says why', () => {
    const script = new URL('../../../scripts/build-app-update.mjs', import.meta.url);
    const r = spawnSync(process.execPath, [fileURLToPath(script)], { env: { ...process.env, WORKOFFDESK_IOS_BUNDLE_ID: '' }, encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/no iPhone update.*WORKOFFDESK_IOS_BUNDLE_ID/s);
  });
});
