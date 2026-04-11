/**
 * AES-256-GCM encryption for PII fields stored in the database.
 *
 * Key: 256-bit hex string via ENCRYPTION_KEY env var.
 * Format: `iv:authTag:ciphertext` (all hex-encoded, colon-separated).
 *
 * Fail-open on read: if decryption fails (key rotation, corrupt data),
 * returns the raw value so the app doesn't crash — log the error instead.
 */

import * as nodeCrypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // 96-bit IV recommended for GCM

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY
  if (!hex || hex.length !== 64) {
    throw new Error('[crypto] ENCRYPTION_KEY must be a 64-character hex string (256 bits)')
  }
  return Buffer.from(hex, 'hex')
}

/**
 * Encrypts a plaintext string.
 * Returns a colon-separated string: `iv:authTag:ciphertext` (all hex).
 * Returns null if value is null or empty.
 */
export function encrypt(value: string | null | undefined): string | null {
  if (value == null || value === '') return null

  const key = getKey()
  const iv = nodeCrypto.randomBytes(IV_LENGTH)
  const cipher = nodeCrypto.createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

/**
 * Decrypts a value previously encrypted with `encrypt()`.
 * Returns null if value is null or empty.
 * Fails open (returns raw value) if decryption fails — logs error.
 */
export function decrypt(value: string | null | undefined): string | null {
  if (value == null || value === '') return null

  // Not in encrypted format — return as-is (handles plaintext legacy values)
  if (!value.includes(':')) return value

  try {
    const key = getKey()
    const parts = value.split(':')
    if (parts.length !== 3) return value // malformed — fail open

    const [ivHex, authTagHex, ciphertextHex] = parts
    const iv = Buffer.from(ivHex, 'hex')
    const authTag = Buffer.from(authTagHex, 'hex')
    const ciphertext = Buffer.from(ciphertextHex, 'hex')

    const decipher = nodeCrypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch (err) {
    console.error(
      '[crypto] decrypt failed — returning raw value (key rotation or data corruption):',
      err
    )
    return value
  }
}

/**
 * Re-encrypts a value with the current key.
 * Useful for key rotation: decrypt with old key, re-encrypt with new key.
 */
export function reEncrypt(value: string | null | undefined): string | null {
  const decrypted = decrypt(value)
  return encrypt(decrypted)
}

/** Returns true if value looks like an encrypted blob (iv:authTag:ciphertext). */
export function isEncrypted(value: string | null | undefined): boolean {
  if (!value) return false
  const parts = value.split(':')
  return parts.length === 3 && parts[0].length === IV_LENGTH * 2
}
