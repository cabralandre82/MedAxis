'use server'
import { createAdminClient } from '@/lib/db/admin'
import { emitirNFSe } from '@/lib/nuvem-fiscal'
import { logger } from '@/lib/logger'

interface EmitirNFSeParaTransferenciaInput {
  /** ID of the `transfers` row (pharmacy transfer) */
  transferId: string
  /** Platform commission amount in BRL */
  valorServicos: number
  /** Clinic CNPJ (tomador) */
  tomadorCnpj: string
  tomadorRazaoSocial: string
  tomadorEmail?: string
  /** Order code for the discriminacao field */
  orderCode: string
}

/**
 * Emits an NFS-e for the platform commission on a pharmacy transfer.
 * Clinipharma = prestador; clinic = tomador.
 *
 * Never throws — errors are logged and stored. Callers must not block on this.
 */
export async function emitirNFSeParaTransferencia(
  input: EmitirNFSeParaTransferenciaInput
): Promise<void> {
  const admin = createAdminClient()
  const referencia = `transfer-${input.transferId}`

  // Idempotency: skip if already emitted for this transfer
  const { data: existing } = await admin
    .from('nfse_records')
    .select('id, status')
    .eq('referencia', referencia)
    .maybeSingle()

  if (existing) {
    logger.info('[nfse] NFS-e already exists for transfer', { referencia, status: existing.status })
    return
  }

  const prestadorCnpj = process.env.NUVEM_FISCAL_CNPJ ?? ''
  const discriminacao =
    `Serviço de intermediação de compra de medicamentos e insumos hospitalares ` +
    `via plataforma Clinipharma — Pedido ${input.orderCode}. ` +
    `CNPJ Prestador: ${prestadorCnpj}. CNPJ Tomador: ${input.tomadorCnpj}.`

  // Create the record first (status = pendente) to capture intent
  const { data: record, error: insertErr } = await admin
    .from('nfse_records')
    .insert({
      transfer_id: input.transferId,
      prestador_cnpj: prestadorCnpj,
      tomador_cnpj: input.tomadorCnpj,
      tomador_razao_social: input.tomadorRazaoSocial,
      valor_servicos: input.valorServicos,
      discriminacao,
      referencia,
      status: 'pendente',
    })
    .select('id')
    .single()

  if (insertErr || !record) {
    logger.error('[nfse] Failed to create nfse_records row', { error: insertErr, referencia })
    return
  }

  try {
    const nfse = await emitirNFSe({
      referencia,
      valorServicos: input.valorServicos,
      discriminacao,
      tomador: {
        cpfCnpj: input.tomadorCnpj,
        razaoSocial: input.tomadorRazaoSocial,
        email: input.tomadorEmail,
      },
    })

    await admin
      .from('nfse_records')
      .update({
        nuvem_fiscal_id: nfse.id,
        numero: nfse.numero ?? null,
        chave_acesso: nfse.chave_acesso ?? null,
        pdf_url: nfse.pdf ?? null,
        status: nfse.status ?? 'pendente',
        updated_at: new Date().toISOString(),
      })
      .eq('id', record.id)

    logger.info('[nfse] NFS-e emitted successfully', {
      referencia,
      id: nfse.id,
      status: nfse.status,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('[nfse] Failed to emit NFS-e', { error: message, referencia })

    await admin
      .from('nfse_records')
      .update({
        status: 'erro',
        error_message: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq('id', record.id)
  }
}

// ── Consultant transfer variant ───────────────────────────────────────────────

interface EmitirNFSeParaConsultorInput {
  /** ID of the `consultant_transfers` row */
  consultantTransferId: string
  valorServicos: number
  /** Consultant CPF or CNPJ (tomador) */
  tomadorCpfCnpj: string
  tomadorNome: string
  tomadorEmail?: string
  commissionCount: number
}

/**
 * Emits an NFS-e documenting commission payment to a sales consultant.
 * Clinipharma = prestador; consultant = tomador.
 *
 * Never throws — errors are logged and stored.
 */
export async function emitirNFSeParaConsultor(input: EmitirNFSeParaConsultorInput): Promise<void> {
  const admin = createAdminClient()
  const referencia = `consultant-transfer-${input.consultantTransferId}`

  const { data: existing } = await admin
    .from('nfse_records')
    .select('id, status')
    .eq('referencia', referencia)
    .maybeSingle()

  if (existing) {
    logger.info('[nfse] NFS-e already exists for consultant transfer', { referencia })
    return
  }

  const prestadorCnpj = process.env.NUVEM_FISCAL_CNPJ ?? ''
  const discriminacao =
    `Repasse de comissão de vendas — ${input.commissionCount} pedido(s) intermediado(s) via plataforma Clinipharma. ` +
    `CNPJ Prestador: ${prestadorCnpj}. CPF/CNPJ Consultor: ${input.tomadorCpfCnpj}.`

  const { data: record, error: insertErr } = await admin
    .from('nfse_records')
    .insert({
      consultant_transfer_id: input.consultantTransferId,
      prestador_cnpj: prestadorCnpj,
      tomador_cnpj: input.tomadorCpfCnpj,
      tomador_razao_social: input.tomadorNome,
      valor_servicos: input.valorServicos,
      discriminacao,
      referencia,
      status: 'pendente',
    })
    .select('id')
    .single()

  if (insertErr || !record) {
    logger.error('[nfse] Failed to create nfse_records row (consultant)', {
      error: insertErr,
      referencia,
    })
    return
  }

  try {
    const nfse = await emitirNFSe({
      referencia,
      valorServicos: input.valorServicos,
      discriminacao,
      tomador: {
        cpfCnpj: input.tomadorCpfCnpj,
        razaoSocial: input.tomadorNome,
        email: input.tomadorEmail,
      },
    })

    await admin
      .from('nfse_records')
      .update({
        nuvem_fiscal_id: nfse.id,
        numero: nfse.numero ?? null,
        chave_acesso: nfse.chave_acesso ?? null,
        pdf_url: nfse.pdf ?? null,
        status: nfse.status ?? 'pendente',
        updated_at: new Date().toISOString(),
      })
      .eq('id', record.id)

    logger.info('[nfse] NFS-e (consultant) emitted successfully', { referencia, id: nfse.id })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('[nfse] Failed to emit NFS-e (consultant)', { error: message, referencia })

    await admin
      .from('nfse_records')
      .update({
        status: 'erro',
        error_message: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq('id', record.id)
  }
}
