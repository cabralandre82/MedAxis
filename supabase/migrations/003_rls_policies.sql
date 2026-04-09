-- ============================================================
-- Clinipharma — Migration 003: Row Level Security Policies
-- ============================================================

-- ========================
-- Helper: get current user role
-- ========================
CREATE OR REPLACE FUNCTION public.get_user_role(p_user_id uuid)
RETURNS text AS $$
  SELECT role FROM public.user_roles WHERE user_id = p_user_id LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND role IN ('SUPER_ADMIN', 'PLATFORM_ADMIN')
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND role = 'SUPER_ADMIN'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ========================
-- PROFILES
-- ========================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (id = auth.uid() OR public.is_platform_admin());

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_insert_service" ON public.profiles
  FOR INSERT WITH CHECK (true);

-- ========================
-- USER ROLES
-- ========================
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_roles_select" ON public.user_roles
  FOR SELECT USING (user_id = auth.uid() OR public.is_platform_admin());

CREATE POLICY "user_roles_manage_admin" ON public.user_roles
  FOR ALL USING (public.is_super_admin());

-- ========================
-- CLINICS
-- ========================
ALTER TABLE public.clinics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clinics_select_admin" ON public.clinics
  FOR SELECT USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.clinic_members
      WHERE clinic_id = clinics.id AND user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.doctor_clinic_links dcl
      JOIN public.doctors d ON d.id = dcl.doctor_id
      WHERE dcl.clinic_id = clinics.id AND d.email = (
        SELECT email FROM public.profiles WHERE id = auth.uid()
      )
    )
  );

CREATE POLICY "clinics_manage_admin" ON public.clinics
  FOR ALL USING (public.is_platform_admin());

-- ========================
-- CLINIC MEMBERS
-- ========================
ALTER TABLE public.clinic_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clinic_members_select" ON public.clinic_members
  FOR SELECT USING (
    public.is_platform_admin()
    OR user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.clinic_members cm
      WHERE cm.clinic_id = clinic_members.clinic_id AND cm.user_id = auth.uid()
    )
  );

CREATE POLICY "clinic_members_manage_admin" ON public.clinic_members
  FOR ALL USING (public.is_platform_admin());

-- ========================
-- DOCTORS
-- ========================
ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "doctors_select" ON public.doctors
  FOR SELECT USING (
    public.is_platform_admin()
    OR email = (SELECT email FROM public.profiles WHERE id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.doctor_clinic_links dcl
      JOIN public.clinic_members cm ON cm.clinic_id = dcl.clinic_id
      WHERE dcl.doctor_id = doctors.id AND cm.user_id = auth.uid()
    )
  );

CREATE POLICY "doctors_manage_admin" ON public.doctors
  FOR ALL USING (public.is_platform_admin());

-- ========================
-- DOCTOR CLINIC LINKS
-- ========================
ALTER TABLE public.doctor_clinic_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "doctor_clinic_links_select" ON public.doctor_clinic_links
  FOR SELECT USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.doctors d
      WHERE d.id = doctor_clinic_links.doctor_id
      AND d.email = (SELECT email FROM public.profiles WHERE id = auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.clinic_members cm
      WHERE cm.clinic_id = doctor_clinic_links.clinic_id AND cm.user_id = auth.uid()
    )
  );

CREATE POLICY "doctor_clinic_links_manage_admin" ON public.doctor_clinic_links
  FOR ALL USING (public.is_platform_admin());

-- ========================
-- PHARMACIES
-- ========================
ALTER TABLE public.pharmacies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pharmacies_select" ON public.pharmacies
  FOR SELECT USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.pharmacy_members
      WHERE pharmacy_id = pharmacies.id AND user_id = auth.uid()
    )
  );

CREATE POLICY "pharmacies_manage_admin" ON public.pharmacies
  FOR ALL USING (public.is_platform_admin());

-- ========================
-- PHARMACY MEMBERS
-- ========================
ALTER TABLE public.pharmacy_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pharmacy_members_select" ON public.pharmacy_members
  FOR SELECT USING (
    public.is_platform_admin()
    OR user_id = auth.uid()
  );

CREATE POLICY "pharmacy_members_manage_admin" ON public.pharmacy_members
  FOR ALL USING (public.is_platform_admin());

-- ========================
-- PRODUCT CATEGORIES
-- ========================
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_categories_select_authenticated" ON public.product_categories
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "product_categories_manage_admin" ON public.product_categories
  FOR ALL USING (public.is_platform_admin());

