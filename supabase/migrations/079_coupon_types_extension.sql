-- Migration 079 — coupons: 3 novos tipos (FIRST_UNIT_DISCOUNT, TIER_UPGRADE,
-- MIN_QTY_PERCENT) + helper de tier-upgrade + estender compute_unit_price/
-- preview_unit_price para cobrir os 5 tipos.
--
-- Contexto / por quê
-- ------------------
-- ADR-001 propôs 5 tipos de cupom mas a implementação efetiva ficou só nos
-- 2 legacy (`PERCENT`, `FIXED`). Quando o operador tentava montar campanhas
-- mais ricas (ex.: "experimente, R$ 100 off na primeira tirzepatida",
-- "10% off se comprar pelo menos 3 unidades", "promovido para o tier de
-- preço de quem compra 5 unidades"), a UI não oferecia o tipo, o engine
-- não calculava e a matriz de impacto não simulava.
--
-- ADR-002 (este PR) materializa a proposta original do ADR-001 §5.4 sem
-- mudar nada do contrato existente:
--
--   - Cupons já criados (PERCENT / FIXED) ficam idênticos: as colunas novas
--     ganham defaults que reproduzem o comportamento legacy
--     (`min_quantity = 1`, `tier_promotion_steps = 0`).
--   - INV-1, INV-2, INV-3 e INV-4 continuam aplicados pelo mesmo código —
--     o cap em `tier_unit - effective_floor` (INV-2) e o LEAST contra
--     `platform_commission_per_unit` (INV-4) seguem após o cálculo do face,
--     independentemente do tipo.
--   - `freeze_order_item_price` para o branch TIERED chama
--     `compute_unit_price` (mig 072) e congela o resultado em
--     `discount_breakdown` — não precisa saber dos tipos novos.
--
-- Nova semântica
-- --------------
--   * `FIRST_UNIT_DISCOUNT` — desconto fixo só na 1ª unidade do pedido.
--     Se `p_quantity = 1`, face_per_unit = `discount_value * 100` cents.
--     Se `p_quantity > 1`, face = 0 (cupom não casa para esse pedido).
--     Caso de uso: "experimente: R$ 100 off na primeira tirzepatida".
--
--   * `TIER_UPGRADE` — promove o cliente para o tier `N` posições acima.
--     `tier_promotion_steps` = N (1..10). O helper
--     `_pricing_tier_n_steps_up(profile_id, qty, steps)` retorna o
--     `unit_price_cents` do tier-alvo (ordem ASC por min_quantity); se a
--     promoção ultrapassa o último tier, o cliente fica no tier mais
--     barato disponível. face_per_unit = `tier_unit_atual - tier_unit_alvo`.
--     Caso de uso: "cupom-VIP-3-tiers — paga preço de quem compra 3 níveis
--     acima".
--
--   * `MIN_QTY_PERCENT` — percentual de desconto, mas só se
--     `p_quantity >= min_quantity`. `discount_value` reusado como
--     percentual (mesma semântica do PERCENT, com gate de quantidade).
--     Caso de uso: "10% off se comprar pelo menos 3 unidades".
--
-- Schema diff
-- -----------
--   - `coupons.discount_type` CHECK passa de 2 para 5 valores.
--   - `coupons.min_quantity` int NOT NULL DEFAULT 1 CHECK (>= 1).
--   - `coupons.tier_promotion_steps` int NOT NULL DEFAULT 0 CHECK (0..10).
--   - CHECK cross-coluna: `MIN_QTY_PERCENT` exige `min_quantity > 1`;
--     `TIER_UPGRADE` exige `tier_promotion_steps > 0`. Os 3 tipos legacy
--     (PERCENT, FIXED, FIRST_UNIT_DISCOUNT) não fazem demanda.
--
-- Compatibilidade
-- ---------------
--   - Defaults preservam comportamento legacy de cupons existentes.
--   - Wrapper TS / API / UI sem mudança quebra nada nesta migration:
--     este PR ajusta cada camada em commits do mesmo PR.
--   - `preview_unit_price` ganha 2 parâmetros novos (`p_min_quantity`,
--     `p_tier_promotion_steps`) — assinatura cresce mas com defaults, então
--     callers antigos continuam funcionando (PostgREST resolve por nome
--     dos parâmetros nomeados).
--
-- Idempotência: tudo via CREATE OR REPLACE / IF NOT EXISTS / DO blocks.
--
-- Rollback
--   - DROP CONSTRAINT coupons_type_consistency;
--   - DROP CONSTRAINT coupons_discount_type_check; ADD original com 2 valores;
--   - DROP COLUMN tier_promotion_steps, min_quantity;
--   - DROP FUNCTION public._pricing_tier_n_steps_up(uuid, int, int);
--   - Re-aplicar mig-078 corpo de compute_unit_price / preview_unit_price.

SET search_path TO public, pg_temp;

-- ── 1. coupons: novas colunas + CHECK ───────────────────────────────────

ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS min_quantity         int NOT NULL DEFAULT 1
    CHECK (min_quantity >= 1),
  ADD COLUMN IF NOT EXISTS tier_promotion_steps int NOT NULL DEFAULT 0
    CHECK (tier_promotion_steps >= 0 AND tier_promotion_steps <= 10);

COMMENT ON COLUMN public.coupons.min_quantity IS
  'Quantidade mínima do pedido para o cupom valer. Default 1 (vale sempre). MIN_QTY_PERCENT exige > 1.';
COMMENT ON COLUMN public.coupons.tier_promotion_steps IS
  'Quantos tiers acima o cliente é promovido (TIER_UPGRADE). 0 = sem upgrade. Cap em 10 para evitar promoções absurdas.';

-- Substituir o CHECK de discount_type para os 5 tipos.
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  -- Localiza o CHECK constraint atual em discount_type. O nome pode variar
  -- entre databases criados a partir de diferentes versões do dump
  -- (Postgres autogera o sufixo _check), por isso buscamos pelo predicado.
  SELECT con.conname INTO v_constraint_name
    FROM pg_constraint con
    JOIN pg_class       rel ON rel.oid = con.conrelid
   WHERE rel.relname = 'coupons'
     AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) ILIKE '%discount_type%';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.coupons DROP CONSTRAINT %I', v_constraint_name);
  END IF;

  ALTER TABLE public.coupons
    ADD CONSTRAINT coupons_discount_type_check
    CHECK (discount_type IN (
      'PERCENT', 'FIXED',
      'FIRST_UNIT_DISCOUNT', 'TIER_UPGRADE', 'MIN_QTY_PERCENT'
    ));
