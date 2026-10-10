import { homedir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

export const E2E_PORT = 7690;
// Outside the temporary folders, whose Claude conversations the server leaves off its recent list as
// throwaway runs; short enough for the sockets inside it.
export const E2E_HOME = join(homedir(), `.workoffdesk-e2e-${E2E_PORT}`);

// The test server (tests/e2e/server.ts), built first, on its own port and throwaway home.
export const testServer = (port: number, home: string) => ({
  command: `pnpm run build && npx tsx tests/e2e/server.ts`,
  url: `http://localhost:${port}/login`,
  reuseExistingServer: false,
  timeout: 120_000,
  // Without it the server is killed outright and its tmux server outlives the run.
  gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 5_000 },
  env: { E2E_PORT: String(port), E2E_HOME: home },
});

export default defineConfig({
  testDir: 'tests/e2e',
  // Made by playwright.screens.config.ts.
  testIgnore: 'screens.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    // WebAuthn and clipboard need a secure context, and http://localhost is one.
    baseURL: `http://localhost:${E2E_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    // What it is used on: Safari on an iPhone, set to Chinese as its owner's is; the specs find things by their Chinese names.
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'], colorScheme: 'dark', locale: 'zh-CN' } },
  ],
  webServer: testServer(E2E_PORT, E2E_HOME),
});
