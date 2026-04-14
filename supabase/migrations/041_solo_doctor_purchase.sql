-- ============================================================
-- Migration 041 — Solo doctor purchase support
--
-- A doctor can now place orders directly (buyer_type = 'DOCTOR')
-- without being linked to any clinic. The pharmacy issues the
-- NF-e to the doctor's CPF. All existing orders retain
-- buyer_type = 'CLINIC' and behaviour is unchanged.
-- ============================================================

-- ── 1. doctors: new fields ────────────────────────────────────────────────────

ALTER TABLE public.doctors
  ADD COLUMN IF NOT EXISTS cpf         text UNIQUE,
  ADD COLUMN IF NOT EXISTS user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS crm_validated_at timestamptz;

COMMENT ON COLUMN public.doctors.cpf IS
  'CPF do médico. Obrigatório para compras solo (buyer_type=DOCTOR). Nullable no DB para compatibilidade com registros anteriores.';
COMMENT ON COLUMN public.doctors.user_id IS
  'FK para o usuário Supabase Auth do médico. Preferir esta FK ao invés de match por email.';
COMMENT ON COLUMN public.doctors.crm_validated_at IS
  'Timestamp da última validação do CRM via API do CFM. NULL = ainda não validado automaticamente.';

CREATE INDEX IF NOT EXISTS idx_doctors_user_id ON public.doctors(user_id);
CREATE INDEX IF NOT EXISTS idx_doctors_cpf     ON public.doctors(cpf);

-- ── 2. doctor_addresses — livro de endereços (estilo Amazon) ─────────────────

CREATE TABLE IF NOT EXISTS public.doctor_addresses (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id      uuid        NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  label          text        NOT NULL DEFAULT 'Principal',
  address_line_1 text        NOT NULL,
  address_line_2 text,
  city           text        NOT NULL,
  state          char(2)     NOT NULL,
  zip_code       text        NOT NULL,
  is_default     boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- At most one default address per doctor
CREATE UNIQUE INDEX IF NOT EXISTS idx_doctor_addresses_one_default
  ON public.doctor_addresses(doctor_id)
  WHERE is_default = true;

CREATE INDEX IF NOT EXISTS idx_doctor_addresses_doctor_id
  ON public.doctor_addresses(doctor_id);

-- Auto updated_at
CREATE OR REPLACE FUNCTION public.set_doctor_address_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_doctor_address_updated_at ON public.doctor_addresses;
CREATE TRIGGER trg_doctor_address_updated_at
  BEFORE UPDATE ON public.doctor_addresses
  FOR EACH ROW EXECUTE FUNCTION public.set_doctor_address_updated_at();

-- ── 3. orders: buyer abstraction ─────────────────────────────────────────────

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS buyer_type          text        NOT NULL DEFAULT 'CLINIC'
    CONSTRAINT orders_buyer_type_check CHECK (buyer_type IN ('CLINIC', 'DOCTOR')),
  ADD COLUMN IF NOT EXISTS delivery_address_id uuid
    REFERENCES public.doctor_addresses(id) ON DELETE RESTRICT;

-- clinic_id was already made nullable in migration 032; this comment clarifies intent
COMMENT ON COLUMN public.orders.clinic_id IS
  'Clínica compradora. Obrigatório quando buyer_type = ''CLINIC''. NULL quando buyer_type = ''DOCTOR''.';
COMMENT ON COLUMN public.orders.buyer_type IS
  'Entidade compradora: CLINIC (usa clinic_id + CNPJ) ou DOCTOR (usa doctor_id + CPF do médico).';
COMMENT ON COLUMN public.orders.delivery_address_id IS
  'Endereço de entrega do médico para pedidos solo. FK para doctor_addresses; ON DELETE RESTRICT para preservar histórico.';

-- Enforce buyer consistency
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_chk_buyer_entity;
ALTER TABLE public.orders ADD CONSTRAINT orders_chk_buyer_entity CHECK (
  (buyer_type = 'CLINIC'  AND clinic_id  IS NOT NULL) OR
  (buyer_type = 'DOCTOR'  AND doctor_id  IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_orders_buyer_type ON public.orders(buyer_type);

-- ── 4. coupons: support doctor target ────────────────────────────────────────

ALTER TABLE public.coupons
  ALTER COLUMN clinic_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS doctor_id uuid REFERENCES public.doctors(id) ON DELETE CASCADE;

-- At least one target must be set
ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_chk_target;
ALTER TABLE public.coupons ADD CONSTRAINT coupons_chk_target CHECK (
  clinic_id IS NOT NULL OR doctor_id IS NOT NULL
);

-- Unique active coupon per doctor+product (mirrors the existing clinic+product index)
DROP INDEX IF EXISTS idx_coupons_one_active_per_doctor_product;
CREATE UNIQUE INDEX idx_coupons_one_active_per_doctor_product
  ON public.coupons(doctor_id, product_id)
  WHERE active = true AND doctor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coupons_doctor_id ON public.coupons(doctor_id);

-- ── 5. RLS: doctor can see their own solo orders ──────────────────────────────
-- The existing RLS for orders allows doctors to see orders where doctor_id matches
-- their profile. Since we are now explicitly setting doctor_id on solo orders as
-- well, no new policy is required — the existing rule already covers this case.
-- (Verify: SELECT * FROM pg_policies WHERE tablename = 'orders' to confirm.)
