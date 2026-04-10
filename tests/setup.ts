import '@testing-library/jest-dom'
import { vi } from 'vitest'

// ── server-only: must be mocked first ────────────────────────────────────────
vi.mock('server-only', () => ({}))

// ── Upstash: optional packages — mock so tests run without them installed ─────
vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    constructor() {}
    limit(_identifier: string) {
      return Promise.resolve({ success: true, remaining: 59, reset: Date.now() + 60_000 })
    }
    static slidingWindow(max: number, _window: string) {
      return { type: 'slidingWindow', max }
    }
  },
}))
vi.mock('@upstash/redis', () => ({
  Redis: class {
    static fromEnv() {
      return new this()
    }
  },
}))

// ── next/cache ────────────────────────────────────────────────────────────────
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

// ── next/navigation ───────────────────────────────────────────────────────────
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
}))

// ── next/headers ──────────────────────────────────────────────────────────────
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() })),
}))

// ── Firebase admin ────────────────────────────────────────────────────────────
vi.mock('firebase-admin', () => ({
  default: {
    apps: [],
    initializeApp: vi.fn().mockReturnValue({ name: 'mock-app' }),
    credential: { cert: vi.fn().mockReturnValue({}) },
    messaging: vi.fn().mockReturnValue({
      sendEach: vi.fn().mockResolvedValue({ responses: [] }),
    }),
  },
}))

// ── Firebase client SDK ───────────────────────────────────────────────────────
vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(),
  getApps: vi.fn().mockReturnValue([]),
}))
vi.mock('firebase/messaging', () => ({
  getMessaging: vi.fn(),
  getToken: vi.fn(),
  onMessage: vi.fn().mockReturnValue(() => {}),
}))

// ── Twilio ────────────────────────────────────────────────────────────────────
vi.mock('twilio', () => ({
  default: vi.fn().mockReturnValue({
    messages: { create: vi.fn().mockResolvedValue({ sid: 'test-sid' }) },
  }),
}))

// ── Resend ────────────────────────────────────────────────────────────────────
vi.mock('resend', () => {
  function ResendMock() {
    return { emails: { send: vi.fn().mockResolvedValue({ id: 'email-test-id' }) } }
  }
  return { Resend: ResendMock }
})

// ── lib/db/admin — global default mock (tests can override per-suite) ─────────
vi.mock('@/lib/db/admin', () => ({
  createAdminClient: vi.fn(() => mockSupabaseAdmin()),
}))

// ── lib/db/server — global default mock ──────────────────────────────────────
vi.mock('@/lib/db/server', () => ({
  createClient: vi.fn(async () => mockSupabaseClient()),
}))

// ── lib/push ─────────────────────────────────────────────────────────────────
vi.mock('@/lib/push', () => ({
  sendPushToUser: vi.fn().mockResolvedValue(undefined),
  sendPushToRole: vi.fn().mockResolvedValue(undefined),
}))

// ── lib/email ────────────────────────────────────────────────────────────────
vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}))

// ── lib/email/templates ───────────────────────────────────────────────────────
vi.mock('@/lib/email/templates', () => ({
  paymentConfirmedEmail: vi.fn().mockReturnValue({ subject: 'test', html: '<p>test</p>' }),
  transferRegisteredEmail: vi.fn().mockReturnValue({ subject: 'test', html: '<p>test</p>' }),
  consultantTransferEmail: vi.fn().mockReturnValue({ subject: 'test', html: '<p>test</p>' }),
}))

// ── lib/audit ────────────────────────────────────────────────────────────────
vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
  AuditAction: {
    CREATE: 'CREATE',
    UPDATE: 'UPDATE',
    DELETE: 'DELETE',
    STATUS_CHANGE: 'STATUS_CHANGE',
    PAYMENT_CONFIRMED: 'PAYMENT_CONFIRMED',
    PRICE_CHANGE: 'PRICE_CHANGE',
    SETTING_CHANGED: 'SETTING_CHANGED',
    TRANSFER_REGISTERED: 'TRANSFER_REGISTERED',
  },
  AuditEntity: {
    CLINIC: 'CLINIC',
    DOCTOR: 'DOCTOR',
    PHARMACY: 'PHARMACY',
    PRODUCT: 'PRODUCT',
    ORDER: 'ORDER',
    PAYMENT: 'PAYMENT',
    TRANSFER: 'TRANSFER',
    PROFILE: 'PROFILE',
    APP_SETTING: 'APP_SETTING',
  },
}))

