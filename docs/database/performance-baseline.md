# Database Performance Baseline

| Field         | Value                                           |
| ------------- | ----------------------------------------------- |
| Owner         | Engineering / DBA                               |
| Last reviewed | 2026-04-18                                      |
| Engine        | Supabase Postgres 16 (managed)                  |
| Region        | `gru1` (São Paulo)                              |
| Migrations    | 56 versioned files under `supabase/migrations/` |

This is the canonical reference for "what good looks like" on the
database. It documents the baseline numbers, the indexes that hold the
shape together, and the playbook for diagnosing a regression.

## 1. Workload shape

Reads dominate by ~10:1 — the platform is a marketplace. The five
busiest tables (by row count and by query volume) are:

| Table         | Rows (prod, 2026-04) | Read pattern              | Write pattern                |
| ------------- | -------------------- | ------------------------- | ---------------------------- |
| `audit_log`   | growing fast         | point-in-time, range scan | append-only                  |
| `cron_runs`   | bounded retention    | tail scan                 | append-only                  |
| `orders`      | growing              | by tenant + status        | low-frequency, transactional |
| `products`    | bounded, slow growth | by category + active flag | rare                         |
| `server_logs` | bounded retention    | range by hour             | append-only                  |

Bounded retention is enforced by the `enforce-retention` cron
(`/api/cron/enforce-retention`, monthly) and by `purge-server-logs`,
`purge-revoked-tokens`, `purge-drafts` (weekly/daily).

## 2. Index strategy (current)

We intentionally do NOT auto-create indexes for every column. Each one
is paired with a query that the index actually serves. Adding an
index that nobody hits costs us write latency for free.

### 2.1 Hot indexes (queried > 100 times/day)

| Table                  | Index                                           | Serves                       |
| ---------------------- | ----------------------------------------------- | ---------------------------- |
| `orders`               | `(buyer_clinic_id, status, created_at DESC)`    | clinic dashboard, order list |
| `orders`               | `(seller_pharmacy_id, status, created_at DESC)` | pharmacy fulfilment list     |
| `order_status_history` | `(order_id, changed_at DESC)`                   | order detail timeline        |
| `audit_log`            | `(actor_id, created_at DESC)`                   | profile activity tab         |
| `audit_log`            | `(entity_type, entity_id, created_at DESC)`     | per-entity audit drill-down  |
| `products`             | `(category_id, is_active, name)`                | catalog browse               |
| `cron_runs`            | `(job_name, started_at DESC)`                   | health-check freshness       |

### 2.2 RLS-supporting indexes

Postgres RLS evaluates the policy as a `WHERE` clause on every read.
If the policy references a column that has no index, every query gets
a sequential scan. We mirror every RLS predicate with an index:

| Table                  | Predicate column(s)      | Index           |
| ---------------------- | ------------------------ | --------------- |
| `clinic_users`         | `(user_id, clinic_id)`   | unique compound |
| `pharmacy_users`       | `(user_id, pharmacy_id)` | unique compound |
| `prescription_uploads` | `(uploader_user_id)`     | btree           |
| `support_tickets`      | `(opener_id, status)`    | btree compound  |

### 2.3 Anti-indexes (deliberately omitted)

- `audit_log(actor_email)` — emails are encrypted; index would be
  meaningless. Search by `actor_id`.
- `orders(notes)` — free-text. Use the `pg_trgm` index already on
  `products.name`; we do not search order notes today.

## 3. Query latency baseline

Measured 2026-04-18 against production. Each row is a representative
query that the platform issues many times per minute. Numbers include
RLS evaluation, parsing, planning, execution.

| Query                                     | p50   | p95    | p99    | Cap (alert) |
| ----------------------------------------- | ----- | ------ | ------ | ----------- |
| `GET /api/health/ready` (single SELECT 1) | 12 ms | 30 ms  | 60 ms  | 200 ms      |
| `SELECT … FROM products WHERE category=…` | 18 ms | 70 ms  | 180 ms | 500 ms      |
| `SELECT … FROM orders WHERE buyer=…`      | 22 ms | 95 ms  | 240 ms | 600 ms      |
| `INSERT INTO orders` (atomic RPC)         | 45 ms | 180 ms | 420 ms | 1 000 ms    |
| `SELECT … FROM audit_log WHERE entity=…`  | 28 ms | 110 ms | 290 ms | 800 ms      |

