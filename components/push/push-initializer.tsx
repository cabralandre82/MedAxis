'use client'

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { requestPushPermission, onForegroundMessage } from '@/lib/firebase/client'

/**
 * PushInitializer — mounts once inside the authenticated layout.
 *
 * Responsibilities:
 *  1. On first render, request Notification permission and obtain an FCM token.
 *  2. Register the token via POST /api/push/subscribe so the server can send pushes.
 *  3. Listen for foreground messages (app is open) and show a toast.
 *
 * Silently no-ops when:
 *  - Browser does not support Notifications (old browsers, iOS < 16.4)
 *  - User denies permission
 *  - Firebase env vars are not configured (dev without Firebase project)
 */
export function PushInitializer() {
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    async function init() {
      try {
        const token = await requestPushPermission()
        if (!token) return

        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        })
      } catch {
        // Non-critical — push is a best-effort feature
      }
    }

    init()

    // Listen for messages while the tab is in the foreground
    const unsubscribe = onForegroundMessage(({ title, body, link }) => {
      toast(title ?? 'Clinipharma', {
        description: body,
        action: link
          ? {
              label: 'Ver',
              onClick: () => window.open(link, '_self'),
            }
          : undefined,
        duration: 6000,
      })
    })

    return () => {
      unsubscribe()
    }
  }, [])

  return null
}
