-- Migration 067: freeze_order_item_price must keep _cents columns in
-- sync with the numeric columns it overwrites.
--
-- Bug
-- ---
-- 2026-04-29 second hot-incident — `money_drift_view` started flagging
-- order_items rows where:
--
--   total_price       = 180.50    (post-coupon — correct)
--   total_price_cents = 19000     (R$ 190.00, pre-coupon — WRONG)
--
-- The cron `/api/cron/money-reconcile` then logs "drift detected" on
-- every run, generating false-alarm noise that makes the operator
-- believe the platform is broken.
--
-- Root cause
-- ----------
-- BEFORE INSERT triggers on `public.order_items` fire alphabetically:
--
--   1. trg_money_sync_order_items   (← runs FIRST)
--      → sees NEW.total_price = 190.00, NEW.total_price_cents = NULL
--      → derives total_price_cents = 19000. Both columns agree.
--
--   2. trg_order_items_freeze_price (← runs SECOND)
--      → applies coupon: NEW.total_price := 180.50
--      → ALSO writes NEW.unit_price, NEW.pharmacy_cost_per_unit,
--        NEW.platform_commission_per_unit, NEW.original_total_price,
--        NEW.discount_amount.
--      → DOES NOT touch any *_cents column.
--      → Row is committed with the post-coupon numeric values
--        and the pre-coupon cents values. Drift = 950 cents.
--
-- Migration 061 fixed the UPDATE branch of the same family of bugs
-- (recalc_order_total firing a single-column UPDATE on orders).
-- It did NOT fix the INSERT branch on order_items because there is
-- no second BEFORE INSERT round to derive cents again — the freeze
-- runs once, after money_sync, and money_sync does not re-fire.
--
-- Fix
-- ---
-- Make `freeze_order_item_price` itself the authoritative source for
-- both representations: it computes the final numeric values, so it
-- writes the matching cents in the same trigger. No new triggers, no
-- ordering tricks, no NULL-out-and-recompute dance. Idempotent: a
-- callsite that already passed correct numeric values will simply
-- have its cents columns rewritten to the same value.
--
-- Helper: there is already a public._money_to_cents(numeric) → bigint
-- (migration 050) that does ROUND(numeric * 100). We reuse it so the
-- rounding rule stays in a single place.
--
-- Backfill
-- --------
-- Any pre-067 row already in production with drift gets healed in the
-- DO block at the bottom: an UPDATE of total_price_cents to the
-- correct value triggers the (already-061-safe) money_sync UPDATE
-- branch. Verified locally on the known drifted row
-- 3d7026d2-d07a-4cb6-bbc7-7645276e6622 (CP-2026-000015).
--
-- Verification
-- ------------
-- After applying:
--   SELECT * FROM money_drift_view;        -- expect 0 rows
--   /api/cron/money-reconcile               -- expect "ok" status
--
-- LGPD: no PII change. Behaviour-preserving for callers.

SET search_path TO public, extensions, pg_temp;

-- ── Trigger function ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.freeze_order_item_price()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_price          numeric(12, 2);
  v_pharmacy_cost  numeric(12, 2);
  v_disc_type      text;
  v_disc_value     numeric(10, 4);
  v_max_disc       numeric(10, 2);
  v_discount       numeric(12, 2) := 0;
BEGIN
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
      IF v_disc_type = 'PERCENT' THEN
        v_discount := ROUND((v_price * v_disc_value / 100.0) * NEW.quantity, 2);
        IF v_max_disc IS NOT NULL THEN
          v_discount := LEAST(v_discount, v_max_disc);
        END IF;
      ELSE
        v_discount := ROUND(LEAST(v_disc_value, v_price) * NEW.quantity, 2);
      END IF;

      UPDATE public.coupons
      SET used_count = used_count + 1
      WHERE id = NEW.coupon_id;
    ELSE
      NEW.coupon_id := NULL;
    END IF;
  END IF;

  NEW.discount_amount := v_discount;
  NEW.total_price     := NEW.original_total_price - v_discount;

  -- Migration 067 — write the matching cents columns in the SAME
  -- trigger so the row leaves BEFORE INSERT with both representations
  -- in agreement. money_sync already ran (alphabetically first) and
  -- does not re-fire; without this block we leak the pre-coupon cents
  -- to disk and money_drift_view flags the row forever.
  NEW.unit_price_cents                   := public._money_to_cents(NEW.unit_price);
  NEW.total_price_cents                  := public._money_to_cents(NEW.total_price);
  NEW.pharmacy_cost_per_unit_cents       := public._money_to_cents(NEW.pharmacy_cost_per_unit);
  NEW.platform_commission_per_unit_cents := public._money_to_cents(NEW.platform_commission_per_unit);

  RETURN NEW;
END;
$$;

-- ── Backfill any already-drifted rows ───────────────────────────────────
DO $heal$
DECLARE
  v_healed int := 0;
BEGIN
  -- Heal order_items where the numeric total_price diverges from
  -- the cents column by more than 1 cent. The UPDATE flips the cents
  -- column to its correct value; the (061-safe) UPDATE branch of
  -- _money_sync_order_items handles single-column updates by
  -- deriving the missing/stale side.
  WITH bad AS (
    SELECT id, public._money_to_cents(total_price) AS expected_cents
      FROM public.order_items
     WHERE total_price IS NOT NULL
       AND total_price_cents IS NOT NULL
       AND abs(total_price_cents - public._money_to_cents(total_price)) > 1
  )
  UPDATE public.order_items oi
     SET total_price_cents = bad.expected_cents
    FROM bad
   WHERE oi.id = bad.id;
  GET DIAGNOSTICS v_healed = ROW_COUNT;
  RAISE NOTICE 'Migration 067 healed % drifted order_items rows.', v_healed;
END
$heal$;

-- ── Smoke ──────────────────────────────────────────────────────────────
DO $smoke$
DECLARE
  v_remaining int;
BEGIN
  SELECT count(*) INTO v_remaining
    FROM public.order_items
   WHERE total_price IS NOT NULL
     AND total_price_cents IS NOT NULL
     AND abs(total_price_cents - public._money_to_cents(total_price)) > 1;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Migration 067 smoke: % order_items still drifted after heal', v_remaining;
  END IF;

  RAISE NOTICE 'Migration 067 smoke passed (no order_items drift remaining)';
END
$smoke$;
