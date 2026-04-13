'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, Check, CheckCheck, ExternalLink } from 'lucide-react'
import { createClient } from '@/lib/db/client'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'

const POLL_MS = 30_000

interface Notification {
  id: string
  type: string
  title: string
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
}

const TYPE_ICONS: Record<string, string> = {
  ORDER_CREATED: '📦',
  ORDER_STATUS: '🔄',
  PAYMENT_CONFIRMED: '✅',
  TRANSFER_REGISTERED: '💸',
  CONSULTANT_TRANSFER: '💳',
  DOCUMENT_UPLOADED: '📎',
  GENERIC: '🔔',
}

export function NotificationBell() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const clientRef = useRef<SupabaseClient | null>(null)

  const fetchNotifications = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('notifications')
      .select('id, type, title, body, link, read_at, created_at')
      .order('created_at', { ascending: false })
      .limit(30)
    setNotifications((data ?? []) as Notification[])
    setUnreadCount((data ?? []).filter((n: Notification) => !n.read_at).length)
  }, [])

  // Polling fallback — guarantees eventual consistency even if Realtime is down
  useEffect(() => {
    const id = setInterval(fetchNotifications, POLL_MS)
    return () => clearInterval(id)
  }, [fetchNotifications])

  // Realtime subscription — guarded by auth session check to avoid anon connections
  useEffect(() => {
    fetchNotifications()

    const supabase = createClient()
    clientRef.current = supabase

    supabase.auth.getSession().then(({ data }) => {
      if (clientRef.current !== supabase) return
      if (!data.session) return // not authenticated — polling fallback handles it

      const channel = supabase
        .channel('notifications-bell')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, () =>
          fetchNotifications()
        )
        .subscribe()

      channelRef.current = channel
    })

    return () => {
      clientRef.current = null
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [fetchNotifications])

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const markAsRead = async (id: string, link?: string | null) => {
    const supabase = createClient()
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
    )
    setUnreadCount((prev) => Math.max(0, prev - 1))
    if (link) {
      setOpen(false)
      router.push(link)
    }
  }

  const markAllRead = async () => {
    setLoading(true)
    const supabase = createClient()
    await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .is('read_at', null)
    await fetchNotifications()
    setLoading(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
        aria-label="Notificações"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-11 right-0 z-50 w-80 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-gray-900">
              Notificações
              {unreadCount > 0 && (
                <span className="ml-2 rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">
                  {unreadCount} nova(s)
                </span>
              )}
            </h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                disabled={loading}
                className="flex items-center gap-1 text-xs text-blue-600 hover:underline disabled:opacity-50"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Marcar todas como lidas
              </button>
            )}
          </div>

          {/* Notifications list */}
          <div className="max-h-96 divide-y divide-gray-50 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center py-10 text-center">
                <Bell className="mb-2 h-8 w-8 text-gray-200" />
                <p className="text-sm text-gray-400">Nenhuma notificação</p>
              </div>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => markAsRead(n.id, n.link)}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 ${
                    !n.read_at ? 'bg-blue-50/40' : ''
                  }`}
                >
                  <span className="mt-0.5 flex-shrink-0 text-base leading-none">
                    {TYPE_ICONS[n.type] ?? '🔔'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-xs leading-snug ${!n.read_at ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}
                    >
                      {n.title}
                    </p>
                    {n.body && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{n.body}</p>
                    )}
                    <p className="mt-1 text-[10px] text-gray-400">
                      {formatDistanceToNow(new Date(n.created_at), {
                        addSuffix: true,
                        locale: ptBR,
                      })}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 flex-col items-end gap-1">
                    {!n.read_at && (
                      <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-blue-500" />
                    )}
                    {n.read_at && <Check className="h-3.5 w-3.5 text-gray-300" />}
                    {n.link && <ExternalLink className="h-3 w-3 text-gray-300" />}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
