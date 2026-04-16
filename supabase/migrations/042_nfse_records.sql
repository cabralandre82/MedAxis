-- Migration 042: NFS-e records
-- Tracks every NFS-e issued by Clinipharma via Nuvem Fiscal.
-- Linked to either a pharmacy transfer (platform commission) or a consultant transfer.

CREATE TABLE IF NOT EXISTS public.nfse_records (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- Source reference (one of the two must be set)
  transfer_id         uuid REFERENCES public.transfers(id)             ON DELETE SET NULL,
  consultant_transfer_id uuid REFERENCES public.consultant_transfers(id) ON DELETE SET NULL,

  -- Identifiers returned by Nuvem Fiscal
  nuvem_fiscal_id     text,          -- internal ID from the API
  numero              text,          -- NFS-e number issued by the city hall
  chave_acesso        text,          -- access key (chave de acesso)
  pdf_url             text,          -- link to the PDF DANFSE

  -- NFS-e metadata
  prestador_cnpj      text NOT NULL,
  tomador_cnpj        text NOT NULL,
  tomador_razao_social text NOT NULL,
  valor_servicos      numeric(12,2) NOT NULL,
  discriminacao       text NOT NULL,
  referencia          text NOT NULL UNIQUE, -- our internal reference (idempotency key)

  -- Status from Nuvem Fiscal: pendente | autorizado | cancelado | erro
  status              text NOT NULL DEFAULT 'pendente',
  error_message       text,

  CONSTRAINT nfse_records_source_check CHECK (
    (transfer_id IS NOT NULL AND consultant_transfer_id IS NULL) OR
    (transfer_id IS NULL AND consultant_transfer_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS nfse_records_transfer_id_idx           ON public.nfse_records(transfer_id);
CREATE INDEX IF NOT EXISTS nfse_records_consultant_transfer_id_idx ON public.nfse_records(consultant_transfer_id);
CREATE INDEX IF NOT EXISTS nfse_records_referencia_idx             ON public.nfse_records(referencia);
CREATE INDEX IF NOT EXISTS nfse_records_status_idx                 ON public.nfse_records(status) WHERE status != 'autorizado';

-- Auto-update updated_at
CREATE OR REPLACE TRIGGER nfse_records_updated_at
  BEFORE UPDATE ON public.nfse_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS: only service role reads/writes (server-side only)
ALTER TABLE public.nfse_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nfse_records_service_only"
  ON public.nfse_records
  FOR ALL
  TO authenticated
  USING (false);
