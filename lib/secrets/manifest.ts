/**
 * Secret manifest — Wave 15.
 *
 * Pure, server-safe-but-isomorphic module describing every secret
 * the platform tracks for rotation. **The DB migration 056 carries
 * the source of truth** (`secret_rotation_overdue` returns rows
 * derived from a hard-coded array there). This file is the
 * runtime mirror used by:
 *
 *   • the cron at `/api/cron/rotate-secrets` to look up provider
 *     metadata when dispatching by tier,
 *   • the deep-health endpoint to surface friendly names,
 *   • the unit-test suite to guarantee the runtime mirror cannot
 *     drift from the SQL manifest (the test reads both and
 *     diffs them — see `tests/unit/lib/secrets-manifest.test.ts`).
 *
 * No DB access here, no `server-only` import — keeps the manifest
 * importable from documentation generators and CI scripts.
 *
 * @module lib/secrets/manifest
 */

export type SecretTier = 'A' | 'B' | 'C'

export type SecretProvider =
  | 'vercel-env'
  | 'supabase-mgmt'
  | 'cloudflare-api'
  | 'firebase-console'
  | 'asaas-portal'
  | 'clicksign-portal'
  | 'resend-portal'
  | 'zenvia-portal'
  | 'inngest-portal'
  | 'nuvem-fiscal-portal'
  | 'openai-portal'
  | 'manual'

/**
 * One descriptor per env-var tracked. `name` MUST exactly match the
 * `process.env.<NAME>` token used in code so the cron can later
 * patch the right Vercel env entry.
 */
export interface SecretDescriptor {
  name: string
  tier: SecretTier
  provider: SecretProvider
  /**
   * Human-friendly label for runbooks / UI. Don't put the value here
   * (obviously). Don't put the rotation procedure either — that
   * lives in `docs/runbooks/secret-compromise.md`.
   */
  description: string
  /**
   * If `true`, rotating this secret invalidates active user sessions
   * (e.g. SUPABASE_JWT_SECRET). The runbook MUST schedule a
   * maintenance window before manual rotation.
   */
  invalidatesSessions?: boolean
  /**
   * If `true`, rotating without a key-versioning migration destroys
   * existing encrypted data (currently only ENCRYPTION_KEY).
   */
  destroysDataAtRest?: boolean
  /**
   * If `true`, this secret has paired sibling envs that must rotate
   * together (e.g. SUPABASE_JWT_SECRET ⇒ SUPABASE_SERVICE_ROLE_KEY +
   * NEXT_PUBLIC_SUPABASE_ANON_KEY). The runbook lists them.
   */
  hasSiblings?: boolean
}

/**
 * Full manifest. Order = importance (Tier A first so cron reports
 * read top-down naturally). Adding a secret here without also
 * touching the SQL manifest in `056_secret_rotation.sql` is a bug —
 * the manifest-coverage test in CI will fail the build.
 */
