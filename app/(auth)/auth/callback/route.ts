import { NextResponse } from 'next/server'
import { createClient } from '@/lib/db/server'
import { logger } from '@/lib/logger'
import { safeNextPath } from '@/lib/security/safe-redirect'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  // Wave 5: `next` is attacker-controllable. safeNextPath enforces that
  // the value is a same-origin path (`/…`) and never a protocol-relative
  // or cross-origin URL.
  const next = safeNextPath(searchParams.get('next'), '/dashboard')

  const supabase = await createClient()

  // Fluxo 1: token_hash — gerado pelo nosso custom forgot-password (recovery)
  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type: type as 'recovery' | 'signup' | 'email' | 'invite' | 'magiclink' | 'email_change',
    })

    if (!error) {
      const destination = type === 'recovery' ? '/reset-password' : next
      return NextResponse.redirect(`${origin}${destination}`)
    }

    logger.error('verifyOtp error', { action: 'auth-callback', type, error: error.message })
    return NextResponse.redirect(`${origin}/unauthorized`)
  }

  // Fluxo 2: code — PKCE (OAuth, magic link iniciado pelo cliente)
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }

    logger.error('exchangeCodeForSession error', { action: 'auth-callback', error: error.message })
  }

  return NextResponse.redirect(`${origin}/unauthorized`)
}
