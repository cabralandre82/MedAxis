/**
 * Public re-exports for `lib/secrets/`. Keep imports tidy:
 *
 *   import { rotateAllOverdue, getRotationStatus } from '@/lib/secrets'
 *
 * @module lib/secrets
 */

export {
  SECRET_MANIFEST,
  SECRET_MANIFEST_SIZE,
  TIER_MAX_AGE_DAYS,
  getSecretDescriptor,
  manifestFingerprint,
  secretsByTier,
  type SecretDescriptor,
  type SecretProvider,
  type SecretTier,
} from './manifest'

export {
  getOverdueSecrets,
  getRotationStatus,
  recordManualRotation,
  rotateAllOverdue,
  type OverdueSecret,
  type RotateAllOptions,
  type RotateAllSummary,
  type RotationOutcome,
  type RotationResult,
  type RotationStatus,
} from './rotate'
