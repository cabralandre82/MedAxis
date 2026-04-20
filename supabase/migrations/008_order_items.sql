-- ============================================================
-- 008 — Múltiplos produtos por pedido: tabela order_items
-- ============================================================

-- 1. Cria tabela order_items
CREATE TABLE IF NOT EXISTS public.order_items (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                      uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id                    uuid NOT NULL REFERENCES public.products(id),
  quantity                      int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price                    numeric(12, 2) NOT NULL,
  total_price                   numeric(12, 2) NOT NULL,
  pharmacy_cost_per_unit        numeric(12, 2),
  platform_commission_per_unit  numeric(12, 2),
  created_at                    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_items_order ON public.order_items(order_id);
CREATE INDEX idx_order_items_product ON public.order_items(product_id);

-- 2. Trigger: congela preço e custos no INSERT de cada item
CREATE OR REPLACE FUNCTION public.freeze_order_item_price()
RETURNS TRIGGER AS $$
DECLARE
  v_price         numeric(12, 2);
  v_pharmacy_cost numeric(12, 2);
BEGIN
  SELECT price_current, pharmacy_cost
  INTO   v_price, v_pharmacy_cost
  FROM   public.products
  WHERE  id = NEW.product_id;

  NEW.unit_price                   := v_price;
  NEW.total_price                  := v_price * NEW.quantity;
  NEW.pharmacy_cost_per_unit       := v_pharmacy_cost;
  NEW.platform_commission_per_unit := v_price - v_pharmacy_cost;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_order_items_freeze_price
  BEFORE INSERT ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.freeze_order_item_price();

-- 3. Trigger: recalcula total do pedido após insert/update/delete em order_items
CREATE OR REPLACE FUNCTION public.recalc_order_total()
RETURNS TRIGGER AS $$
DECLARE
  v_order_id uuid;
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);

  UPDATE public.orders
  SET total_price = (
        SELECT COALESCE(SUM(total_price), 0)
        FROM   public.order_items
        WHERE  order_id = v_order_id
      ),
      updated_at = now()
  WHERE id = v_order_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_order_items_recalc_total
  AFTER INSERT OR UPDATE OR DELETE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.recalc_order_total();

-- 4. Remove colunas de item do cabeçalho orders (migra dados existentes primeiro)
--    Migra pedidos existentes → cria um order_item por pedido
INSERT INTO public.order_items (
  order_id, product_id, quantity,
  unit_price, total_price,
  pharmacy_cost_per_unit, platform_commission_per_unit
)
SELECT
  id, product_id, quantity,
  unit_price, total_price,
  pharmacy_cost_per_unit, platform_commission_per_unit
FROM public.orders
WHERE product_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 5. Remove colunas que agora vivem em order_items
ALTER TABLE public.orders
  DROP COLUMN IF EXISTS product_id,
  DROP COLUMN IF EXISTS quantity,
  DROP COLUMN IF EXISTS unit_price,
  DROP COLUMN IF EXISTS pharmacy_cost_per_unit,
  DROP COLUMN IF EXISTS platform_commission_per_unit;

-- @retired: price-freeze moved from public.orders to public.order_items
-- (see trg_order_items_freeze_price above). No caller references the
-- old trigger after this migration — intentional, final retirement.
DROP TRIGGER IF EXISTS trg_orders_freeze_price ON public.orders;

-- 6. RLS para order_items
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

-- Admins veem tudo
CREATE POLICY "Admins full access order_items"
  ON public.order_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role IN ('SUPER_ADMIN', 'PLATFORM_ADMIN')
    )
  );

-- Clínicas veem itens dos seus pedidos
CREATE POLICY "Clinic members read own order_items"
  ON public.order_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      JOIN public.clinic_members cm ON cm.clinic_id = o.clinic_id
      WHERE o.id = order_items.order_id
        AND cm.user_id = auth.uid()
    )
  );

-- Farmácias veem itens dos pedidos atribuídos a elas
CREATE POLICY "Pharmacy members read assigned order_items"
  ON public.order_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      JOIN public.pharmacy_members pm ON pm.pharmacy_id = o.pharmacy_id
      WHERE o.id = order_items.order_id
        AND pm.user_id = auth.uid()
    )
  );

-- Médicos veem itens dos seus pedidos
CREATE POLICY "Doctors read own order_items"
  ON public.order_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND o.created_by_user_id = auth.uid()
    )
  );
