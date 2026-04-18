# RLS matrix — Clinipharma (Wave 14)

**Source of truth:** the matrix declared inside the SECURITY INVOKER
function `public.rls_canary_assert(uuid)` in
`supabase/migrations/055_rls_canary.sql`. This file is the human-
readable mirror; if the two diverge the migration wins. CI (Wave 14)
fails if a new RLS-enabled table is added to `public` without being
classified here AND in the matrix.

## How to read this file

For every table protected by RLS, we record:

- **Bucket** — what kind of data it holds, which determines the
  expected visibility for an unaffiliated authenticated user:
  - `tenant`: business data scoped to a clinic / pharmacy /
    consultant. Visibility requires explicit membership.
  - `self`: per-user data. Visibility requires
    `user_id = auth.uid()` (or equivalent).
  - `admin`: privileged ledger. Visibility requires
    `is_platform_admin()` or service_role.
- **Canary expectation** — the result the daily canary asserts.
  Today every classified table expects `visible_rows = 0`
  for a stranger. A future "**visible to all authenticated**" bucket
  (catalogue items, SLA configs) is intentionally excluded — see
  the **Excluded** section.
- **Tenant columns** — the columns the policy keys off. Useful
  during incident triage to map a leaked row back to its owner.
- **Status** — covered by the canary today (✅) or in backlog (🟡).

## Tables in the canary matrix

### Bucket: `tenant` (membership-scoped)

| Table                           | Tenant cols                       | Status | Notes                                                     |
| ------------------------------- | --------------------------------- | :----: | --------------------------------------------------------- |
| `orders`                        | clinic_id, doctor_id, pharmacy_id |   ✅   | Read by clinic + pharmacy + admin                         |
| `order_items`                   | order_id (→ orders)               |   ✅   | Inherited via orders join                                 |
| `order_documents`               | order_id                          |   ✅   | Idem                                                      |
| `order_status_history`          | order_id                          |   ✅   | Idem                                                      |
| `order_operational_updates`     | order_id, pharmacy_id             |   ✅   | Idem                                                      |
| `order_item_prescriptions`      | order_id                          |   ✅   | Idem                                                      |
| `order_templates`               | clinic_id                         |   ✅   | Manage policy is `ALL` — canary covers SELECT             |
| `payments`                      | order_id (→ orders)               |   ✅   | + `payer_profile_id = auth.uid()`                         |
| `commissions`                   | order_id                          |   ✅   | Read by consultant + admin                                |
| `transfers`                     | order_id, pharmacy_id             |   ✅   | Read by pharmacy + admin                                  |
| `consultant_commissions`        | consultant_id, order_id           |   ✅   |                                                           |
| `consultant_transfers`          | consultant_id                     |   ✅   |                                                           |
| `coupons`                       | clinic_id, doctor_id              |   ✅   |                                                           |
| `contracts`                     | user_id                           |   ✅   |                                                           |
| `nfse_records`                  | (via order)                       |   ✅   |                                                           |
| `support_tickets`               | (clinic/pharmacy via FK)          |   ✅   |                                                           |
| `support_messages`              | (ticket FK)                       |   ✅   |                                                           |
| `pharmacy_products`             | pharmacy_id                       |   ✅   |                                                           |
| `product_pharmacy_cost_history` | (pharmacy_id via FK)              |   ✅   |                                                           |
| `product_price_history`         | (pharmacy_id via FK)              |   ✅   |                                                           |
| `clinic_members`                | clinic_id, user_id                |   ✅   | **Wave 14 fix: was self-recursive**                       |
| `pharmacy_members`              | pharmacy_id, user_id              |   ✅   |                                                           |
| `doctor_clinic_links`           | (doctor_id, clinic_id)            |   ✅   | **Wave 14 fix: cycled with `doctors_select`**             |
| `clinic_churn_scores`           | (clinic_id via FK)                |   ✅   | Admin-only, but in tenant bucket since data is per-clinic |

### Bucket: `self` (per-user)

| Table                    | Tenant cols     | Status | Notes |
| ------------------------ | --------------- | :----: | ----- |
| `notifications`          | user_id         |   ✅   |       |
| `dsar_requests`          | subject_user_id |   ✅   |       |
| `fcm_tokens`             | user_id         |   ✅   |       |
| `user_permission_grants` | user_id         |   ✅   |       |
| `registration_drafts`    | (user_id)       |   ✅   |       |

### Bucket: `admin` (privileged ledgers)

| Table                    | Owner        | Status | Notes                          |
| ------------------------ | ------------ | :----: | ------------------------------ |
| `audit_logs`             | platform     |   ✅   | service_role write, admin read |
| `dsar_audit`             | DPO          |   ✅   | No policies → default DENY     |
| `legal_holds`            | DPO          |   ✅   | Wave 13                        |
| `backup_runs`            | SRE          |   ✅   | Wave 12                        |
| `rls_canary_log`         | security     |   ✅   | Wave 14, this file             |
| `rate_limit_violations`  | security     |   ✅   | Wave 10                        |
| `server_logs`            | platform     |   ✅   |                                |
| `webhook_events`         | integrations |   ✅   |                                |
| `access_logs`            | platform     |   ✅   |                                |
| `registration_requests`  | sales/admin  |   ✅   |                                |
| `registration_documents` | sales/admin  |   ✅   |                                |

## Excluded from the canary

These tables are RLS-enabled but the policy is **deliberately
permissive** to all authenticated (or even anonymous) users. The
canary skips them so a `visible_rows > 0` doesn't fire a false
positive.

| Table                     | Reason for exclusion                                      |
| ------------------------- | --------------------------------------------------------- |
| `products`                | Public catalogue — every visitor browses                  |
| `product_variants`        | Idem                                                      |
| `product_categories`      | Idem                                                      |
| `product_images`          | Idem                                                      |
| `product_associations`    | Idem                                                      |
| `feature_flags`           | Client-side feature flag evaluation                       |
| `permissions`             | RBAC catalogue used by client UI                          |
| `role_permissions`        | Idem                                                      |
| `sla_configs`             | Default row visible to everyone                           |
| `app_settings`            | Some keys (theme, public links) are public                |
| `cron_runs`               | service_role only — never user-readable, no policy needed |
| `cron_locks`              | service_role only                                         |
| `audit_chain_checkpoints` | Admin-only via separate endpoint; not user surface        |
| `feature_flag_audit`      | service_role only                                         |
| `order_tracking_tokens`   | Token-based access, not subject-based — covered by HMAC   |
| `revoked_tokens`          | service_role only                                         |
| `product_interests`       | Per-user; covered indirectly by user-id RPC checks        |

## Adding a new table

1. Decide the bucket (`tenant`, `self`, or `admin`). If unsure, ask
   in `#sec-platform`.
2. Add the table to the `v_matrix` array in
   `public.rls_canary_assert()` (next migration).
3. Add a row to this matrix file in the same PR.
4. Run the canary once locally:

   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" \
     http://localhost:3000/api/cron/rls-canary | jq
   ```

5. CI will reject the PR if the table is RLS-enabled in `public`
   but neither matrixed nor explicitly excluded (see
   `tests/integration/rls-matrix-coverage.test.ts`, follow-up).

## Real bugs the canary has caught (since W14 launch)

| Date       | Symptom                                                     | Fix                                                                                 |
| ---------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 2026-04-17 | `clinic_members_select` recursed into itself                | Helper `is_clinic_member()` (migration 055)                                         |
| 2026-04-17 | `doctors_select` ↔ `doctor_clinic_links_select` cross-cycle | Helpers `is_doctor_for_user()`, `doctor_visible_to_clinic_member()` (migration 055) |
