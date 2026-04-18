# Runbook — Backup freshness SLA breach

**Severity:** P2 (warning) escalating to **P1** when `backup.freshness_enforce = ON`.
**Owner on-call:** Platform / SRE.
**Alert source:** `/api/cron/backup-freshness` (daily 09:00 UTC) +
`backup_freshness_breach_total` / `backup_chain_break_total`
metrics.

---

## 1. What this alert means

One of three things is wrong with the disaster-recovery pipeline:

| Reason        | Meaning                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| `missing`     | No row for `(kind,label)` in `public.backup_runs`. Either the very first run, or the workflow never fires. |
| `stale`       | Newest `ok` row is older than SLA (9 d for BACKUP/weekly, 35 d for RESTORE_DRILL/monthly).                 |
| `last_failed` | Newest row has `outcome='fail'`/`partial` and no subsequent `ok` has landed.                               |
| `chain_break` | `backup_verify_chain()` found a row whose `prev_hash` does not match the prior `row_hash` — tamper or gap. |

A single `missing` or `stale` reason means **we might not be
able to restore**. Treat it as such, even when P2 — a 10-day
gap after an incident is a board-reportable event.

## 2. Business impact

- RTO/RPO targets in `docs/disaster-recovery.md` are **not met**.
- LGPD Art. 46 (data-integrity obligation) requires “adequate
  administrative measures” — missing backups are an audit red
  flag.
- Paid subscriptions have a contractual 99,5 % availability
  clause; an unrecoverable dataset turns a 15-min outage into a
  business-ending event.

Do **not** silence this alert without a written mitigation.

## 3. Triage (first 10 minutes)

1. **Confirm the reason**. Query from any psql session (service
   role):

   ```sql
   SELECT kind, label, outcome, recorded_at,
          now() - recorded_at AS age,
          r2_prefix, source_url
     FROM public.backup_latest_view
    ORDER BY kind, label;
   ```

   Then the chain:

   ```sql
   SELECT * FROM public.backup_verify_chain(NULL);
   ```

   `first_break_id IS NULL` → chain intact.

2. **Look at the GitHub workflow page**: repo → Actions →
   _Offsite Backup_ / _Restore Drill_. Sort by "Run started" desc.
   Is the schedule actually firing? (Paused repos, missing
   permissions, and "Actions disabled for forks" all silently
   stop the cron.)

3. **Inspect the last 10 runs**:

   ```sql
   SELECT id, kind, label, outcome, recorded_at,
          metadata_json->>'commit' AS commit,
          source_url
     FROM public.backup_runs
    ORDER BY recorded_at DESC
    LIMIT 10;
   ```

## 4. Ground-truth checks

| Check                          | How                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| R2 bucket reachable            | `aws --endpoint-url=https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com s3 ls s3://$R2_BUCKET/`     |
| Most recent R2 object          | `aws … s3 ls s3://$R2_BUCKET/weekly/ --recursive \| tail -5`                                    |
| AGE key still valid            | Run the "Restore Drill" workflow manually — failure in the decrypt step = rotated key mismatch. |
| Postgres major version match   | Workflows hard-code PG 17 client. `SHOW server_version;` on Supabase must be ≥ 17.              |
| Ledger ingest endpoint healthy | `curl -I $BACKUP_LEDGER_URL` → 405 (method not allowed on GET) is good. 404 / 5xx is bad.       |

## 5. Mitigation by scenario

### 5.1 Workflow schedule disabled / paused

Most common after a repo transfer or an "inactive fork" warning.
Go to repo → Settings → Actions → General → "Allow all actions";
then trigger a manual run via _workflow_dispatch_.

### 5.2 R2 credentials expired

R2 access keys are finite-lived. If `aws s3 ls` returns 403 /
InvalidAccessKeyId, rotate:

1. Cloudflare dashboard → R2 → Manage API Tokens → create new
   access key + secret.
2. Update GH secrets `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
3. Re-run the _Offsite Backup_ workflow.

### 5.3 AGE key lost

This is a **data-security emergency**. Without the private key
nobody (including us) can decrypt existing backups. Freeze:

1. Stop further backups (disable the workflow) until we decide
   whether to re-encrypt prior artefacts.
2. Generate a new keypair (`age-keygen`), publish the new public
   key in `AGE_PUBLIC_KEY`.
3. Coordinate with the founder — the private key is held
   offline. If it is truly gone, we must treat **all existing
   offsite backups as expired** and start from zero, which
   resets the RPO window. Report to DPO.

### 5.4 Ledger ingest endpoint returning 5xx

The GH workflow will still upload backups to R2; only the
platform-side ledger is stale. That means:

1. Backups are safe (verify via `aws s3 ls`).
2. The freshness cron is over-alerting.
3. Fix the endpoint (look at `lib/backup.ts::recordBackupRun`,
   likely a Supabase RPC outage) and the next workflow run will
   catch up.

### 5.5 Chain break

The `backup_runs` trigger blocks UPDATE/DELETE, so a true break
is extremely unlikely. If the chain reports one:

1. Check `SELECT count(*) FROM backup_runs` — does the count
   match the number of recent workflow runs on GitHub? A
   mismatch means rows are **missing** (direct DB access with
   `session_replication_role = replica` was used somewhere).
2. Preserve the evidence: `SELECT * FROM backup_runs ORDER BY
recorded_at` as CSV.
3. Open a P1 security incident — someone with DB admin rights
   acted outside the application. Rotate credentials.

### 5.6 Reset the freshness alarm after recovery

Once a new `ok` row lands for the affected stream the cron
auto-resolves. No manual reset is required. If PagerDuty fired,
annotate the incident with the `backup_runs.id` of the
recovery row.

## 6. Post-incident actions

- Update `docs/disaster-recovery.md` with the new RTO observed.
- If the incident involved an AGE key, schedule a key-rotation
  drill within 14 days.
- Verify the next scheduled _Restore Drill_ completes end-to-end;
  if not, file a P1 follow-up — the automated recovery promise
  is broken until drill green.

## 7. Quick reference

```sql
-- Latest state per stream:
SELECT kind, label, outcome, recorded_at, now() - recorded_at AS age
  FROM public.backup_latest_view
 ORDER BY kind, label;

-- Chain intact?
SELECT * FROM public.backup_verify_chain(NULL);

-- Failures in the last 90 days:
SELECT kind, label, outcome, recorded_at, source_url
  FROM public.backup_runs
 WHERE outcome <> 'ok'
   AND recorded_at > now() - interval '90 days'
 ORDER BY recorded_at DESC;
```

```bash
# R2 sanity (AWS CLI v2):
aws --endpoint-url=https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com \
    s3 ls s3://$R2_BUCKET/weekly/ --recursive | tail

# Force a manual run:
gh workflow run offsite-backup.yml -f label=manual-$(date +%Y%m%d)
gh workflow run restore-drill.yml
```
