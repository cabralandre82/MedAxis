# Secrets inventory — Wave 15

Source of truth: [`lib/secrets/manifest.ts`](../lib/secrets/manifest.ts)
mirrored by SQL in [`supabase/migrations/056_secret_rotation.sql`](../supabase/migrations/056_secret_rotation.sql).
This document is the human-friendly view; tests in
`tests/unit/lib/secrets-manifest.test.ts` enforce parity between
runtime and SQL manifests so this table cannot silently drift.

## Classification

| Tier | Auto-rotate?                               | Cron behaviour                                                                             | Human action required                          | Max age (days) |
| ---- | ------------------------------------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------- | -------------- |
| A    | YES (when `secrets.auto_rotate_tier_a` ON) | Generates new value, PATCHes Vercel env, redeploys, records success                        | None (alert only on failure)                   | 90             |
| B    | NO                                         | Records "queued for operator", emits warning alert with runbook anchor                     | Operator follows runbook §3.2 within 7d        | 90             |
| C    | NO                                         | Records "requires operator", emits warning OR critical based on `secrets.rotation_enforce` | Operator schedules maintenance window per §3.3 | 180            |

## Manifest

| Env var                      | Tier | Provider            | Description                                       | Notes                                                                                         |
| ---------------------------- | ---- | ------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `CRON_SECRET`                | A    | vercel-env          | Bearer for Vercel Cron → /api/cron/\*             |                                                                                               |
| `METRICS_SECRET`             | A    | vercel-env          | Bearer for Prometheus scrape                      |                                                                                               |
| `BACKUP_LEDGER_SECRET`       | A    | vercel-env          | HMAC over backup ledger entries (Wave 12)         |                                                                                               |
| `RESEND_API_KEY`             | B    | resend-portal       | Outbound transactional email                      |                                                                                               |
| `ASAAS_API_KEY`              | B    | asaas-portal        | Payment gateway production                        |                                                                                               |
| `ASAAS_WEBHOOK_SECRET`       | B    | asaas-portal        | HMAC for inbound Asaas webhooks                   | rotate paired with API key                                                                    |
| `ZENVIA_API_TOKEN`           | B    | zenvia-portal       | SMS / WhatsApp                                    |                                                                                               |
| `INNGEST_EVENT_KEY`          | B    | inngest-portal      | Outbound auth (platform → Inngest Cloud)          |                                                                                               |
| `INNGEST_SIGNING_KEY`        | B    | inngest-portal      | Inbound auth (Inngest Cloud → /api/inngest)       | drain queue first                                                                             |
| `CLICKSIGN_ACCESS_TOKEN`     | B    | clicksign-portal    | E-signature service                               |                                                                                               |
| `CLICKSIGN_WEBHOOK_SECRET`   | B    | clicksign-portal    | HMAC for inbound Clicksign webhooks               | rotate paired with token                                                                      |
| `NUVEM_FISCAL_CLIENT_SECRET` | B    | nuvem-fiscal-portal | OAuth2 for NF-e / NFS-e                           |                                                                                               |
| `VERCEL_TOKEN`               | B    | vercel-env          | Vercel API token used by the rotation cron itself | CIRCULAR — pause cron during rotation                                                         |
| `TURNSTILE_SECRET_KEY`       | B    | cloudflare-api      | Cloudflare Turnstile widget secret                |                                                                                               |
| `SUPABASE_DB_PASSWORD`       | C    | supabase-mgmt       | Postgres role password                            | drops direct DB connections                                                                   |
| `SUPABASE_JWT_SECRET`        | C    | supabase-mgmt       | HS256 secret for Auth tokens                      | invalidates ALL sessions; siblings: SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_ANON_KEY |
| `FIREBASE_PRIVATE_KEY`       | C    | firebase-console    | Firebase Admin service account                    | siblings: FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL                                         |
| `OPENAI_API_KEY`             | C    | openai-portal       | OpenAI billing key                                |                                                                                               |
| `ENCRYPTION_KEY`             | C    | vercel-env          | AES-256-GCM key for PII at rest (Wave 6)          | DESTRUCTIVE — needs envelope encryption migration before rotation                             |

