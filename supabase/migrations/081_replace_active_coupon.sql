-- Migration 081: replace_active_coupon — substituição atômica de cupom
-- ativo de um (target × produto), com RFC ADR-003 implícita.
--
-- Contexto
-- --------
-- Hoje a regra é "1 cupom ativo por (clinic|doctor × produto)" garantida por
-- partial unique indexes:
--   idx_coupons_one_active_per_clinic_product  (clinic_id, product_id) WHERE active=true
--   idx_coupons_one_active_per_doctor_product  (doctor_id, product_id) WHERE active=true
-- e por validação na server action createCoupon, que retorna erro pedindo
-- desativação manual.
--
-- O operador pediu: ao criar B sobre (target, produto) onde já existe A
-- ativo, substituir A automaticamente — A.active := false e B é o ativo.
-- Comportamento NÃO acumulativo (já é o caso: order_item.coupon_id é
-- single FK), mas explicitamente "novo apaga antigo".
--
-- Por que RPC e não UPDATE+INSERT do client?
-- ------------------------------------------
-- O partial unique index só acomoda 1 active=true. Se o client fizer
-- INSERT antes do UPDATE, o índice rejeita (tem 2 active=true). Se fizer
-- UPDATE antes do INSERT, abre uma janela onde a clinic fica sem cupom
-- ativo até o INSERT — visível em qualquer leitura concorrente. RPC
-- PL/pgSQL roda os dois statements numa única transação, atomicamente.
--
-- Invariantes preservadas
-- -----------------------
-- - Audit chain (mig-046): UPDATE em coupons gera audit_log normal via
--   trigger se houver. Não tocamos.
-- - Partial unique indexes: o UPDATE roda PRIMEIRO, libera o slot, depois
--   o INSERT entra. Mesma transação, sem janela.
-- - LGPD: NÃO deletamos. Marcamos active=false; histórico preservado em
--   coupons + order_items.coupon_id (snapshots de pedidos).
-- - INV-1..INV-4 do ADR-002: não tocamos compute_unit_price.
--
-- Roll-forward only.

BEGIN;

