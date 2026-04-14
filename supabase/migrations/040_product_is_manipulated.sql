-- Migration 040: Move is_manipulated flag from product_categories to products
-- Each product knows whether it is compounded/magistral (manipulated) or
-- industrialized. Distributors (entity_type = 'DISTRIBUTOR') may not sell
-- products with is_manipulated = true.

-- 1. Add flag to products (default false — all existing products are kept as-is)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_manipulated boolean NOT NULL DEFAULT false;

-- 2. Remove the flag that was added to product_categories in migration 039
--    (it was never rolled out to production data, safe to drop)
ALTER TABLE public.product_categories
  DROP COLUMN IF EXISTS is_manipulated;
