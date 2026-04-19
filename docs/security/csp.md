# Content Security Policy

> Wave Hardening II — task **#8**.
> Status: **enforced** in production since `2026-04-18`.
> Owners: Security WG. Runbook contact: `#security-oncall` (Slack).

---

## 1. Why a strict CSP

CSP is the last defence in depth against XSS. Until Wave Hardening II
our policy carried `'unsafe-inline'` on `script-src`, which is the
moral equivalent of disabling the directive entirely — any reflected
or stored injection that managed to render a `<script>` tag in our
HTML would execute. Browser telemetry showed 0 violations during 90
days, but that is itself a smell: an attacker who lands inline JS sees
no error in DevTools either.

The new policy:

- **bans inline scripts entirely** — the only way a `<script>` tag
  executes is if it carries the per-request nonce minted by
  `middleware.ts`. The nonce is 128 bits of CSPRNG entropy, fresh on
  every request (no caching, no reuse);
- **uses `'strict-dynamic'`** so a nonce'd loader script may
  recursively load further bundles without us having to predict and
  whitelist their hashes (Next.js's chunk loader and Sentry's lazy
  loader rely on this);
- **keeps `'unsafe-inline'` only on `style-src-attr`** — React's
  `style={{...}}` JSX prop renders an HTML `style="..."` attribute
  and CSP3 explicitly requires opt-in for those. We cannot hash them
  at build time because the values are dynamic. The `<style>` element
  whitelist (`style-src-elem`) does require the nonce;
- **reports** every violation to `/api/csp-report` (legacy
  `report-uri` + modern `Report-To` header — both formats parsed).

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ Edge middleware (`middleware.ts`)                                 │
│                                                                   │
│   1. mint nonce      = generateNonce()       ← lib/security/csp   │
│   2. set request hdr x-nonce: <nonce>                             │
│   3. set response hdr Content-Security-Policy:                    │
│           default-src 'self'; script-src 'self' 'nonce-XXX'       │
│           'strict-dynamic' https: http:; …; report-uri            │
│           /api/csp-report; report-to csp-endpoint                 │
│   4. set Report-To: {"group":"csp-endpoint","endpoints":[…]}      │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│ Next.js runtime                                                   │
│                                                                   │
│   • Auto-attaches the nonce to every framework-injected script    │
│     (RSC chunks, streaming hydration, devtool runtime) by reading │
│     the `x-nonce` request header.                                  │
│   • Server components can read it explicitly via                   │
│     `headers().get('x-nonce')` (see `app/layout.tsx`).             │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│ Browser                                                           │
│                                                                   │
│   • Rejects any `<script>` without `nonce="XXX"`.                 │
│   • Rejects any inline event handler (`onclick=""`) — script-src- │
│     attr is `'none'`.                                              │
│   • POSTs violation reports to `/api/csp-report` (legacy & API).  │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│ /api/csp-report (`app/api/csp-report/route.ts`)                   │
│                                                                   │
│   • Rate-limited 10/10s per IP (bucket `security.csp_report`).    │
│   • Body capped at 16 KiB.                                         │
│   • Parses both legacy `{"csp-report":{…}}` and modern             │
│     `[{type:"csp-violation",body:{…}}]` payloads.                  │
│   • Emits `csp_violation_total{directive,blocked_host,disposition}`│
│     and `csp_report_invalid_total{reason}`.                        │
│   • Persists each violation via `logger.warn('csp_violation',…)`,  │
│     which mirrors into `public.server_logs` (RP-09, 90-day TTL).   │
│   • Always returns 204.                                            │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. The full policy (verbatim)

The string is built deterministically by `buildCsp()` in
`lib/security/csp.ts`. With a sample nonce of `XXXXXXXXXXXXXXXXXXXXXX`
the production header is:

```
default-src 'self';
script-src 'self' 'nonce-XXXXXXXXXXXXXXXXXXXXXX' 'strict-dynamic' https: http:;
script-src-attr 'none';
style-src 'self' 'unsafe-inline';
style-src-elem 'self' 'nonce-XXXXXXXXXXXXXXXXXXXXXX' 'unsafe-inline';
style-src-attr 'unsafe-inline';
img-src 'self' data: blob: https://jomdntqlgrupvhrqoyai.supabase.co;
font-src 'self';
connect-src 'self' https://*.supabase.co wss://*.supabase.co
            https://o4510907598700544.ingest.us.sentry.io
            https://www.googleapis.com https://fcm.googleapis.com;
frame-src 'none';
frame-ancestors 'none';
object-src 'none';
base-uri 'self';
form-action 'self';
worker-src 'self' blob:;
manifest-src 'self';
upgrade-insecure-requests;
block-all-mixed-content;
report-uri /api/csp-report;
report-to csp-endpoint
```

Notes per directive:

- `https: http:` in `script-src` is a fallback for the very small
  set of pre-2018 browsers that do not support `'strict-dynamic'`.
  In supporting browsers `'strict-dynamic'` overrides them, so the
  fallback is dead code on Chrome ≥ 60, Firefox ≥ 59, Safari ≥ 15.4.
- `script-src-attr 'none'` is what blocks `onclick=""` and friends.
  We have **zero** intentional inline event handlers in the codebase
  (verified by `rg "on[a-z]+="` over `app/` and `components/`).
