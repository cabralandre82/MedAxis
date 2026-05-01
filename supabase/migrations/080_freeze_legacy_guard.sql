-- Migration 080: freeze_order_item_price — defesa profunda contra cupom
-- de tipo novo (ADR-002) atribuído a produto FIXED.
--
-- Contexto
-- --------
-- A migração 079 ampliou os tipos de cupom suportados de 2 (PERCENT,
-- FIXED) para 5 (+ FIRST_UNIT_DISCOUNT, TIER_UPGRADE, MIN_QTY_PERCENT).
-- A nova lógica vive em `compute_unit_price`, que é chamada pelo branch
-- TIERED_PROFILE de `freeze_order_item_price` — e portanto é entendida
-- corretamente.
--
-- Já o branch FIXED (legacy) tem um CASE hardcoded que só conhece
-- PERCENT e FIXED. Sem este guarda, um cupom de TIER_UPGRADE associado
-- por engano a um produto FIXED cairia no `ELSE` do branch legacy,
-- aplicando `LEAST(discount_value, price) * quantity` — desconto
-- calculado errado, sem nenhum aviso.
--
-- Mitigação
-- ---------
-- - Camada 1 (services/coupons.ts): a server action createCoupon
--   bloqueia atribuição de cupom novo a produto FIXED (mensagem
--   amigável). Cobre 100% dos fluxos via UI.
--
-- - Camada 2 (esta migração): se algo passar pela camada 1 (atribuição
--   manual via SQL, atualização de pricing_mode após criação, etc.),
--   a trigger erra alto e claro em vez de freezar valor errado.
--
-- Roll-forward only. Crash em vez de silêncio.

BEGIN;

CREATE OR REPLACE FUNCTION public.freeze_order_item_price()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_pricing_mode  text;

  -- Legacy (FIXED) locals
  v_price          numeric(12, 2);
  v_pharmacy_cost  numeric(12, 2);
  v_disc_type      text;
  v_disc_value     numeric(10, 4);
  v_max_disc       numeric(10, 2);
  v_discount       numeric(12, 2) := 0;

  -- Tiered locals
  v_clinic_id     uuid;
  v_doctor_id     uuid;
  v_breakdown     jsonb;
  v_final_cents   bigint;
  v_tier_cents    bigint;
  v_pharm_cents   bigint;
  v_plat_cents    bigint;
  v_profile_id    uuid;
  v_resolved_coupon_id uuid;
  v_quantity      int;
