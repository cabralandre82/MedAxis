import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    exclude: ['tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['lib/**/*.ts', 'services/**/*.ts'],
      exclude: [
        'lib/db/**',
        'lib/firebase/client.ts',
        'lib/firebase-admin.ts',
        'lib/push.ts',
        'lib/sms.ts',
        'lib/whatsapp.ts',
        'lib/asaas.ts',
        'lib/clicksign.ts',
        'lib/email/index.ts',
        'lib/email/templates.ts',
        'lib/session-logger.ts',
        // Inngest jobs require integration testing against Inngest Dev Server
        'lib/jobs/**',
        // Inngest client setup — no testable logic
        'lib/inngest.ts',
        // Uses Next.js unstable_cache — requires real Next.js runtime
        'lib/dashboard.ts',
        '**/*.d.ts',
      ],
      thresholds: {
        // Unit-test ceiling: complex service success paths (multi-step DB chains)
        // require integration tests against a real Supabase test project.
        // lib/jobs excluded (Inngest integration tests) — reduces denominator.
        statements: 75,
        branches: 60,
        functions: 80,
        lines: 75,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
      // Stub optional packages that are not installed in the test environment.
      // These are only needed at runtime (Redis-backed rate limiter).
      '@upstash/ratelimit': resolve(__dirname, 'tests/__mocks__/@upstash/ratelimit.ts'),
      '@upstash/redis': resolve(__dirname, 'tests/__mocks__/@upstash/redis.ts'),
    },
  },
})
