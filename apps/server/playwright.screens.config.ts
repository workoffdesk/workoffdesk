import { homedir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import base, { testServer } from './playwright.config';

// The screenshots in docs/screens, one set per language, from the same test server as the end-to-end tests.
export const SCREENS_PORT = 7691;
export const SCREENS_HOME = join(homedir(), `.workoffdesk-screens-${SCREENS_PORT}`);

// The whole screen of an iPhone 16 Pro Max (440x956 points), so the screenshots have a phone's proportions.
const phone = { ...devices['iPhone 13'], viewport: { width: 440, height: 956 }, screen: { width: 440, height: 956 }, colorScheme: 'dark' as const };

export default defineConfig({
  ...base,
  testMatch: 'screens.spec.ts',
  testIgnore: [],
  use: { ...base.use, baseURL: `http://localhost:${SCREENS_PORT}`, trace: 'off' },
  projects: [
    { name: 'en', use: { ...phone, locale: 'en-US' } },
    { name: 'zh-CN', use: { ...phone, locale: 'zh-CN' } },
  ],
  webServer: testServer(SCREENS_PORT, SCREENS_HOME),
});
