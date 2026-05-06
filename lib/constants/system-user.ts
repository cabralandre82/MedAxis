/**
 * Synthetic system actor used by automated processes (webhooks, Inngest
 * jobs, cron) that need to write to tables whose `actor_user_id` /
 * `changed_by_user_id` columns are FK NOT NULL to `profiles.id`.
 *
 * Provisioned by migration `084_system_user.sql` (applied 2026-05-06):
 *   - `auth.users.id`     = SYSTEM_USER_ID
 *   - `profiles.id`       = SYSTEM_USER_ID, is_active=false, no role
 *   - bcrypt password of a random UUID never communicated to anyone
 *
 * Why a constant module
 * ---------------------
 * Multiple call sites need this UUID (`lib/orders/release-for-execution.ts`,
 * `lib/jobs/asaas-webhook.ts`, future cron jobs). Inlining the literal in
 * each file invites typos and makes "where is this used?" greps noisier.
 * A dedicated constants module is also import-safe from any layer
 * (server-only / client / edge) because it contains zero side effects.
 *
 * Do NOT use this UUID for anything other than the actor of automated
 * writes. It must never appear as `created_by`, `confirmed_by`,
 * `processed_by` for human-driven actions — those should fail loudly
 * if no real user is present.
 */
export const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000' as const

export type SystemUserId = typeof SYSTEM_USER_ID