END
$$;

-- CHECK cross-coluna por tipo. Garantia em DB que cada tipo carrega os
-- parâmetros que de fato precisa para gerar desconto não-zero.
ALTER TABLE public.coupons
  DROP CONSTRAINT IF EXISTS coupons_type_consistency;

ALTER TABLE public.coupons
  ADD CONSTRAINT coupons_type_consistency CHECK (
    CASE discount_type
      WHEN 'TIER_UPGRADE'    THEN tier_promotion_steps > 0
      WHEN 'MIN_QTY_PERCENT' THEN min_quantity > 1
      ELSE true
    END
  );

-- ── 2. helper: tier N posições acima ────────────────────────────────────
--
-- Resolve, para um (profile_id, quantidade), o `unit_price_cents` do tier
-- que está N posições ACIMA na ordenação ASC por `min_quantity`. Acima =
-- "o que o cliente que compra mais paga". Por construção tiers de min_qty
-- maior têm preço unitário menor (tiers são monotonicamente decrescentes
-- em preço — esperado pela política comercial).
--
-- Casos de borda:
--   - profile sem tiers cadastrados → NULL (caller decide ignorar).
--   - quantidade fora de qualquer tier → NULL.
--   - promoção excede o último tier → retorna o último (cliente fica no
--     tier mais barato disponível, não há "premiação infinita").
--   - `p_steps = 0` → retorna o próprio unit_price do tier resolvido (no-op).
CREATE OR REPLACE FUNCTION public._pricing_tier_n_steps_up(
  p_profile_id uuid,
  p_quantity   int,
  p_steps      int
) RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current_rank int;
  v_max_rank     int;
  v_target_unit  bigint;
