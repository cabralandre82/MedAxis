# Testing Strategy

| Field           | Value                                                |
| --------------- | ---------------------------------------------------- |
| Owner           | Engineering                                          |
| Last reviewed   | 2026-04-18                                           |
| Source-of-truth | this doc, `vitest.config.ts`, `playwright.config.ts` |

## 1. Test pyramid

```
                ┌────────────┐
                │  E2E (10)  │   ← user-flow contracts
                └────────────┘
              ┌──────────────────┐
              │  Integration (~30)│  ← real DB, real Redis (Vitest)
              └──────────────────┘
        ┌────────────────────────────┐
        │      Unit (~119)           │  ← pure logic, mocked I/O
        └────────────────────────────┘
   ┌────────────────────────────────────┐
   │  Static (lint, types, deps)        │  ← every PR, < 30 s
   └────────────────────────────────────┘
   ┌────────────────────────────────────┐
   │  Load (k6, 7 scripts)              │  ← scheduled, on-demand
   └────────────────────────────────────┘
```

Roughly 80 % of test code is unit; 15 % integration; 5 % E2E. Load &
synthetic checks are run separately (not on every PR).

## 2. What lives where

### Unit (`tests/unit/**/*.test.ts`)

Vitest with jsdom. Fast (< 30 s for the whole suite). Mocks Supabase,
Redis, Sentry, fetch. Anything with non-trivial branching logic lives
here. Coverage thresholds (vitest.config.ts):

| Metric     | Floor | Real (Wave Hardening III) |
| ---------- | ----- | ------------------------- |
| statements | 80 %  | 81.6 %                    |
| branches   | 80 %  | 81.2 %                    |
| functions  | 90 %  | 90.7 %                    |
| lines      | 80 %  | 81.6 %                    |

Ratchet rule: after every wave that adds ≥ 20 tests we **lift** these
floors toward the new measurement. We never lower them — if a PR drops
coverage, add the missing test instead of relaxing the floor.

### Integration (`tests/unit/**/*.test.ts` with `*-integration` suffix)

Same harness as unit but with the `INTEGRATION=1` env var which routes
to a real Postgres/Redis. Used for: RLS policy assertions, RPC
return-shape validation, race conditions in cron locks.

### E2E (`tests/e2e/*.test.ts`)

Playwright. Targets either a Vercel preview (`BASE_URL`) or the local
dev server. Two browser projects: `chromium` (full coverage) and
`mobile-chrome` (Pixel 5 viewport, runs the smoke test only — keeps
CI cost bounded).

Numbered files run in narrative order:

| File                               | Scope                                         |
| ---------------------------------- | --------------------------------------------- |
| `01-auth.test.ts`                  | login, logout, password-reset link, redirects |
| `02-admin-clinic-approval.test.ts` | super-admin approves a clinic registration    |
| `03-order-lifecycle.test.ts`       | clinic creates order → pharmacy fulfils       |
| `04-profile-privacy.test.ts`       | LGPD portal: export + deletion buttons        |
| `05-forgot-password.test.ts`       | non-enumerating recovery flow                 |
| `06-registration.test.ts`          | clinic vs doctor profile choice + validation  |
| `07-support-ticket.test.ts`        | open ticket, see thread                       |
| `08-prescription-review.test.ts`   | reach order detail without crashing           |
| `smoke.test.ts`                    | front-page renders, login still works         |
| `smoke-health.test.ts`             | `/api/health/*` return expected codes         |
| `smoke-security-attack.test.ts`    | basic XSS / SQL-injection / CSRF probes       |
| `smoke-a11y.test.ts`               | axe-core WCAG 2.1 AA on 6 public pages        |

Smoke tests are designed to run against PRODUCTION as a deploy gate
(no destructive actions). The numbered tests assume staging Supabase.

### Load (`tests/load/*.js`)

k6 scripts, run on demand or before a release:

- `smoke.js` — sanity, 1 VU for 30 s.
- `health.js` — `/api/health/*` under burst.
- `login.js` — credential stuffing rate-limit verification.
- `list-orders.js` — paginated orders endpoint.
- `export-csv.js` — CSV export bandwidth profile.
- `realistic-workload.js` — mixed-shape steady state (60 VUs, 5 min).
- `_helpers.js` — shared (auth token, fixtures, HTTP wrapper).

Thresholds and pass/fail criteria are inline in each script. Results
land in `tests/load/results/` (gitignored).

### Static

- `npm run lint` — ESLint with `next/core-web-vitals` + `next/typescript`
  - `plugin:jsx-a11y/recommended`.
- `npm run format:check` — Prettier.
- `npx tsc --noEmit` — type-check; runs in CI alongside lint.
- Security: CodeQL, Gitleaks, Trivy, npm audit, license check, SBOM
  (`.github/workflows/security-scan.yml`).
- Local: gitleaks pre-commit hook (auto-skipped if not installed).

## 3. CI orchestration

`.github/workflows/ci.yml` defines four jobs:

| Job         | Runtime | Blocking? | Inputs                  |
| ----------- | ------- | --------- | ----------------------- |
| `lint`      | Node 20 | Yes       | source                  |
| `unit`      | Node 20 | Yes       | source + coverage gates |
| `e2e-smoke` | Node 20 | Yes       | needs lint + unit       |
| Sec scans   | Node 20 | No (yet)  | source                  |

`STRICT_A11Y=1` is set on the e2e-smoke job — any new critical/serious
WCAG violation drops the build immediately.

## 4. Anti-patterns (do NOT do these)

- **Snapshot-tests for HTML.** Use semantic queries (`getByRole`,
  `getByLabel`) instead. Snapshots regress on every Tailwind reorder.
- **Sleeps for synchronisation.** Use `waitForLoadState`, `expect.poll`
  or explicit `await page.waitForResponse`. Sleeps make CI flaky.
- **Cross-test state.** Each E2E test re-derives its starting state.
  Where a multi-step flow is necessary, it lives in a single test.
- **`.only` or `.skip` checked into main.** CI rejects via
  `forbidOnly: true` in playwright.config.

## 5. Promotion path

Items intentionally out of scope for now, with the trigger to revisit:

- **Mutation testing (Stryker).** Trigger: coverage above 90 % becomes
  the new floor; mutation score then becomes the next quality lever.
- **Visual regression (Playwright + Percy/Chromatic).** Trigger: a
  visual incident slips through three sprints in a row.
- **Contract tests against external APIs (Pactflow).** Trigger: we
  introduce a second consumer of the Asaas webhook, or a third-party
  consumer of our public API.

## 6. Change log

| Date       | Change                                                          |
| ---------- | --------------------------------------------------------------- |
| 2026-04-18 | Initial publication. Pyramid, ratchet plan, four new E2E flows. |
