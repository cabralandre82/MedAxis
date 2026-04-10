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
    _adminInstance = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    )
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
