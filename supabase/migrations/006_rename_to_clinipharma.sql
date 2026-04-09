-- ============================================================
-- 006 — Renomeia plataforma: Clinipharma → Clinipharma
-- ============================================================

-- 1. Atualiza nome da plataforma em app_settings
UPDATE public.app_settings
  SET value_json = '"Clinipharma"',
      updated_at = now()
  WHERE key = 'platform_name';

UPDATE public.app_settings
  SET value_json = '"suporte@clinipharma.com.br"',
      updated_at = now()
  WHERE key = 'platform_support_email';

-- 2. Atualiza prefixo dos novos códigos de pedido: MED- → CP-
--    (pedidos existentes não são alterados)
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
