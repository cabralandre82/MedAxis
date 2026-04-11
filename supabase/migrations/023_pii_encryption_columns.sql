-- Migration 023: PII Encryption — add _encrypted columns alongside plaintext
-- Strategy: additive migration (keep original columns, add encrypted variants)
-- Application layer handles read/write during transition period.
-- A follow-up migration (024) will drop plaintext columns after full rollout.

-- profiles: encrypt phone
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone_encrypted text;

-- doctors: encrypt CRM (sensitive professional ID)
ALTER TABLE public.doctors
  ADD COLUMN IF NOT EXISTS crm_encrypted text;

-- registration_requests: encrypt form_data JSON (may contain CPF, CNPJ, personal docs)
ALTER TABLE public.registration_requests
  ADD COLUMN IF NOT EXISTS form_data_encrypted text;

-- Index for fast lookup of unencrypted rows (for migration cron)
CREATE INDEX IF NOT EXISTS idx_profiles_phone_migration
  ON public.profiles(id)
  WHERE phone IS NOT NULL AND phone_encrypted IS NULL;

CREATE INDEX IF NOT EXISTS idx_doctors_crm_migration
  ON public.doctors(id)
  WHERE crm IS NOT NULL AND crm_encrypted IS NULL;

COMMENT ON COLUMN public.profiles.phone_encrypted IS 'AES-256-GCM encrypted phone. Format: iv:authTag:ciphertext (hex). Replaces phone column after migration completes.';
COMMENT ON COLUMN public.doctors.crm_encrypted IS 'AES-256-GCM encrypted CRM. Format: iv:authTag:ciphertext (hex). Replaces crm column after migration completes.';
COMMENT ON COLUMN public.registration_requests.form_data_encrypted IS 'AES-256-GCM encrypted form_data JSON. Replaces form_data column after migration completes.';
