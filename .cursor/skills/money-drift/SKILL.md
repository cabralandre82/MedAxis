---
name: money-drift
description: Reconciles a `money_drift_view` non-empty alert — identifies which row(s) have `*_cents` ≠ `round(numeric * 100)`, restores trigger if missing, mitigates user impact via the `money.cents_read` kill-switch. Use when the user says "money drift", "cents != numeric", "reconciliation failed", "divergência em centavos", "alerta de drift financeiro", or when `/api/cron/money-reconcile` fires. P2 by default; P1 if drift exists on `transfers.status='COMPLETED'` or `consultant_transfers.status='COMPLETED'`.
---

# Money-drift reconciliation (financial integrity)

The reconciliation cron `/api/cron/money-reconcile` (every 30 min) queries
`public.money_drift_view`. A non-empty row means `*_cents` disagrees with
its twin `numeric(x,2)` column by > 1 cent — one of the 4 root causes in
the runbook.

Full runbook: `docs/runbooks/money-drift.md`.
Migration: `supabase/migrations/050_money_cents.sql`.
Cron: `app/api/cron/money-reconcile/route.ts`.

## Workflow

```
Money-drift triage:
- [ ] 1. Alert confirmed by manual cron invocation
- [ ] 2. Kill-switch flag `money.cents_read` state assessed
- [ ] 3. Drift sample pulled from money_drift_view
- [ ] 4. Root cause classified (missing trigger / helper / migration / rogue write)
- [ ] 5. Mitigation applied (row fix / flag OFF / trigger reinstall)
- [ ] 6. Re-run cron, driftCount = 0
- [ ] 7. If ANY completed transfer had drift: finance + legal notified
- [ ] 8. Post-mortem with regression test
```

## Step 1 — confirm the alert is still real

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  https://app.clinipharma.com.br/api/cron/money-reconcile | jq .
```

If `driftCount == 0`, a concurrent writer or re-enabled trigger
auto-healed. Acknowledge alert + proceed to post-mortem only.

## Step 2 — check kill-switch state

```sql
select key, enabled from public.feature_flags where key = 'money.cents_read';
```

If `enabled = true` AND drift is widespread → **flip OFF first** (users stop seeing bad totals, then investigate):

```sql
update public.feature_flags set enabled = false, updated_at = now()
 where key = 'money.cents_read';
select public.invalidate_feature_flag_cache('money.cents_read');
```

No data is lost; reads fall back to `numeric` (pre-Wave-8 behaviour).

## Step 3 — pull the drift sample

```sql
select table_name, row_id, field, numeric_value, cents_value, drift_cents
  from public.money_drift_view
 order by drift_cents desc
 limit 100;
```

Columns:

- `drift_cents`: absolute difference in cents (> 1 = alertable)
- `numeric_value`: authoritative value
- `cents_value`: shadow that diverged

## Step 4 — classify the pattern

| Pattern                            | Root cause                                            | Mitigation               |
| ---------------------------------- | ----------------------------------------------------- | ------------------------ |
| 1 row, same table, drift ≤ 2 cents | One-off bad write (manual UPDATE / script)            | 5a single-row fix        |
| > 1 row, same table                | Trigger dropped or disabled                           | 5c trigger reinstall     |
| > 1 row, multiple tables           | `_money_to_cents` helper redefined OR bad migration   | 5d rollback + escalation |
| drift_cents in millions            | Unit confusion (someone wrote numeric into `*_cents`) | Case-by-case, spot-check |

## Step 5 — mitigations

### 5a. Single-row fix (safest)

```sql
update public.<table>
   set <field>_cents = public._money_to_cents(<field>)
 where id = '<row_id>';
```

BEFORE trigger re-validates on UPDATE → safe and idempotent.
Verify:

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  https://app.clinipharma.com.br/api/cron/money-reconcile | jq .result.driftCount
```

Should print `0`.

### 5b. Kill-switch (already covered in step 2)

### 5c. Trigger reinstall

Check trigger presence:

```sql
select tgname, tgrelid::regclass as table_name, tgenabled
  from pg_trigger
 where tgname like 'trg_money_sync%'
   and not tgisinternal
 order by tgname;
```

Should return 7 rows, all `tgenabled = 'O'`. Any `'D'` → re-enable:

```sql
alter table public.<table_name> enable trigger trg_money_sync_<table_name>;
```

If missing entirely → re-run the trigger creation from migration `050_money_cents.sql` sections 4. The migration uses `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` so re-running a single block is safe.

### 5d. Helper function check (rare)

```sql
select pg_get_functiondef(oid) from pg_proc
 where proname = '_money_to_cents'
   and pronamespace = 'public'::regnamespace;
```

Expected body:

```sql
select case
  when v is null then null
  else (round(v * 100))::bigint
end
```

If different → restore from migration 050. Do NOT edit in-place without a PR.

## Step 6 — payout-integrity escalation (P1 pivot)

If drift exists on rows that already paid out:

```sql
select t.id, t.net_amount, t.net_amount_cents,
       t.net_amount_cents - public._money_to_cents(t.net_amount) as drift_cents,
       t.status, t.completed_at
  from public.transfers t
 where t.status = 'COMPLETED'
   and t.net_amount_cents != public._money_to_cents(t.net_amount);

-- Same for consultant_transfers
select c.id, c.gross_amount, c.gross_amount_cents,
       c.gross_amount_cents - public._money_to_cents(c.gross_amount) as drift_cents
  from public.consultant_transfers c
 where c.status = 'COMPLETED'
   and c.gross_amount_cents != public._money_to_cents(c.gross_amount);
```

Any row returned → **upgrade to P1**, page finance + legal lead. Freeze new transfers:

```sql
select set_config('clinipharma.transfers_frozen', 'true', false);
```

If the kill-switch isn't yet installed (wave-N pending), fall back to pausing the Vercel cron for `stale-orders` and `coupon-expiry-alerts`.

## Step 7 — verify clean state

```bash
# Should return driftCount: 0
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  https://app.clinipharma.com.br/api/cron/money-reconcile | jq
```

Watch the Prometheus counter for the next 30 min:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  'https://app.clinipharma.com.br/api/health/deep?format=prometheus' \
  | rg '^money_'
```

`money_drift_total` should trend to 0.

## Step 8 — post-mortem requirements

Required artefacts:

- Incident doc in `docs/incidents/YYYY-MM-DD-money-drift-<slug>.md`
- If trigger was the cause → assertion in `/api/health/deep` (next drift caught by probe, not the 30-min cron)
- If migration was the cause → regression test in `tests/unit/migrations/` asserting `abs(cents - round(numeric * 100)) <= 1` across all 7 tables

## Anti-patterns

- **Never manually `UPDATE` a `*_cents` column** outside the single-row fix pattern — defeats the trigger's safety net.
- **Never set `enabled = true` on `money.cents_read`** while drift > 0 — propagates bad totals to users.
- **Never silence the alert** — `money_drift_total > 0` is the smoke detector.
- **Never skip the COMPLETED transfer check** — drift on paid-out rows is a legal exposure, not a "data issue".
- **Never edit `_money_to_cents()` without a PR** — production helper function changes go through review.

## Related

- Full runbook: `docs/runbooks/money-drift.md`
- Helper lib: `lib/money.ts`, `lib/money-format.ts`
- Database conventions: `.cursor/rules/database.mdc` §"Dinheiro"
- Migration (authoritative): `supabase/migrations/050_money_cents.sql`
