-- ============================================================
-- 027 — Cupons de desconto por produto (por clínica)
-- ============================================================
-- Regras de negócio:
--   • Cupom é sempre vinculado a um produto específico e a uma clínica específica
--   • Desconto é por unidade (PERCENT ou FIXED)
--   • A plataforma absorve integralmente o desconto
--   • Apenas um cupom pode estar ativo por par (clinic_id, product_id)
--   • A clínica ativa o cupom uma única vez via código
--   • O desconto é aplicado automaticamente em pedidos futuros
-- ============================================================

-- 1. Tabela principal de cupons
CREATE TABLE IF NOT EXISTS public.coupons (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 text        NOT NULL UNIQUE,
  product_id           uuid        NOT NULL REFERENCES public.products(id),
  clinic_id            uuid        NOT NULL REFERENCES public.clinics(id),
  discount_type        text        NOT NULL CHECK (discount_type IN ('PERCENT', 'FIXED')),
  discount_value       numeric(10, 4) NOT NULL CHECK (discount_value > 0),
  -- Para PERCENT: teto em R$ (evita descontos absurdos em lotes grandes)
  max_discount_amount  numeric(10, 2),
  valid_from           timestamptz NOT NULL DEFAULT now(),
  valid_until          timestamptz,          -- null = sem vencimento
  activated_at         timestamptz,          -- null = aguardando ativação pela clínica
  active               boolean     NOT NULL DEFAULT true,
  created_by_user_id   uuid        NOT NULL REFERENCES public.profiles(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Garante no máximo um cupom ATIVO por par clinic+product
CREATE UNIQUE INDEX idx_coupons_one_active_per_clinic_product
  ON public.coupons(clinic_id, product_id)
  WHERE active = true;

-- Índices operacionais
CREATE INDEX idx_coupons_clinic_id    ON public.coupons(clinic_id);
CREATE INDEX idx_coupons_product_id   ON public.coupons(product_id);
CREATE INDEX idx_coupons_code         ON public.coupons(code);
CREATE INDEX idx_coupons_active_valid ON public.coupons(active, valid_until);

-- Trigger: updated_at automático
CREATE OR REPLACE FUNCTION public.set_coupon_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_coupon_updated_at
  BEFORE UPDATE ON public.coupons
  FOR EACH ROW EXECUTE FUNCTION public.set_coupon_updated_at();

-- ============================================================
-- 2. Novas colunas em order_items (retrocompatíveis)
-- ============================================================
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS coupon_id            uuid        REFERENCES public.coupons(id),
  ADD COLUMN IF NOT EXISTS discount_amount      numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS original_total_price numeric(12, 2);

-- ============================================================
-- 3. Atualiza trigger freeze_order_item_price para aplicar desconto
-- ============================================================
CREATE OR REPLACE FUNCTION public.freeze_order_item_price()
RETURNS TRIGGER AS $$
DECLARE
  v_price          numeric(12, 2);
  v_pharmacy_cost  numeric(12, 2);
  v_disc_type      text;
  v_disc_value     numeric(10, 4);
  v_max_disc       numeric(10, 2);
  v_discount       numeric(12, 2) := 0;
BEGIN
  -- Congela preço atual do produto
  SELECT price_current, pharmacy_cost
  INTO   v_price, v_pharmacy_cost
  FROM   public.products
  WHERE  id = NEW.product_id;

  NEW.unit_price                   := v_price;
  NEW.original_total_price         := v_price * NEW.quantity;
  NEW.pharmacy_cost_per_unit       := v_pharmacy_cost;
  NEW.platform_commission_per_unit := v_price - v_pharmacy_cost;

  -- Aplica desconto se coupon_id foi fornecido e é válido
  IF NEW.coupon_id IS NOT NULL THEN
    SELECT discount_type, discount_value, max_discount_amount
    INTO   v_disc_type, v_disc_value, v_max_disc
    FROM   public.coupons
    WHERE  id           = NEW.coupon_id
      AND  active       = true
      AND  activated_at IS NOT NULL
      AND  (valid_until IS NULL OR valid_until >= now());

    IF FOUND THEN
      IF v_disc_type = 'PERCENT' THEN
        -- Desconto percentual por unidade × quantidade
        v_discount := ROUND((v_price * v_disc_value / 100.0) * NEW.quantity, 2);
        IF v_max_disc IS NOT NULL THEN
          v_discount := LEAST(v_discount, v_max_disc);
        END IF;
      ELSE
        -- Desconto fixo por unidade (não pode exceder o preço unitário)
        v_discount := ROUND(LEAST(v_disc_value, v_price) * NEW.quantity, 2);
      END IF;
    ELSE
      -- Cupom inválido no momento da criação do item: limpa silenciosamente
      NEW.coupon_id := NULL;
    END IF;
  END IF;

  NEW.discount_amount := v_discount;
  -- A plataforma absorve: total pago pela clínica é o valor já descontado
  NEW.total_price     := NEW.original_total_price - v_discount;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 4. RLS para coupons
-- ============================================================
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

-- Admins veem e gerenciam tudo
CREATE POLICY "Admins full access coupons"
  ON public.coupons FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role IN ('SUPER_ADMIN', 'PLATFORM_ADMIN')
    )
  );

-- Clínicas veem apenas seus próprios cupons
CREATE POLICY "Clinic members read own coupons"
  ON public.coupons FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.clinic_members
      WHERE clinic_id = coupons.clinic_id
        AND user_id   = auth.uid()
    )
  );
