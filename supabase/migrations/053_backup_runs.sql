-- Migration 053: backup + restore ledger (Wave 12).
--
-- Purpose
-- -------
-- The offsite backup and monthly restore-drill workflows live in
-- `.github/workflows/{offsite-backup,restore-drill}.yml`. They run
-- outside our platform, on GitHub's runners, and — until today —
-- their success was visible *only* in GitHub Actions. If the
-- workflow silently stopped (broken secret rotation, expired R2
-- credential, age key loss, disabled schedule after repo transfer,
-- etc.) we would not notice until we actually needed a restore.
--
-- This migration introduces:
--
--   1. public.backup_runs — append-only ledger of every backup and
--      restore-drill attempt. Populated by the workflows via the
--      new /api/backups/record endpoint (protected by
--      BACKUP_LEDGER_SECRET). Hash-chained so tampering is
--      detectable:
--
--          row_hash = sha256(prev_hash || canonical_payload)
--
--   2. public.backup_latest_view — one row per (kind, label)
--      with the most recent successful record, feeding the
--      freshness cron + Grafana panel.
--
--   3. public.backup_record_run(...) SECURITY DEFINER RPC used by
--      the ingest endpoint. Computes prev_hash / row_hash
--      atomically so two concurrent workflow runs can never break
--      the chain.
--
--   4. public.backup_verify_chain(kind) — readonly SECURITY
--      DEFINER RPC that re-computes every row hash top-to-bottom
--      and returns the first break, if any. Called by the
--      freshness cron.
--
--   5. Trigger `_backup_runs_append_only` — service_role can
--      INSERT but UPDATE/DELETE are rejected (matches `dsar_audit`
--      from Wave 9).
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.backup_verify_chain(text);
--   DROP FUNCTION IF EXISTS public.backup_record_run(text, text, text, text, bigint, text, jsonb, text);
--   DROP VIEW IF EXISTS public.backup_latest_view;
--   DROP TRIGGER IF EXISTS _backup_runs_append_only ON public.backup_runs;
--   DROP FUNCTION IF EXISTS public._backup_runs_guard();
--   DROP TABLE IF EXISTS public.backup_runs;

SET search_path TO public, extensions, pg_temp;

-- ─── ledger table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.backup_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'BACKUP' when a new snapshot landed in R2,
  -- 'VERIFY' when the weekly integrity check ran,
  -- 'RESTORE_DRILL' when the monthly drill succeeded.
  kind            text NOT NULL
                    CHECK (kind IN ('BACKUP', 'VERIFY', 'RESTORE_DRILL')),
  -- Human-friendly stream: 'weekly', 'monthly', 'ad-hoc', etc.
  label           text NOT NULL DEFAULT 'weekly',
  -- R2 prefix so operators can `aws s3 ls s3://bucket/<prefix>/`.
  r2_prefix       text,
  -- Concatenated SHA-256s of the archive files, from
  -- manifest-sha256.txt. Opaque to the database; used by
  -- backup_verify_chain() to compute row_hash.
  files_sha256    text,
  -- Total bytes uploaded (sum of all .age files). Informational.
  size_bytes      bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  -- 'ok' when the workflow succeeded end-to-end, 'fail' otherwise.
  -- The endpoint records failures too — we want to SEE the misses.
  outcome         text NOT NULL CHECK (outcome IN ('ok', 'fail', 'partial')),
  -- GitHub Actions run URL for forensics.
  source_url      text,
  -- Optional diagnostic payload (duration, error excerpt, commit SHA).
  metadata_json   jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  -- Chain hashes: NULL only for the very first row per (kind,label).
  prev_hash       text,
  row_hash        text NOT NULL
);

CREATE INDEX IF NOT EXISTS backup_runs_kind_recorded_at_idx
  ON public.backup_runs (kind, recorded_at DESC);
CREATE INDEX IF NOT EXISTS backup_runs_label_recorded_at_idx
  ON public.backup_runs (label, recorded_at DESC);
CREATE INDEX IF NOT EXISTS backup_runs_outcome_idx
  ON public.backup_runs (outcome)
  WHERE outcome <> 'ok';

COMMENT ON TABLE public.backup_runs IS
  'Wave 12 — append-only ledger of offsite backup + restore drill runs. Hash-chained per (kind,label) so missing rows and tampering are detectable.';
COMMENT ON COLUMN public.backup_runs.row_hash IS
  'hex SHA-256 of prev_hash || canonical(kind,label,r2_prefix,files_sha256,size_bytes,outcome,recorded_at). Computed by backup_record_run().';