### 3.1 How to recompute

Run `EXPLAIN (ANALYZE, BUFFERS)` against a representative parameter
set with the connection bound to the **anon** role (so RLS is evaluated):

```sql
SET ROLE anon;
SET request.jwt.claims TO
  '{"sub": "<some clinic user uuid>", "role": "authenticated"}';

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, status, created_at
FROM orders
WHERE buyer_clinic_id = '<clinic uuid>'
ORDER BY created_at DESC
LIMIT 50;
```

Watch for: `Seq Scan on orders` (means the index is missing or unused),
or `Filter: ((true OR false))` — Postgres found the RLS policy too
expensive to push down.

## 4. Slow-query review process

Supabase ships `pg_stat_statements`. The review playbook:

1. Weekly, dump the top 20 by `total_exec_time`:

   ```sql
   SELECT
     substring(query, 1, 100) AS q,
     calls,
     round(total_exec_time::numeric, 1) AS total_ms,
     round(mean_exec_time::numeric, 1)  AS mean_ms
   FROM pg_stat_statements
   ORDER BY total_exec_time DESC
   LIMIT 20;
   ```

2. For any query whose `mean_ms` is above the row's "Cap" in the
   table above, open an issue and assign to the platform engineer
   on rotation.

3. The fix is one of:
   - Missing index: add a migration, ratchet the baseline.
   - RLS predicate not indexed: add the index, prove via EXPLAIN.
   - Wrong query shape: rewrite the call site, add a unit test that
     binds it to the new shape.
   - Genuine cardinality blow-up: add a paging cap or a precomputed
     summary table; schedule a backfill cron if needed.

4. After every fix, append a row to the change log at the bottom of
   this document so the rationale outlives memory.

## 5. Backups & recovery

- **Daily logical backup** to S3-compatible offsite via
  `.github/workflows/offsite-backup.yml`. Encrypted with GPG; key
  managed in `BACKUP_GPG_PUBKEY`.
- **Weekly restore drill** via `.github/workflows/restore-drill.yml`.
  Restores the latest backup into an ephemeral postgres, runs the
  verification suite, reports the result to `cron_runs` so the
  public status page reflects backup health.
- **PITR**: enabled on the Supabase project (managed, retained 7 d
  on the current plan). Promotion path: extend retention to 30 d
  when a customer SLA requires it.
- **Restore evidence**: every drill writes a row to `backup_runs` (see
  `supabase/migrations/053_backup_runs.sql`). The latest drill must be
  < 8 days old for `/api/health/deep` to remain green.

## 6. Schema drift detection

`.github/workflows/schema-drift.yml` runs:

- on every push touching `supabase/migrations/**`
- on every PR touching `supabase/migrations/**`
- daily at 04:30 UTC (catches out-of-band manual changes)

Layer 1 always runs (parses every migration into an ephemeral
postgres). Layer 2 (production diff) runs only when
`vars.HAS_PROD_DB_URL == 'true'` AND `secrets.SUPABASE_DB_URL` is set
— that's the secret-protected, opt-in path. Drift is a **build
failure**.

## 7. Promotion path

Items deliberately out of scope today, with revisit triggers:

- **Read replica** — when read p95 exceeds 250 ms sustained for two
  weeks and tuning an index isn't enough.
- **Connection pooler tuning** — when total connections exceed 70 %
  of the project's pool ceiling for 1 h sustained.
- **Logical replication for analytics** — when product asks for
  ad-hoc analytics queries that we don't want competing with OLTP.

## 8. Change log

| Date       | Change                                                                   |
| ---------- | ------------------------------------------------------------------------ |
| 2026-04-18 | Initial publication. Workload, index strategy, baseline, drift workflow. |
