-- ============================================================
-- Clinipharma — Migration 002: Functions & Triggers
-- ============================================================

-- ========================
-- Auto-update updated_at
-- ========================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE OR REPLACE TRIGGER trg_clinics_updated_at
  BEFORE UPDATE ON public.clinics
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE OR REPLACE TRIGGER trg_doctors_updated_at
  BEFORE UPDATE ON public.doctors
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE OR REPLACE TRIGGER trg_pharmacies_updated_at
  BEFORE UPDATE ON public.pharmacies
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE OR REPLACE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE OR REPLACE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE OR REPLACE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE OR REPLACE TRIGGER trg_transfers_updated_at
  BEFORE UPDATE ON public.transfers
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ========================
-- Auto-create profile on signup
-- ========================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER trg_auth_users_new_user
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ========================
-- Order code generator: MED-YYYY-NNNNNN
-- ========================
CREATE SEQUENCE IF NOT EXISTS public.order_code_seq START 1;

CREATE OR REPLACE FUNCTION public.generate_order_code()
RETURNS TRIGGER AS $$
DECLARE
  v_year  text;
  v_seq   bigint;
  v_code  text;
BEGIN
  v_year := to_char(now(), 'YYYY');
  v_seq  := nextval('public.order_code_seq');
  v_code := 'CP-' || v_year || '-' || lpad(v_seq::text, 6, '0');
  NEW.code := v_code;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_orders_generate_code
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  WHEN (NEW.code IS NULL OR NEW.code = '')
  EXECUTE FUNCTION public.generate_order_code();

-- ========================
-- Freeze price on order creation
-- ========================
CREATE OR REPLACE FUNCTION public.freeze_order_price()
RETURNS TRIGGER AS $$
DECLARE
  v_price numeric(10,2);
BEGIN
  SELECT price_current INTO v_price
  FROM public.products
  WHERE id = NEW.product_id;

  NEW.unit_price := v_price;
  NEW.total_price := v_price * NEW.quantity;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_orders_freeze_price
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.freeze_order_price();

-- ========================
-- Auto-record status history
-- ========================
CREATE OR REPLACE FUNCTION public.record_order_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.order_status IS DISTINCT FROM NEW.order_status THEN
    INSERT INTO public.order_status_history (
      order_id, old_status, new_status, changed_by_user_id
    ) VALUES (
      NEW.id, OLD.order_status, NEW.order_status, NEW.created_by_user_id
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_orders_status_history
  AFTER UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.record_order_status_change();

-- ========================
-- Default app settings
-- ========================
INSERT INTO public.app_settings (key, value_json, description)
VALUES
  ('default_commission_percentage', '15', 'Percentual de comissão padrão da plataforma (%)'),
  ('platform_name', '"Clinipharma"', 'Nome da plataforma'),
  ('platform_support_email', '"suporte@clinipharma.com.br"', 'Email de suporte')
ON CONFLICT (key) DO NOTHING;