-- ========================
-- PRODUCTS
-- ========================
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "products_select_authenticated" ON public.products
  FOR SELECT USING (auth.uid() IS NOT NULL AND active = true OR public.is_platform_admin());

CREATE POLICY "products_manage_admin" ON public.products
  FOR ALL USING (public.is_platform_admin());

-- ========================
-- PRODUCT IMAGES
-- ========================
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_images_select_authenticated" ON public.product_images
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "product_images_manage_admin" ON public.product_images
  FOR ALL USING (public.is_platform_admin());

-- ========================
-- PRODUCT PRICE HISTORY
-- ========================
ALTER TABLE public.product_price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "price_history_select_admin" ON public.product_price_history
  FOR SELECT USING (public.is_platform_admin());

CREATE POLICY "price_history_insert_admin" ON public.product_price_history
  FOR INSERT WITH CHECK (public.is_platform_admin());

-- ========================
-- ORDERS
-- ========================
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orders_select" ON public.orders
  FOR SELECT USING (
    public.is_platform_admin()
    OR created_by_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.clinic_members cm
      WHERE cm.clinic_id = orders.clinic_id AND cm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.pharmacy_members pm
      WHERE pm.pharmacy_id = orders.pharmacy_id AND pm.user_id = auth.uid()
    )
  );

CREATE POLICY "orders_insert_auth" ON public.orders
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "orders_update" ON public.orders
  FOR UPDATE USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.pharmacy_members pm
      WHERE pm.pharmacy_id = orders.pharmacy_id AND pm.user_id = auth.uid()
    )
  );

-- ========================
-- ORDER DOCUMENTS
-- ========================
ALTER TABLE public.order_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "order_docs_select" ON public.order_documents
  FOR SELECT USING (
    public.is_platform_admin()
    OR uploaded_by_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.orders o
      JOIN public.clinic_members cm ON cm.clinic_id = o.clinic_id
      WHERE o.id = order_documents.order_id AND cm.user_id = auth.uid()
    )
  );

CREATE POLICY "order_docs_insert_auth" ON public.order_documents
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ========================
-- ORDER STATUS HISTORY
-- ========================
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "order_status_history_select" ON public.order_status_history
  FOR SELECT USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_status_history.order_id
      AND (
        o.created_by_user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.clinic_members cm WHERE cm.clinic_id = o.clinic_id AND cm.user_id = auth.uid())
        OR EXISTS (SELECT 1 FROM public.pharmacy_members pm WHERE pm.pharmacy_id = o.pharmacy_id AND pm.user_id = auth.uid())
      )
    )
  );

CREATE POLICY "order_status_history_insert" ON public.order_status_history
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ========================
-- PAYMENTS
-- ========================
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payments_select" ON public.payments
  FOR SELECT USING (
    public.is_platform_admin()
    OR payer_profile_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.orders o
      JOIN public.clinic_members cm ON cm.clinic_id = o.clinic_id
      WHERE o.id = payments.order_id AND cm.user_id = auth.uid()
    )
  );

CREATE POLICY "payments_manage_admin" ON public.payments
  FOR ALL USING (public.is_platform_admin());

CREATE POLICY "payments_insert_auth" ON public.payments
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ========================
-- COMMISSIONS
-- ========================
ALTER TABLE public.commissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "commissions_select_admin" ON public.commissions
  FOR SELECT USING (public.is_platform_admin());

CREATE POLICY "commissions_manage_admin" ON public.commissions
  FOR ALL USING (public.is_platform_admin());

-- ========================
-- TRANSFERS
-- ========================
ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transfers_select" ON public.transfers
  FOR SELECT USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.pharmacy_members pm
      WHERE pm.pharmacy_id = transfers.pharmacy_id AND pm.user_id = auth.uid()
    )
  );

CREATE POLICY "transfers_manage_admin" ON public.transfers
  FOR ALL USING (public.is_platform_admin());

-- ========================
-- AUDIT LOGS
-- ========================
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_logs_select_admin" ON public.audit_logs
  FOR SELECT USING (public.is_platform_admin());

CREATE POLICY "audit_logs_insert" ON public.audit_logs
  FOR INSERT WITH CHECK (true);

-- ========================
-- APP SETTINGS
-- ========================
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_settings_select_admin" ON public.app_settings
  FOR SELECT USING (public.is_platform_admin());

CREATE POLICY "app_settings_manage_super_admin" ON public.app_settings
  FOR ALL USING (public.is_super_admin());
