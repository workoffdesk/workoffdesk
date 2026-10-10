import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { testServer } from '../../../playwright.config';

// The phone recording the demo GIF is cut from (make.sh runs it). iPhone 16 Pro Max: 440x956 points, the app
// between the 54-point status bar and the 34-point home indicator, both drawn by compose.py.
export const DEMO_PORT = 7692;
export const DEMO_HOME = join(homedir(), `.workoffdesk-demo-${DEMO_PORT}`);

const proMax = { ...devices['iPhone 13'], viewport: { width: 440, height: 868 }, screen: { width: 440, height: 956 }, colorScheme: 'dark' as const };

export default defineConfig({
  testDir: '.',
  testMatch: 'record.ts',
  workers: 1,
  timeout: 180_000,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${DEMO_PORT}`, trace: 'off' },
  projects: [
    { name: 'en', use: { ...proMax, locale: 'en-US' } },
    { name: 'zh-CN', use: { ...proMax, locale: 'zh-CN' } },
  ],
  webServer: { ...testServer(DEMO_PORT, DEMO_HOME), cwd: fileURLToPath(new URL('../../..', import.meta.url)) },
});