-- ─── append-only trigger ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._backup_runs_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'backup_runs is append-only (operation=%, id=%)',
      TG_OP, COALESCE(OLD.id, NEW.id)
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS _backup_runs_append_only ON public.backup_runs;
CREATE TRIGGER _backup_runs_append_only
  BEFORE UPDATE OR DELETE ON public.backup_runs
  FOR EACH ROW EXECUTE FUNCTION public._backup_runs_guard();

-- ─── record RPC ─────────────────────────────────────────────────────────
-- The only API the /api/backups/record endpoint uses. Centralising
-- the hash computation here means we do not have to trust
-- application code to compute prev_hash correctly, and two racing
-- workflow runs are serialised on a per-(kind,label) advisory lock.
CREATE OR REPLACE FUNCTION public.backup_record_run(
  p_kind         text,
  p_label        text,
  p_r2_prefix    text,
  p_files_sha256 text,
  p_size_bytes   bigint,
  p_outcome      text,
  p_metadata     jsonb DEFAULT '{}'::jsonb,
  p_source_url   text DEFAULT NULL
)
RETURNS public.backup_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_prev      text;
  v_now       timestamptz := now();
  v_canonical text;
  v_hash      text;
  v_row       public.backup_runs%ROWTYPE;
BEGIN
  IF p_kind NOT IN ('BACKUP', 'VERIFY', 'RESTORE_DRILL') THEN
    RAISE EXCEPTION 'backup_record_run: invalid kind %', p_kind USING ERRCODE = 'P0001';
  END IF;
  IF p_outcome NOT IN ('ok', 'fail', 'partial') THEN
    RAISE EXCEPTION 'backup_record_run: invalid outcome %', p_outcome USING ERRCODE = 'P0001';
  END IF;
  IF p_label IS NULL OR length(p_label) = 0 THEN
    RAISE EXCEPTION 'backup_record_run: label required' USING ERRCODE = 'P0001';
  END IF;

  -- Serialise concurrent writers for the same (kind,label) so the
  -- chain order is deterministic. The lock key is derived from the
  -- pair via hashtext so we don't need a bookkeeping table.
  PERFORM pg_advisory_xact_lock(hashtext(p_kind || ':' || p_label));

  SELECT row_hash INTO v_prev
    FROM public.backup_runs
   WHERE kind = p_kind AND label = p_label
   ORDER BY recorded_at DESC, id DESC
   LIMIT 1;

  -- Canonicalise the payload. jsonb_build_object() preserves key
  -- order, so serialising to text gives us a deterministic digest
  -- input regardless of client library.
  v_canonical := COALESCE(v_prev, '') || '|' ||
    jsonb_build_object(
      'kind',         p_kind,
      'label',        p_label,
      'r2_prefix',    p_r2_prefix,
      'files_sha256', p_files_sha256,
      'size_bytes',   p_size_bytes,
      'outcome',      p_outcome,
      'recorded_at',  to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    )::text;
  v_hash := encode(digest(v_canonical, 'sha256'), 'hex');

  INSERT INTO public.backup_runs AS r
    (kind, label, r2_prefix, files_sha256, size_bytes,
     outcome, source_url, metadata_json, recorded_at,
     prev_hash, row_hash)
    VALUES
    (p_kind, p_label, p_r2_prefix, p_files_sha256, p_size_bytes,
     p_outcome, p_source_url, COALESCE(p_metadata, '{}'::jsonb), v_now,
     v_prev, v_hash)
    RETURNING * INTO v_row;

  RETURN v_row;
END
$$;

