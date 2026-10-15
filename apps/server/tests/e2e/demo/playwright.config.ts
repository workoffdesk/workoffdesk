import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { testServer } from '../../../playwright.config';

// The recording of the iPhone app the demo GIF is cut from (make.sh runs it): record.ts drives the app in the
// Simulator against this test server.
export const DEMO_PORT = 7692;
export const DEMO_HOME = join(homedir(), `.workoffdesk-demo-${DEMO_PORT}`);

export default defineConfig({
  testDir: '.',
  testMatch: 'record.ts',
  workers: 1,
  timeout: 600_000,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${DEMO_PORT}`, trace: 'off' },
  projects: [
    { name: 'en' },
    { name: 'zh-CN' },
  ],
  webServer: { ...testServer(DEMO_PORT, DEMO_HOME), cwd: fileURLToPath(new URL('../../..', import.meta.url)) },
});