export const SECRET_MANIFEST: readonly SecretDescriptor[] = [
  // ── Tier A — auto-rotate, app-level random bytes ──────────────────
  {
    name: 'CRON_SECRET',
    tier: 'A',
    provider: 'vercel-env',
    description:
      'Bearer token Vercel Cron presents to /api/cron/* endpoints (Wave 2 cron-guard). Pure random, no third-party dep.',
  },
  {
    name: 'METRICS_SECRET',
    tier: 'A',
    provider: 'vercel-env',
    description: 'Bearer token Prometheus uses to scrape /api/metrics. App-internal only.',
  },
  {
    name: 'BACKUP_LEDGER_SECRET',
    tier: 'A',
    provider: 'vercel-env',
    description:
      'HMAC key over backup ledger entries (Wave 12). Rotation is safe because new entries get the new key and old verification keeps a key-history.',
  },

  // ── Tier B — assisted: provider rotation + Vercel env update ─────
  {
    name: 'RESEND_API_KEY',
    tier: 'B',
    provider: 'resend-portal',
    description:
      'Outbound transactional email. Rotation = create new key in Resend, update Vercel env, redeploy, revoke old key.',
  },
  {
    name: 'ASAAS_API_KEY',
    tier: 'B',
    provider: 'asaas-portal',
    description:
      'Payment gateway production key. Rotation requires Asaas portal access + Vercel env patch + redeploy.',
  },
  {
    name: 'ASAAS_WEBHOOK_SECRET',
    tier: 'B',
    provider: 'asaas-portal',
    description:
      'HMAC verifying Asaas webhooks. Updating it must be coordinated: change in Asaas portal, then in Vercel env, then redeploy. Window of ~30s where webhooks may 401.',
  },
  {
    name: 'ZENVIA_API_TOKEN',
    tier: 'B',
    provider: 'zenvia-portal',
    description: 'SMS / WhatsApp gateway. Rotation in Zenvia developer portal + Vercel env.',
  },
  {
    name: 'INNGEST_EVENT_KEY',
    tier: 'B',
    provider: 'inngest-portal',
    description: 'Auth for events sent FROM the platform TO Inngest Cloud.',
  },
  {
    name: 'INNGEST_SIGNING_KEY',
    tier: 'B',
    provider: 'inngest-portal',
    description:
      'Validates requests FROM Inngest Cloud TO /api/inngest. Rotation must wait until Inngest queue drained.',
  },
  {
    name: 'CLICKSIGN_ACCESS_TOKEN',
    tier: 'B',
    provider: 'clicksign-portal',
    description: 'E-signature service token. Rotation in Clicksign portal + Vercel.',
  },
  {
    name: 'CLICKSIGN_WEBHOOK_SECRET',
    tier: 'B',
    provider: 'clicksign-portal',
    description: 'HMAC verifying Clicksign webhooks. Same care as ASAAS_WEBHOOK_SECRET.',
  },
  {
    name: 'NUVEM_FISCAL_CLIENT_SECRET',
    tier: 'B',
    provider: 'nuvem-fiscal-portal',
    description: 'OAuth2 client secret for NF-e / NFS-e issuance.',
  },
  {
    name: 'VERCEL_TOKEN',
    tier: 'B',
    provider: 'vercel-env',
    description:
      'Vercel API token used by the cron itself to PATCH envs. Rotation: create new in Vercel dashboard, update env, redeploy, delete old. CIRCULAR — must be done by an operator while the cron is paused.',
    hasSiblings: false,
  },
  {
    name: 'TURNSTILE_SECRET_KEY',
    tier: 'B',
    provider: 'cloudflare-api',
    description: 'Cloudflare Turnstile widget secret. Rotation via Cloudflare dashboard or API.',
  },

  // ── Tier C — manual only, high blast radius ──────────────────────
  {
    name: 'SUPABASE_DB_PASSWORD',
    tier: 'C',
    provider: 'supabase-mgmt',
    description:
      'Postgres role password. Rotation forces every direct DB connection to drop. The cron NEVER auto-rotates this.',
  },
  {
    name: 'SUPABASE_JWT_SECRET',
    tier: 'C',
    provider: 'supabase-mgmt',
    description:
      'HS256 secret for every API call signed by Supabase Auth. Rotating invalidates EVERY active user session. Schedule a maintenance window.',
    invalidatesSessions: true,
    hasSiblings: true,
  },
  {
    name: 'FIREBASE_PRIVATE_KEY',
    tier: 'C',
    provider: 'firebase-console',
    description:
      'Firebase Admin service account. Rotation requires creating a new service account in Firebase Console, copying the JSON, and patching three envs.',
    hasSiblings: true,
  },
  {
    name: 'OPENAI_API_KEY',
    tier: 'C',
    provider: 'openai-portal',
    description: 'OpenAI billing key. Manual rotation per OpenAI policy.',
  },
  {
    name: 'ENCRYPTION_KEY',
    tier: 'C',
    provider: 'vercel-env',
    description:
      'AES-256-GCM key for PII at rest (Wave 6). Rotation is a multi-week project: implement key versioning, re-encrypt every encrypted row with new key, retire old key. NEVER rotate naively.',
    destroysDataAtRest: true,
  },
] as const

/** Stable count exported for the manifest-coverage test. */
export const SECRET_MANIFEST_SIZE = SECRET_MANIFEST.length

/** Look up a single descriptor by env-var name. */
export function getSecretDescriptor(name: string): SecretDescriptor | null {
  return SECRET_MANIFEST.find((s) => s.name === name) ?? null
}

/** Filter by tier — handy for the cron dispatcher. */
export function secretsByTier(tier: SecretTier): readonly SecretDescriptor[] {
  return SECRET_MANIFEST.filter((s) => s.tier === tier)
}

/**
 * Default per-tier max-age windows (days). The cron passes these to
 * the SQL `secret_rotation_overdue(p_max_age_days)` RPC. We use a
 * sliding scale: high-blast-radius (Tier C) gets a longer fuse so
 * we don't page about Supabase JWT every 90 days when rotating it
 * is a maintenance-window event.
 *
 *   Tier A — 90 days  (auto, low risk → tight)
 *   Tier B — 90 days  (assisted, moderate risk → standard)
 *   Tier C — 180 days (manual, high risk → loose, alerts well in
 *                       advance of the strict 12-month industry max)
 */
export const TIER_MAX_AGE_DAYS: Record<SecretTier, number> = {
  A: 90,
  B: 90,
  C: 180,
}

/**
 * Stable list of `(name, tier)` pairs used by the
 * manifest-coverage test to detect drift between the runtime
 * manifest and the SQL manifest in migration 056.
 */
export function manifestFingerprint(): string {
  return SECRET_MANIFEST.map((s) => `${s.name}:${s.tier}:${s.provider}`)
    .sort()
    .join('|')
}