// ── lib/notifications ────────────────────────────────────────────────────────
vi.mock('@/lib/notifications', () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
  createNotificationForRole: vi.fn().mockResolvedValue(undefined),
  SILENCEABLE_TYPES: [
    'TRANSFER_REGISTERED',
    'CONSULTANT_TRANSFER',
    'PRODUCT_INTEREST',
    'REGISTRATION_REQUEST',
    'STALE_ORDER',
  ],
  CRITICAL_TYPES: ['ORDER_CREATED', 'ORDER_STATUS', 'PAYMENT_CONFIRMED', 'DOCUMENT_UPLOADED'],
}))

// ── lib/session-logger ───────────────────────────────────────────────────────
vi.mock('@/lib/session-logger', () => ({
  logSession: vi.fn().mockResolvedValue(undefined),
}))

// ─── Supabase builder factory ──────────────────────────────────────────────
// Returns a fluent query builder where each method returns `this`-like chains
// and .single(), .maybeSingle(), etc. return { data: null, error: null } by default.
// Tests override via mockResolvedValueOnce on the chain methods.

export function makeQueryBuilder(resolvedData: unknown = null, resolvedError: unknown = null) {
  const builder: Record<string, unknown> = {}

  const terminalResult = {
    data: resolvedData,
    error: resolvedError,
    count: resolvedData ? (Array.isArray(resolvedData) ? resolvedData.length : 1) : 0,
  }

  // Filtering / ordering / paging — all return builder
  builder.select = vi.fn().mockReturnValue(builder)
  builder.eq = vi.fn().mockReturnValue(builder)
  builder.neq = vi.fn().mockReturnValue(builder)
  builder.in = vi.fn().mockReturnValue(builder)
  builder.not = vi.fn().mockReturnValue(builder)
  builder.is = vi.fn().mockReturnValue(builder)
  builder.gte = vi.fn().mockReturnValue(builder)
  builder.lte = vi.fn().mockReturnValue(builder)
  builder.gt = vi.fn().mockReturnValue(builder)
  builder.lt = vi.fn().mockReturnValue(builder)
  builder.order = vi.fn().mockReturnValue(builder)
  builder.limit = vi.fn().mockReturnValue(builder)
  builder.range = vi.fn().mockReturnValue(builder)

  // Mutation — return builder so callers can chain .select().single()
  builder.insert = vi.fn().mockReturnValue(builder)
  builder.upsert = vi.fn().mockReturnValue(builder)
  builder.update = vi.fn().mockReturnValue(builder)
  builder.delete = vi.fn().mockReturnValue(builder)

  // Terminal — resolve with data
  builder.single = vi.fn().mockResolvedValue(terminalResult)
  builder.maybeSingle = vi.fn().mockResolvedValue({ data: resolvedData, error: null })

  // Make builder itself awaitable (resolves array queries)
  builder.then = (resolve: (v: unknown) => void) => resolve(terminalResult)

  return builder
}

export function mockSupabaseAdmin(overrides: Record<string, unknown> = {}) {
  const qb = makeQueryBuilder()
  return {
    from: vi.fn().mockReturnValue(qb),
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://test.com/file' } }),
        remove: vi.fn().mockResolvedValue({ error: null }),
      }),
    },
    auth: {
      admin: {
        createUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null }),
        updateUserById: vi.fn().mockResolvedValue({ data: {}, error: null }),
        deleteUser: vi.fn().mockResolvedValue({ error: null }),
        generateLink: vi.fn().mockResolvedValue({
          data: { properties: { hashed_token: 'tok123' } },
          error: null,
        }),
      },
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null }),
    },
    ...overrides,
  }
}

export function mockSupabaseClient(overrides: Record<string, unknown> = {}) {
  const qb = makeQueryBuilder()
  return {
    from: vi.fn().mockReturnValue(qb),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      verifyOtp: vi.fn().mockResolvedValue({ error: null }),
      exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
    },
    ...overrides,
  }
}
