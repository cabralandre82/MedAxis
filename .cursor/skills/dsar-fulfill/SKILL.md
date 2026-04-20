---
name: dsar-fulfill
description: Processes a LGPD Data Subject Access Request (DSAR) from RECEIVED to FULFILLED or REJECTED within the 15-day legal SLA. Use when the user says "processar DSAR", "responder solicitação LGPD", "cliente pediu exclusão / exportação de dados", "DSAR vencendo", or when the `dsar-sla-check` cron alerts. Covers the three kinds the DB enum allows — `EXPORT`, `ERASURE`, `RECTIFICATION` — with legal-hold checks and notes on portability/partial-erasure variants.
---

# DSAR fulfillment — LGPD Art. 19 (15-day SLA)

## Legal context — read once

- **SLA**: 15 calendar days from `requested_at` (LGPD Art. 19).
- **Grace**: 30 extra days → `EXPIRED` status (cron auto-closes).
- **ANPD exposure**: up to 2% revenue (capped R$ 50M) for missed SLA.
- **Never `DELETE` from `dsar_requests` or `dsar_audit`** — append-only.

Full runbook: `docs/runbooks/dsar-sla-missed.md`.

## Workflow

```
DSAR progress:
- [ ] 1. Identified request(s) by id(s)
- [ ] 2. Validated legal holds blocking ERASURE
- [ ] 3. Advanced RECEIVED → PROCESSING (audit trail)
- [ ] 4. Executed the request (export / erasure / correction)
- [ ] 5. Recorded fulfillment evidence
- [ ] 6. Advanced PROCESSING → FULFILLED or REJECTED
- [ ] 7. Notified the subject (email or admin channel)
- [ ] 8. Hash-chain integrity verified
```

## Step 1 — identify the request

```sql
-- Specific request
select id, kind, status, subject_user_id, requested_at, sla_due_at,
       now() - sla_due_at as over_by
  from public.dsar_requests
 where id = '<uuid>';

-- All open + breach
select id, kind, status, subject_user_id, sla_due_at,
       now() - sla_due_at as over_by
  from public.dsar_requests
 where status in ('RECEIVED','PROCESSING')
 order by sla_due_at asc;
```

Check the DSAR audit chain to see history:

```sql
select seq, to_status, actor_user_id, actor_role, created_at, metadata_json
  from public.dsar_audit
 where request_id = '<uuid>'
 order by seq asc;
```

## Step 2 — validate legal holds (for ERASURE only)

ERASURE requests MUST reject if any of these apply. Never silently skip.

| Reject code   | Applies when                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------- |
| `NFSE_10Y`    | Subject has fiscal records < 10 years old (CTN Art. 195)                                        |
| `RDC_67_2007` | Subject uploaded/appears in prescription records < 5 years old (Anvisa RDC 67/2007 — see RP-06) |
| `ART_37_LGPD` | Active consent-manifest records (LGPD Art. 37)                                                  |
| `LEGAL_HOLD`  | Row in `legal_holds` table pointing to subject                                                  |

Check:

```sql
-- NFSE retention (CTN Art. 195 — 10 years)
select count(*) from public.nfse_records where subject_id = '<uuid>'
  and issued_at > now() - interval '10 years';

-- Prescription retention (RDC 67/2007 — 5 years). The platform
-- tracks prescriptions via order_item_prescriptions, linked to the
-- subject through orders.created_by_user_id (clinic user) or
-- uploaded_by_user_id. Check both angles — either blocks erasure.
select count(*)
  from public.order_item_prescriptions oip
  join public.orders o on o.id = oip.order_id
 where (o.created_by_user_id = '<uuid>' or oip.uploaded_by_user_id = '<uuid>')
   and oip.created_at > now() - interval '5 years';

-- Active legal holds
select reason, authority, expires_at from public.legal_holds
 where subject_user_id = '<uuid>' and released_at is null;
```

If any count > 0 or hold exists → reject (see Step 6, rejection path).

## Step 3 — advance RECEIVED → PROCESSING

```sql
select public.dsar_transition(
  '<request-id>'::uuid,
  'PROCESSING',
  jsonb_build_object(
    'actor_user_id', '<admin-uuid>',
    'actor_role', 'SUPER_ADMIN'
  )
);
```

The RPC writes the audit row with fresh hash-chain. Never bypass
this RPC — direct `UPDATE` on `dsar_requests` breaks the chain.

## Step 4 — execute by kind

### EXPORT — deliver a data dump

1. Hit `GET /api/lgpd/export` impersonating the subject (prefer self-serve; extreme cases only):

   ```bash
   # Admin impersonation — requires SUPER_ADMIN + MFA + audit-logged
   curl -X GET "https://clinipharma.com.br/api/lgpd/export?subject=<uuid>" \
     -H "Authorization: Bearer <admin-service-token>" \
     -H "X-On-Behalf-Of: <subject-uuid>" \
     -o "dsar-export-<uuid>.zip"
   ```

2. Compute delivery hash:

   ```bash
   DELIVERY_HASH=$(sha256sum dsar-export-<uuid>.zip | cut -d' ' -f1)
   ```

3. Upload to a subject-accessible location (Supabase Storage, expiring link):
   ```bash
   # bucket: dsar-exports (7-day signed URLs only)
   supabase storage cp dsar-export-<uuid>.zip \
     dsar-exports/<uuid>.zip
   ```

### ERASURE — tombstone the profile

```bash
# Sets profiles.anonymized_at, replaces PII with hashed placeholders,
# and transitions the DSAR atomically. All anonymisation SQL lives
# inside the route handler (see app/api/admin/lgpd/anonymize/
# [userId]/route.ts) — there is no separate RPC.
curl -X POST "https://clinipharma.com.br/api/admin/lgpd/anonymize/<subject-uuid>" \
  -H "Authorization: Bearer <admin-service-token>"
```

