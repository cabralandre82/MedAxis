/**
 * One-shot backfill: set `notificationDisabled = true` on every
 * Asaas customer that Clinipharma already provisioned. Required
 * companion of the 2026-04-29 change in `lib/asaas.ts` that flips
 * the default to `true` for new customers.
 *
 * Why a script and not a migration: the truth lives at Asaas, not in
 * our DB. Our `clinics.asaas_customer_id` is a mirror, so we iterate
 * through every clinic that has a customer ID, PUT the flag, and
 * verify the response. No DB writes happen here — this is purely an
 * outbound Asaas API change.
 *
 * Idempotent: customers that already have `notificationDisabled=true`
 * are skipped. Failures are logged and the script continues so a
 * single 4xx doesn't block the rest of the tenant base.
 *
 * Usage:
 *   npx tsx scripts/silence-asaas-notifications.ts          # all clinics
 *   npx tsx scripts/silence-asaas-notifications.ts --customer cus_xxx
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

interface AsaasCustomer {
  id: string
  name: string
  email?: string
  notificationDisabled?: boolean
}

async function asaas<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${ASAAS_API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', access_token: ASAAS_API_KEY!, ...init?.headers },
  })
  if (!res.ok) throw new Error(`Asaas ${path} → ${res.status}: ${await res.text()}`)
  return (await res.json()) as T
}

async function silenceOne(customerId: string): Promise<'ok' | 'skip' | 'error'> {
  try {
    const current = await asaas<AsaasCustomer>(`/customers/${customerId}`)
    if (current.notificationDisabled === true) {
      console.log(`  [skip] ${customerId} (${current.name}) already silenced`)
      return 'skip'
    }
    const updated = await asaas<AsaasCustomer>(`/customers/${customerId}`, {
      method: 'PUT',
      body: JSON.stringify({ notificationDisabled: true }),
    })
    if (updated.notificationDisabled !== true) {
      throw new Error(
        `Asaas accepted PUT but returned notificationDisabled=${updated.notificationDisabled}`
      )
    }
    console.log(`  [ok]   ${customerId} (${updated.name}) silenced`)
    return 'ok'
  } catch (err) {
    console.warn(`  [err]  ${customerId}: ${(err as Error).message}`)
    return 'error'
  }
}

async function main() {
  const args = process.argv.slice(2)
  const customerFlag = args.indexOf('--customer')

  let customerIds: string[] = []

  if (customerFlag !== -1) {
    const id = args[customerFlag + 1]
    if (!id) {
      console.error('Usage: --customer <cus_xxx>')
      process.exit(1)
    }
    customerIds = [id]
  } else {
    const { data, error } = await supa
      .from('clinics')
      .select('id, trade_name, asaas_customer_id')
      .not('asaas_customer_id', 'is', null)
    if (error) throw error
    customerIds = (data ?? [])
      .map((c) => c.asaas_customer_id as string | null)
      .filter((id): id is string => id !== null)
    console.log(`Found ${customerIds.length} clinics with Asaas customers`)
  }

  if (customerIds.length === 0) {
    console.log('Nothing to do.')
    return
  }

  let okCount = 0
  let skipCount = 0
  let errCount = 0
  for (const id of customerIds) {
    const result = await silenceOne(id)
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