BEGIN
  SELECT pricing_mode INTO v_pricing_mode
    FROM public.products
   WHERE id = NEW.product_id;

  IF v_pricing_mode = 'TIERED_PROFILE' THEN
    SELECT clinic_id, doctor_id INTO v_clinic_id, v_doctor_id
      FROM public.orders WHERE id = NEW.order_id;

    v_quantity := NEW.quantity;

    v_breakdown := public.compute_unit_price(
      NEW.product_id, v_quantity, v_clinic_id, v_doctor_id,
      NEW.coupon_id, now()
    );

    IF v_breakdown ? 'error' THEN
      RAISE EXCEPTION 'freeze_order_item_price: tiered pricing failed for product % qty %: %',
        NEW.product_id, v_quantity, v_breakdown
        USING ERRCODE = 'P0001';
    END IF;

    v_final_cents := (v_breakdown ->> 'final_unit_price_cents')::bigint;
    v_tier_cents  := (v_breakdown ->> 'tier_unit_cents')::bigint;
    v_pharm_cents := (v_breakdown ->> 'pharmacy_cost_unit_cents')::bigint;
    v_plat_cents  := (v_breakdown ->> 'platform_commission_per_unit_cents')::bigint;
    v_profile_id  := (v_breakdown ->> 'pricing_profile_id')::uuid;
    v_resolved_coupon_id := NULLIF(v_breakdown ->> 'coupon_id', '')::uuid;

    NEW.unit_price                         := (v_final_cents::numeric / 100)::numeric(12, 2);
    NEW.original_total_price               := (v_tier_cents::numeric * v_quantity / 100)::numeric(12, 2);
    NEW.total_price                        := (v_final_cents::numeric * v_quantity / 100)::numeric(12, 2);
    NEW.discount_amount                    := NEW.original_total_price - NEW.total_price;
    NEW.pharmacy_cost_per_unit             := (v_pharm_cents::numeric / 100)::numeric(12, 2);
    NEW.platform_commission_per_unit       := (v_plat_cents::numeric / 100)::numeric(12, 2);

    NEW.unit_price_cents                   := v_final_cents;
    NEW.total_price_cents                  := v_final_cents * v_quantity;
    NEW.pharmacy_cost_per_unit_cents       := v_pharm_cents;
    NEW.platform_commission_per_unit_cents := v_plat_cents;

    NEW.pricing_profile_id := v_profile_id;
    NEW.coupon_id := v_resolved_coupon_id;

    IF v_resolved_coupon_id IS NOT NULL THEN
      UPDATE public.coupons
         SET used_count = used_count + 1
       WHERE id = v_resolved_coupon_id;
    END IF;

    RETURN NEW;
  END IF;

  -- ── Legacy FIXED branch (preservado bit-a-bit do mig-067) ────────────
  SELECT price_current, pharmacy_cost
  INTO   v_price, v_pharmacy_cost
  FROM   public.products
  WHERE  id = NEW.product_id;

  NEW.unit_price                   := v_price;
  NEW.original_total_price         := v_price * NEW.quantity;
  NEW.pharmacy_cost_per_unit       := v_pharmacy_cost;
  NEW.platform_commission_per_unit := v_price - v_pharmacy_cost;

  IF NEW.coupon_id IS NOT NULL THEN
    SELECT discount_type, discount_value, max_discount_amount
    INTO   v_disc_type, v_disc_value, v_max_disc
    FROM   public.coupons
    WHERE  id           = NEW.coupon_id
      AND  active       = true
      AND  activated_at IS NOT NULL
      AND  (valid_until IS NULL OR valid_until >= now());

    IF FOUND THEN
      -- ADR-002 / mig-080: defesa profunda.
      -- O branch legacy só sabe lidar com PERCENT e FIXED. Os tipos novos
      -- (FIRST_UNIT_DISCOUNT, TIER_UPGRADE, MIN_QTY_PERCENT) só fazem
      -- sentido em TIERED_PROFILE e são bloqueados na criação por
      -- services/coupons.ts. Se algum cair aqui (atribuição manual,
      -- mudança de pricing_mode pós-criação), abortamos em vez de
      -- aplicar matemática errada.
      IF v_disc_type NOT IN ('PERCENT', 'FIXED') THEN
        RAISE EXCEPTION 'freeze_order_item_price: cupom % do tipo % é incompatível com produto pricing_mode=FIXED. Tipos novos exigem TIERED_PROFILE. (ADR-002)',
          NEW.coupon_id, v_disc_type
          USING ERRCODE = 'P0001';
      END IF;

      IF v_disc_type = 'PERCENT' THEN
        v_discount := ROUND((v_price * v_disc_value / 100.0) * NEW.quantity, 2);
        IF v_max_disc IS NOT NULL THEN
          v_discount := LEAST(v_discount, v_max_disc);
        END IF;
      ELSE
        v_discount := ROUND(LEAST(v_disc_value, v_price) * NEW.quantity, 2);
      END IF;

      NEW.discount_amount := v_discount;
      NEW.total_price     := NEW.original_total_price - v_discount;

      UPDATE public.coupons
         SET used_count = used_count + 1
       WHERE id = NEW.coupon_id;
    ELSE
      NEW.coupon_id := NULL;
      NEW.total_price := NEW.original_total_price;
    END IF;
  ELSE
    NEW.total_price := NEW.original_total_price;
  END IF;

  -- mig-067 cents sync (preservado)
  NEW.unit_price_cents                   := ROUND(NEW.unit_price * 100)::bigint;
  NEW.total_price_cents                  := ROUND(NEW.total_price * 100)::bigint;
  NEW.pharmacy_cost_per_unit_cents       := ROUND(NEW.pharmacy_cost_per_unit * 100)::bigint;
  NEW.platform_commission_per_unit_cents := ROUND(NEW.platform_commission_per_unit * 100)::bigint;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.freeze_order_item_price()
IS 'mig-080: branch legacy FIXED erra explicitamente para discount_type ∉ {PERCENT,FIXED} (ADR-002).';

-- ── smoke ───────────────────────────────────────────────────────────────
-- Validação leve: confere que o RAISE de defesa-em-profundidade está
-- presente no corpo da função instalada. Não simula INSERT em
-- order_items aqui (depende de N colunas NOT NULL e fixtures pesadas);
-- a cobertura comportamental fica nos testes Vitest e na camada 1
-- (services/coupons.ts). Aqui é só "código instalado bate com fonte?".
DO $smoke$
DECLARE
  v_src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'freeze_order_item_price';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'mig080 smoke FAIL: freeze_order_item_price ausente';
  END IF;
  IF v_src NOT LIKE '%incompatível com produto pricing_mode=FIXED%' THEN
    RAISE EXCEPTION 'mig080 smoke FAIL: guarda de tipo novo nao instalada';
  END IF;
  IF v_src NOT LIKE '%TIERED_PROFILE%' THEN
    RAISE EXCEPTION 'mig080 smoke FAIL: branch tiered ausente';
  END IF;
  RAISE NOTICE 'mig080 smoke OK: defesa profunda instalada';
END $smoke$;

COMMIT;
