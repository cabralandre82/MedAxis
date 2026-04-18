# Runbook — LGPD DSAR SLA missed (Wave 9)

- **Severity:** P1 when `dsar.sla_enforce=true` + flag present, P2 otherwise
- **Alert dedup keys:**
  - `lgpd:dsar:sla:breach` (> 15 calendar days since `requested_at`)
  - `lgpd:dsar:sla:warning` (within 3 days of SLA, still open)
- **Source:** `/api/cron/dsar-sla-check` (hourly)
- **Tables:** `public.dsar_requests`, `public.dsar_audit`
- **Metrics:** `dsar_sla_breach_total`, `dsar_sla_warning_total`, `dsar_expired_total`

## What the alert means

LGPD Art. 19 obliges the platform to respond to data-subject access
requests (Art. 18 I and VI) within **15 calendar days**. This alert
fires when at least one row in `public.dsar_requests` has
`status IN ('RECEIVED','PROCESSING')` and either

- `sla_due_at` already elapsed (BREACH) — legal exposure is open, or
- `sla_due_at` is within 3 days (WARNING) — we're about to breach.

The alert fires independently of the `dsar.sla_enforce` feature
flag, but severity changes: with the flag OFF we page at P2 only
(safe rollout), with the flag ON we page at P1 and the cron also
calls `public.dsar_expire_stale(30)` to flip anything > 30 days
past SLA into the terminal `EXPIRED` status. Expired requests are
NOT fulfilled — they are marked "abandoned" and the cron stops
re-alerting on them, so breached requests need human triage before
they hit grace+30.

## Impact

- **Legal:** ANPD can fine up to 2% of revenue (capped at BRL 50M)
  for missed DSAR SLAs. Failure to respond is an aggravating factor.
- **User trust:** subjects see no response; many will escalate to
  ANPD directly.
- **Platform:** none — no production traffic is blocked by this
  cron. The alert is an operational signal, not a system failure.

## Triage (target: 10 min)

1. **Confirm the alert is real**, not a cron bug. Check Sentry for a
   parallel `[dsar-sla-check] query failed` — if present, the query
   itself errored and the count you see is stale; skip to step 6.

2. **Pull the breach sample.** The alert's `customDetails.sample`
   shows up to 10 rows. Full list:

   ```sql
   select id, kind, status, subject_user_id, requested_at, sla_due_at,
          now() - sla_due_at as over_by
     from public.dsar_requests
    where status in ('RECEIVED','PROCESSING')
      and sla_due_at < now()
    order by sla_due_at asc;
   ```

3. **Check the DSAR audit chain** for each request — if it's still
   in `RECEIVED`, nobody triaged it:

   ```sql
   select a.seq, a.to_status, a.actor_user_id, a.actor_role, a.created_at,
          a.metadata_json
     from public.dsar_audit a
    where a.request_id = '<id>'
    order by a.seq asc;
   ```

   A single row (`to_status='RECEIVED'`) means the admin never
   picked it up. Two or more rows with no `FULFILLED` means it got
   stuck mid-processing.

4. **Count backlog by kind** so you know if this is one-off or a
   flood (e.g. post-incident form spam):

   ```sql
   select kind, status, count(*)
     from public.dsar_requests
    where status in ('RECEIVED','PROCESSING')
    group by kind, status
    order by kind, status;
   ```

## Decision tree

- **Backlog ≤ 3 requests, all `RECEIVED`**
  → Triage them manually right now via `/admin/dsar/<id>`. Advance
  to `PROCESSING`, do the work, then hit FULFILLED (EXPORT) or
  REJECTED (ERASURE with legal hold).

- **Backlog 4-20 requests**
  → Same as above, but also check whether admins were notified:

  ```sql
  select n.id, n.user_id, n.title, n.read_at, n.created_at
    from public.notifications n
   where n.title ilike '%LGPD%'
     and n.created_at > now() - interval '20 days'
   order by n.created_at desc;
  ```

  If `read_at IS NULL` for all of them, the alerting channel to
  SUPER_ADMIN is broken — remediate `lib/notifications.ts` or the
  email transport.

- **Backlog > 20 requests**
  → This is a flood, likely abuse or a compromised endpoint. Apply
  rate-limit at the `/api/lgpd/deletion-request` layer (increase
  `RATELIMIT_DSAR_PER_HOUR`), then batch-reject obvious duplicates:

  ```sql
  -- Only use after exec team sign-off.
  -- Find obvious duplicates (same subject, multiple kind=ERASURE):
  select subject_user_id, count(*)
    from public.dsar_requests
   where kind='ERASURE' and status in ('RECEIVED','PROCESSING')
   group by subject_user_id
   having count(*) > 1;
  ```

- **`EXPIRED` requests piling up**
  → The `dsar_expire_stale()` cron path is running but nothing is
  being closed before the 30-day grace. The on-call process is
  broken. File a compliance incident (`#compliance-incidents`) and
  review the last 90 days of DSAR audit rows.

## Diagnostic queries

