-- ============================================================
-- 033 — Document review flow
--
-- order_documents: adds status + rejection_reason + reviewed_by + reviewed_at
-- order_items:     adds doc_status to track per-item documentation state
-- orders:          adds docs_deadline for expiry cron
-- ============================================================

-- 1. order_documents — review columns
ALTER TABLE public.order_documents
  ADD COLUMN IF NOT EXISTS status            text NOT NULL DEFAULT 'PENDING'
                                             CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  ADD COLUMN IF NOT EXISTS rejection_reason  text,
  ADD COLUMN IF NOT EXISTS reviewed_by_user_id uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS reviewed_at       timestamptz;

COMMENT ON COLUMN public.order_documents.status IS
  'PENDING = awaiting pharmacy review; APPROVED = accepted; REJECTED = rejected with reason';
COMMENT ON COLUMN public.order_documents.rejection_reason IS
  'Required when status = REJECTED. Shown to the clinic so they know what to fix.';

-- 2. order_items — doc_status
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS doc_status text NOT NULL DEFAULT 'OK'
                                      CHECK (doc_status IN ('OK', 'PENDING_DOCS', 'REJECTED_DOCS'));

COMMENT ON COLUMN public.order_items.doc_status IS
  'OK = no docs needed or docs approved; PENDING_DOCS = waiting for docs; REJECTED_DOCS = docs rejected by pharmacy';

-- 3. orders — deadline for document resubmission (set when order enters AWAITING_DOCUMENTS)
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS docs_deadline timestamptz;

COMMENT ON COLUMN public.orders.docs_deadline IS
  'Deadline for the clinic to resubmit rejected documents (3 business days). Set by the pharmacy review action. Cron cancels orders past this date.';