BEGIN
  IF p_steps IS NULL OR p_steps < 0 THEN
    RETURN NULL;
  END IF;

  -- Rank do tier que casa com a quantidade.
  WITH ranked AS (
    SELECT id, min_quantity, max_quantity, unit_price_cents,
           ROW_NUMBER() OVER (ORDER BY min_quantity ASC) AS rn
      FROM public.pricing_profile_tiers
     WHERE pricing_profile_id = p_profile_id
  )
  SELECT rn INTO v_current_rank
    FROM ranked
   WHERE p_quantity BETWEEN min_quantity AND max_quantity
   LIMIT 1;

  IF v_current_rank IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT MAX(rn) INTO v_max_rank
    FROM (
      SELECT ROW_NUMBER() OVER (ORDER BY min_quantity ASC) AS rn
        FROM public.pricing_profile_tiers
       WHERE pricing_profile_id = p_profile_id
    ) ranks;

  -- Promoção saturada no último tier (mais barato).
  IF v_current_rank + p_steps > v_max_rank THEN
    SELECT unit_price_cents INTO v_target_unit
      FROM public.pricing_profile_tiers
     WHERE pricing_profile_id = p_profile_id
     ORDER BY min_quantity DESC
     LIMIT 1;
    RETURN v_target_unit;
  END IF;

  WITH ranked AS (
    SELECT unit_price_cents,
           ROW_NUMBER() OVER (ORDER BY min_quantity ASC) AS rn
      FROM public.pricing_profile_tiers
     WHERE pricing_profile_id = p_profile_id
  )
  SELECT unit_price_cents INTO v_target_unit
    FROM ranked
   WHERE rn = v_current_rank + p_steps
   LIMIT 1;

  RETURN v_target_unit;
END
$$;

