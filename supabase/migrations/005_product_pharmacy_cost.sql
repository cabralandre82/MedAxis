-- ============================================================
-- 005 — Comissão por produto: pharmacy_cost + congelamento
-- ============================================================

-- 1. Custo obrigatório de repasse à farmácia por unidade
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS pharmacy_cost numeric(12, 2) NOT NULL DEFAULT 0.00;

-- 2. Campos congelados no momento da criação do pedido
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS pharmacy_cost_per_unit    numeric(12, 2),
  ADD COLUMN IF NOT EXISTS platform_commission_per_unit numeric(12, 2);

-- 3. Atualiza o trigger de congelamento para incluir pharmacy_cost
CREATE OR REPLACE FUNCTION public.freeze_order_price()
RETURNS TRIGGER AS $$
DECLARE
  v_price         numeric(12, 2);
  v_pharmacy_cost numeric(12, 2);
BEGIN
  SELECT price_current, pharmacy_cost
  INTO   v_price, v_pharmacy_cost
  FROM   public.products
  WHERE  id = NEW.product_id;

  NEW.unit_price                  := v_price;
  NEW.total_price                 := v_price * NEW.quantity;
  NEW.pharmacy_cost_per_unit      := v_pharmacy_cost;
  NEW.platform_commission_per_unit := v_price - v_pharmacy_cost;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Taxa de comissão dos consultores — agora global, não por consultor
ALTER TABLE public.sales_consultants
  DROP COLUMN IF EXISTS commission_rate;

-- 5. Atualiza app_settings:
--    - remove default_commission_percentage (agora é por produto)
--    - adiciona consultant_commission_rate (global para todos os consultores)
DELETE FROM public.app_settings WHERE key = 'default_commission_percentage';

INSERT INTO public.app_settings (key, value_json, description)
VALUES (
  'consultant_commission_rate',
  '5',
  'Taxa de comissão dos consultores de vendas (%) — aplica-se a todos os consultores'
)
ON CONFLICT (key) DO NOTHING;