- `style-src-attr 'unsafe-inline'` — React's `style={{}}` cannot be
  hashed; the cost of moving every `style={}` into a Tailwind class
  outweighs the residual risk (an attacker who already has a CSS
  injection primitive can do far less harm than one with JS exec).
- `connect-src` matches `lib/firebase/client.ts`, Sentry browser
  ingest, and Supabase (REST + realtime). On-call may add a
  one-off origin via `extraConnectSrc` if necessary (see §6).

---

## 4. Operational toggles (env vars)

| Variable          | Default | Effect                                                                                                                                                   |
| ----------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CSP_REPORT_ONLY` | unset   | When `"true"` middleware emits `Content-Security-Policy-Report-Only` instead of the enforced header. Use during canary rollouts of new directives.       |
| `NODE_ENV`        | —       | When not `production` middleware sets `allowEval: true` so Next.js dev HMR + Webpack eval source maps work. Production explicitly does NOT allow `eval`. |

There is no env-driven origin whitelist — adding origins is a code
change so the diff is reviewed in Git.

---

## 5. Rollout & rollback

The change shipped behind `CSP_REPORT_ONLY=true` for one full day
(Apr 17 → Apr 18), with monitoring on `csp_violation_total`. Zero
non-trivial violations were reported during that window.

To roll back **without a code revert**:

1. Set `CSP_REPORT_ONLY=true` in Vercel env (production scope).
2. Trigger a redeploy (env var changes are not live-applied).
3. Browsers immediately switch to report-only — no XSS attempts
   blocked, but inventory of violations continues.

If a regression is severe enough that even report-only spam is
unacceptable, comment out lines 130-145 in `middleware.ts` (the
`stampHeaders` calls) — the static `next.config.ts` headers list
still ships HSTS, Permissions-Policy, and friends.

---

## 6. Adding a new origin

Two paths.

**(a) Permanent change — preferred.** Edit
`lib/security/csp.ts → buildCsp()` and update the `connectSrc` /
`scriptSrc` / etc. arrays. Add a sentence in this doc under §3 if
the origin is non-obvious. Run `npx vitest run tests/unit/lib/security-csp.test.ts`
to confirm the structural invariants still hold.

**(b) Hot-patch — emergency only.** The `extraConnectSrc` parameter
of `buildCsp()` accepts an array of origins to append at runtime.
Plumb it through middleware via an env var (currently NOT exposed —
opening that envelope is a deliberate decision because env-driven
CSP changes bypass code review).

---

## 7. How to read a violation report

When `csp_violation_total` spikes, on-call should:

1. **Pull the warn rows from `server_logs`** in the last 30 min:

   ```sql
   select created_at, message, context_json
     from server_logs
    where level = 'warn'
      and message = 'csp_violation'
      and created_at > now() - interval '30 minutes'
    order by created_at desc
    limit 100;
   ```

2. Look at `context_json.directive`, `blocked_uri`, `script_sample`,
   `document_uri`. Common diagnoses:

   | Pattern                                           | Diagnosis                                                                |
   | ------------------------------------------------- | ------------------------------------------------------------------------ |
   | `directive=script-src`, `blocked_host=inline`     | XSS attempt OR a deploy lost the nonce (check `app/layout.tsx`).         |
   | `directive=connect-src`, host = unknown 3p        | Bundle started talking to a new origin — investigate the diff.           |
   | `directive=style-src-elem`, `blocked_host=inline` | A library injected a `<style>` without a nonce — file an upstream issue. |
   | `directive=img-src`, host = customer-uploaded CDN | User profile picture or product image; whitelist the origin permanently. |

3. If real attack: file SEV-1, snapshot `server_logs`, rotate any
   sessions belonging to the affected `document_uri` user.

4. Always update the alert annotation if you find a new pattern, so
   the next on-call has a faster signal.

---

## 8. Related artifacts

- Code: `lib/security/csp.ts`, `middleware.ts`, `app/api/csp-report/route.ts`,
  `app/layout.tsx`.
- Tests: `tests/unit/lib/security-csp.test.ts` (21 tests),
  `tests/unit/api/csp-report.test.ts` (10 tests).
- Metrics: `csp_violation_total`, `csp_report_invalid_total` —
  documented in `docs/observability/metrics.md` §3.2.
- Alerts: `monitoring/prometheus/alerts.yml` group `csp` —
  `CspViolationSpike`, `CspInlineScriptBlocked`, `CspReportInvalidFlood`.
- Retention: violation rows are subject to RP-09 (`server_logs`) —
  90 days, see `lib/retention/policies.ts` and `docs/legal/retention-policy.md`.
- Trust Center entry: control **CC-13** in `app/trust/page.tsx`.

---

## 9. Out of scope (for now)

- Hashing every Tailwind-injected `<style>` chunk for `style-src-elem`
  to drop `'unsafe-inline'` there too — Next.js does not yet expose
  the chunk hashes in a stable form. Tracked as future hardening.
- Trusted Types (`require-trusted-types-for 'script'`). Would force
  every `innerHTML` write to go through a typed policy. Adoption
  needs an audit of every dependency that touches the DOM (Sentry,
  Sonner, lucide). Deferred to next wave.
- Subresource Integrity (`integrity="sha384-..."`) on the Sentry
  CDN bundle. We currently bundle Sentry server-side, so no
  external script tags exist; if we ever load from a CDN this MUST
  be added.