-- ── RPC ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.replace_active_coupon(
  p_product_id            uuid,
  p_clinic_id             uuid,         -- exatamente um de clinic/doctor
  p_doctor_id             uuid,
  p_code                  text,
  p_discount_type         text,
  p_discount_value        numeric,
  p_max_discount_amount   numeric,
  p_min_quantity          int,
  p_tier_promotion_steps  int,
  p_valid_from            timestamptz,
  p_valid_until           timestamptz,
  p_created_by_user_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_replaced_ids   uuid[] := ARRAY[]::uuid[];
  v_replaced_codes text[] := ARRAY[]::text[];
  v_new            public.coupons%ROWTYPE;
BEGIN
  -- Pré-condição: exatamente um target.
  IF (p_clinic_id IS NULL AND p_doctor_id IS NULL)
     OR (p_clinic_id IS NOT NULL AND p_doctor_id IS NOT NULL) THEN
    RAISE EXCEPTION 'replace_active_coupon: exatamente um de clinic_id ou doctor_id deve ser informado'
      USING ERRCODE = 'P0001';
  END IF;

  -- Passo 1 — desativa o(s) ativo(s) do mesmo (target × produto).
  -- Em teoria há no máximo 1 (partial unique index garante), mas
  -- usamos array_agg defensivamente caso o índice tenha sido removido
  -- ou um cupom legacy órfão exista.
  WITH deactivated AS (
    UPDATE public.coupons
       SET active     = false,
           updated_at = now()
     WHERE active     = true
       AND product_id = p_product_id
       AND (
             (p_clinic_id IS NOT NULL AND clinic_id = p_clinic_id)
          OR (p_doctor_id IS NOT NULL AND doctor_id = p_doctor_id)
           )
     RETURNING id, code
  )
  SELECT
    COALESCE(array_agg(id),   ARRAY[]::uuid[]),
    COALESCE(array_agg(code), ARRAY[]::text[])
  INTO v_replaced_ids, v_replaced_codes
  FROM deactivated;

  -- Passo 2 — insere o novo. O CHECK constraint coupons_type_consistency
  -- (mig-079) valida tier_promotion_steps/min_quantity por tipo.
  INSERT INTO public.coupons (
    code, product_id, clinic_id, doctor_id,
    discount_type, discount_value, max_discount_amount,
    min_quantity, tier_promotion_steps,
    valid_from, valid_until, active, activated_at,
    created_by_user_id
  ) VALUES (
    p_code, p_product_id, p_clinic_id, p_doctor_id,
    p_discount_type, p_discount_value, p_max_discount_amount,
    COALESCE(p_min_quantity, 1), COALESCE(p_tier_promotion_steps, 0),
    COALESCE(p_valid_from, now()), p_valid_until, true, NULL,
    p_created_by_user_id
  )
  RETURNING * INTO v_new;

  RETURN jsonb_build_object(
    'new_coupon', to_jsonb(v_new),
    'replaced_ids', v_replaced_ids,
    'replaced_codes', v_replaced_codes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.replace_active_coupon(
  uuid, uuid, uuid, text, text, numeric, numeric, int, int,
  timestamptz, timestamptz, uuid
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.replace_active_coupon(
  uuid, uuid, uuid, text, text, numeric, numeric, int, int,
  timestamptz, timestamptz, uuid
) TO authenticated, service_role;

COMMENT ON FUNCTION public.replace_active_coupon(
  uuid, uuid, uuid, text, text, numeric, numeric, int, int,
  timestamptz, timestamptz, uuid
) IS
'mig-081: substituição atômica de cupom ativo de (clinic|doctor × produto). '
'Desativa o ativo anterior + insere o novo na mesma transação. Ver ADR-003.';

-- ── smoke ───────────────────────────────────────────────────────────────
DO $smoke$
DECLARE
  v_clinic uuid;
  v_user uuid;
  v_product uuid;
  v_first uuid;
  v_second_payload jsonb;
  v_old_active bool;
  v_new_id uuid;
  v_replaced_arr jsonb;
  v_replaced_count int;
BEGIN
  SELECT id INTO v_clinic FROM public.clinics LIMIT 1;
  SELECT id INTO v_user   FROM auth.users     LIMIT 1;
  -- Usa um produto qualquer (TIERED ou FIXED — replace é independente
  -- do pricing_mode; o guard de tipo novo é validado em camada superior).
  SELECT id INTO v_product FROM public.products WHERE pricing_mode='FIXED' LIMIT 1;

  IF v_clinic IS NULL OR v_user IS NULL OR v_product IS NULL THEN
    RAISE NOTICE 'mig081 smoke SKIP: pre-requisitos ausentes (clinic/user/product)';
    RETURN;
  END IF;

  BEGIN
    -- Cleanup defensivo: remove qualquer cupom MIG081_* prévio
    DELETE FROM public.coupons
     WHERE clinic_id = v_clinic
       AND product_id = v_product
       AND code LIKE 'MIG081_%';

    -- Cria primeiro cupom (PERCENT 5%).
    v_first := gen_random_uuid();
    INSERT INTO public.coupons(
      id, code, product_id, clinic_id, discount_type, discount_value,
      valid_from, active, activated_at, created_by_user_id
    ) VALUES (
      v_first, 'MIG081_FIRST_'||substring(v_first::text,1,8),
      v_product, v_clinic, 'PERCENT', 5,
      now(), true, now(), v_user
    );

    -- Substitui via RPC (FIXED R$ 7).
    v_second_payload := public.replace_active_coupon(
      p_product_id           => v_product,
      p_clinic_id            => v_clinic,
      p_doctor_id            => NULL,
      p_code                 => 'MIG081_SECOND_'||substring(gen_random_uuid()::text,1,8),
      p_discount_type        => 'FIXED',
      p_discount_value       => 7,
      p_max_discount_amount  => NULL,
      p_min_quantity         => NULL,
      p_tier_promotion_steps => NULL,
      p_valid_from           => now(),
      p_valid_until          => NULL,
      p_created_by_user_id   => v_user
    );

    -- Asserts:
    --  1) cupom antigo agora active=false
    SELECT active INTO v_old_active FROM public.coupons WHERE id = v_first;
    IF v_old_active IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'mig081 smoke FAIL: cupom antigo deveria estar inativo (active=%)', v_old_active;
    END IF;

    --  2) RPC retornou replaced_ids contendo o antigo
    v_replaced_arr := v_second_payload->'replaced_ids';
    SELECT count(*) INTO v_replaced_count
      FROM jsonb_array_elements_text(v_replaced_arr) e
     WHERE e = v_first::text;
    IF v_replaced_count <> 1 THEN
      RAISE EXCEPTION 'mig081 smoke FAIL: replaced_ids nao contem id antigo. payload: %', v_second_payload;
    END IF;

    --  3) cupom novo está ativo
    v_new_id := ((v_second_payload->'new_coupon')->>'id')::uuid;
    IF v_new_id IS NULL THEN
      RAISE EXCEPTION 'mig081 smoke FAIL: new_coupon.id ausente';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.coupons WHERE id = v_new_id AND active = true) THEN
      RAISE EXCEPTION 'mig081 smoke FAIL: cupom novo nao ficou ativo';
    END IF;

    --  4) só 1 ativo no total para esse (target × produto)
    IF (SELECT count(*) FROM public.coupons
         WHERE clinic_id = v_clinic AND product_id = v_product AND active = true) <> 1 THEN
      RAISE EXCEPTION 'mig081 smoke FAIL: invariante "1 ativo por target+product" violada';
    END IF;

    --  5) idempotência: chamar replace de novo sem cupom anterior nao falha
    PERFORM public.replace_active_coupon(
      p_product_id           => v_product,
      p_clinic_id            => v_clinic,
      p_doctor_id            => NULL,
      p_code                 => 'MIG081_THIRD_'||substring(gen_random_uuid()::text,1,8),
      p_discount_type        => 'FIXED',
      p_discount_value       => 8,
      p_max_discount_amount  => NULL,
      p_min_quantity         => NULL,
      p_tier_promotion_steps => NULL,
      p_valid_from           => now(),
      p_valid_until          => NULL,
      p_created_by_user_id   => v_user
    );

    RAISE NOTICE 'mig081 smoke OK: 5 cenarios (substituicao atomica + invariantes)';

    -- Cleanup
    DELETE FROM public.coupons
     WHERE clinic_id = v_clinic AND product_id = v_product AND code LIKE 'MIG081_%';
  EXCEPTION WHEN others THEN
    -- Cleanup mesmo em falha
    DELETE FROM public.coupons
     WHERE clinic_id = v_clinic AND product_id = v_product AND code LIKE 'MIG081_%';
    RAISE;
  END;
END $smoke$;

COMMIT;
