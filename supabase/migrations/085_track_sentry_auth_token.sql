-- Migration 085: rastrear SENTRY_AUTH_TOKEN no manifest de rotação.
--
-- Contexto
-- --------
-- 2026-05-07: provisionamos pela primeira vez SENTRY_AUTH_TOKEN no
-- Vercel (production + preview) para que o build do Next.js faça
-- upload de source maps no Sentry. Antes desse commit o manifest
-- de secrets em `lib/secrets/manifest.ts` e na função
-- `secret_rotation_overdue()` (mig 056 + 059) não conhecia esse
-- token — nunca iria alertar sobre rotação dele.
--
-- Esse migration apenas estende a função `secret_rotation_overdue`
-- para incluir uma entrada nova no jsonb de manifest estático, e
-- semeia o genesis row em `secret_rotations` para que o inventário
-- comece a contar idade a partir do momento do deploy. O padrão é
-- idêntico ao de mig 059 (ZENVIA_WEBHOOK_SECRET).
--
-- Tier B porque a rotação é assistida:
--   1. Operador gera novo auth token em
--      https://sentry.io/settings/account/api/auth-tokens/ (mínimo
--      `project:releases`). Recomendação: Internal Integration
--      org-scoped, não user auth token, para não depender da conta
--      de uma pessoa.
--   2. Atualiza Vercel env (production + preview).
--   3. Redeploy (qualquer push faz).
--   4. Revoga o token antigo no portal Sentry.
--
-- Total de secrets no manifesto após 085: 21
-- (056=19 + 059=20 + 085=21).
--
-- Rollback
-- --------
--   Append nova migration substituindo a função pela versão sem
--   a entrada SENTRY_AUTH_TOKEN. Não há lógica destrutiva aqui.

SET search_path TO public, extensions, pg_temp;