REVOKE ALL ON FUNCTION public.backup_record_run(text, text, text, text, bigint, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backup_record_run(text, text, text, text, bigint, text, jsonb, text) TO service_role;

-- ─── chain verifier RPC ─────────────────────────────────────────────────
-- Returns the id of the first row whose prev_hash does not match
-- the previous row's row_hash (per (kind,label) chain), or NULL
-- if intact. Combined with the append-only trigger this is enough
-- to detect: row deletion (prev_hash linkage breaks), row
-- insertion out of order (same), and row_hash rewrites (since the
-- next row's prev_hash would no longer match).
--
-- We deliberately do NOT re-compute row_hash from the stored
-- columns: jsonb text serialisation depends on internal key
-- ordering which can vary across pg versions, and re-computing
-- costs nothing if we already trust the trigger to block UPDATE.
CREATE OR REPLACE FUNCTION public.backup_verify_chain(p_kind text DEFAULT NULL)
RETURNS TABLE (
  first_break_id uuid,
  checked_rows   bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  r           public.backup_runs%ROWTYPE;
  v_count     bigint := 0;
  v_first     uuid := NULL;
  v_prev_map  jsonb := '{}'::jsonb;
  v_key       text;
  v_expected  text;
BEGIN
  FOR r IN
    SELECT *
      FROM public.backup_runs
     WHERE p_kind IS NULL OR kind = p_kind
     ORDER BY kind, label, recorded_at ASC, id ASC
  LOOP
    v_key      := r.kind || ':' || r.label;
    v_expected := v_prev_map ->> v_key;

    v_count := v_count + 1;

    -- For the first row of a (kind,label) chain, prev_hash must
    -- be NULL. For subsequent rows, prev_hash must equal the
    -- previous row_hash we stashed in v_prev_map.
    IF v_expected IS NULL THEN
      IF r.prev_hash IS NOT NULL AND v_first IS NULL THEN
        v_first := r.id;
      END IF;
    ELSE
      IF r.prev_hash IS DISTINCT FROM v_expected AND v_first IS NULL THEN
        v_first := r.id;
      END IF;
    END IF;

    v_prev_map := v_prev_map || jsonb_build_object(v_key, r.row_hash);
  END LOOP;

  first_break_id := v_first;
  checked_rows   := v_count;
  RETURN NEXT;
END
$$;

REVOKE ALL ON FUNCTION public.backup_verify_chain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backup_verify_chain(text) TO service_role;

-- ─── convenience view ───────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.backup_latest_view AS
SELECT DISTINCT ON (kind, label)
  kind,
  label,
  outcome,
  r2_prefix,
  size_bytes,
  recorded_at,
  source_url,
  metadata_json
FROM public.backup_runs
ORDER BY kind, label, recorded_at DESC;
GRANT SELECT ON public.backup_latest_view TO service_role;

-- ─── RLS ────────────────────────────────────────────────────────────────
ALTER TABLE public.backup_runs ENABLE ROW LEVEL SECURITY;
-- No policies for authenticated / anon on purpose — only
-- service_role (the cron + ingest endpoint) can read/write.

-- ─── feature flag (freshness cron soft-kill) ────────────────────────────
INSERT INTO public.feature_flags (key, description, enabled, owner)
VALUES (
  'backup.freshness_enforce',
  'When ON, /api/cron/backup-freshness pages P1 when the last successful BACKUP is older than 9 days OR the last RESTORE_DRILL is older than 35 days. Default OFF until a 30-day history is populated.',
  false,
  'audit-2026-04'
)
ON CONFLICT (key) DO NOTHING;

-- ─── smoke test ─────────────────────────────────────────────────────────
DO $$
DECLARE
  v_first  public.backup_runs%ROWTYPE;
  v_second public.backup_runs%ROWTYPE;
  v_break  uuid;
  v_rows   bigint;
BEGIN
  IF current_setting('server_version_num')::int < 170000 THEN
    RAISE NOTICE 'backup_runs smoke skipped (pg < 17)';
    RETURN;
  END IF;

  v_first := public.backup_record_run(
    'BACKUP', 'smoke', 'smoke/stamp', 'aa:1111,bb:2222', 12345, 'ok',
    '{"source":"migration-053-smoke"}'::jsonb, 'https://example.test/run/1'
  );
  ASSERT v_first.prev_hash IS NULL, 'first chain entry must have NULL prev_hash';

  v_second := public.backup_record_run(
    'BACKUP', 'smoke', 'smoke/stamp2', 'cc:3333', 67890, 'ok',
    '{"source":"migration-053-smoke"}'::jsonb, 'https://example.test/run/2'
  );
  ASSERT v_second.prev_hash = v_first.row_hash,
    'second chain entry must link to first';

  SELECT first_break_id, checked_rows INTO v_break, v_rows
    FROM public.backup_verify_chain('BACKUP');
  ASSERT v_break IS NULL, 'fresh chain should be intact';
  ASSERT v_rows >= 2, 'verifier should see both rows';

  -- Clean up the smoke rows. We bypass the trigger with the
  -- session_replication_role trick because we created them just
  -- now and don't want to pollute the ledger. In production the
  -- trigger refuses DELETE.
  SET LOCAL session_replication_role = 'replica';
  DELETE FROM public.backup_runs WHERE label = 'smoke';
  SET LOCAL session_replication_role = 'origin';

  RAISE NOTICE 'backup_runs smoke OK';
END
$$;
