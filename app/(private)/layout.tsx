import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import { Shell } from '@/components/layout/shell'
import { logger } from '@/lib/logger'

export default async function PrivateLayout({ children }: { children: React.ReactNode }) {
  let user
  try {
    user = await getCurrentUser()
  } catch (err) {
    // Re-throw Next.js internal errors (e.g. NEXT_REDIRECT, Dynamic server usage)
    // so the framework can handle them correctly
    if (
      err instanceof Error &&
      (err.message.includes('NEXT_REDIRECT') ||
        err.message.includes('Dynamic server usage') ||
        err.message.includes('NEXT_NOT_FOUND'))
    ) {
      throw err
    }
    logger.error('PrivateLayout: getCurrentUser threw unexpectedly', { error: String(err) })
    redirect('/login')
  }

  if (!user) {
    redirect('/login')
  }

  if (!user.is_active) {
    redirect('/unauthorized')
  }

  return <Shell user={user}>{children}</Shell>
}
