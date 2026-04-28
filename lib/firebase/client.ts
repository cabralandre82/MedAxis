'use client'

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import { getMessaging, getToken, isSupported, onMessage, type Messaging } from 'firebase/messaging'

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

let app: FirebaseApp | null = null
let messaging: Messaging | null = null

function getFirebaseApp(): FirebaseApp {
  if (!app) {
    app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]
  }
  return app
}

/**
 * Browser-aware lazy resolver for Firebase Messaging.
 *
 * `firebase/messaging` 9+ rejects asynchronously on browsers that lack
 * the required APIs (Mobile Safari < 16.4, in-app webviews, Brave with
 * blockers, etc.). The throw bubbles up as an *unhandled promise
 * rejection* if you call `getMessaging()` directly, which is exactly
 * what Sentry caught as `de5eecaa3dd94957b59161d64ad262ae` on iPhone
 * iOS 18.7. The fix is to ALWAYS gate behind `isSupported()` (Firebase's
 * own probe) before constructing the Messaging instance.
 *
 * Returns `null` for any of:
 *  - SSR (no `window`)
 *  - browsers Firebase declares unsupported
 *  - constructor still throws (defense in depth — `isSupported` has
 *    been observed to return true in some webviews and then `getMessaging`
 *    still throws synchronously)
 *
 * Result is cached after first probe so we only pay the round-trip once.
 */
let messagingProbe: Promise<Messaging | null> | null = null

async function getFirebaseMessaging(): Promise<Messaging | null> {
  if (typeof window === 'undefined') return null
  if (messaging) return messaging
  if (!messagingProbe) {
    messagingProbe = (async () => {
      try {
        const supported = await isSupported()
        if (!supported) return null
        messaging = getMessaging(getFirebaseApp())
        return messaging
      } catch {
        return null
      }
    })()
  }
  return messagingProbe
}

export async function requestPushPermission(): Promise<string | null> {
  try {
    if (typeof window === 'undefined') return null
    // `'Notification' in window` is not enough — some webviews expose
    // the property as `undefined`. We need a real callable check.
    const NotificationApi = (window as { Notification?: typeof Notification }).Notification
    if (typeof NotificationApi?.requestPermission !== 'function') return null
    const permission = await NotificationApi.requestPermission()
    if (permission !== 'granted') return null

    const m = await getFirebaseMessaging()
    if (!m) return null

    const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY
    if (!vapidKey || vapidKey === 'PENDING_GENERATE_FROM_FIREBASE_CONSOLE') {
      console.warn(
        '[push] VAPID key not configured. Set NEXT_PUBLIC_FIREBASE_VAPID_KEY in env vars.'
      )
      return null
    }

    const token = await getToken(m, {
      vapidKey,
      serviceWorkerRegistration: await navigator.serviceWorker.register(
        '/firebase-messaging-sw.js'
      ),
    })

    return token ?? null
  } catch (err) {
    console.warn('[push] Failed to get FCM token:', err)
    return null
  }
}

/**
 * Subscribes to foreground messages **iff** Firebase Messaging is supported
 * in the current browser. Returns a no-op unsubscribe synchronously so
 * callers can safely use it from `useEffect` without awaiting.
 *
 * Internally we resolve `getFirebaseMessaging()` async (because of
 * `isSupported`); on unsupported browsers we never call `onMessage` and
 * the whole call is a silent no-op.
 */
export function onForegroundMessage(
  callback: (payload: { title?: string; body?: string; link?: string }) => void
): () => void {
  let unsubscribe: (() => void) | null = null
  let cancelled = false

  void (async () => {
    const m = await getFirebaseMessaging()
    if (!m || cancelled) return
    unsubscribe = onMessage(m, (payload) => {
      callback({
        title: payload.notification?.title,
        body: payload.notification?.body,
        link: payload.data?.link,
      })
    })
  })()

  return () => {
    cancelled = true
    unsubscribe?.()
  }
}
