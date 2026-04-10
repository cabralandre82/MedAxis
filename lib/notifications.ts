import 'server-only'
import { createAdminClient } from '@/lib/db/admin'
import { sendPushToUser, sendPushToRole, type PushPayload } from '@/lib/push'
import { type NotificationType, SILENCEABLE_TYPES, CRITICAL_TYPES } from '@/lib/notification-types'

export type { NotificationType }
export { SILENCEABLE_TYPES, CRITICAL_TYPES }

export interface CreateNotificationInput {
  userId: string
  type: NotificationType
  title: string
  body?: string
  message?: string
  link?: string
  /** If true, also sends a push notification in addition to in-app */
  push?: boolean | Partial<PushPayload>
}

/**
 * Checks a single user's notification_preferences map to decide if the type is enabled.
 * Pure function — no DB call.
 */
function isPreferenceEnabled(
  prefs: Record<string, boolean> | null | undefined,
  type: NotificationType
): boolean {
  if (CRITICAL_TYPES.includes(type)) return true
  if (!SILENCEABLE_TYPES.includes(type)) return true // GENERIC and unknown always on
  return (prefs ?? {})[type] !== false // missing key → enabled
}

/**
 * Single-user check that hits the DB once.
 * Used by createNotification only.
 */
async function isTypeEnabled(userId: string, type: NotificationType): Promise<boolean> {
  if (CRITICAL_TYPES.includes(type)) return true
  if (!SILENCEABLE_TYPES.includes(type)) return true

  const admin = createAdminClient()
  const { data } = await admin
    .from('profiles')
    .select('notification_preferences')
    .eq('id', userId)
    .single()

  const prefs = (data?.notification_preferences ?? {}) as Record<string, boolean>
  return prefs[type] !== false
}

export async function createNotification(input: CreateNotificationInput): Promise<void> {
  try {
    if (!input.userId) return
    const admin = createAdminClient()
    const enabled = await isTypeEnabled(input.userId, input.type)
    if (!enabled) return

    await admin.from('notifications').insert({
      user_id: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? input.message ?? null,
      link: input.link ?? null,
    })

    const shouldPush = input.push !== undefined ? !!input.push : CRITICAL_TYPES.includes(input.type)

    if (shouldPush) {
      const pushOverride = typeof input.push === 'object' ? input.push : {}
      await sendPushToUser(input.userId, {
        title: pushOverride.title ?? input.title,
        body: pushOverride.body ?? input.body ?? input.message ?? '',
        link: pushOverride.link ?? input.link,
      })
    }
  } catch (err) {
    console.warn('[notifications] failed to create notification:', err)
  }
}

export async function createNotificationForRole(
  role: string,
  input: Omit<CreateNotificationInput, 'userId'>
): Promise<void> {
  try {
    const admin = createAdminClient()
    const { data: roles } = await admin.from('user_roles').select('user_id').eq('role', role)
    if (!roles?.length) return

    const userIds = roles.map((r) => r.user_id)

    // ── O(1) batch query for notification_preferences ──────────────────────
    // Previously: O(n) — one isTypeEnabled() DB call per user.
    // Now: one query fetching all preferences, filtered in memory.
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, notification_preferences')
      .in('id', userIds)

    const profileMap = Object.fromEntries(
      (profiles ?? []).map((p) => [
        p.id,
        (p.notification_preferences ?? {}) as Record<string, boolean>,
      ])
    )

    const eligibleUserIds = userIds.filter((uid) =>
      isPreferenceEnabled(profileMap[uid], input.type)
    )

    if (!eligibleUserIds.length) return

    await admin.from('notifications').insert(
      eligibleUserIds.map((uid) => ({
        user_id: uid,
        type: input.type,
        title: input.title,
        body: input.body ?? input.message ?? null,
        link: input.link ?? null,
      }))
    )

    const shouldPush = input.push !== undefined ? !!input.push : CRITICAL_TYPES.includes(input.type)

    if (shouldPush) {
      await sendPushToRole(role, {
        title: input.title,
        body: input.body ?? input.message ?? '',
        link: input.link,
      })
    }
  } catch (err) {
    console.warn('[notifications] failed to create role notification:', err)
  }
}
