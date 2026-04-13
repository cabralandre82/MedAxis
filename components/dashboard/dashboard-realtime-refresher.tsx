'use client'

/**
 * Invisible component that keeps the admin dashboard KPI cards in sync.
 *
 * Strategy (two layers):
 *  1. Primary — Supabase Realtime postgres_changes on the four tables that
 *     drive dashboard metrics (products, orders, payments, transfers).
 *     When any INSERT/UPDATE arrives, it calls the revalidateDashboard()
 *     server action (which runs revalidateTag('dashboard') on the server)
 *     and then router.refresh() so Next.js re-renders with fresh cache-busted
 *     data.
 *  2. Fallback — silent 60-second polling via router.refresh() after
 *     revalidateDashboard(), ensuring eventual consistency even when
 *     Realtime is unavailable.
 */

import { useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/db/client'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { revalidateDashboard } from '@/lib/actions/revalidate'

const POLL_MS = 60_000

const WATCHED_TABLES = ['products', 'orders', 'payments', 'transfers'] as const

export function DashboardRealtimeRefresher() {
  const router = useRouter()
  const channelRef = useRef<RealtimeChannel | null>(null)
  const clientRef = useRef<SupabaseClient | null>(null)

  const refresh = useCallback(async () => {
    await revalidateDashboard()
    router.refresh()
  }, [router])

  // Polling fallback
  useEffect(() => {
    const id = setInterval(refresh, POLL_MS)
    return () => clearInterval(id)
  }, [refresh])

  // Realtime primary
  useEffect(() => {
    const supabase = createClient()
    clientRef.current = supabase

    supabase.auth.getSession().then(({ data }) => {
      if (clientRef.current !== supabase) return
      if (!data.session) return // not authenticated — polling fallback handles it

      let channel = supabase.channel('dashboard-metrics')

      for (const table of WATCHED_TABLES) {
        channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, () =>
          refresh()
        )
      }

      channel.subscribe()
      channelRef.current = channel
    })

    return () => {
      clientRef.current = null
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [refresh])

  return null
}
