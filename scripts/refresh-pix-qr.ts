/**
 * Refreshes `asaas_pix_qr_code` + `asaas_pix_copy_paste` for a single
 * payments row whose Asaas charge already exists but had no PIX QR
 * persisted. The usual cause: the Asaas merchant had no Pix key
 * registered when the charge was created, so `getPixQrCode` 4xx-d
 * and the helper swallowed the failure (intentional — boleto + card
 * still work and the row stays usable).
 *
 * After registering a Pix key in Asaas, every existing PENDING
 * charge becomes QR-eligible. The runtime helper
 * `generateAsaasChargeForOrder` self-heals on the next retry, but
 * historical rows whose tab the user already saw "QR Code sendo
 * gerado…" need a nudge.
 *
 * Two modes:
 *   • `npx tsx scripts/refresh-pix-qr.ts --order <orderId>` — single order
 *   • `npx tsx scripts/refresh-pix-qr.ts --all` — every PENDING row with
 *     `asaas_payment_id IS NOT NULL AND asaas_pix_qr_code IS NULL`
 *
 * Idempotent: rows that already have a QR are skipped. Rows that
 * fail at Asaas are logged and left untouched.
 *
 * Why standalone (not importing the runtime helper): same reason as
 * `backfill-asaas-charge.ts` — the helper uses `server-only`, which
 * is a Next bundler guard that explodes when imported from a Node
 * CLI script.
 */
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ASAAS_API_URL = process.env.ASAAS_API_URL ?? 'https://sandbox.asaas.com/api/v3'
const ASAAS_API_KEY = process.env.ASAAS_API_KEY

if (!SUPABASE_URL || !SUPABASE_KEY || !ASAAS_API_KEY) {
  console.error('Missing env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ASAAS_API_KEY')
  process.exit(1)
}

const supa = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

interface PaymentRow {
  id: string
  order_id: string
  asaas_payment_id: string
  asaas_pix_qr_code: string | null
}

async function getPixQrCode(
  asaasPaymentId: string
): Promise<{ encodedImage: string; payload: string }> {
  const res = await fetch(`${ASAAS_API_URL}/payments/${asaasPaymentId}/pixQrCode`, {
    headers: { 'Content-Type': 'application/json', access_token: ASAAS_API_KEY! },
  })
  if (!res.ok) throw new Error(`Asaas pixQrCode → ${res.status}: ${await res.text()}`)
  return (await res.json()) as { encodedImage: string; payload: string }
}

async function refreshOne(row: PaymentRow): Promise<'ok' | 'skip' | 'error'> {
  if (row.asaas_pix_qr_code) {
    console.log(`  [skip] ${row.order_id} already has QR`)
    return 'skip'
  }
  try {
    const pix = await getPixQrCode(row.asaas_payment_id)
    const { error } = await supa
      .from('payments')
      .update({
        asaas_pix_qr_code: pix.encodedImage,
        asaas_pix_copy_paste: pix.payload,
      })
      .eq('id', row.id)
    if (error) throw error
    console.log(`  [ok]   ${row.order_id} refreshed (${pix.encodedImage.length}b)`)
    return 'ok'
  } catch (err) {
    console.warn(`  [err]  ${row.order_id}: ${(err as Error).message}`)
    return 'error'
  }
}

async function main() {
  const args = process.argv.slice(2)
  const orderFlag = args.indexOf('--order')
  const all = args.includes('--all')

  let rows: PaymentRow[] = []

  if (orderFlag !== -1) {
    const orderId = args[orderFlag + 1]
    if (!orderId) {
      console.error('Usage: --order <orderId>')
      process.exit(1)
    }
    const { data, error } = await supa
      .from('payments')
      .select('id, order_id, asaas_payment_id, asaas_pix_qr_code')
      .eq('order_id', orderId)
      .not('asaas_payment_id', 'is', null)
    if (error) throw error
    rows = (data ?? []) as PaymentRow[]
  } else if (all) {
    const { data, error } = await supa
      .from('payments')
      .select('id, order_id, asaas_payment_id, asaas_pix_qr_code')
      .eq('status', 'PENDING')
      .not('asaas_payment_id', 'is', null)
      .is('asaas_pix_qr_code', null)
    if (error) throw error
    rows = (data ?? []) as PaymentRow[]
  } else {
    console.error('Usage:')
    console.error('  npx tsx scripts/refresh-pix-qr.ts --order <orderId>')
    console.error('  npx tsx scripts/refresh-pix-qr.ts --all')
    process.exit(1)
  }

  if (rows.length === 0) {
    console.log('Nothing to do — no eligible payments found.')
    return
  }

  console.log(`Refreshing PIX QR for ${rows.length} payment(s):`)
  let okCount = 0
  let skipCount = 0
  let errCount = 0
  for (const row of rows) {
    const result = await refreshOne(row)
    if (result === 'ok') okCount++
    else if (result === 'skip') skipCount++
    else errCount++
  }
  console.log(`\nDone. ok=${okCount} skip=${skipCount} err=${errCount}`)
  process.exit(errCount > 0 ? 2 : 0)
}

main().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