REVOKE ALL ON FUNCTION public._pricing_tier_n_steps_up(uuid, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._pricing_tier_n_steps_up(uuid, int, int)
  TO service_role, authenticated;

COMMENT ON FUNCTION public._pricing_tier_n_steps_up(uuid, int, int) IS
  'Retorna unit_price_cents do tier N posições acima (ASC por min_quantity). '
  'Saturação no último tier para promoções acima do limite. NULL se não houver tier.';

-- ── 3. compute_unit_price (motor real) — extender CASE para 5 tipos ─────
--
-- Mesma assinatura, mesma fluxo. Diferenças vs mig-078:
--   - Lê `min_quantity` e `tier_promotion_steps` da tabela `coupons`.
--   - CASE expandido para 5 tipos. Cap INV-2 e INV-4 inalterados.
--   - Gate `min_quantity` aplicado uniformemente: se p_quantity < min_qty,
--     o cupom não vale (face = 0) — independentemente do tipo. Isso vale
--     mesmo para PERCENT / FIXED quando o operador setar min_quantity > 1
--     (semântica adicional gratuita).

CREATE OR REPLACE FUNCTION public.compute_unit_price(
  p_product_id uuid,
  p_quantity   int,
  p_clinic_id  uuid DEFAULT NULL,
  p_doctor_id  uuid DEFAULT NULL,
  p_coupon_id  uuid DEFAULT NULL,
  p_at         timestamptz DEFAULT now()
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
  v_coupon_min_qty        int;
  v_coupon_steps          int;
  v_coupon_active         boolean := false;
  v_coupon_disc_raw       bigint  := 0;
  v_coupon_disc_capped    bigint  := 0;
  v_coupon_capped         boolean := false;
  v_target_unit_cents     bigint;

  v_final_unit_cents      bigint;
  v_platform_commission_per_unit_cents bigint;
  v_consultant_rate       numeric;
  v_consultant_raw_cents  bigint  := 0;
  v_consultant_cents      bigint  := 0;
  v_consultant_capped     boolean := false;
BEGIN
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
    SELECT discount_type, discount_value,
           public._money_to_cents(max_discount_amount),
           min_quantity, tier_promotion_steps
      INTO v_disc_type, v_disc_value, v_max_disc_cents,
           v_coupon_min_qty, v_coupon_steps
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
    -- Gate de quantidade mínima vale para qualquer tipo. Para os tipos
    -- legacy (PERCENT, FIXED), `coupon_min_quantity` default 1 → no-op.
    IF p_quantity < COALESCE(v_coupon_min_qty, 1) THEN
      v_coupon_disc_raw := 0;
    ELSE
      v_coupon_disc_raw := CASE v_disc_type
        WHEN 'PERCENT' THEN
          (v_tier_unit_cents * v_disc_value / 100.0)::bigint

        WHEN 'FIXED' THEN
          public._money_to_cents(v_disc_value)

        WHEN 'FIRST_UNIT_DISCOUNT' THEN
          -- Só vale quando o pedido tem exatamente 1 unidade. Em pedidos
          -- maiores o cupom não casa: face = 0 e o pedido segue sem
          -- desconto. Manter assim (e não ratear) preserva a previsibilidade
          -- do "experimente, R$ X off na sua primeira unidade".
          CASE WHEN p_quantity = 1
               THEN public._money_to_cents(v_disc_value)
               ELSE 0
          END

        WHEN 'TIER_UPGRADE' THEN
          -- v_target_unit_cents pode vir NULL se não houver tier ou se a
          -- promoção for inválida; tratamos como "sem desconto".
          GREATEST(
            0,
            v_tier_unit_cents - COALESCE(
              public._pricing_tier_n_steps_up(v_profile.id, p_quantity, v_coupon_steps),
              v_tier_unit_cents
            )
          )

        WHEN 'MIN_QTY_PERCENT' THEN
          -- A semântica é PERCENT + gate de quantidade. O gate já foi
          -- aplicado acima (p_quantity >= v_coupon_min_qty), aqui é só
          -- o cálculo do percentual.
          (v_tier_unit_cents * v_disc_value / 100.0)::bigint

        ELSE 0
      END;
    END IF;

    IF v_max_disc_cents IS NOT NULL AND v_coupon_disc_raw > v_max_disc_cents THEN
      v_coupon_disc_raw := v_max_disc_cents;
    END IF;

    -- INV-2: cap absoluto contra o piso efetivo. Mesmo cálculo de mig-078.
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
    SELECT (value_json::text)::numeric
      INTO v_consultant_rate
      FROM public.app_settings WHERE key = 'consultant_commission_rate' LIMIT 1;
    v_consultant_rate := COALESCE(v_consultant_rate, 5);
    v_consultant_raw_cents := (v_pharmacy_cost_cents * v_consultant_rate / 100.0)::bigint;
  ELSE
    SELECT (value_json::text)::numeric
      INTO v_consultant_rate
      FROM public.app_settings WHERE key = 'consultant_commission_rate' LIMIT 1;
    v_consultant_rate := COALESCE(v_consultant_rate, 5);
    v_consultant_raw_cents := (v_final_unit_cents * v_consultant_rate / 100.0)::bigint;
  END IF;

  -- INV-4: consultor nunca pode receber mais do que a plataforma ganha
  -- na mesma unidade. Igual à mig-078, sem mudança.
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

-- ── 4. preview_unit_price (hipotético) — assinatura cresce ──────────────
--
-- DROP + CREATE porque a assinatura mudou (2 parâmetros novos opcionais).
-- CREATE OR REPLACE só funciona quando a assinatura é idêntica.
--
-- Caller passa todos os parâmetros do cupom hipotético explicitamente
-- (não há `coupon_id` aqui — é simulação). Os 2 novos parâmetros têm
-- DEFAULT, então callers existentes (matriz que ainda só passa 6 args)
-- continuam funcionando sem mudança no PostgREST.

DROP FUNCTION IF EXISTS public.preview_unit_price(uuid, int, uuid, uuid, text, numeric, bigint, timestamptz);

CREATE OR REPLACE FUNCTION public.preview_unit_price(
  p_product_id            uuid,
  p_quantity              int,
  p_clinic_id             uuid,
  p_doctor_id             uuid,
  p_disc_type             text,
  p_disc_value            numeric,
  p_max_disc_cents        bigint,
  p_at                    timestamptz DEFAULT now(),
  p_min_quantity          int          DEFAULT 1,
  p_tier_promotion_steps  int          DEFAULT 0
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

  -- TIER_UPGRADE não usa p_disc_value (o efeito vem de p_tier_promotion_steps).
  -- Os demais tipos exigem valor > 0 para ter qualquer cálculo.
  IF p_disc_type IS NOT NULL AND (
       p_disc_type = 'TIER_UPGRADE'
    OR (p_disc_value IS NOT NULL AND p_disc_value > 0)
  ) THEN
    -- Gate de min_quantity uniforme — espelha compute_unit_price.
    IF p_quantity < COALESCE(p_min_quantity, 1) THEN
      v_coupon_disc_raw := 0;
    ELSE
      v_coupon_disc_raw := CASE p_disc_type
        WHEN 'PERCENT' THEN
          (v_tier_unit_cents * p_disc_value / 100.0)::bigint
        WHEN 'FIXED' THEN
          public._money_to_cents(p_disc_value)
        WHEN 'FIRST_UNIT_DISCOUNT' THEN
          CASE WHEN p_quantity = 1
               THEN public._money_to_cents(p_disc_value)
               ELSE 0
          END
        WHEN 'TIER_UPGRADE' THEN
          GREATEST(
            0,
            v_tier_unit_cents - COALESCE(
              public._pricing_tier_n_steps_up(v_profile.id, p_quantity, p_tier_promotion_steps),
              v_tier_unit_cents
            )
          )
        WHEN 'MIN_QTY_PERCENT' THEN
          (v_tier_unit_cents * p_disc_value / 100.0)::bigint
        ELSE 0
      END;
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
    SELECT (value_json::text)::numeric
      INTO v_consultant_rate
      FROM public.app_settings WHERE key = 'consultant_commission_rate' LIMIT 1;
    v_consultant_rate := COALESCE(v_consultant_rate, 5);
    v_consultant_raw_cents := (v_pharmacy_cost_cents * v_consultant_rate / 100.0)::bigint;
  ELSE
    SELECT (value_json::text)::numeric
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

-- ── 5. Smoke test ───────────────────────────────────────────────────────
--
-- Padrão da mig-078: reusa um produto existente sem profile vivo, anexa
-- um profile temporário com 3 tiers, exercita os 5 tipos via
-- `preview_unit_price` e limpa no final. NULL-safety e cap INV-2/INV-4
-- continuam validados pela mig-078; aqui validamos apenas a lógica nova.

DO $smoke$
DECLARE
  v_admin_id   uuid;
  v_product_id uuid;
  v_profile_id uuid;
  v_result     jsonb;
  v_disc       bigint;
BEGIN
  SELECT user_id INTO v_admin_id
    FROM public.user_roles
   WHERE role = 'SUPER_ADMIN'
   LIMIT 1;

  IF v_admin_id IS NULL THEN
    RAISE NOTICE 'mig079 smoke: skip (no SUPER_ADMIN seeded)';
    RETURN;
  END IF;

  SELECT p.id
    INTO v_product_id
    FROM public.products p
   WHERE p.active = true
     AND NOT EXISTS (
       SELECT 1 FROM public.pricing_profiles pp
        WHERE pp.product_id = p.id
          AND pp.effective_from <= now()
          AND (pp.effective_until IS NULL OR pp.effective_until > now())
     )
   LIMIT 1;

  IF v_product_id IS NULL THEN
    RAISE NOTICE 'mig079 smoke: skip (no product without active profile)';
    RETURN;
  END IF;

  -- Profile com pharmacy_cost = R$ 50, floor abs = R$ 120 e 3 tiers
  -- (1u: R$ 200, 3u: R$ 180, 5u: R$ 150). Garante margem suficiente
  -- para que os caps INV-2 / INV-4 não escondam o valor calculado.
  INSERT INTO public.pricing_profiles (
    product_id, pharmacy_cost_unit_cents, platform_min_unit_cents,
    consultant_commission_basis, created_by_user_id, change_reason
  ) VALUES (
    v_product_id, 5000, 12000, 'TOTAL_PRICE', v_admin_id, 'mig079 smoke'
  ) RETURNING id INTO v_profile_id;

  INSERT INTO public.pricing_profile_tiers (pricing_profile_id, min_quantity, max_quantity, unit_price_cents)
  VALUES
    (v_profile_id, 1, 2, 20000),
    (v_profile_id, 3, 4, 18000),
    (v_profile_id, 5, 100, 15000);

  -- (a) PERCENT 10% em qty=1 → face = 200 * 0.10 = R$ 20
  v_result := public.preview_unit_price(v_product_id, 1, NULL, NULL,
    'PERCENT', 10::numeric, NULL::bigint, NULL::timestamptz);
  v_disc := (v_result->>'coupon_disc_per_unit_capped_cents')::bigint;
  IF v_disc <> 2000 THEN
    RAISE EXCEPTION 'mig079 smoke FAIL PERCENT: face=% (esperava 2000)', v_disc;
  END IF;

  -- (b) FIRST_UNIT_DISCOUNT R$ 100 em qty=1 → face = 100 * 100 = 10000
  v_result := public.preview_unit_price(v_product_id, 1, NULL, NULL,
    'FIRST_UNIT_DISCOUNT', 100::numeric, NULL::bigint, NULL::timestamptz);
  v_disc := (v_result->>'coupon_disc_per_unit_capped_cents')::bigint;
  IF v_disc <> 8000 THEN
    -- Cap INV-2: face raw 10000, mas (tier_unit 20000 - floor 12000) = 8000.
    -- Capeado, então o esperado é 8000.
    RAISE EXCEPTION 'mig079 smoke FAIL FIRST_UNIT_DISCOUNT qty=1: face=% (esperava 8000 após cap)', v_disc;
  END IF;

  -- (c) FIRST_UNIT_DISCOUNT R$ 100 em qty=2 → face = 0 (não casa)
  v_result := public.preview_unit_price(v_product_id, 2, NULL, NULL,
    'FIRST_UNIT_DISCOUNT', 100::numeric, NULL::bigint, NULL::timestamptz);
  v_disc := (v_result->>'coupon_disc_per_unit_capped_cents')::bigint;
  IF v_disc <> 0 THEN
    RAISE EXCEPTION 'mig079 smoke FAIL FIRST_UNIT_DISCOUNT qty=2: face=% (esperava 0)', v_disc;
  END IF;

  -- (d) TIER_UPGRADE 1 step em qty=1 → tier 1u (R$ 200) sobe para tier 3u (R$ 180), face = 2000
  v_result := public.preview_unit_price(v_product_id, 1, NULL, NULL,
    'TIER_UPGRADE', NULL::numeric, NULL::bigint, NULL::timestamptz, 1, 1);
  v_disc := (v_result->>'coupon_disc_per_unit_capped_cents')::bigint;
  IF v_disc <> 2000 THEN
    RAISE EXCEPTION 'mig079 smoke FAIL TIER_UPGRADE 1 step: face=% (esperava 2000)', v_disc;
  END IF;

  -- (e) TIER_UPGRADE 5 steps em qty=1 → satura no último (R$ 150), face = 5000
  v_result := public.preview_unit_price(v_product_id, 1, NULL, NULL,
    'TIER_UPGRADE', NULL::numeric, NULL::bigint, NULL::timestamptz, 1, 5);
  v_disc := (v_result->>'coupon_disc_per_unit_capped_cents')::bigint;
  IF v_disc <> 5000 THEN
    RAISE EXCEPTION 'mig079 smoke FAIL TIER_UPGRADE saturado: face=% (esperava 5000)', v_disc;
  END IF;

  -- (f) MIN_QTY_PERCENT 10% qty=2 com min=3 → face = 0 (gate bloqueia)
  v_result := public.preview_unit_price(v_product_id, 2, NULL, NULL,
    'MIN_QTY_PERCENT', 10::numeric, NULL::bigint, NULL::timestamptz, 3, 0);
  v_disc := (v_result->>'coupon_disc_per_unit_capped_cents')::bigint;
  IF v_disc <> 0 THEN
    RAISE EXCEPTION 'mig079 smoke FAIL MIN_QTY_PERCENT abaixo do min: face=% (esperava 0)', v_disc;
  END IF;

  -- (g) MIN_QTY_PERCENT 10% qty=3 com min=3 → tier 3u é 180; face = 18000 * 10% = 1800
  v_result := public.preview_unit_price(v_product_id, 3, NULL, NULL,
    'MIN_QTY_PERCENT', 10::numeric, NULL::bigint, NULL::timestamptz, 3, 0);
  v_disc := (v_result->>'coupon_disc_per_unit_capped_cents')::bigint;
  IF v_disc <> 1800 THEN
    RAISE EXCEPTION 'mig079 smoke FAIL MIN_QTY_PERCENT igual ao min: face=% (esperava 1800)', v_disc;
  END IF;

  -- Cleanup
  DELETE FROM public.pricing_profiles WHERE id = v_profile_id;

  RAISE NOTICE 'mig079 smoke OK: 7 cenários (PERCENT, FIRST_UNIT, TIER_UPGRADE, MIN_QTY) validados';
END
$smoke$;
