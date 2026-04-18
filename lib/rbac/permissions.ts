/**
 * Fine-grained permissions — Wave 4.
 *
 * Layer above `lib/rbac` that expresses authorisation as _permissions_
 * (`users.manage`, `audit.read`, …) instead of roles. Gated behind the
 * feature flag `rbac.fine_grained`:
 *
 *   - flag OFF (default)     → delegates to `requireRole` using a static
 *                              fallback map derived from migration 047
 *                              seeds. Existing behaviour is preserved
 *                              byte-for-byte, so flipping the flag off at
 *                              any time is a safe rollback.
 *   - flag ON for subject    → calls the `has_permission(user_id, perm)`
 *                              RPC (SECURITY DEFINER, defined in 047) which
 *                              reads `user_roles` + `role_permissions` +
 *                              `user_permission_grants`.
 *
 * The RPC short-circuits to `true` for SUPER_ADMIN (wildcard). When the
 * RPC errors we **fail closed** — permission is denied and the error is
 * logged.
 *
 * Hot-path latency: each check does at most one RPC round-trip. We cache
 * negative and positive answers per-request in an AsyncLocalStorage store
 * so that guards in the same request (e.g. `requirePermission` in a
 * server action called from a server component that already gated with
 * `requirePermissionPage`) never re-query.
 *
 * @module lib/rbac/permissions
 */

import 'server-only'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/db/admin'
import { getCurrentUser, requireAuth } from '@/lib/auth/session'
import { hasAnyRole } from '@/lib/rbac'
import { isFeatureEnabled } from '@/lib/features'
import { logger } from '@/lib/logger'
import { getRequestContext } from '@/lib/logger/context'
import type { ProfileWithRoles, UserRole } from '@/types'

// ─────────────────────────────────────────────────────────────────
// Catalog — must stay in sync with migration 047 seed.
// ─────────────────────────────────────────────────────────────────

export const Permissions = {
  PLATFORM_ADMIN: 'platform.admin',
  USERS_READ: 'users.read',
  USERS_MANAGE: 'users.manage',
  USERS_ANONYMIZE: 'users.anonymize',
  CLINICS_READ: 'clinics.read',
  CLINICS_MANAGE: 'clinics.manage',
  PHARMACIES_READ: 'pharmacies.read',
  PHARMACIES_MANAGE: 'pharmacies.manage',
  PHARMACIES_MANAGE_OWN: 'pharmacies.manage_own',
  DOCTORS_READ: 'doctors.read',
  DOCTORS_MANAGE: 'doctors.manage',
  PRODUCTS_READ: 'products.read',
  PRODUCTS_MANAGE: 'products.manage',
  PRODUCTS_MANAGE_OWN_PHARMACY: 'products.manage_own_pharmacy',
  ORDERS_READ: 'orders.read',
  ORDERS_MANAGE: 'orders.manage',
  PAYMENTS_READ: 'payments.read',
  PAYMENTS_MANAGE: 'payments.manage',
  COUPONS_READ: 'coupons.read',
  COUPONS_MANAGE: 'coupons.manage',
  CONSULTANTS_READ: 'consultants.read',
  CONSULTANTS_MANAGE: 'consultants.manage',
  DISTRIBUTORS_READ: 'distributors.read',
  DISTRIBUTORS_MANAGE: 'distributors.manage',
  CATEGORIES_READ: 'categories.read',
  CATEGORIES_MANAGE: 'categories.manage',
  AUDIT_READ: 'audit.read',
  SERVER_LOGS_READ: 'server_logs.read',
  CHURN_READ: 'churn.read',
  REPORTS_READ: 'reports.read',
  SETTINGS_READ: 'settings.read',
  SETTINGS_WRITE: 'settings.write',
  REGISTRATIONS_READ: 'registrations.read',
  REGISTRATIONS_APPROVE: 'registrations.approve',
  SUPPORT_READ_ALL: 'support.read_all',
  SUPPORT_RESPOND_INTERNAL: 'support.respond_internal',
  SUPPORT_CREATE_TICKET: 'support.create_ticket',
  LGPD_EXPORT_SELF: 'lgpd.export_self',
} as const

