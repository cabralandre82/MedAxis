-- ============================================================
-- Clinipharma — Migration 001: Initial Schema
-- ============================================================
-- Run this in the Supabase SQL Editor.
-- Order matters: run 001 → 002 → 003
-- ============================================================

-- ========================
-- PROFILES
-- ========================
CREATE TABLE IF NOT EXISTS public.profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   text NOT NULL,
  email       text NOT NULL,
  phone       text,
  avatar_url  text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ========================
-- USER ROLES
-- ========================
CREATE TABLE IF NOT EXISTS public.user_roles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('SUPER_ADMIN','PLATFORM_ADMIN','CLINIC_ADMIN','DOCTOR','PHARMACY_ADMIN')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);

-- ========================
-- CLINICS
-- ========================
CREATE TABLE IF NOT EXISTS public.clinics (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_name     text NOT NULL,
  trade_name         text NOT NULL,
  cnpj               text NOT NULL UNIQUE,
  state_registration text,
  email              text NOT NULL,
  phone              text,
  address_line_1     text NOT NULL,
  address_line_2     text,
  city               text NOT NULL,
  state              char(2) NOT NULL,
  zip_code           text NOT NULL,
  status             text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','BLOCKED')),
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- ========================
-- CLINIC MEMBERS
-- ========================
CREATE TABLE IF NOT EXISTS public.clinic_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  membership_role text NOT NULL DEFAULT 'STAFF' CHECK (membership_role IN ('ADMIN','STAFF')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(clinic_id, user_id)
);

-- ========================
-- DOCTORS
-- ========================
CREATE TABLE IF NOT EXISTS public.doctors (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name  text NOT NULL,
  crm        text NOT NULL,
  crm_state  char(2) NOT NULL,
  specialty  text,
  email      text NOT NULL,
  phone      text,
  status     text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','BLOCKED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(crm, crm_state)
);

-- ========================
-- DOCTOR CLINIC LINKS
-- ========================
CREATE TABLE IF NOT EXISTS public.doctor_clinic_links (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id  uuid NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  clinic_id  uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(doctor_id, clinic_id)
);

-- ========================
-- PHARMACIES
-- ========================
CREATE TABLE IF NOT EXISTS public.pharmacies (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_name     text NOT NULL,
  trade_name         text NOT NULL,
  cnpj               text NOT NULL UNIQUE,
  email              text NOT NULL,
  phone              text,
  address_line_1     text NOT NULL,
  address_line_2     text,
  city               text NOT NULL,
  state              char(2) NOT NULL,
  zip_code           text NOT NULL,
  responsible_person text NOT NULL,
  bank_name          text,
  bank_branch        text,
  bank_account       text,
  pix_key            text,
  status             text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','BLOCKED')),
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- ========================
-- PHARMACY MEMBERS
-- ========================
CREATE TABLE IF NOT EXISTS public.pharmacy_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id     uuid NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  membership_role text NOT NULL DEFAULT 'STAFF' CHECK (membership_role IN ('ADMIN','STAFF')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, user_id)
);

-- ========================
-- PRODUCT CATEGORIES
-- ========================
CREATE TABLE IF NOT EXISTS public.product_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ========================
-- PRODUCTS
-- ========================
CREATE TABLE IF NOT EXISTS public.products (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id            uuid NOT NULL REFERENCES public.product_categories(id),
  pharmacy_id            uuid NOT NULL REFERENCES public.pharmacies(id),
  sku                    text NOT NULL UNIQUE,
  name                   text NOT NULL,
  slug                   text NOT NULL UNIQUE,
  concentration          text NOT NULL,
  presentation           text NOT NULL,
  short_description      text NOT NULL,
  long_description       text,
  characteristics_json   jsonb NOT NULL DEFAULT '{}',
  price_current          numeric(10,2) NOT NULL CHECK (price_current >= 0),
  currency               text NOT NULL DEFAULT 'BRL',
  estimated_deadline_days integer NOT NULL CHECK (estimated_deadline_days > 0),
  active                 boolean NOT NULL DEFAULT true,
  featured               boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- ========================
-- PRODUCT IMAGES
-- ========================
CREATE TABLE IF NOT EXISTS public.product_images (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  public_url   text,
  alt_text     text,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ========================
-- PRODUCT PRICE HISTORY
-- ========================
CREATE TABLE IF NOT EXISTS public.product_price_history (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  old_price           numeric(10,2) NOT NULL,
  new_price           numeric(10,2) NOT NULL,
  changed_by_user_id  uuid NOT NULL REFERENCES public.profiles(id),
  reason              text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ========================
-- PHARMACY PRODUCTS
-- ========================
CREATE TABLE IF NOT EXISTS public.pharmacy_products (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id       uuid NOT NULL REFERENCES public.pharmacies(id),
  product_id        uuid NOT NULL REFERENCES public.products(id),
  active            boolean NOT NULL DEFAULT true,
  operational_notes text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, product_id)
);

-- ========================
-- ORDERS
-- ========================
CREATE TABLE IF NOT EXISTS public.orders (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 text NOT NULL UNIQUE,
  clinic_id            uuid NOT NULL REFERENCES public.clinics(id),
  doctor_id            uuid NOT NULL REFERENCES public.doctors(id),
  pharmacy_id          uuid NOT NULL REFERENCES public.pharmacies(id),
  product_id           uuid NOT NULL REFERENCES public.products(id),
  quantity             integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price           numeric(10,2) NOT NULL,
  total_price          numeric(10,2) NOT NULL,
  payment_status       text NOT NULL DEFAULT 'PENDING'
    CHECK (payment_status IN ('PENDING','UNDER_REVIEW','CONFIRMED','FAILED','REFUNDED')),
  transfer_status      text NOT NULL DEFAULT 'NOT_READY'
    CHECK (transfer_status IN ('NOT_READY','PENDING','COMPLETED','FAILED')),
  order_status         text NOT NULL DEFAULT 'DRAFT'
    CHECK (order_status IN (
      'DRAFT','AWAITING_DOCUMENTS','READY_FOR_REVIEW','AWAITING_PAYMENT',
      'PAYMENT_UNDER_REVIEW','PAYMENT_CONFIRMED','COMMISSION_CALCULATED',
      'TRANSFER_PENDING','TRANSFER_COMPLETED','RELEASED_FOR_EXECUTION',
      'RECEIVED_BY_PHARMACY','IN_EXECUTION','READY','SHIPPED','DELIVERED',
      'COMPLETED','CANCELED','WITH_ISSUE'
    )),
  notes                text,
  created_by_user_id   uuid NOT NULL REFERENCES public.profiles(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ========================
-- ORDER DOCUMENTS
-- ========================
CREATE TABLE IF NOT EXISTS public.order_documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  document_type       text NOT NULL,
  storage_path        text NOT NULL,
  original_filename   text NOT NULL,
  mime_type           text NOT NULL,
  file_size           bigint NOT NULL,
  uploaded_by_user_id uuid NOT NULL REFERENCES public.profiles(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ========================
-- ORDER STATUS HISTORY
-- ========================
CREATE TABLE IF NOT EXISTS public.order_status_history (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  old_status          text,
  new_status          text NOT NULL,
  changed_by_user_id  uuid NOT NULL REFERENCES public.profiles(id),
  reason              text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ========================
-- ORDER OPERATIONAL UPDATES
-- ========================
CREATE TABLE IF NOT EXISTS public.order_operational_updates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  pharmacy_id         uuid NOT NULL REFERENCES public.pharmacies(id),
  status              text NOT NULL,
  description         text NOT NULL,
  created_by_user_id  uuid NOT NULL REFERENCES public.profiles(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ========================
-- PAYMENTS
-- ========================
CREATE TABLE IF NOT EXISTS public.payments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              uuid NOT NULL REFERENCES public.orders(id),
  payer_profile_id      uuid REFERENCES public.profiles(id),
  gross_amount          numeric(10,2) NOT NULL,
  status                text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','UNDER_REVIEW','CONFIRMED','FAILED','REFUNDED')),
  payment_method        text NOT NULL DEFAULT 'MANUAL',
  reference_code        text,
  proof_storage_path    text,
  confirmed_by_user_id  uuid REFERENCES public.profiles(id),
  confirmed_at          timestamptz,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- ========================
-- COMMISSIONS
-- ========================
CREATE TABLE IF NOT EXISTS public.commissions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                 uuid NOT NULL REFERENCES public.orders(id),
  commission_type          text NOT NULL DEFAULT 'PERCENTAGE'
    CHECK (commission_type IN ('PERCENTAGE','FIXED','HYBRID')),
  commission_percentage    numeric(5,2),
  commission_fixed_amount  numeric(10,2),
  commission_total_amount  numeric(10,2) NOT NULL,
  calculated_by_user_id    uuid REFERENCES public.profiles(id),
  created_at               timestamptz NOT NULL DEFAULT now()
);

-- ========================
-- TRANSFERS
-- ========================
CREATE TABLE IF NOT EXISTS public.transfers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              uuid NOT NULL REFERENCES public.orders(id),
  pharmacy_id           uuid NOT NULL REFERENCES public.pharmacies(id),
  gross_amount          numeric(10,2) NOT NULL,
  commission_amount     numeric(10,2) NOT NULL,
  net_amount            numeric(10,2) NOT NULL,
  status                text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('NOT_READY','PENDING','COMPLETED','FAILED')),
  transfer_reference    text,
  proof_storage_path    text,
  processed_by_user_id  uuid REFERENCES public.profiles(id),
  processed_at          timestamptz,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- ========================
-- AUDIT LOGS
-- ========================
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id   uuid REFERENCES public.profiles(id),
  actor_role      text,
  entity_type     text NOT NULL,
  entity_id       text NOT NULL,
  action          text NOT NULL,
  old_values_json jsonb,
  new_values_json jsonb,
  metadata_json   jsonb,
  ip              text,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ========================
-- APP SETTINGS
-- ========================
CREATE TABLE IF NOT EXISTS public.app_settings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                 text NOT NULL UNIQUE,
  value_json          jsonb NOT NULL,
  description         text,
  updated_by_user_id  uuid REFERENCES public.profiles(id),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ========================
-- INDEXES
-- ========================
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_clinic_members_clinic_id ON public.clinic_members(clinic_id);
CREATE INDEX IF NOT EXISTS idx_clinic_members_user_id ON public.clinic_members(user_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_members_pharmacy_id ON public.pharmacy_members(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_members_user_id ON public.pharmacy_members(user_id);
CREATE INDEX IF NOT EXISTS idx_doctor_clinic_links_doctor_id ON public.doctor_clinic_links(doctor_id);
CREATE INDEX IF NOT EXISTS idx_doctor_clinic_links_clinic_id ON public.doctor_clinic_links(clinic_id);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON public.products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_pharmacy_id ON public.products(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_products_slug ON public.products(slug);
CREATE INDEX IF NOT EXISTS idx_products_active ON public.products(active);
CREATE INDEX IF NOT EXISTS idx_orders_clinic_id ON public.orders(clinic_id);
CREATE INDEX IF NOT EXISTS idx_orders_doctor_id ON public.orders(doctor_id);
CREATE INDEX IF NOT EXISTS idx_orders_pharmacy_id ON public.orders(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_status ON public.orders(order_status);
CREATE INDEX IF NOT EXISTS idx_orders_code ON public.orders(code);
CREATE INDEX IF NOT EXISTS idx_order_status_history_order_id ON public.order_status_history(order_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_user_id ON public.audit_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_type ON public.audit_logs(entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON public.payments(order_id);
CREATE INDEX IF NOT EXISTS idx_transfers_order_id ON public.transfers(order_id);
CREATE INDEX IF NOT EXISTS idx_transfers_pharmacy_id ON public.transfers(pharmacy_id);
