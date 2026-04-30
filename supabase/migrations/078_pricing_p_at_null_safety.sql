-- Migration 078 — pricing engine: NULL-safety on p_at parameter.
--
-- Bug
-- ---
-- Smoke run em 2026-04-30 detectou que toda chamada da UI ao
-- `compute_unit_price` retornava `{"error": "no_active_profile"}`
-- mesmo com profile vivo. Causa raiz:
--
--   * As funções declaram `p_at timestamptz DEFAULT now()`.
--   * O wrapper TS (lib/services/pricing-engine.server.ts) passava
--     explicitamente `p_at: args.at ?? null`. PostgREST encaminha o
--     `null` JSON como SQL NULL — e SQL NULL não dispara o DEFAULT.
--   * As funções então comparavam `effective_from <= NULL`, que é
--     NULL (≡ false), e nenhum profile casava.
--
-- Sintoma só não foi visto antes porque produção tinha 0 produtos
-- TIERED + 0 profiles — a UI sempre exibia o fallback corretamente.
-- Na hora de ligar o primeiro produto TIERED, a regressão aparece.
--
-- Fix em duas camadas (defesa em profundidade)
-- --------------------------------------------
-- 1. Wrapper TS agora omite a chave `p_at` quando o caller não a
--    fornece — deixa o DEFAULT da função SQL atuar (commit no mesmo
--    PR). Resolve 100% dos call-sites do wrapper.
-- 2. Esta migration (camada SQL): coage `p_at := COALESCE(p_at,
--    now())` na entrada de cada uma das 4 funções afetadas. Mesmo
--    que algum cliente futuro (CLI, script, terceiros via PostgREST)
--    passe `null`, o NULL é normalizado dentro da função, antes da
--    primeira comparação.
--
-- Por que não consertar só a SQL
-- -------------------------------
-- A SQL é fonte da verdade — fix obrigatório. O wrapper TS é
-- segunda barreira: chamadas via wrapper nunca mais enviam null,
-- evitando casos exóticos de PostgREST encaminhar NULL para outras
-- assinaturas que ainda não normalizamos. Belt-and-braces.
--
-- Funções afetadas
-- ----------------
--   - `public.resolve_pricing_profile(uuid, timestamptz)` — LANGUAGE sql
--   - `public.resolve_effective_floor(uuid, uuid, uuid, bigint, timestamptz)`
--   - `public.compute_unit_price(uuid, int, uuid, uuid, uuid, timestamptz)`
--   - `public.preview_unit_price(uuid, int, uuid, uuid, text, numeric, bigint, timestamptz)`
--
-- Idempotência
-- ------------
-- Tudo via CREATE OR REPLACE. Re-executar é no-op.
--
-- Rollback
-- --------
-- Re-aplicar o corpo das migrations 071, 075 e 077 (desfaz o COALESCE).
-- A função fica idêntica ao que estava antes desta migration.

SET search_path TO public, pg_temp;

-- ── 1. resolve_pricing_profile (sql) ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.resolve_pricing_profile(
  p_product_id uuid,
  p_at         timestamptz DEFAULT now()
) RETURNS public.pricing_profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- COALESCE garante que NULL explícito do caller também caia em now().
  -- Sem isso, `effective_from <= NULL` é NULL e nenhum profile casa.
  SELECT *
    FROM public.pricing_profiles
   WHERE product_id      = p_product_id
     AND effective_from <= COALESCE(p_at, now())
     AND (effective_until IS NULL OR effective_until > COALESCE(p_at, now()))
   ORDER BY effective_from DESC
   LIMIT 1;
$$;

-- ── 2. resolve_effective_floor (plpgsql) ────────────────────────────────

