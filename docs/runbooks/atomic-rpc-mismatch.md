# Runbook — Atomic RPC mismatch (P2)

## Alert pattern

A production incident originating from this runbook usually surfaces as
one of the following:

- Spike of `atomic_rpc_total{outcome="exception"}` or
  `atomic_rpc_total{outcome="rpc_unavailable"}` in the metrics
  endpoint (`/api/health/deep?format=prometheus`).
- Divergence in the `orders`, `coupons`, or `payments` tables where the
  numbers produced by the RPC path disagree with the legacy path
  (for example, a payment that is `CONFIRMED` in `payments` but whose
  `orders.payment_status` is still `PENDING`).
- A support ticket claiming that a coupon was used twice, that a
  payment was confirmed twice, or that a payment appears confirmed in
  the UI but produced no commission / transfer / consultant row.

## Impact

The three flows protected by Wave 7 are:

| Flow    | Legacy service                         | Atomic RPC                      | Flag                      |
| ------- | -------------------------------------- | ------------------------------- | ------------------------- |
| Order   | `services/orders.ts::createOrder`      | `public.create_order_atomic`    | `orders.atomic_rpc`       |
| Coupon  | `services/coupons.ts::activateCoupon`  | `public.apply_coupon_atomic`    | `coupons.atomic_rpc`      |
| Payment | `services/payments.ts::confirmPayment` | `public.confirm_payment_atomic` | `payments.atomic_confirm` |

When the flag is enabled and the RPC has a bug, operations that
previously succeeded multi-step may now fail atomically (better), but
any difference between legacy and RPC behaviour is an incident.

When the flag is disabled, the RPC is never called, so a "mismatch"
alert from this runbook with the flag off means the RPC self-test is
failing and needs attention before the flag is turned back on.

## Decision tree

### 1. Confirm which flow is affected

Look at the surge metric labels:

```
atomic_rpc_total{flow="coupon",outcome="exception"}
atomic_rpc_total{flow="payment",outcome="already_processed"}
atomic_rpc_total{flow="order",outcome="rpc_unavailable"}
```

`outcome` values: `success`, `rpc_unavailable`, `exception`, and the
reason strings raised by the RPC (`already_activated`, `stale_version`,
`already_processed`, `empty_items`, `missing_pharmacy`, etc.).

`flow` is one of `order`, `coupon`, `payment`.

### 2. Is the RPC reachable at all?

Run against the affected environment:

```sql
select proname, pronargs from pg_proc p
 join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and proname in (
     'apply_coupon_atomic',
     'confirm_payment_atomic',
     'create_order_atomic'
   );
```

Expected output: three rows. If fewer, migration 049 has been rolled
back or was never applied to this environment — re-apply it
(`supabase/migrations/049_atomic_rpcs.sql`) before changing any flag.

### 3. Is the flag state what you expect?

```sql
select key, enabled, rollout_percent, target_user_ids, target_clinic_ids
  from public.feature_flags
 where key in ('orders.atomic_rpc','coupons.atomic_rpc','payments.atomic_confirm');
```

If `enabled = true` and the RPC is producing errors, **flip the flag
off first** (kill-switch) via the admin UI or:

```sql
update public.feature_flags set enabled = false
 where key = '<key from the table above>';
```

Flipping the flag off routes all subsequent traffic to the legacy
multi-step path. The wrapper counter
`atomic_rpc_fallback_total{reason="flag_off"}` should start climbing
immediately once the cache TTL expires (≤ 30 s).

### 4. Reproduce the mismatch deterministically

For `coupon` flow:

```sql
-- Make sure the coupon is in the right starting state.
select id, code, active, activated_at
  from public.coupons where code = '<CODE>';

-- Call the RPC directly as service_role.
select public.apply_coupon_atomic('<CODE>', '<user-uuid>');
```

Expected: JSONB with the updated row on first call; `P0001` with
`already_activated` on a second call within the same transaction.

For `payment` flow:

```sql
select id, status, lock_version from public.payments where id = '<PID>';

select public.confirm_payment_atomic('<PID>', jsonb_build_object(
  'payment_method', 'PIX',
  'confirmed_by_user_id', '<admin-uuid>',
  'expected_lock_version', 0   -- 0 disables the optimistic guard
));
```

Expected on duplicate: `P0001` with `already_processed`.

For `order` flow:

```sql
select public.create_order_atomic(jsonb_build_object(
  'buyer_type', 'CLINIC',
  'clinic_id', '<clinic>',
  'doctor_id', '<doctor>',
  'pharmacy_id', '<pharm>',
  'created_by_user_id', '<user>',
  'estimated_total', 100,
  'items', jsonb_build_array(
    jsonb_build_object(
      'product_id','<product>',
      'quantity',1,
      'unit_price',100,
      'total_price',100
    )
  )
));
```

### 5. Compare with legacy behaviour