-- ─── overdue RPC — re-defined with 21-entry manifest ───────────────
-- Body idêntico ao de 059 exceto por uma nova entrada Tier B para
-- SENTRY_AUTH_TOKEN. CREATE OR REPLACE faz swap atômico; chamadas
-- in-flight contra o body antigo terminam antes do novo entrar.
CREATE OR REPLACE FUNCTION public.secret_rotation_overdue(
  p_max_age_days int DEFAULT 90
)
RETURNS TABLE (
  secret_name text,
  tier        text,
  provider    text,
  age_days    int,
  last_rotated_at timestamptz,
  status      text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_manifest CONSTANT jsonb := jsonb_build_array(
    -- Tier A — auto-rotate
    jsonb_build_object('n','CRON_SECRET',          't','A','p','vercel-env'),
    jsonb_build_object('n','METRICS_SECRET',       't','A','p','vercel-env'),
    jsonb_build_object('n','BACKUP_LEDGER_SECRET', 't','A','p','vercel-env'),
    -- Tier B — assisted
    jsonb_build_object('n','RESEND_API_KEY',           't','B','p','resend-portal'),
    jsonb_build_object('n','ASAAS_API_KEY',            't','B','p','asaas-portal'),
    jsonb_build_object('n','ASAAS_WEBHOOK_SECRET',     't','B','p','asaas-portal'),
    jsonb_build_object('n','ZENVIA_API_TOKEN',         't','B','p','zenvia-portal'),
    jsonb_build_object('n','ZENVIA_WEBHOOK_SECRET',    't','B','p','zenvia-portal'),
    jsonb_build_object('n','INNGEST_EVENT_KEY',        't','B','p','inngest-portal'),
    jsonb_build_object('n','INNGEST_SIGNING_KEY',      't','B','p','inngest-portal'),
    jsonb_build_object('n','CLICKSIGN_ACCESS_TOKEN',   't','B','p','clicksign-portal'),
    jsonb_build_object('n','CLICKSIGN_WEBHOOK_SECRET', 't','B','p','clicksign-portal'),
    jsonb_build_object('n','NUVEM_FISCAL_CLIENT_SECRET','t','B','p','nuvem-fiscal-portal'),
    jsonb_build_object('n','VERCEL_TOKEN',             't','B','p','vercel-env'),
    jsonb_build_object('n','TURNSTILE_SECRET_KEY',     't','B','p','cloudflare-api'),
    jsonb_build_object('n','SENTRY_AUTH_TOKEN',        't','B','p','sentry-portal'),
    -- Tier C — manual only (high blast radius)
    jsonb_build_object('n','SUPABASE_DB_PASSWORD',     't','C','p','supabase-mgmt'),
    jsonb_build_object('n','SUPABASE_JWT_SECRET',      't','C','p','supabase-mgmt'),
    jsonb_build_object('n','FIREBASE_PRIVATE_KEY',     't','C','p','firebase-console'),
    jsonb_build_object('n','OPENAI_API_KEY',           't','C','p','openai-portal'),
    jsonb_build_object('n','ENCRYPTION_KEY',           't','C','p','vercel-env')
  );
  v_entry jsonb;
  v_name  text;
  v_tier  text;
  v_prov  text;
  v_inv   record;
BEGIN
  FOR v_entry IN SELECT jsonb_array_elements(v_manifest) LOOP
    v_name := v_entry->>'n';
    v_tier := v_entry->>'t';
    v_prov := v_entry->>'p';

    SELECT i.age_days, i.last_rotated_at INTO v_inv
      FROM public.secret_inventory i
     WHERE i.secret_name = v_name;

    IF NOT FOUND THEN
      secret_name := v_name;
      tier        := v_tier;
      provider    := v_prov;
      age_days    := NULL;
      last_rotated_at := NULL;
      status      := 'never-rotated';
      RETURN NEXT;
    ELSIF v_inv.age_days >= p_max_age_days THEN
      secret_name := v_name;
      tier        := v_tier;
      provider    := v_prov;
      age_days    := v_inv.age_days;
      last_rotated_at := v_inv.last_rotated_at;
      status      := 'overdue';
      RETURN NEXT;
    END IF;
  END LOOP;
END
$$;

REVOKE ALL ON FUNCTION public.secret_rotation_overdue(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.secret_rotation_overdue(int) TO service_role;

-- ─── genesis seed — SENTRY_AUTH_TOKEN only ─────────────────────────
-- Provisionado em 2026-05-07. Tratamos a rotação baseline como "agora"
-- para dar ao operador o fuse padrão de 90 dias antes de qualquer
-- alerta — consistente com mig 056/059. Idempotente: só insere se
-- não houver linha de rotação bem-sucedida ainda.
DO $$
DECLARE
  v_existing int;
BEGIN
  SELECT COUNT(*) INTO v_existing
    FROM public.secret_rotations
   WHERE secret_name = 'SENTRY_AUTH_TOKEN' AND success = true;

  IF v_existing = 0 THEN
    PERFORM public.secret_rotation_record(
      'SENTRY_AUTH_TOKEN', 'B', 'sentry-portal',
      'genesis', 'migration:085', true, NULL,
      jsonb_build_object(
        'seeded_by', 'migration_085',
        'note', 'baseline at wave pre-launch S1 — Sentry plugin source map upload + release tracking',
        'token_kind', 'sntryu_user_auth_token',
        'follow_up', 'migrar para Internal Integration org-scoped quando virar comercial'
      )
    );
  END IF;
END
$$;

-- ─── smoke test ────────────────────────────────────────────────────
-- Espelha mig 059: prova que (a) RPC retorna o conjunto esperado,
-- (b) genesis existe, (c) chain ainda intacta após o append.
DO $$
DECLARE
  v_rpc_count    int;
  v_inv_count    int;
  v_overdue      int;
  v_chain_breaks int;
BEGIN
  SELECT COUNT(*) INTO v_rpc_count
    FROM public.secret_rotation_overdue(36500);  -- ~100 anos
  IF v_rpc_count > 0 THEN
    RAISE EXCEPTION 'SMOKE FAIL 085: % secrets overdue at 100y threshold (should be 0)', v_rpc_count;
  END IF;

  SELECT COUNT(*) INTO v_inv_count FROM public.secret_inventory;
  IF v_inv_count < 21 THEN
    RAISE EXCEPTION 'SMOKE FAIL 085: secret_inventory has only % rows (expected ≥ 21 after genesis)', v_inv_count;
  END IF;

  SELECT COUNT(*) INTO v_overdue FROM public.secret_rotation_overdue(90);
  IF v_overdue > 0 THEN
    RAISE EXCEPTION 'SMOKE FAIL 085: % secrets overdue at 90d window immediately after seed', v_overdue;
  END IF;

  WITH ordered AS (
    SELECT row_hash, prev_hash,
           LAG(row_hash) OVER (ORDER BY seq) AS expected_prev
      FROM public.secret_rotations
  )
  SELECT COUNT(*) INTO v_chain_breaks
    FROM ordered
   WHERE prev_hash IS DISTINCT FROM expected_prev
     AND expected_prev IS NOT NULL;
  IF v_chain_breaks > 0 THEN
    RAISE EXCEPTION 'SMOKE FAIL 085: % hash chain break(s) after genesis of SENTRY_AUTH_TOKEN', v_chain_breaks;
  END IF;

  RAISE NOTICE 'Migration 085 smoke OK — inventory=%, overdue=%, chain_breaks=%',
    v_inv_count, v_overdue, v_chain_breaks;
END
$$;
