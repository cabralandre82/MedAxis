-- Persists clinic churn scores so admin can filter/sort and mark as contacted.
-- Populated nightly by the churn-detection Inngest job.

CREATE TABLE IF NOT EXISTS public.clinic_churn_scores (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id             uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  score                 integer NOT NULL CHECK (score >= 0 AND score <= 100),
  risk_level            text NOT NULL CHECK (risk_level IN ('LOW', 'MODERATE', 'HIGH')),
  days_since_last_order integer NOT NULL DEFAULT 0,
  avg_cycle_days        integer NOT NULL DEFAULT 0,
  open_tickets          integer NOT NULL DEFAULT 0,
  failed_payments       integer NOT NULL DEFAULT 0,
  contacted_at          timestamptz,
  contacted_by_user_id  uuid REFERENCES public.profiles(id),
  contact_notes         text,
  computed_at           timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS clinic_churn_scores_clinic_id_idx
  ON public.clinic_churn_scores (clinic_id);

ALTER TABLE public.clinic_churn_scores ENABLE ROW LEVEL SECURITY;

-- Only admins and consultants can read churn scores (never exposed to clinics)
CREATE POLICY "churn_select_admin" ON public.clinic_churn_scores
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('SUPER_ADMIN', 'PLATFORM_ADMIN', 'CONSULTANT')
    )
  );

CREATE POLICY "churn_update_admin" ON public.clinic_churn_scores
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('SUPER_ADMIN', 'PLATFORM_ADMIN', 'CONSULTANT')
    )
  );

CREATE POLICY "churn_insert_admin" ON public.clinic_churn_scores
  FOR INSERT WITH CHECK (true); -- service role only via admin client
