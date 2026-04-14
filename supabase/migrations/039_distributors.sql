-- Migration 039: Distributor support
-- Distributors are pharmacies with entity_type = 'DISTRIBUTOR'.
-- They only work with industrialized (non-manipulated) products.

-- 1. Add entity_type discriminator to pharmacies
ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS entity_type text NOT NULL DEFAULT 'PHARMACY'
  CONSTRAINT pharmacies_entity_type_check CHECK (entity_type IN ('PHARMACY', 'DISTRIBUTOR'));

-- 2. Flag manipulated-product categories so they can be hidden from distributors
ALTER TABLE public.product_categories
  ADD COLUMN IF NOT EXISTS is_manipulated boolean NOT NULL DEFAULT false;

-- Backfill: all existing pharmacies are real pharmacies
UPDATE public.pharmacies SET entity_type = 'PHARMACY' WHERE entity_type IS NULL;
