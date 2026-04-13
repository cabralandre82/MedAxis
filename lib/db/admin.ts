import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Admin client using the service role key.
 * ONLY use in Server Actions, Route Handlers, and server-side code.
 * NEVER expose this client to the browser.
 *
 * Singleton per process: reused across warm serverless invocations
 * instead of re-initializing on every request.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminInstance: SupabaseClient<any, 'public', any> | null = null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAdminClient(): SupabaseClient<any, 'public', any> {
  if (!_adminInstance) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!url || !key) {
      throw new Error(
        `[adminClient] Missing env vars: ${!url ? 'NEXT_PUBLIC_SUPABASE_URL ' : ''}${!key ? 'SUPABASE_SERVICE_ROLE_KEY' : ''}`.trim()
      )
    }

    _adminInstance = createSupabaseClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  }
  return _adminInstance
}

/**
 * Force a fresh client instance.
 * Only needed in tests that mock createAdminClient per-call.
 * @internal
 */
export function _resetAdminClientForTests() {
  _adminInstance = null
}
