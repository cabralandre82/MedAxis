import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E Configuration for Clinipharma.
 *
 * Run against staging:
 *   BASE_URL=https://staging.clinipharma.com.br npx playwright test
 *
 * Run against local dev server:
 *   npx playwright test  (starts Next.js dev server automatically)
 *
 * Run with UI mode:
 *   npx playwright test --ui
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const IS_CI = !!process.env.CI

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // E2E tests share state — run sequentially
  forbidOnly: IS_CI,
  retries: IS_CI ? 2 : 0,
  workers: IS_CI ? 1 : 1,
  reporter: IS_CI ? 'github' : 'list',

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    // Setup: authenticate and save session state
    {
      name: 'setup',
      testMatch: '**/auth.setup.ts',
    },
    // E2E flows (depend on auth setup)
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/e2e/.auth/super-admin.json',
      },
      dependencies: ['setup'],
    },
    // Mobile viewport — smoke test main flows
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 5'],
        storageState: 'tests/e2e/.auth/super-admin.json',
      },
      dependencies: ['setup'],
      testMatch: '**/smoke.test.ts',
    },
  ],

  // Start local Next.js dev server when not targeting external BASE_URL.
  // Wave 5 — in CI we inject the staging Supabase creds so the dev
  // server can boot. Playwright only forwards the env vars listed
  // here; anything that lives in `process.env` of the runner is NOT
  // automatically visible to the child process.
  webServer:
    BASE_URL === 'http://localhost:3000'
      ? {
          command: 'npm run dev',
          url: 'http://localhost:3000',
          reuseExistingServer: !IS_CI,
          timeout: 180_000,
          env: {
            NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
            NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
            SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
            ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? '',
            NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
            NODE_ENV: 'development',
          },
        }
      : undefined,
})
