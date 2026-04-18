import admin from 'firebase-admin'

/**
 * Firebase Admin lazy bootstrap.
 *
 * Why not a top-level `export const firebaseAdmin = getFirebaseAdmin()`?
 * --------------------------------------------------------------------
 * Next.js evaluates every route module during the "Collecting page data"
 * step of `next build`, including in Preview deployments and CI builds
 * where `FIREBASE_PRIVATE_KEY` may legitimately be unset. Initialising
 * Firebase at module-import time means the *build itself* throws
 * `Failed to parse private key: Invalid PEM formatted message` on any
 * route that transitively imports `lib/push` (e.g. the Clicksign
 * webhook). That's exactly how the deploys started failing on
 * 2026-04-18 — see Vercel run `b2b-med-platform-24qkbblh3`.
 *
 * The fix: defer `admin.initializeApp(...)` until the first FCM call
 * actually runs. If an env var is missing at that point, we throw a
 * caller-friendly error and the request fails individually instead of
 * taking down every cold start.
 */

let cached: admin.app.App | null = null

function getFirebaseAdmin(): admin.app.App {
  if (cached) return cached
  if (admin.apps.length > 0) {
    cached = admin.apps[0]!
    return cached
  }

  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Firebase Admin not configured: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY must all be set'
    )
  }

  cached = admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  })
  return cached
}

export { getFirebaseAdmin as firebaseAdmin }
export const fcmMessaging = () => admin.messaging(getFirebaseAdmin())