export type Permission = (typeof Permissions)[keyof typeof Permissions]

// ─────────────────────────────────────────────────────────────────
// Fallback role map (flag OFF path). Mirrors migration 047 seeds so the
// legacy `requireRole` behaviour resolves identically. SUPER_ADMIN is
// handled separately via wildcard semantics.
// ─────────────────────────────────────────────────────────────────

const ROLE_FALLBACK: Record<Permission, UserRole[]> = {
  'platform.admin': ['PLATFORM_ADMIN'],
  'users.read': ['PLATFORM_ADMIN'],
  'users.manage': ['PLATFORM_ADMIN'],
  'users.anonymize': [],
  'clinics.read': ['PLATFORM_ADMIN'],
  'clinics.manage': ['PLATFORM_ADMIN'],
  'pharmacies.read': ['PLATFORM_ADMIN'],
  'pharmacies.manage': ['PLATFORM_ADMIN'],
  'pharmacies.manage_own': ['PHARMACY_ADMIN'],
  'doctors.read': ['PLATFORM_ADMIN', 'CLINIC_ADMIN'],
  'doctors.manage': ['PLATFORM_ADMIN', 'CLINIC_ADMIN'],
  'products.read': ['PLATFORM_ADMIN', 'PHARMACY_ADMIN', 'CLINIC_ADMIN'],
  'products.manage': ['PLATFORM_ADMIN'],
  'products.manage_own_pharmacy': ['PHARMACY_ADMIN'],
  'orders.read': ['PLATFORM_ADMIN', 'PHARMACY_ADMIN', 'CLINIC_ADMIN'],
  'orders.manage': ['PLATFORM_ADMIN'],
  'payments.read': ['PLATFORM_ADMIN', 'PHARMACY_ADMIN', 'CLINIC_ADMIN'],
  'payments.manage': ['PLATFORM_ADMIN'],
  'coupons.read': ['PLATFORM_ADMIN'],
  'coupons.manage': ['PLATFORM_ADMIN'],
  'consultants.read': ['PLATFORM_ADMIN', 'SALES_CONSULTANT'],
  'consultants.manage': [],
  'distributors.read': ['PLATFORM_ADMIN'],
  'distributors.manage': ['PLATFORM_ADMIN'],
  'categories.read': ['PLATFORM_ADMIN', 'PHARMACY_ADMIN'],
  'categories.manage': ['PLATFORM_ADMIN'],
  'audit.read': ['PLATFORM_ADMIN'],
  'server_logs.read': ['PLATFORM_ADMIN'],
  'churn.read': ['PLATFORM_ADMIN'],
  'reports.read': ['PLATFORM_ADMIN'],
  'settings.read': ['PLATFORM_ADMIN'],
  'settings.write': ['PLATFORM_ADMIN'],
  'registrations.read': ['PLATFORM_ADMIN', 'SALES_CONSULTANT'],
  'registrations.approve': [],
  'support.read_all': ['PLATFORM_ADMIN'],
  'support.respond_internal': ['PLATFORM_ADMIN'],
  'support.create_ticket': [
    'PLATFORM_ADMIN',
    'CLINIC_ADMIN',
    'PHARMACY_ADMIN',
    'DOCTOR',
    'SALES_CONSULTANT',
  ],
  'lgpd.export_self': [
    'PLATFORM_ADMIN',
    'CLINIC_ADMIN',
    'PHARMACY_ADMIN',
    'DOCTOR',
    'SALES_CONSULTANT',
  ],
}

// ─────────────────────────────────────────────────────────────────
// Per-request cache (positive + negative).
//
// We piggyback on the existing request-scoped AsyncLocalStorage store
// used by the structured logger. The cache never outlives a single
// request, so permission revocations inside the same request
// boundary are vanishingly unlikely and acceptable.
// ─────────────────────────────────────────────────────────────────

const perRequestCaches = new WeakMap<object, Map<string, boolean>>()

