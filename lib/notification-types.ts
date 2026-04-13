/**
 * Notification type definitions and classification.
 * This file has NO server-only imports so it can be used in client components.
 */

export type NotificationType =
  | 'ORDER_CREATED'
  | 'ORDER_STATUS'
  | 'PAYMENT_CONFIRMED'
  | 'TRANSFER_REGISTERED'
  | 'CONSULTANT_TRANSFER'
  | 'DOCUMENT_UPLOADED'
  | 'PRODUCT_INTEREST'
  | 'REGISTRATION_REQUEST'
  | 'STALE_ORDER'
  | 'SUPPORT_TICKET'
  | 'SUPPORT_REPLY'
  | 'SUPPORT_RESOLVED'
  | 'COUPON_ASSIGNED'
  | 'REORDER_ALERT'
  | 'CHURN_RISK'
  | 'PRODUCT_AWAITING_PRICE'
  | 'GENERIC'

/** Types the user can silence. Critical types are always delivered. */
export const SILENCEABLE_TYPES: NotificationType[] = [
  'TRANSFER_REGISTERED',
  'CONSULTANT_TRANSFER',
  'PRODUCT_INTEREST',
  'REGISTRATION_REQUEST',
  'STALE_ORDER',
  'PRODUCT_AWAITING_PRICE',
]

/** Critical types are NEVER silenced by user preferences. */
export const CRITICAL_TYPES: NotificationType[] = [
  'ORDER_CREATED',
  'ORDER_STATUS',
  'PAYMENT_CONFIRMED',
  'DOCUMENT_UPLOADED',
  'SUPPORT_REPLY',
  'SUPPORT_RESOLVED',
]
