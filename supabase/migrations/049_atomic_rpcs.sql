-- Migration 049: atomic RPCs for order / coupon / payment critical sections (Wave 7).
--
-- Purpose
-- -------
-- Replace the three multi-step service flows that currently rely on "check
-- then act" patterns in application code with SECURITY DEFINER functions
-- whose body runs inside the single statement transaction Postgres gives us
-- for free:
--
--   1. public.apply_coupon_atomic(code, user_id)
--        — atomically flips a coupon from "assigned, not activated" to
--          "activated", returning the full row. Replaces the
--          SELECT+UPDATE race in services/coupons.ts::activateCoupon.
--
--   2. public.confirm_payment_atomic(payment_id, args jsonb)
--        — transitions a payment PENDING → CONFIRMED and inserts the
--          downstream commission / transfer / consultant_commission rows
--          in the same transaction, guarded by a new `lock_version`
--          optimistic concurrency field on `payments` and `orders`.
--
--   3. public.create_order_atomic(args jsonb)
--        — wraps the orders + order_items + order_status_history
--          inserts in a single transaction. The coupon auto-detection
--          still happens in application code (it reads across roles
--          and respects FK ownership), but the WRITE path is now a
--          single round trip that can never leave half of the
--          cluster committed.
--
-- Schema additions (additive, safe)
-- ---------------------------------
--   - `public.orders.lock_version`   int NOT NULL DEFAULT 1
--   - `public.payments.lock_version` int NOT NULL DEFAULT 1
--
-- `coupons` deliberately has no `lock_version`: its activation state is a
-- single nullable timestamp (`activated_at`), so the atomic UPDATE of that
-- column IS the lock.
--
-- Rollback
-- --------
--   DROP FUNCTION IF EXISTS public.apply_coupon_atomic(text, uuid);
--   DROP FUNCTION IF EXISTS public.confirm_payment_atomic(uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.create_order_atomic(jsonb);
--   ALTER TABLE public.orders   DROP COLUMN IF EXISTS lock_version;
--   ALTER TABLE public.payments DROP COLUMN IF EXISTS lock_version;
--
-- Idempotency: every statement is wrapped in IF NOT EXISTS / CREATE OR
-- REPLACE so the file can be re-applied safely.

SET search_path TO public, extensions, pg_temp;

-- ── Columns ──────────────────────────────────────────────────────────────

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS lock_version int NOT NULL DEFAULT 1;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS lock_version int NOT NULL DEFAULT 1;

-- Index only useful for analytics / debugging drift. Not required for the
-- RPC — the RPC scans by PK + lock_version equality.
CREATE INDEX IF NOT EXISTS idx_orders_lock_version
  ON public.orders (lock_version)
  WHERE lock_version > 1;

CREATE INDEX IF NOT EXISTS idx_payments_lock_version
  ON public.payments (lock_version)
  WHERE lock_version > 1;

-- ── 1. apply_coupon_atomic ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.apply_coupon_atomic(
  p_code text,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row       public.coupons%ROWTYPE;
  v_membership_clinic uuid;
  v_doctor_id uuid;
BEGIN
  IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
    RAISE EXCEPTION 'invalid_code' USING ERRCODE = 'P0001';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_user' USING ERRCODE = 'P0001';
  END IF;

  -- Resolve caller ownership context once. The WHERE clause on UPDATE
  -- uses these to prevent cross-tenant activation even if a caller
  -- crafts a valid-but-foreign code.
  SELECT clinic_id INTO v_membership_clinic
    FROM public.clinic_members
   WHERE user_id = p_user_id
   LIMIT 1;

  SELECT id INTO v_doctor_id
    FROM public.doctors
   WHERE user_id = p_user_id
   LIMIT 1;

  IF v_membership_clinic IS NULL AND v_doctor_id IS NULL THEN
    RAISE EXCEPTION 'user_not_linked' USING ERRCODE = 'P0001';
  END IF;

  -- The critical section. A concurrent second caller with the same code
  -- sees `activated_at IS NOT NULL` and UPDATE matches zero rows,
  -- yielding a clean `already_activated` error instead of a silent
  -- second activation.
  UPDATE public.coupons
     SET activated_at = now(),
         updated_at   = now()
   WHERE code = upper(trim(p_code))
     AND active = true
     AND activated_at IS NULL
     AND (valid_until IS NULL OR valid_until >= now())
     AND (
           (clinic_id IS NOT NULL AND clinic_id = v_membership_clinic)
        OR (doctor_id IS NOT NULL AND doctor_id = v_doctor_id)
     )
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    -- Distinguish "not found / expired / cross-tenant" from "already used"
    -- so the TS wrapper can map to the right user-facing message.
    IF EXISTS (
      SELECT 1 FROM public.coupons
       WHERE code = upper(trim(p_code))
         AND active = true
         AND activated_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'already_activated' USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'not_found_or_forbidden' USING ERRCODE = 'P0001';
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

COMMENT ON FUNCTION public.apply_coupon_atomic(text, uuid) IS
  'Wave 7 — atomic coupon activation. Replaces SELECT+UPDATE race in services/coupons.ts::activateCoupon. Raises P0001 with reason (invalid_code, invalid_user, user_not_linked, already_activated, not_found_or_forbidden).';

GRANT EXECUTE ON FUNCTION public.apply_coupon_atomic(text, uuid) TO authenticated, service_role;

-- ── 2. confirm_payment_atomic ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.confirm_payment_atomic(
  p_payment_id uuid,
  p_args jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment              public.payments%ROWTYPE;
  v_order                public.orders%ROWTYPE;
  v_expected_lock        int;
  v_pharmacy_transfer    numeric(10,2);
  v_platform_commission  numeric(10,2);
  v_consultant_id        uuid;
  v_consultant_rate      numeric;
  v_consultant_commission numeric(10,2);
BEGIN
  IF p_payment_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payment' USING ERRCODE = 'P0001';
  END IF;
  IF p_args IS NULL OR (p_args ? 'confirmed_by_user_id') = false THEN
    RAISE EXCEPTION 'invalid_args' USING ERRCODE = 'P0001';
  END IF;

  v_expected_lock := COALESCE((p_args ->> 'expected_lock_version')::int, 0);

  -- Atomic status transition. If another confirmer already moved the
  -- payment to CONFIRMED, `lock_version` will no longer match the expected
  -- value (which defaults to the row's current one in the TS wrapper) and
  -- the UPDATE will match 0 rows.
  UPDATE public.payments
     SET status              = 'CONFIRMED',
         payment_method      = COALESCE(p_args ->> 'payment_method', payment_method),
         reference_code      = NULLIF(p_args ->> 'reference_code', ''),
         notes               = NULLIF(p_args ->> 'notes', ''),
         confirmed_by_user_id= (p_args ->> 'confirmed_by_user_id')::uuid,
         confirmed_at        = now(),
         updated_at          = now(),
         lock_version        = lock_version + 1
   WHERE id = p_payment_id
     AND status = 'PENDING'
     AND (v_expected_lock = 0 OR lock_version = v_expected_lock)
  RETURNING * INTO v_payment;

  IF NOT FOUND THEN
    -- Distinguish "already confirmed" from "stale version" so the caller
    -- can retry on stale but abort on already-confirmed.
    IF EXISTS (SELECT 1 FROM public.payments WHERE id = p_payment_id AND status <> 'PENDING') THEN
      RAISE EXCEPTION 'already_processed' USING ERRCODE = 'P0001';
    END IF;
    IF v_expected_lock > 0 AND EXISTS (SELECT 1 FROM public.payments WHERE id = p_payment_id) THEN
      RAISE EXCEPTION 'stale_version' USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Load the companion order once; subsequent updates reuse it.
  SELECT * INTO v_order FROM public.orders WHERE id = v_payment.order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Sum frozen cost columns from order_items.
  SELECT
      round(coalesce(sum(pharmacy_cost_per_unit * quantity), 0)::numeric, 2),
      round(coalesce(sum(platform_commission_per_unit * quantity), 0)::numeric, 2)
    INTO v_pharmacy_transfer, v_platform_commission
    FROM public.order_items
   WHERE order_id = v_payment.order_id;

  INSERT INTO public.commissions (
    order_id, commission_type, commission_fixed_amount,
    commission_total_amount, calculated_by_user_id
  ) VALUES (
    v_payment.order_id, 'FIXED', v_platform_commission,
    v_platform_commission, (p_args ->> 'confirmed_by_user_id')::uuid
  );

  INSERT INTO public.transfers (
    order_id, pharmacy_id, gross_amount, commission_amount, net_amount, status
  ) VALUES (
    v_payment.order_id, v_order.pharmacy_id,
    v_order.total_price, v_platform_commission, v_pharmacy_transfer,
    'PENDING'
  );

  -- Consultant commission is optional — only if the clinic has one.
  IF v_order.clinic_id IS NOT NULL THEN
    SELECT consultant_id INTO v_consultant_id
      FROM public.clinics WHERE id = v_order.clinic_id;

    IF v_consultant_id IS NOT NULL THEN
      SELECT COALESCE((value_json::text)::numeric, 5)
        INTO v_consultant_rate
        FROM public.app_settings
       WHERE key = 'consultant_commission_rate'
       LIMIT 1;
      v_consultant_rate := COALESCE(v_consultant_rate, 5);
      v_consultant_commission := round(v_order.total_price * v_consultant_rate / 100, 2);

      INSERT INTO public.consultant_commissions (
        order_id, consultant_id, order_total,
        commission_rate, commission_amount, status
      ) VALUES (
        v_payment.order_id, v_consultant_id, v_order.total_price,
        v_consultant_rate, v_consultant_commission, 'PENDING'
      );
    END IF;
  END IF;

  -- Order status transition — also lock-versioned so a concurrent admin
  -- edit cannot silently clobber the new status.
  UPDATE public.orders
     SET payment_status  = 'CONFIRMED',
         order_status    = 'COMMISSION_CALCULATED',
         transfer_status = 'PENDING',
         updated_at      = now(),
         lock_version    = lock_version + 1
   WHERE id = v_payment.order_id;

  -- Append the status-history row in the same transaction. The TS layer
  -- still writes the audit log / notifications outside — those are
  -- idempotent by design and do not need transactional coupling.
  INSERT INTO public.order_status_history (
    order_id, old_status, new_status, changed_by_user_id, reason
  ) VALUES (
    v_payment.order_id,
    v_order.order_status,
    'COMMISSION_CALCULATED',
    (p_args ->> 'confirmed_by_user_id')::uuid,
    COALESCE(
      'Pagamento confirmado (' || COALESCE(p_args ->> 'payment_method', 'MANUAL') ||
      CASE WHEN NULLIF(p_args ->> 'reference_code', '') IS NOT NULL
           THEN ' · ref: ' || (p_args ->> 'reference_code')
           ELSE '' END
      || ')',
      'Pagamento confirmado'
    )
  );

  RETURN jsonb_build_object(
    'payment_id', v_payment.id,
    'order_id', v_payment.order_id,
    'pharmacy_transfer', v_pharmacy_transfer,
    'platform_commission', v_platform_commission,
    'consultant_commission', v_consultant_commission,
    'new_lock_version', v_payment.lock_version
  );
END;
$$;

COMMENT ON FUNCTION public.confirm_payment_atomic(uuid, jsonb) IS
  'Wave 7 — atomic payment confirmation: payment UPDATE + commissions/transfers/consultant_commissions INSERT + order UPDATE under a single transaction with lock_version guard. Raises P0001 with reason (invalid_payment, invalid_args, not_found, already_processed, stale_version, order_not_found).';

GRANT EXECUTE ON FUNCTION public.confirm_payment_atomic(uuid, jsonb) TO service_role;

-- ── 3. create_order_atomic ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_order_atomic(
  p_args jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_id            uuid;
  v_order_code          text;
  v_order_total         numeric(10,2);
  v_buyer_type          text := p_args ->> 'buyer_type';
  v_clinic_id           uuid := NULLIF(p_args ->> 'clinic_id', '')::uuid;
  v_doctor_id           uuid := NULLIF(p_args ->> 'doctor_id', '')::uuid;
  v_delivery_address_id uuid := NULLIF(p_args ->> 'delivery_address_id', '')::uuid;
  v_pharmacy_id         uuid := NULLIF(p_args ->> 'pharmacy_id', '')::uuid;
  v_notes               text := NULLIF(p_args ->> 'notes', '');
  v_created_by          uuid := NULLIF(p_args ->> 'created_by_user_id', '')::uuid;
  v_estimated_total     numeric(10,2) := COALESCE((p_args ->> 'estimated_total')::numeric, 0);
  v_items               jsonb := COALESCE(p_args -> 'items', '[]'::jsonb);
  v_item                jsonb;
BEGIN
  IF v_buyer_type NOT IN ('CLINIC', 'DOCTOR') THEN
    RAISE EXCEPTION 'invalid_buyer_type' USING ERRCODE = 'P0001';
  END IF;
  IF v_pharmacy_id IS NULL THEN
    RAISE EXCEPTION 'missing_pharmacy' USING ERRCODE = 'P0001';
  END IF;
  IF v_created_by IS NULL THEN
    RAISE EXCEPTION 'missing_actor' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'empty_items' USING ERRCODE = 'P0001';
  END IF;

  -- Insert order header (code is generated by trg_orders_generate_code).
  INSERT INTO public.orders (
    buyer_type, clinic_id, doctor_id, delivery_address_id, pharmacy_id,
    total_price, order_status, payment_status, transfer_status,
    notes, created_by_user_id, code
  ) VALUES (
    v_buyer_type,
    CASE WHEN v_buyer_type = 'CLINIC' THEN v_clinic_id ELSE NULL END,
    v_doctor_id,
    CASE WHEN v_buyer_type = 'DOCTOR' THEN v_delivery_address_id ELSE NULL END,
    v_pharmacy_id,
    v_estimated_total,
    'AWAITING_DOCUMENTS',
    'PENDING',
    'NOT_READY',
    v_notes,
    v_created_by,
    ''
  )
  RETURNING id, code INTO v_order_id, v_order_code;

  -- Insert each item. The triggers on order_items freeze prices and
  -- recompute orders.total_price — both happen inside this same
  -- transaction, so a concurrent reader only sees the fully-formed order.
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
    INSERT INTO public.order_items (
      order_id, product_id, quantity, unit_price, total_price, coupon_id
    ) VALUES (
      v_order_id,
      (v_item ->> 'product_id')::uuid,
      (v_item ->> 'quantity')::int,
      COALESCE((v_item ->> 'unit_price')::numeric, 0),
      COALESCE((v_item ->> 'total_price')::numeric, 0),
      NULLIF(v_item ->> 'coupon_id', '')::uuid
    );
  END LOOP;

  INSERT INTO public.order_status_history (
    order_id, old_status, new_status, changed_by_user_id, reason
  ) VALUES (
    v_order_id, NULL, 'AWAITING_DOCUMENTS', v_created_by, 'Pedido criado'
  );

  -- Read back the trigger-computed total so the caller can surface the
  -- authoritative number (freezes + coupon discounts applied).
  SELECT total_price INTO v_order_total
    FROM public.orders WHERE id = v_order_id;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'order_code', v_order_code,
    'total_price', v_order_total
  );
END;
$$;

COMMENT ON FUNCTION public.create_order_atomic(jsonb) IS
  'Wave 7 — atomic order creation. Inserts orders + order_items + order_status_history in a single transaction. Pre-validation (RBAC, compliance, prescription rules) still lives in TS. Raises P0001 with reason (invalid_buyer_type, missing_pharmacy, missing_actor, empty_items).';

GRANT EXECUTE ON FUNCTION public.create_order_atomic(jsonb) TO service_role;

-- ── Feature flags ────────────────────────────────────────────────────────
-- All three flags default to OFF (shadow mode). Toggle per-environment
-- after integration tests + a canary sample land in production.
INSERT INTO public.feature_flags (key, description, enabled, owner)
VALUES
  (
    'orders.atomic_rpc',
    'Route services/orders.ts::createOrder through public.create_order_atomic() instead of the multi-step client flow (Wave 7).',
    false,
    'audit-2026-04'
  ),
  (
    'coupons.atomic_rpc',
    'Route services/coupons.ts::activateCoupon through public.apply_coupon_atomic() (Wave 7).',
    false,
    'audit-2026-04'
  ),
  (
    'payments.atomic_confirm',
    'Route services/payments.ts::confirmPayment through public.confirm_payment_atomic() (Wave 7).',
    false,
    'audit-2026-04'
  )
ON CONFLICT (key) DO NOTHING;

-- ── Smoke block ──────────────────────────────────────────────────────────
DO $smoke$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('apply_coupon_atomic', 'confirm_payment_atomic', 'create_order_atomic');
  IF v_count < 3 THEN
    RAISE EXCEPTION 'Migration 049 smoke: expected 3 atomic RPCs, found %', v_count;
  END IF;

  PERFORM 1
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'orders'
     AND column_name = 'lock_version';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Migration 049 smoke: orders.lock_version missing';
  END IF;

  PERFORM 1
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'payments'
     AND column_name = 'lock_version';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Migration 049 smoke: payments.lock_version missing';
  END IF;

  SELECT count(*) INTO v_count
    FROM public.feature_flags
   WHERE key IN ('orders.atomic_rpc', 'coupons.atomic_rpc', 'payments.atomic_confirm');
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'Migration 049 smoke: expected 3 atomic flags, found %', v_count;
  END IF;

  RAISE NOTICE 'Migration 049 smoke passed (3 RPCs + 2 lock_version cols + 3 flags)';
END
$smoke$;