Total: 19 secrets (3 Tier A, 11 Tier B, 5 Tier C).

## Secrets NOT yet tracked

These exist in `.env.local` but are not in the rotation manifest
because they're either:

- **Public by design** — anything `NEXT_PUBLIC_*` (auth metadata,
  Firebase web SDK, Vercel-injected build vars). No rotation needed
  unless `SUPABASE_JWT_SECRET` rotates (which forces
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` to rotate as a sibling — handled
  in §3.3.2 of `secret-compromise.md`).
- **Effectively immutable** — `FIREBASE_PROJECT_ID`,
  `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `ASAAS_API_URL`,
  `CLICKSIGN_API_URL`, `EMAIL_FROM`, `NEXT_PUBLIC_APP_URL`. Rotating
  these requires renaming projects, which is a multi-week migration,
  not a key rotation.
- **Test/demo credentials** — `NEXT_PUBLIC_FIREBASE_VAPID_KEY`
  (web push, requires re-subscribing every device on rotation),
  `NEXT_PUBLIC_FIREBASE_API_KEY` (browser SDK, restricted by
  Firebase rules — minimal value to attacker).

If you add a new env var to the codebase, decide its tier and:

1. Append to `SECRET_MANIFEST` in `lib/secrets/manifest.ts`.
2. Append to the `v_manifest` jsonb array in
   `secret_rotation_overdue()` (migration 056) **and** to the
   `v_seed` array in the genesis DO block.
3. Append to the table in this doc.
4. Add the rotation procedure to `docs/runbooks/secret-compromise.md`.
5. Run `npm test tests/unit/lib/secrets-manifest.test.ts` — the
   coverage test must pass.

The CI test enforces this — adding a secret to one place but not
the others fails the build.

## Operations queries

```sql
-- Daily check: any secret approaching its limit?
SELECT secret_name, tier, age_days,
       CASE
         WHEN tier IN ('A','B') THEN 90 - age_days
         ELSE 180 - age_days
       END AS days_remaining
  FROM public.secret_inventory
 ORDER BY days_remaining ASC NULLS FIRST;

-- Weekly DPO report: rotations in the last 30 days
SELECT rotated_at, secret_name, tier, trigger_reason, rotated_by, success
  FROM public.secret_rotations
 WHERE rotated_at > now() - interval '30 days'
   AND trigger_reason != 'genesis'
 ORDER BY rotated_at DESC;

-- Audit: prove the chain hasn't been tampered
WITH ordered AS (
  SELECT row_hash, prev_hash,
         LAG(row_hash) OVER (ORDER BY seq) AS expected_prev
    FROM public.secret_rotations
)
SELECT 'OK' AS status
  FROM ordered
 GROUP BY ()
HAVING COUNT(*) FILTER (
  WHERE prev_hash IS DISTINCT FROM expected_prev
    AND expected_prev IS NOT NULL
) = 0;
```

## Compliance mapping

| Standard / regulation                  | How Wave 15 addresses                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| LGPD Art. 46 (security measures)       | Documented rotation policy + tamper-evident ledger + per-tier max age        |
| LGPD Art. 48 (incident notification)   | Runbook §4.3 includes ANPD reporting path within 72h                         |
| LGPD Art. 49 (data protection officer) | DPO is mandatory stakeholder for any Tier C rotation                         |
| ISO 27001 A.10.1.2 (key management)    | Hash-chained ledger + per-secret tier policy + automated overdue detection   |
| SOC 2 CC6.1 (logical access)           | `secret_rotations` table immutable; `rotated_by` field carries operator UUID |
| OWASP ASVS 2.10 (secret management)    | Manifest-coverage test enforces no untracked secrets in `process.env.*`      |