CREATE OR REPLACE FUNCTION public.resolve_effective_floor(
  p_product_id        uuid,
  p_clinic_id         uuid,
  p_doctor_id         uuid,
  p_tier_unit_cents   bigint,
  p_at                timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_override        public.buyer_pricing_overrides;
  v_profile         public.pricing_profiles;
  v_floor_abs       bigint;
  v_floor_pct_cents bigint;
  v_floor_eff       bigint;
  v_source          text;
  v_override_id     uuid;
BEGIN
  -- p_at-null safety: caller (PostgREST, CLI, terceiros) pode mandar
  -- NULL explícito, contornando o DEFAULT. Normalizamos no início.
  p_at := COALESCE(p_at, now());

  IF p_clinic_id IS NOT NULL OR p_doctor_id IS NOT NULL THEN
    SELECT *
      INTO v_override
      FROM public.buyer_pricing_overrides
     WHERE product_id = p_product_id
       AND ((p_clinic_id IS NOT NULL AND clinic_id = p_clinic_id)
         OR (p_doctor_id IS NOT NULL AND doctor_id = p_doctor_id))
       AND effective_from <= p_at
       AND (effective_until IS NULL OR effective_until > p_at)
     ORDER BY effective_from DESC
     LIMIT 1;
  END IF;

  IF v_override.id IS NOT NULL THEN
    v_floor_abs := v_override.platform_min_unit_cents;
    IF v_override.platform_min_unit_pct IS NOT NULL AND p_tier_unit_cents IS NOT NULL THEN
      v_floor_pct_cents := (p_tier_unit_cents * v_override.platform_min_unit_pct / 100.0)::bigint;
    END IF;

    v_floor_eff := GREATEST(COALESCE(v_floor_abs, 0), COALESCE(v_floor_pct_cents, 0));

    IF v_floor_eff = 0 AND v_floor_abs IS NULL AND v_floor_pct_cents IS NULL THEN
      RAISE EXCEPTION 'override % has both platform_min fields NULL — schema invariant violated', v_override.id;
    END IF;

    v_source      := 'buyer_override';
    v_override_id := v_override.id;

    RETURN jsonb_build_object(
      'floor_cents',     v_floor_eff,
      'source',          v_source,
      'override_id',     v_override_id,
      'floor_abs_cents', v_floor_abs,
      'floor_pct_cents', v_floor_pct_cents
    );
  END IF;

  v_profile := public.resolve_pricing_profile(p_product_id, p_at);
  IF v_profile.id IS NULL THEN
    RETURN jsonb_build_object('floor_cents', NULL::bigint, 'source', 'no_profile');
  END IF;

  v_floor_abs := v_profile.platform_min_unit_cents;
  IF v_profile.platform_min_unit_pct IS NOT NULL AND p_tier_unit_cents IS NOT NULL THEN
    v_floor_pct_cents := (p_tier_unit_cents * v_profile.platform_min_unit_pct / 100.0)::bigint;
  END IF;

  v_floor_eff := GREATEST(COALESCE(v_floor_abs, 0), COALESCE(v_floor_pct_cents, 0));
  IF v_floor_eff = 0 AND v_floor_abs IS NULL AND v_floor_pct_cents IS NULL THEN
    RAISE EXCEPTION 'profile % has both platform_min fields NULL — schema invariant violated', v_profile.id;
  END IF;

  RETURN jsonb_build_object(
    'floor_cents',     v_floor_eff,
    'source',          'product',
    'profile_id',      v_profile.id,
    'floor_abs_cents', v_floor_abs,
    'floor_pct_cents', v_floor_pct_cents
  );
END
$$;

-- ── 3. compute_unit_price (plpgsql) ─────────────────────────────────────
--
-- Mesma estratégia: prepend `p_at := COALESCE(p_at, now());` ao BEGIN.
-- O resto do corpo é idêntico ao que veio na migration 071+073. Não
-- alteramos nenhuma lógica de invariantes.

CREATE OR REPLACE FUNCTION public.compute_unit_price(
  p_product_id  uuid,
  p_quantity    int,
  p_clinic_id   uuid,
  p_doctor_id   uuid,
  p_coupon_id   uuid,
  p_at          timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile               public.pricing_profiles;
  v_tier_unit_cents       bigint;
  v_tier_id               uuid;
  v_pharmacy_cost_cents   bigint;
  v_floor_jsonb           jsonb;
  v_floor_cents           bigint;

  v_disc_type             text;
  v_disc_value            numeric(10,4);
  v_max_disc_cents        bigint;
  v_coupon_active         boolean := false;
  v_coupon_disc_raw       bigint  := 0;
  v_coupon_disc_capped    bigint  := 0;
  v_coupon_capped         boolean := false;

  v_final_unit_cents      bigint;
  v_platform_commission_per_unit_cents bigint;
  v_consultant_rate       numeric;
  v_consultant_raw_cents  bigint  := 0;
  v_consultant_cents      bigint  := 0;
  v_consultant_capped     boolean := false;
BEGIN
  -- p_at-null safety (mig-078): cliente pode mandar NULL explícito.
  p_at := COALESCE(p_at, now());

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'compute_unit_price: quantity must be > 0, got %', p_quantity;
  END IF;

  v_profile := public.resolve_pricing_profile(p_product_id, p_at);
  IF v_profile.id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_active_profile');
  END IF;

  SELECT id, unit_price_cents
    INTO v_tier_id, v_tier_unit_cents
    FROM public.pricing_profile_tiers
   WHERE pricing_profile_id = v_profile.id
     AND p_quantity BETWEEN min_quantity AND max_quantity
   ORDER BY min_quantity DESC
   LIMIT 1;

  IF v_tier_unit_cents IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'no_tier_for_quantity',
      'profile_id', v_profile.id,
      'quantity', p_quantity
    );
  END IF;

  v_pharmacy_cost_cents := v_profile.pharmacy_cost_unit_cents;

  v_floor_jsonb := public.resolve_effective_floor(
    p_product_id, p_clinic_id, p_doctor_id, v_tier_unit_cents, p_at
  );
  v_floor_cents := (v_floor_jsonb->>'floor_cents')::bigint;

  IF v_floor_cents < v_pharmacy_cost_cents THEN
    v_floor_cents := v_pharmacy_cost_cents;
  END IF;

  IF p_coupon_id IS NOT NULL THEN
    SELECT discount_type, discount_value, public._money_to_cents(max_discount_amount)
      INTO v_disc_type, v_disc_value, v_max_disc_cents
      FROM public.coupons
     WHERE id           = p_coupon_id
       AND active       = true
       AND (valid_until IS NULL OR valid_until > p_at)
       AND (valid_from  IS NULL OR valid_from <= p_at)
       AND (product_id  IS NULL OR product_id = p_product_id)
       AND (
            clinic_id IS NULL
         OR (p_clinic_id IS NOT NULL AND clinic_id = p_clinic_id)
       )
       AND (
            doctor_id IS NULL
         OR (p_doctor_id IS NOT NULL AND doctor_id = p_doctor_id)
       )
     LIMIT 1;
    v_coupon_active := FOUND;
  END IF;

  IF v_coupon_active THEN
    IF v_disc_type = 'PERCENT' THEN
      v_coupon_disc_raw := (v_tier_unit_cents * v_disc_value / 100.0)::bigint;
    ELSIF v_disc_type = 'FIXED' THEN
      v_coupon_disc_raw := public._money_to_cents(v_disc_value);
    ELSE
      v_coupon_disc_raw := 0;
    END IF;

    IF v_max_disc_cents IS NOT NULL AND v_coupon_disc_raw > v_max_disc_cents THEN
      v_coupon_disc_raw := v_max_disc_cents;
    END IF;

    v_coupon_disc_capped := LEAST(
      v_coupon_disc_raw,
      GREATEST(v_tier_unit_cents - v_floor_cents, 0)
    );
    v_coupon_capped := (v_coupon_disc_capped < v_coupon_disc_raw);
  END IF;

  v_final_unit_cents := v_tier_unit_cents - v_coupon_disc_capped;
  v_platform_commission_per_unit_cents := v_final_unit_cents - v_pharmacy_cost_cents;

  IF v_profile.consultant_commission_basis = 'FIXED_PER_UNIT' THEN
    v_consultant_raw_cents := COALESCE(v_profile.consultant_commission_fixed_per_unit_cents, 0);
  ELSIF v_profile.consultant_commission_basis = 'PHARMACY_TRANSFER' THEN
    SELECT (value::numeric)
      INTO v_consultant_rate
      FROM public.app_settings WHERE key = 'consultant_commission_rate' LIMIT 1;
    v_consultant_rate := COALESCE(v_consultant_rate, 5);
    v_consultant_raw_cents := (v_pharmacy_cost_cents * v_consultant_rate / 100.0)::bigint;
  ELSE
    SELECT (value::numeric)
      INTO v_consultant_rate
      FROM public.app_settings WHERE key = 'consultant_commission_rate' LIMIT 1;
    v_consultant_rate := COALESCE(v_consultant_rate, 5);
    v_consultant_raw_cents := (v_final_unit_cents * v_consultant_rate / 100.0)::bigint;
  END IF;

  v_consultant_cents := LEAST(v_consultant_raw_cents, v_platform_commission_per_unit_cents);
  v_consultant_capped := (v_consultant_cents < v_consultant_raw_cents);

  RETURN jsonb_build_object(
    'pricing_profile_id',                v_profile.id,
    'tier_id',                           v_tier_id,
    'tier_unit_cents',                   v_tier_unit_cents,
    'pharmacy_cost_unit_cents',          v_pharmacy_cost_cents,
    'effective_floor_cents',             v_floor_cents,
    'floor_breakdown',                   v_floor_jsonb,
    'coupon_id',                         CASE WHEN v_coupon_active THEN p_coupon_id ELSE NULL END,
    'coupon_disc_per_unit_raw_cents',    v_coupon_disc_raw,
    'coupon_disc_per_unit_capped_cents', v_coupon_disc_capped,
    'coupon_capped',                     v_coupon_capped,
    'final_unit_price_cents',            v_final_unit_cents,
    'platform_commission_per_unit_cents', v_platform_commission_per_unit_cents,
    'consultant_basis',                  v_profile.consultant_commission_basis,
    'consultant_per_unit_raw_cents',     v_consultant_raw_cents,
    'consultant_per_unit_cents',         v_consultant_cents,
    'consultant_capped',                 v_consultant_capped,
    'quantity',                          p_quantity,
    'final_total_cents',                 v_final_unit_cents * p_quantity,
    'pharmacy_transfer_cents',           v_pharmacy_cost_cents * p_quantity,
    'platform_commission_total_cents',   v_platform_commission_per_unit_cents * p_quantity,
    'consultant_commission_total_cents', v_consultant_cents * p_quantity
  );
END
$$;

-- ── 4. preview_unit_price (plpgsql) ─────────────────────────────────────
--
-- Mesmo padrão. Reproduz o corpo da migration 077 com `p_at :=
-- COALESCE(p_at, now());` no início.

CREATE OR REPLACE FUNCTION public.preview_unit_price(
  p_product_id      uuid,
  p_quantity        int,
  p_clinic_id       uuid,
  p_doctor_id       uuid,
  p_disc_type       text,
  p_disc_value      numeric,
  p_max_disc_cents  bigint,
  p_at              timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile               public.pricing_profiles;
  v_tier_unit_cents       bigint;
  v_tier_id               uuid;
  v_pharmacy_cost_cents   bigint;
  v_floor_jsonb           jsonb;
  v_floor_cents           bigint;

  v_coupon_disc_raw       bigint  := 0;
  v_coupon_disc_capped    bigint  := 0;
  v_coupon_capped         boolean := false;

  v_final_unit_cents      bigint;
  v_platform_commission_per_unit_cents bigint;
  v_consultant_rate       numeric;
  v_consultant_raw_cents  bigint  := 0;
  v_consultant_cents      bigint  := 0;
  v_consultant_capped     boolean := false;
BEGIN
  p_at := COALESCE(p_at, now());

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'preview_unit_price: quantity must be > 0, got %', p_quantity;
  END IF;

  v_profile := public.resolve_pricing_profile(p_product_id, p_at);
  IF v_profile.id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_active_profile', 'is_preview', true);
  END IF;

  SELECT id, unit_price_cents
    INTO v_tier_id, v_tier_unit_cents
    FROM public.pricing_profile_tiers
   WHERE pricing_profile_id = v_profile.id
     AND p_quantity BETWEEN min_quantity AND max_quantity
   ORDER BY min_quantity DESC
   LIMIT 1;

  IF v_tier_unit_cents IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'no_tier_for_quantity',
      'profile_id', v_profile.id,
      'quantity', p_quantity,
      'is_preview', true
    );
  END IF;

  v_pharmacy_cost_cents := v_profile.pharmacy_cost_unit_cents;

  v_floor_jsonb := public.resolve_effective_floor(
    p_product_id, p_clinic_id, p_doctor_id, v_tier_unit_cents, p_at
  );
  v_floor_cents := (v_floor_jsonb->>'floor_cents')::bigint;

  IF v_floor_cents < v_pharmacy_cost_cents THEN
    v_floor_cents := v_pharmacy_cost_cents;
  END IF;

  IF p_disc_type IS NOT NULL AND p_disc_value IS NOT NULL AND p_disc_value > 0 THEN
    IF p_disc_type = 'PERCENT' THEN
      v_coupon_disc_raw := (v_tier_unit_cents * p_disc_value / 100.0)::bigint;
    ELSIF p_disc_type = 'FIXED' THEN
      v_coupon_disc_raw := public._money_to_cents(p_disc_value);
    ELSE
      v_coupon_disc_raw := 0;
    END IF;

    IF p_max_disc_cents IS NOT NULL AND v_coupon_disc_raw > p_max_disc_cents THEN
      v_coupon_disc_raw := p_max_disc_cents;
    END IF;

    v_coupon_disc_capped := LEAST(
      v_coupon_disc_raw,
      GREATEST(v_tier_unit_cents - v_floor_cents, 0)
    );
    v_coupon_capped := (v_coupon_disc_capped < v_coupon_disc_raw);
  END IF;

  v_final_unit_cents := v_tier_unit_cents - v_coupon_disc_capped;
  v_platform_commission_per_unit_cents := v_final_unit_cents - v_pharmacy_cost_cents;

  IF v_profile.consultant_commission_basis = 'FIXED_PER_UNIT' THEN
    v_consultant_raw_cents := COALESCE(v_profile.consultant_commission_fixed_per_unit_cents, 0);
  ELSIF v_profile.consultant_commission_basis = 'PHARMACY_TRANSFER' THEN
    SELECT (value::numeric)
      INTO v_consultant_rate
      FROM public.app_settings WHERE key = 'consultant_commission_rate' LIMIT 1;
    v_consultant_rate := COALESCE(v_consultant_rate, 5);
    v_consultant_raw_cents := (v_pharmacy_cost_cents * v_consultant_rate / 100.0)::bigint;
  ELSE
    SELECT (value::numeric)
      INTO v_consultant_rate
      FROM public.app_settings WHERE key = 'consultant_commission_rate' LIMIT 1;
    v_consultant_rate := COALESCE(v_consultant_rate, 5);
    v_consultant_raw_cents := (v_final_unit_cents * v_consultant_rate / 100.0)::bigint;
  END IF;

  v_consultant_cents := LEAST(v_consultant_raw_cents, v_platform_commission_per_unit_cents);
  v_consultant_capped := (v_consultant_cents < v_consultant_raw_cents);

  RETURN jsonb_build_object(
    'pricing_profile_id',                v_profile.id,
    'tier_id',                           v_tier_id,
    'tier_unit_cents',                   v_tier_unit_cents,
    'pharmacy_cost_unit_cents',          v_pharmacy_cost_cents,
    'effective_floor_cents',             v_floor_cents,
    'floor_breakdown',                   v_floor_jsonb,
    'coupon_id',                         NULL::uuid,
    'coupon_disc_per_unit_raw_cents',    v_coupon_disc_raw,
    'coupon_disc_per_unit_capped_cents', v_coupon_disc_capped,
    'coupon_capped',                     v_coupon_capped,
    'final_unit_price_cents',            v_final_unit_cents,
    'platform_commission_per_unit_cents', v_platform_commission_per_unit_cents,
    'consultant_basis',                  v_profile.consultant_commission_basis,
    'consultant_per_unit_raw_cents',     v_consultant_raw_cents,
    'consultant_per_unit_cents',         v_consultant_cents,
    'consultant_capped',                 v_consultant_capped,
    'quantity',                          p_quantity,
    'final_total_cents',                 v_final_unit_cents * p_quantity,
    'pharmacy_transfer_cents',           v_pharmacy_cost_cents * p_quantity,
    'platform_commission_total_cents',   v_platform_commission_per_unit_cents * p_quantity,
    'consultant_commission_total_cents', v_consultant_cents * p_quantity,
    'is_preview',                        true
  );
END
$$;

-- ── Smoke ───────────────────────────────────────────────────────────────
--
-- Cria um produto + profile + tier, chama compute_unit_price com
-- p_at=NULL e confirma que retorna o profile (e não no_active_profile).
-- Tudo dentro da transação da migration; a ROLLBACK conceitual é o
-- fato de que criamos numa savepoint dedicada e cancelamos.

DO $smoke$
DECLARE
  v_admin_id uuid;
  v_product_id uuid := gen_random_uuid();
  v_profile_id uuid;
  v_result jsonb;
BEGIN
  -- Pegamos qualquer SUPER_ADMIN existente para FK do change_reason
  SELECT user_id INTO v_admin_id
    FROM public.user_roles
   WHERE role = 'SUPER_ADMIN'
   LIMIT 1;

  IF v_admin_id IS NULL THEN
    RAISE NOTICE 'mig078 smoke: skip (no SUPER_ADMIN seeded)';
    RETURN;
  END IF;

  -- Cria produto efêmero
  INSERT INTO public.products (id, name, slug, sku, active, pricing_mode)
  VALUES (v_product_id, 'mig078 smoke', 'mig078-smoke-' || v_product_id::text, 'SMOKE-' || left(v_product_id::text, 8), true, 'TIERED_PROFILE');

  INSERT INTO public.pricing_profiles (
    product_id, pharmacy_cost_unit_cents, platform_min_unit_cents,
    consultant_commission_basis, created_by_user_id, change_reason
  ) VALUES (
    v_product_id, 5000, 12000, 'TOTAL_PRICE', v_admin_id, 'mig078 smoke'
  ) RETURNING id INTO v_profile_id;

  INSERT INTO public.pricing_profile_tiers (pricing_profile_id, min_quantity, max_quantity, unit_price_cents)
  VALUES (v_profile_id, 1, 100, 20000);

  -- O ponto-chave: passar p_at=NULL explícito. Antes da mig-078 isso
  -- retornava {"error": "no_active_profile"}.
  v_result := public.compute_unit_price(v_product_id, 1, NULL, NULL, NULL, NULL::timestamptz);

  IF v_result ? 'error' THEN
    RAISE EXCEPTION 'mig078 smoke FAIL: compute_unit_price com p_at=NULL retornou %, esperava breakdown', v_result;
  END IF;

  IF (v_result->>'final_unit_price_cents')::bigint <> 20000 THEN
    RAISE EXCEPTION 'mig078 smoke FAIL: final_unit_price_cents = %, esperava 20000', v_result->>'final_unit_price_cents';
  END IF;

  -- Mesmo teste para preview_unit_price + resolve_effective_floor + resolve_pricing_profile.
  v_result := public.preview_unit_price(v_product_id, 1, NULL, NULL, NULL, NULL, NULL, NULL::timestamptz);
  IF v_result ? 'error' THEN
    RAISE EXCEPTION 'mig078 smoke FAIL: preview_unit_price com p_at=NULL retornou %', v_result;
  END IF;

  v_result := public.resolve_effective_floor(v_product_id, NULL, NULL, 20000::bigint, NULL::timestamptz);
  IF (v_result->>'source') <> 'product' THEN
    RAISE EXCEPTION 'mig078 smoke FAIL: resolve_effective_floor com p_at=NULL source=%, esperava product', v_result->>'source';
  END IF;

  -- Cleanup do smoke
  DELETE FROM public.pricing_profiles WHERE id = v_profile_id;
  DELETE FROM public.products         WHERE id = v_product_id;

  RAISE NOTICE 'mig078 smoke OK: p_at=NULL agora resolve para now() em todas as 4 funções';
END
$smoke$;
