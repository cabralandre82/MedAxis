-- ============================================================
-- Migration 030 — Prescription enforcement
-- ============================================================
-- Adds prescription control to the products table and creates
-- order_item_prescriptions for per-unit prescription tracking.
--
-- Business rules implemented here:
--   1. products.requires_prescription — gate for any prescription upload
--   2. products.prescription_type     — regulatory category (display / future automation)
--   3. products.max_units_per_prescription — NULL = one receipt covers all units;
--                                            N    = one receipt covers N units
--                                            (1 = one receipt per unit, strictest case)
--   4. order_item_prescriptions — one row per uploaded prescription per order item.
--      When max_units_per_prescription IS NULL, a single row satisfies any quantity.
--      When max_units_per_prescription = 1 and quantity = 5, five rows are required.
-- ============================================================

-- ── 1. Products: prescription control columns ─────────────────────────────────

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS requires_prescription       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS prescription_type           text
    CHECK (prescription_type IN ('SIMPLE', 'SPECIAL_CONTROL', 'ANTIMICROBIAL')),
  ADD COLUMN IF NOT EXISTS max_units_per_prescription  integer
    CHECK (max_units_per_prescription IS NULL OR max_units_per_prescription >= 1);

COMMENT ON COLUMN public.products.requires_prescription IS
  'Se true, pedidos com este produto só avançam de AWAITING_DOCUMENTS após receita enviada.';

COMMENT ON COLUMN public.products.prescription_type IS
  'Categoria regulatória: SIMPLE (receita comum), SPECIAL_CONTROL (Lista B1/B2/C1 Portaria 344), ANTIMICROBIAL (receita antimicrobiano).';

COMMENT ON COLUMN public.products.max_units_per_prescription IS
  'NULL = uma receita cobre qualquer quantidade. 1 = uma receita por unidade (p.ex. controlado especial). N = uma receita por N unidades.';

-- ── 2. order_item_prescriptions ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.order_item_prescriptions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id       uuid NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  order_id            uuid NOT NULL REFERENCES public.orders(id)      ON DELETE CASCADE,
  storage_path        text NOT NULL,
  original_filename   text NOT NULL,
  mime_type           text NOT NULL,
  file_size           bigint NOT NULL,
  -- Optional metadata the clinic can fill for traceability (not validated by platform)
  patient_name        text,
  prescription_number text,
  units_covered       integer NOT NULL DEFAULT 1
    CHECK (units_covered >= 1),
  uploaded_by_user_id uuid NOT NULL REFERENCES public.profiles(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.order_item_prescriptions IS
  'One row per prescription uploaded for a specific order item. '
  'For max_units_per_prescription=1 products, sum(units_covered) must equal order_item.quantity.';

CREATE INDEX IF NOT EXISTS idx_oip_order_item ON public.order_item_prescriptions(order_item_id);
CREATE INDEX IF NOT EXISTS idx_oip_order      ON public.order_item_prescriptions(order_id);

-- ── 3. RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.order_item_prescriptions ENABLE ROW LEVEL SECURITY;

-- Clinic members can read prescriptions for their own orders
CREATE POLICY "oip_select_clinic" ON public.order_item_prescriptions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      JOIN public.clinic_members cm ON cm.clinic_id = o.clinic_id
      WHERE o.id = order_item_prescriptions.order_id
        AND cm.user_id = auth.uid()
    )
  );

-- Pharmacy members can read prescriptions for orders assigned to their pharmacy
CREATE POLICY "oip_select_pharmacy" ON public.order_item_prescriptions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      JOIN public.pharmacy_members pm ON pm.pharmacy_id = o.pharmacy_id
      WHERE o.id = order_item_prescriptions.order_id
        AND pm.user_id = auth.uid()
    )
  );

-- Admin can read all
CREATE POLICY "oip_select_admin" ON public.order_item_prescriptions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('SUPER_ADMIN', 'PLATFORM_ADMIN')
    )
  );

-- Only authenticated users who belong to the clinic can insert
CREATE POLICY "oip_insert_clinic" ON public.order_item_prescriptions
  FOR INSERT WITH CHECK (
    uploaded_by_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.orders o
      JOIN public.clinic_members cm ON cm.clinic_id = o.clinic_id
      WHERE o.id = order_item_prescriptions.order_id
        AND cm.user_id = auth.uid()
    )
  );

-- No UPDATE/DELETE — prescriptions are immutable once uploaded (audit trail)
-- Admin soft-management via service-role client only.