The endpoint:

- Replaces PII fields with hashed placeholders
- Sets `profiles.anonymized_at = now()` (migration 051 columns)
- Keeps `audit_logs` intact (append-only) — LGPD Art. 16 allows this
- Transitions DSAR to FULFILLED atomically

### RECTIFICATION — correct specific fields

There is no dedicated RPC for this; the admin edits the subject's
fields directly (audit-logged at the column level by migration 046),
then transitions the DSAR with a `delivery_hash` summarising the
change:

```sql
-- 1) Admin applies the correction (e.g. via the admin UI or a
--    one-off UPDATE guarded by audit_logs triggers).
update public.profiles
   set full_name = 'Nome Corrigido', updated_at = now()
 where id = '<subject-uuid>';

-- 2) Compute a deterministic delivery_hash over the corrected
--    fields so the audit row is reproducible.
--    Example: echo -n 'full_name=Nome Corrigido' | sha256sum
--    → <hash>

-- 3) Close the DSAR.
select public.dsar_transition(
  '<request-id>'::uuid,
  'FULFILLED',
  jsonb_build_object(
    'actor_user_id', '<admin-uuid>',
    'actor_role', 'SUPER_ADMIN',
    'delivery_hash', '<sha256-of-corrected-fields>',
    'delivery_ref', 'rectification:<subject-uuid>',
    'metadata', jsonb_build_object(
      'fields_corrected', jsonb_build_array('full_name')
    )
  )
);
```

### EXPORT variants

The migration enum has a single `EXPORT` kind. Two operational
shapes exist on top of it:

- **Portability (LGPD Art. 18 V):** same `EXPORT` kind, but call the
  endpoint with `?format=portability` so the bundle contains
  structured JSON instead of human-readable PDFs. Record the
  selected format in the `metadata.format` field of the FULFILLED
  transition so the choice is auditable.
- **Partial anonymisation (aggregates retained):** an ERASURE variant
  that is **not** wired as a self-serve path. Route to DPO for
  manual review; do NOT transition through the RECEIVED→PROCESSING→
  FULFILLED graph automatically. If the DPO decides to proceed, the
  subject still gets an `ERASURE` DSAR row and the partial nature is
  captured in `metadata`.

## Step 5 — record fulfillment evidence

```sql
select public.dsar_transition(
  '<request-id>'::uuid,
  'FULFILLED',
  jsonb_build_object(
    'actor_user_id', '<admin-uuid>',
    'actor_role', 'SUPER_ADMIN',
    'delivery_hash', '<sha256-hex>',
    'delivery_ref', 'storage://dsar-exports/<uuid>.zip',
    'metadata', jsonb_build_object('channel', 'email', 'delivered_at', now())
  )
);
```

## Step 6 — rejection path (with legal-hold code)

When erasure is blocked by a retention obligation:

```sql
select public.dsar_transition(
  '<request-id>'::uuid,
  'REJECTED',
  jsonb_build_object(
    'actor_user_id', '<admin-uuid>',
    'actor_role', 'SUPER_ADMIN',
    'reject_code', 'NFSE_10Y',
    'metadata', jsonb_build_object(
      'reason', 'Obrigação legal de retenção fiscal (CTN Art. 195)',
      'retry_after', '2036-04-19'
    )
  )
);
```

Then send the subject a clear Portuguese-language explanation citing
the specific legal basis. Template: `docs/templates/dsar-rejection-*.md`.

## Step 7 — notify the subject

Send through the same channel the request arrived (usually email).
Include:

- What was done (EXPORT delivered / ERASURE completed / CORRECTION applied / REJECTED with reason)
- When (timestamp)
- Link to the download (EXPORT only; expiring)
- How to appeal (ANPD + our contact)

Template: `docs/templates/dsar-response-*.md`.

## Step 8 — verify hash-chain integrity

```sql
-- Should return all `chain_ok = true`
select seq, to_status,
       prev_hash = lag(row_hash) over (order by seq) as chain_ok
  from public.dsar_audit
 where request_id = '<request-id>'
 order by seq asc;
```

If any row shows `chain_ok = false`, **do not close the issue**. Escalate to `audit-chain-verify` skill.

## Recovery — botched half-anonymization

If `/api/admin/lgpd/anonymize` half-completed (profile tombstoned but DSAR still PROCESSING):

```sql
-- Finish the transition manually, do NOT retry the HTTP endpoint
select public.dsar_transition(
  '<request-id>'::uuid,
  'FULFILLED',
  jsonb_build_object(
    'actor_user_id', '<admin-uuid>',
    'actor_role', 'SUPER_ADMIN',
    'delivery_hash', 'manual-recovery-' || gen_random_uuid()::text,
    'delivery_ref', 'recovered:<subject-uuid>',
    'metadata', jsonb_build_object('reason', 'manual recovery after partial anonymise')
  )
);
```

## Anti-patterns

- **Never `UPDATE dsar_requests` directly** — use `dsar_transition()`.
- **Never delete an EXPIRED request** — it's part of the legal record.
- **Never fulfil an ERASURE without checking legal_holds** — creates retention-law exposure.
- **Never write free-form reject reasons** — use the documented `reject_code` values.
- **Never close this issue before verifying the hash chain** is contiguous.

## Related

- Full narrative runbook: `docs/runbooks/dsar-sla-missed.md`
- Legal-hold details: `docs/runbooks/legal-hold-received.md` + `legal-hold-apply` skill
- Hash-chain tamper: `.cursor/skills/audit-chain-verify/`
