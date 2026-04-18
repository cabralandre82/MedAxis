import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/db/server'
import { createAdminClient } from '@/lib/db/admin'
import { decrypt } from '@/lib/crypto'
import { createDsarRequest, transitionDsarRequest, signCanonicalBundle } from '@/lib/dsar'
import { logPiiView } from '@/lib/audit'
import { logger } from '@/lib/logger'

/**
 * GET /api/lgpd/export
 * LGPD Art. 18, I — Direito de acesso aos dados pessoais.
 *
 * Wave 9: the export is now tracked as a DSAR request. Each call
 *   1. Opens an EXPORT DSAR request (or reuses the existing open one).
 *   2. Materialises the canonical bundle.
 *   3. HMAC-signs the bundle with `LGPD_EXPORT_HMAC_KEY`.
 *   4. Transitions the DSAR through PROCESSING → FULFILLED, stamping
 *      the canonical hash as `delivery_hash` so the subject can
 *      later prove "this bundle is the one you gave me".
 *
 * The response includes the signature in the
 * `X-LGPD-Export-Signature` header (format `sha256=<hex>`) and
 * embeds `_signature` inside the body for users who can't see
 * headers easily.
 *
 * Signing is best-effort: if the HMAC key is missing, the export
 * still ships but without the signature, and the DSAR transition
 * is skipped so admins can see the failure in the logs.
 */
export async function GET(req: NextRequest) {
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: { 'X-Request-ID': requestId } }
    )
  }

  const admin = createAdminClient()

  // Log the self-read of PII. Actor and subject coincide, so this is
  // the "I accessed my own data" trail required by LGPD Art. 37.
  await logPiiView({
    actorUserId: user.id,
    actorRole: 'SELF',
    subjectUserId: user.id,
    scope: ['full_name', 'email', 'phone', 'orders', 'notifications', 'audit_logs'],
    reason: 'lgpd_self_export',
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
    userAgent: req.headers.get('user-agent') ?? undefined,
  })

  // Open (or reuse) an EXPORT DSAR request. A duplicate (409) means
  // there's already an open export in-flight — we still serve the
  // bundle but reuse the request id.
  let dsarId: string | null = null
  const opened = await createDsarRequest({
    subjectUserId: user.id,
    kind: 'EXPORT',
    reasonText: 'LGPD Art. 18 I — self-service export',
    requestedBy: user.id,
    requestCorrelationId: requestId,
  })
  if (opened.data) {
    dsarId = opened.data.id
  } else if (opened.error?.reason === 'duplicate_open') {
    const { data: existing } = await admin
      .from('dsar_requests')
      .select('id')
      .eq('subject_user_id', user.id)
      .eq('kind', 'EXPORT')
      .in('status', ['RECEIVED', 'PROCESSING'])
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    dsarId = existing?.id ?? null
  }

  // Profile
  const { data: profile } = await admin
    .from('profiles')
    .select('id, full_name, email, phone, phone_encrypted, role, status, created_at, anonymized_at')
    .eq('id', user.id)
    .single()

  // Orders (as clinic member)
  const { data: clinicMemberships } = await admin
    .from('clinic_members')
    .select('clinic_id, clinics(trade_name)')
    .eq('user_id', user.id)

  const clinicIds = clinicMemberships?.map((m) => m.clinic_id) ?? []

  const { data: orders } = clinicIds.length
    ? await admin
        .from('orders')
        .select('id, code, order_status, total_price, created_at')
        .in('clinic_id', clinicIds)
        .order('created_at', { ascending: false })
        .limit(500)
    : { data: [] }

  const { data: notifications } = await admin
    .from('notifications')
    .select('id, type, title, message, created_at, read_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(200)

  const { data: auditLogs } = await admin
    .from('audit_logs')
    .select('id, entity_type, entity_id, action, created_at')
    .eq('actor_user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(500)

  // Any previous DSAR history for this subject.
  const { data: dsarHistory } = await admin
    .from('dsar_requests')
    .select('id, kind, status, sla_due_at, fulfilled_at, expired_at, reject_code, created_at')
    .eq('subject_user_id', user.id)
    .order('created_at', { ascending: false })

  const bundle: Record<string, unknown> = {
    exported_at: new Date().toISOString(),
    user_id: user.id,
    dsar_request_id: dsarId,
    profile: profile
      ? {
          ...profile,
          phone: decrypt(profile.phone_encrypted) ?? profile.phone,
          phone_encrypted: undefined,
        }
      : null,
    clinic_memberships: clinicMemberships ?? [],
    orders: orders ?? [],
    notifications: notifications ?? [],
    audit_logs: auditLogs ?? [],
    dsar_history: dsarHistory ?? [],
  }

  let signature: string | undefined
  let deliveryHash: string | undefined
  try {
    const signed = signCanonicalBundle(bundle)
    signature = signed.signature
    deliveryHash = signed.hash
    bundle._signature = signed.signature
    bundle._hash = signed.hash
  } catch (signErr) {
    logger.error('[lgpd/export] signing failed', { error: signErr, userId: user.id })
  }

  // Transition the DSAR request to FULFILLED (only when we have a
  // signature — otherwise we have nothing to stamp as delivery_hash
  // and we don't want to close the request without proof).
  if (dsarId && deliveryHash) {
    try {
      // If the request is still RECEIVED, push it through PROCESSING first.
      const { data: currentRow } = await admin
        .from('dsar_requests')
        .select('status')
        .eq('id', dsarId)
        .single()
      if (currentRow?.status === 'RECEIVED') {
        await transitionDsarRequest(dsarId, 'PROCESSING', {
          actorUserId: user.id,
          actorRole: 'SELF',
        })
      }
      await transitionDsarRequest(dsarId, 'FULFILLED', {
        actorUserId: user.id,
        actorRole: 'SELF',
        deliveryHash,
        deliveryRef: `self-export:${new Date().toISOString().slice(0, 10)}`,
        metadata: { channel: 'http_get', request_id: requestId },
      })
    } catch (txErr) {
      logger.error('[lgpd/export] DSAR transition failed', {
        error: txErr,
        dsarId,
      })
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Content-Disposition': `attachment; filename="clinipharma-meus-dados-${new Date().toISOString().slice(0, 10)}.json"`,
    'X-Request-ID': requestId,
  }
  if (signature) headers['X-LGPD-Export-Signature'] = signature

  return new NextResponse(JSON.stringify(bundle, null, 2), {
    status: 200,
    headers,
  })
}