```sql
-- Show requests about to breach (next 72 hours)
select id, kind, subject_user_id, sla_due_at - now() as time_left
  from public.dsar_requests
 where status in ('RECEIVED','PROCESSING')
   and sla_due_at between now() and now() + interval '3 days'
 order by sla_due_at asc;

-- Hash-chain integrity for one request (should be contiguous)
select seq, to_status, prev_hash = lag(row_hash) over (order by seq) as chain_ok
  from public.dsar_audit
 where request_id = '<id>'
 order by seq asc;

-- Inspect a request's full lifecycle
select r.*, (
  select json_agg(a order by a.seq)
    from public.dsar_audit a
   where a.request_id = r.id
) as audit
  from public.dsar_requests r
 where r.id = '<id>';

-- How many PII reads did we emit in the last 24h?
select count(*) as views, array_agg(distinct metadata_json->>'reason') as reasons
  from public.audit_logs
 where action='VIEW_PII'
   and created_at > now() - interval '24 hours';
```

## Mitigation strategies

### 1. Fulfill a stuck request manually (happy path)

```sql
-- Advance to PROCESSING (only if still RECEIVED)
select public.dsar_transition(
  '<request-id>'::uuid,
  'PROCESSING',
  jsonb_build_object('actor_user_id', '<admin-uuid>', 'actor_role', 'SUPER_ADMIN')
);
```

Then for EXPORT: hit `GET /api/lgpd/export` impersonating the
subject (only in extreme cases; prefer asking the user to self-
serve). For ERASURE: hit `POST /api/admin/lgpd/anonymize/<subject>`
which will transition the DSAR to FULFILLED and tombstone the
profile.

### 2. Reject with legal hold code

Use when the subject asked for ERASURE but financial records (10y
retention under CTN Art. 195) or prescriptions (Anvisa RDC 22/2014)
prevent us:

```sql
select public.dsar_transition(
  '<request-id>'::uuid,
  'REJECTED',
  jsonb_build_object(
    'actor_user_id', '<admin-uuid>',
    'actor_role', 'SUPER_ADMIN',
    'reject_code', 'NFSE_10Y',        -- or 'RDC_22_2014' for prescriptions
    'metadata', jsonb_build_object('reason', 'Obrigação legal de retenção fiscal')
  )
);
```

Reject codes in use:

| Code          | Legal hold                                            |
| ------------- | ----------------------------------------------------- |
| `NFSE_10Y`    | CTN Art. 195 — fiscal records 10-year retention       |
| `RDC_22_2014` | Anvisa RDC 22/2014 — prescriptions (5-year retention) |
| `ART_37_LGPD` | LGPD Art. 37 — manifest consent records               |

### 3. Emergency kill-switch (flag ON → P1 silenced)

If the P1 pages are noise (e.g. staging data leaked to prod) and
we're in the middle of an incident, flip the flag OFF to
re-silence at P2:

```sql
update public.feature_flags set enabled = false where key = 'dsar.sla_enforce';
```

This also disables `dsar_expire_stale()` auto-transition. Follow
up with a compliance review within 24h.

### 4. Recovery from a botched erasure

If `admin/lgpd/anonymize` half-completed and left the subject in
an inconsistent state (e.g. profile tombstoned but DSAR still
PROCESSING):

```sql
-- Finish the transition manually
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

Do **not** retry the HTTP endpoint — it will 404 on the already-
anonymized profile and leave the DSAR open.

## Metrics to watch

- `dsar_opened_total{kind}` — total requests opened; normal is 0-5/day.
- `dsar_transition_total{to}` — per-state flow; `FULFILLED:REJECTED`
  ratio should be > 5:1.
- `dsar_transition_error_total{reason}` — non-trivial counts here
  usually indicate the admin UI is sending bad payloads; review
  `docs/runbooks/atomic-rpc-mismatch.md` for the diagnostic pattern.
- `dsar_sla_breach_total{kind}` — any non-zero at the daily check
  is a compliance yellow light.
- `dsar_expired_total{via="cron"}` — any non-zero is a compliance
  red light — we failed to close a request within 45 days.
- `cron_runs_total{job="dsar-sla-check", status="success"}` — cron
  health signal.

## Escalation

- **P1 (flag ON + breach):** on-call → SUPER_ADMIN slack (`#legal`)
  → DPO within 2 hours.
- **P2 (flag OFF or warning):** next business day is OK, but log
  in the compliance weekly standup.
- **Backlog > 20 simultaneous:** treat as potential abuse; loop in
  security (`#security-incidents`).

## Post-incident

1. Audit `dsar_audit` for the full timeline of each missed request
   and attach the dump to the incident doc.
2. Backfill a `compliance_incident` row:
   ```sql
   insert into public.audit_logs (
     actor_user_id, actor_role, entity_type, entity_id, action, metadata_json
   ) values (
     '<actor>', 'SUPER_ADMIN', 'COMPLIANCE', '<request-id>',
     'DSAR_SLA_MISSED_CLOSED',
     jsonb_build_object('days_over', <int>, 'resolution', 'fulfilled'|'rejected'|'expired')
   );
   ```
3. If > 5 requests breached in the same window, file an ANPD
   notification per Art. 48 (data-subject-impacting failures must
   be disclosed within "reasonable time").
4. Review whether the admin notification pipeline needs a
   dead-man's-switch health check added to `/api/health/deep`.
