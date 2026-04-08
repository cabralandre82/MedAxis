/**
 * MedAxis — Script de Setup de Produção
 *
 * Cria:
 * 1. Storage buckets (product-images, order-documents)
 * 2. Usuários iniciais (superadmin, platform_admin, clinic_admin, pharmacy_admin)
 * 3. Roles dos usuários
 * 4. Vínculos de organização
 *
 * Execute: npx tsx scripts/setup-production.ts
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ─── CONFIG ─────────────────────────────────────────────────────────────────

const USERS = [
  {
    email: 'superadmin@medaxis.com.br',
    password: 'MedAxis@2026',
    full_name: 'Super Administrador',
    role: 'SUPER_ADMIN' as const,
    clinic_id: null,
    pharmacy_id: null,
  },
  {
    email: 'admin@medaxis.com.br',
    password: 'MedAxis@2026',
    full_name: 'Administrador Plataforma',
    role: 'PLATFORM_ADMIN' as const,
    clinic_id: null,
    pharmacy_id: null,
  },
  {
    email: 'clinica@medaxis.com.br',
    password: 'MedAxis@2026',
    full_name: 'Admin Clínica Exemplo',
    role: 'CLINIC_ADMIN' as const,
    clinic_id: 'c1000000-0000-0000-0000-000000000001',
    pharmacy_id: null,
  },
  {
    email: 'medico@medaxis.com.br',
    password: 'MedAxis@2026',
    full_name: 'Dr. João Silva',
    role: 'DOCTOR' as const,
    clinic_id: 'c1000000-0000-0000-0000-000000000001',
    pharmacy_id: null,
  },
  {
    email: 'farmacia@medaxis.com.br',
    password: 'MedAxis@2026',
    full_name: 'Admin FarmaMag SP',
    role: 'PHARMACY_ADMIN' as const,
    clinic_id: null,
    pharmacy_id: 'b1000000-0000-0000-0000-000000000001',
  },
]

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function log(msg: string) {
  console.log(`  ${msg}`)
}

function success(msg: string) {
  console.log(`  ✅ ${msg}`)
}

function warn(msg: string) {
  console.log(`  ⚠️  ${msg}`)
}

function error(msg: string) {
  console.log(`  ❌ ${msg}`)
}

// ─── STEP 1: STORAGE BUCKETS ─────────────────────────────────────────────────

async function setupStorageBuckets() {
  console.log('\n📦 Criando Storage Buckets...')

  // Product images — público
  const { error: err1 } = await supabase.storage.createBucket('product-images', {
    public: true,
    fileSizeLimit: 5242880, // 5MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  })
  if (err1 && !err1.message.includes('already exists')) {
    error(`product-images: ${err1.message}`)
  } else {
    success('Bucket product-images criado (público)')
  }

  // Order documents — privado
  const { error: err2 } = await supabase.storage.createBucket('order-documents', {
    public: false,
    fileSizeLimit: 10485760, // 10MB
    allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
  })
  if (err2 && !err2.message.includes('already exists')) {
    error(`order-documents: ${err2.message}`)
  } else {
    success('Bucket order-documents criado (privado)')
  }
}

// ─── STEP 2: USERS ───────────────────────────────────────────────────────────

async function createUsers() {
  console.log('\n👥 Criando Usuários...')

  for (const user of USERS) {
    log(`Criando ${user.email}...`)

    // Check if exists
    const { data: existing } = await supabase.auth.admin.listUsers()
    const alreadyExists = existing?.users?.find((u) => u.email === user.email)

    let userId: string

    if (alreadyExists) {
      warn(`${user.email} já existe (id: ${alreadyExists.id})`)
      userId = alreadyExists.id
    } else {
      const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
        email: user.email,
        password: user.password,
        email_confirm: true,
        user_metadata: { full_name: user.full_name },
      })

      if (authErr || !authUser.user) {
        error(`Falha ao criar ${user.email}: ${authErr?.message}`)
        continue
      }

      userId = authUser.user.id
      success(`Auth user criado: ${user.email}`)
    }

    // Upsert profile
    const { error: profileErr } = await supabase.from('profiles').upsert({
      id: userId,
      full_name: user.full_name,
      email: user.email,
    })
    if (profileErr) warn(`Profile upsert: ${profileErr.message}`)

    // Assign role
    const { error: roleErr } = await supabase
      .from('user_roles')
      .upsert({ user_id: userId, role: user.role }, { onConflict: 'user_id,role' })
    if (roleErr) warn(`Role: ${roleErr.message}`)
    else log(`  Papel atribuído: ${user.role}`)

    // Link to clinic
    if (user.clinic_id) {
      const { error: clinicErr } = await supabase
        .from('clinic_members')
        .upsert(
          { user_id: userId, clinic_id: user.clinic_id, membership_role: 'ADMIN' },
          { onConflict: 'user_id,clinic_id' }
        )
      if (clinicErr) warn(`Vínculo clínica: ${clinicErr.message}`)
      else log(`  Vinculado à clínica: ${user.clinic_id}`)
    }

    // Link to pharmacy (store in user metadata for RLS)
    if (user.pharmacy_id) {
      await supabase.auth.admin.updateUserById(userId, {
        user_metadata: { full_name: user.full_name, pharmacy_id: user.pharmacy_id },
      })
      log(`  Vinculado à farmácia: ${user.pharmacy_id}`)
    }
  }
}

// ─── STEP 3: VERIFY ──────────────────────────────────────────────────────────

async function verify() {
  console.log('\n🔍 Verificando dados...')

  const { count: catCount } = await supabase
    .from('product_categories')
    .select('*', { count: 'exact', head: true })
  success(`${catCount} categorias de produtos`)

  const { count: pharCount } = await supabase
    .from('pharmacies')
    .select('*', { count: 'exact', head: true })
  success(`${pharCount} farmácias`)

  const { count: clinicCount } = await supabase
    .from('clinics')
    .select('*', { count: 'exact', head: true })
  success(`${clinicCount} clínicas`)

  const { count: prodCount } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
  success(`${prodCount} produtos`)

  const { data: buckets } = await supabase.storage.listBuckets()
  success(`${buckets?.length ?? 0} storage buckets: ${buckets?.map((b) => b.name).join(', ')}`)

  const { data: users } = await supabase.auth.admin.listUsers()
  success(`${users?.users?.length ?? 0} usuários auth`)

  const { count: roleCount } = await supabase
    .from('user_roles')
    .select('*', { count: 'exact', head: true })
  success(`${roleCount} papéis atribuídos`)
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 MedAxis — Setup de Produção')
  console.log('================================')

  await setupStorageBuckets()
  await createUsers()
  await verify()

  console.log('\n================================')
  console.log('✅ Setup concluído!')
  console.log('\n📋 Credenciais de acesso:')
  for (const user of USERS) {
    console.log(`   ${user.role.padEnd(18)} ${user.email} / ${user.password}`)
  }
  console.log('\n⚠️  IMPORTANTE: Troque as senhas após o primeiro acesso!')
  console.log('================================\n')
}

main().catch((err) => {
  console.error('Script error:', err)
  process.exit(1)
})
