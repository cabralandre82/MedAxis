import { Metadata } from 'next'
import { createAdminClient } from '@/lib/db/admin'

export const dynamic = 'force-dynamic'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import { NewOrderForm, type NewOrderFormProduct } from '@/components/orders/new-order-form'
import { parseCartParam } from '@/lib/orders/doctor-field-rules'

export const metadata: Metadata = { title: 'Novo pedido | Clinipharma' }

interface NewOrderPageProps {
  searchParams: Promise<{ product?: string; cart?: string }>
}

export default async function NewOrderPage({ searchParams }: NewOrderPageProps) {
  const params = await searchParams
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  // Parse ?cart=id:qty,id:qty (set when navigating away to /doctors/new)
  const initialCart = parseCartParam(params.cart)

  if (user.registration_status && user.registration_status !== 'APPROVED') {
    redirect('/dashboard')
  }

  const admin = createAdminClient()

  const { data: productsRaw } = await admin
    .from('products')
    .select(
      'id, name, slug, concentration, presentation, price_current, estimated_deadline_days, requires_prescription, pharmacy_id, pharmacies(id, trade_name), product_images(id, public_url, alt_text, sort_order)'
    )
    .eq('active', true)
    .order('name')

  const products = (productsRaw ?? []) as unknown as NewOrderFormProduct[]
  const initialProduct = params.product ? products.find((p) => p.id === params.product) : undefined

  // Resolve the clinic the current user belongs to.
  // Uses adminClient to bypass RLS bootstrap problem on clinic_members:
  // a user can only read clinic_members if already a member — but on first
  // login after being added, the RLS check would fail with the user client.
  let resolvedClinic: { id: string; trade_name: string } | null = null
  let adminClinics: { id: string; trade_name: string }[] | null = null

  if (user.roles.includes('CLINIC_ADMIN')) {
    const { data: membership } = await admin
      .from('clinic_members')
      .select('clinics(id, trade_name)')
      .eq('user_id', user.id)
      .maybeSingle()

    resolvedClinic =
      (membership?.clinics as unknown as { id: string; trade_name: string } | null) ?? null
  } else if (user.roles.includes('DOCTOR')) {
    const { data: doctorRecord } = await admin
      .from('doctors')
      .select('id')
      .eq('email', user.email)
      .maybeSingle()

    if (doctorRecord) {
      const { data: linked } = await admin
        .from('doctor_clinic_links')
        .select('clinics(id, trade_name)')
        .eq('doctor_id', doctorRecord.id)

      const doctorClinics = (linked ?? [])
        .map((l) => l.clinics as unknown as { id: string; trade_name: string })
        .filter(Boolean)

      if (doctorClinics.length === 1) {
        resolvedClinic = doctorClinics[0]
      } else {
        adminClinics = doctorClinics
      }
    }
  } else {
    // SUPER_ADMIN / PLATFORM_ADMIN see all clinics
    const { data } = await admin
      .from('clinics')
      .select('id, trade_name')
      .eq('status', 'ACTIVE')
      .order('trade_name')
    adminClinics = data ?? []
  }

  // Fetch doctors linked to the resolved clinic via adminClient (bypasses RLS).
  let linkedDoctors: { id: string; full_name: string; crm: string; crm_state: string }[] = []

  if (resolvedClinic) {
    const { data } = await admin
      .from('doctor_clinic_links')
      .select('doctors(id, full_name, crm, crm_state)')
      .eq('clinic_id', resolvedClinic.id)

    linkedDoctors = (data ?? [])
      .map(
        (l) =>
          l.doctors as unknown as { id: string; full_name: string; crm: string; crm_state: string }
      )
      .filter(Boolean)
  } else {
    const { data } = await admin
      .from('doctors')
      .select('id, full_name, crm, crm_state')
      .eq('status', 'ACTIVE')
      .order('full_name')
    linkedDoctors = data ?? []
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Novo pedido</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Adicione um ou mais produtos da mesma farmácia e preencha os dados
        </p>
      </div>
      <NewOrderForm
        initialProduct={initialProduct}
        availableProducts={products}
        resolvedClinic={resolvedClinic}
        adminClinics={adminClinics}
        doctors={linkedDoctors}
        isClinicAdmin={user.roles.includes('CLINIC_ADMIN')}
        initialCart={initialCart.length > 0 ? initialCart : undefined}
      />
    </div>
  )
}