function perRequestCache(): Map<string, boolean> | null {
  const ctx = getRequestContext()
  if (!ctx) return null
  let bag = perRequestCaches.get(ctx)
  if (!bag) {
    bag = new Map()
    perRequestCaches.set(ctx, bag)
  }
  return bag
}

// ─────────────────────────────────────────────────────────────────
// Core evaluator.
// ─────────────────────────────────────────────────────────────────

async function evaluate(user: ProfileWithRoles, permission: Permission): Promise<boolean> {
  // SUPER_ADMIN shortcut — same as the RPC, keeps OFF path in parity
  // with the DB semantics.
  if (user.roles.includes('SUPER_ADMIN')) return true

  const cache = perRequestCache()
  const cacheKey = `${user.id}:${permission}`
  if (cache) {
    const hit = cache.get(cacheKey)
    if (hit !== undefined) return hit
  }

  const granular = await isFeatureEnabled('rbac.fine_grained', {
    userId: user.id,
    role: user.roles[0] ?? null,
  }).catch(() => false)

  let decision: boolean
  if (!granular) {
    const allowed = ROLE_FALLBACK[permission] ?? []
    decision = hasAnyRole(user, allowed)
  } else {
    try {
      const admin = createAdminClient()
      const { data, error } = await admin.rpc('has_permission', {
        p_user_id: user.id,
        p_permission: permission,
      })
      if (error) {
        logger.error('has_permission RPC failed — failing closed', {
          userId: user.id,
          permission,
          errorMessage: error.message,
          errorCode: error.code ?? null,
        })
        decision = false
      } else {
        decision = data === true
      }
    } catch (err) {
      logger.error('has_permission RPC threw — failing closed', {
        userId: user.id,
        permission,
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      decision = false
    }
  }

  cache?.set(cacheKey, decision)
  return decision
}

// ─────────────────────────────────────────────────────────────────
// Public API.
// ─────────────────────────────────────────────────────────────────

/**
 * Does the given user carry the requested permission?
 * Returns `false` on any error (fail-closed).
 */
export async function hasPermission(
  user: ProfileWithRoles,
  permission: Permission
): Promise<boolean> {
  return evaluate(user, permission)
}

/**
 * Returns true if the user has at least one of the permissions.
 * Equivalent to `Array.some(hasPermission)` but short-circuits.
 */
export async function hasAnyPermission(
  user: ProfileWithRoles,
  permissions: Permission[]
): Promise<boolean> {
  for (const p of permissions) {
    if (await evaluate(user, p)) return true
  }
  return false
}

/**
 * Server-side guard for Server Actions and Route Handlers.
 *
 * Throws `Error('UNAUTHORIZED')` if there is no authenticated user.
 * Throws `Error('FORBIDDEN')` if authenticated but permission missing.
 * Accepts a single permission or an array (OR semantics — any match passes).
 */
export async function requirePermission(
  permission: Permission | Permission[]
): Promise<ProfileWithRoles> {
  const user = await requireAuth()
  const perms = Array.isArray(permission) ? permission : [permission]

  if (perms.length === 0) {
    logger.error('requirePermission called with empty list', { userId: user.id })
    throw new Error('FORBIDDEN')
  }

  if (await hasAnyPermission(user, perms)) return user

  logger.warn('permission denied', {
    userId: user.id,
    roles: user.roles,
    required: perms,
  })
  throw new Error('FORBIDDEN')
}

/**
 * Server-side page guard. Redirects to /login or /unauthorized instead
 * of throwing, to avoid surfacing the error boundary for a routine
 * permission miss.
 */
export async function requirePermissionPage(
  permission: Permission | Permission[]
): Promise<ProfileWithRoles> {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const perms = Array.isArray(permission) ? permission : [permission]
  if (perms.length > 0 && (await hasAnyPermission(user, perms))) return user

  logger.warn('permission denied (page)', {
    userId: user.id,
    roles: user.roles,
    required: perms,
  })
  redirect('/unauthorized')
}

/** Test-only helpers. */
export const _internal = {
  evaluate,
  ROLE_FALLBACK,
}