When the flag is off, execute the same user action via the UI and
compare what lands in the database. The invariants are:

- Coupon path: exactly one row changes from `activated_at IS NULL`
  → `activated_at = <timestamp>` regardless of how many times the
  action fires concurrently.
- Payment path: `payments.status = 'CONFIRMED'` exactly once; matching
  rows in `commissions`, `transfers`, `consultant_commissions` (if
  the clinic has a consultant); `orders.payment_status = 'CONFIRMED'`
  and `orders.order_status = 'COMMISSION_CALCULATED'`.
- Order path: exactly one row in `orders`, matching N rows in
  `order_items`, one row in `order_status_history`, and
  `orders.total_price` equals the sum of `order_items.total_price`
  after the trigger recomputes it.

If the RPC path produces a different invariant state than legacy, file
a `W7-drift` issue with the reproduction and **keep the flag off** for
that environment until the RPC is fixed or rolled back.

## Mitigations

1. **Immediate kill-switch**: set the affected flag `enabled = false`.
2. **Per-tenant quarantine**: leave the flag on globally but remove
   the offending clinic / pharmacy / user from `target_*_ids`.
3. **Rollback the RPC** (last resort):
   ```sql
   drop function public.apply_coupon_atomic(text, uuid);
   drop function public.confirm_payment_atomic(uuid, jsonb);
   drop function public.create_order_atomic(jsonb);
   alter table public.orders   drop column lock_version;
   alter table public.payments drop column lock_version;
   ```
   Only do this if the code has been redeployed with the flag fields
   forcibly returning false at the call site — otherwise the wrapper
   will keep hitting `rpc_unavailable` until the deploy completes.

## Metrics to watch during mitigation

- `atomic_rpc_total{flow,outcome}` — any `outcome` other than `success`
  or the known business reasons (`already_activated`,
  `already_processed`, `not_found_or_forbidden`, `stale_version`) is
  a signal of infrastructure drift.
- `atomic_rpc_duration_ms{flow}` — p95 should be < 300 ms. Values
  above 1 s suggest PostgREST is queueing or the connection pool is
  saturated.
- `atomic_rpc_fallback_total{flow,reason}` — a sudden climb with
  `reason="rpc_unavailable"` while the flag is on means the RPC path
  is degraded but the wrapper is correctly failing-over to legacy.

## Post-incident

1. Document the reproduction steps and the root cause in
   `docs/execution-log.md` under a new W7 follow-up section.
2. Add a regression test under `tests/unit/lib/services-atomic-*.test.ts`
   that mocks the specific RPC-error reason that triggered the
   incident, asserting the wrapper propagates the right user-facing
   message.
3. If the issue was a schema mismatch, add a smoke block to the
   relevant migration (`DO $smoke$ ... $smoke$;`).
4. Re-enable the flag gradually: start with `rollout_percent = 5` for
   24 h before ramping back up.

## Kill-switches & feature flags

Three flags control the atomic-RPC path. All default OFF — the legacy multi-step client flow runs until each flag is explicitly flipped ON after a full-bake validation.

| `feature_flags.key`         | State default | Effect when ON                                                                           | Effect when OFF                             |
| --------------------------- | ------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------- |
| `'orders.atomic_rpc'`       | OFF           | `services/orders.ts::createOrder` routes through `public.create_order_atomic()`.         | Legacy multi-step client flow (pre-Wave 7). |
| `'coupons.atomic_rpc'`      | OFF           | `services/coupons.ts::activateCoupon` routes through `public.apply_coupon_atomic()`.     | Legacy multi-step client flow (pre-Wave 7). |
| `'payments.atomic_confirm'` | OFF           | `services/payments.ts::confirmPayment` routes through `public.confirm_payment_atomic()`. | Legacy multi-step client flow (pre-Wave 7). |

**Kill-switch during an incident:**

```sql
UPDATE public.feature_flags SET enabled = false, updated_at = now()
 WHERE key = 'coupons.atomic_rpc';

UPDATE public.feature_flags SET enabled = false, updated_at = now()
 WHERE key = 'payments.atomic_confirm';

UPDATE public.feature_flags SET enabled = false, updated_at = now()
 WHERE key = 'orders.atomic_rpc';
```

Cache TTL is ≤ 30 s, so fallback to the legacy path is immediate. The wrapper emits `atomic_rpc_fallback_total{reason="flag_off"}` per request routed to legacy.

**When to re-enable:** only after the RPC's regression is fixed, a test is added, and a `rollout_percent = 5` ramp shows no divergence vs. legacy for 24 h.

## See also

- `docs/runbooks/README.md` — runbook index
- `supabase/migrations/049_atomic_rpcs.sql` — the RPC definitions
- `lib/services/atomic.server.ts` — the TS wrapper
- `lib/features/index.ts` — feature-flag evaluation order
