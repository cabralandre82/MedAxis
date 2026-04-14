-- Migration 037: Add CANCELED status to payments and transfers
--
-- When an order is canceled, the system automatically voids any
-- PENDING / UNDER_REVIEW payments and PENDING / NOT_READY transfers.
-- CONFIRMED payments and COMPLETED transfers are left intact and
-- require manual admin action (refund / reversal).

-- ── payments ─────────────────────────────────────────────────────────────────
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_status_check;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_status_check
    CHECK (status IN ('PENDING','UNDER_REVIEW','CONFIRMED','FAILED','REFUNDED','CANCELED'));

-- ── transfers ─────────────────────────────────────────────────────────────────
ALTER TABLE public.transfers
  DROP CONSTRAINT IF EXISTS transfers_status_check;

ALTER TABLE public.transfers
  ADD CONSTRAINT transfers_status_check
    CHECK (status IN ('NOT_READY','PENDING','COMPLETED','FAILED','CANCELED'));
