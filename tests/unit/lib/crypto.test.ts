import { describe, it, expect, vi, beforeEach } from 'vitest'

// Set up ENCRYPTION_KEY before importing the module
const TEST_KEY = 'a'.repeat(64) // 64 hex chars = 256 bits

beforeEach(() => {
  vi.stubEnv('ENCRYPTION_KEY', TEST_KEY)
})

describe('encrypt', () => {
  it('returns null for null input', async () => {
    const { encrypt } = await import('@/lib/crypto')
    expect(encrypt(null)).toBeNull()
    expect(encrypt(undefined)).toBeNull()
    expect(encrypt('')).toBeNull()
  })

  it('returns a colon-separated iv:authTag:ciphertext string', async () => {
    const { encrypt } = await import('@/lib/crypto')
    const result = encrypt('hello world')
    expect(result).toBeTruthy()
    const parts = result!.split(':')
    expect(parts).toHaveLength(3)
    // iv = 12 bytes = 24 hex chars
    expect(parts[0]).toHaveLength(24)
    // authTag = 16 bytes = 32 hex chars (GCM default)
    expect(parts[1]).toHaveLength(32)
    // ciphertext length > 0
    expect(parts[2].length).toBeGreaterThan(0)
  })

  it('produces different ciphertexts for same plaintext (random IV)', async () => {
    const { encrypt } = await import('@/lib/crypto')
    const a = encrypt('same value')
    const b = encrypt('same value')
    expect(a).not.toBe(b)
  })

  it('throws if ENCRYPTION_KEY is missing', async () => {
    // Setup test environments commonly carry an ENCRYPTION_KEY value in
    // process.env (loaded from `.env.local` for local dev, or injected by
    // CI). `vi.unstubAllEnvs()` only removes the *test stubs*, not the
    // baseline value, so we explicitly delete it here to force the
    // missing-env failure path. resetModules() guarantees that any
    // already-imported `lib/crypto` does not return a cached `getKey`.
    const previous = process.env.ENCRYPTION_KEY
    vi.unstubAllEnvs()
    delete process.env.ENCRYPTION_KEY
    vi.resetModules()
    try {
      const { encrypt } = await import('@/lib/crypto')
      expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY')
    } finally {
      if (previous !== undefined) process.env.ENCRYPTION_KEY = previous
      vi.stubEnv('ENCRYPTION_KEY', TEST_KEY)
    }
  })
})

describe('decrypt', () => {
  it('returns null for null input', async () => {
    const { decrypt } = await import('@/lib/crypto')
    expect(decrypt(null)).toBeNull()
    expect(decrypt(undefined)).toBeNull()
    expect(decrypt('')).toBeNull()
  })

  it('decrypts a value encrypted with encrypt()', async () => {
    const { encrypt, decrypt } = await import('@/lib/crypto')
    const original = 'Texto sensível com acentuação: André'
    const encrypted = encrypt(original)
    expect(encrypted).not.toBe(original)
    const decrypted = decrypt(encrypted)
    expect(decrypted).toBe(original)
  })

  it('round-trips complex JSON strings', async () => {
    const { encrypt, decrypt } = await import('@/lib/crypto')
    const json = JSON.stringify({ cpf: '123.456.789-00', name: 'Teste', docs: ['rg', 'cpf'] })
    expect(decrypt(encrypt(json))).toBe(json)
  })

  it('fails open (returns raw value) for non-encrypted strings', async () => {
    const { decrypt } = await import('@/lib/crypto')
    // Legacy plaintext value — should pass through unchanged
    expect(decrypt('plaintext-phone')).toBe('plaintext-phone')
  })

  it('fails open when authTag is tampered (corrupt data)', async () => {
    const { encrypt, decrypt } = await import('@/lib/crypto')
    const encrypted = encrypt('secret')!
    const parts = encrypted.split(':')
    // Corrupt the authTag
    parts[1] = 'ff'.repeat(16)
    const tampered = parts.join(':')
    // Should return the raw tampered string instead of throwing
    const result = decrypt(tampered)
    expect(result).toBe(tampered)
  })
})

describe('isEncrypted', () => {
  it('returns true for encrypted values', async () => {
    const { encrypt, isEncrypted } = await import('@/lib/crypto')
    const encrypted = encrypt('test')
    expect(isEncrypted(encrypted)).toBe(true)
  })

  it('returns false for plaintext', async () => {
    const { isEncrypted } = await import('@/lib/crypto')
    expect(isEncrypted('plaintext')).toBe(false)
    expect(isEncrypted(null)).toBe(false)
    expect(isEncrypted('')).toBe(false)
  })
})

describe('reEncrypt', () => {
  it('produces a new encrypted value with same plaintext', async () => {
    const { encrypt, decrypt, reEncrypt } = await import('@/lib/crypto')
    const original = 'meu número secreto'
    const encrypted = encrypt(original)
    const reEncrypted = reEncrypt(encrypted)
    // Different ciphertext (different IV)
    expect(reEncrypted).not.toBe(encrypted)
    // But same plaintext when decrypted
    expect(decrypt(reEncrypted)).toBe(original)
  })
})
