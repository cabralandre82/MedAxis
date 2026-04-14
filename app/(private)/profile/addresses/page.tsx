import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/db/admin'
import { DoctorAddressBook } from '@/components/doctors/doctor-address-book'
import { BackButton } from '@/components/ui/back-button'
import type { DoctorAddress } from '@/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Meus endereços | Clinipharma' }

export default async function DoctorAddressesPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  if (!user.roles.includes('DOCTOR')) redirect('/dashboard')

  const admin = createAdminClient()

  // Resolve doctor record
  const { data: doctor } = await admin
    .from('doctors')
    .select('id, full_name, cpf')
    .or(`user_id.eq.${user.id},email.eq.${user.email}`)
    .maybeSingle()

  if (!doctor) redirect('/dashboard')

  const { data: addrData } = await admin
    .from('doctor_addresses')
    .select('*')
    .eq('doctor_id', doctor.id)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })

  const addresses = (addrData ?? []) as DoctorAddress[]

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <BackButton href="/profile" label="Perfil" />
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Meus endereços de entrega</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Endereços salvos para compras pessoais (CPF). Você pode escolher um deles ao fazer um
          pedido.
        </p>
      </div>

      {!doctor.cpf && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-800">CPF não cadastrado</p>
          <p className="mt-0.5 text-xs text-amber-700">
            Para fazer compras como pessoa física, seu CPF precisa estar cadastrado no seu perfil.
            Entre em contato com o administrador da plataforma.
          </p>
        </div>
      )}

      <DoctorAddressBook addresses={addresses} doctorId={doctor.id} />
    </div>
  )
}
