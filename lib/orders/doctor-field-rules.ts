/**
 * Determines whether the "requesting doctor" field should be shown and/or
 * required when placing an order.
 *
 * Rules:
 * - No linked doctors + prescription product in cart → blocked (order cannot proceed)
 * - No linked doctors + no prescription product → field hidden, not required
 * - Has linked doctors + no prescription product → show, optional
 * - Has linked doctors + prescription product → show, required
 */
export function resolveDoctorFieldState(
  cartItems: { requires_prescription: boolean }[],
  linkedDoctors: unknown[]
): { show: boolean; required: boolean; blocked: boolean } {
  const hasRxProduct = cartItems.some((item) => item.requires_prescription)

  if (linkedDoctors.length === 0) {
    // Blocked when there's a prescription product but no doctor available to assign
    return { show: false, required: false, blocked: hasRxProduct }
  }

  return { show: true, required: hasRxProduct, blocked: false }
}

/**
 * Parses the ?cart=id:qty,id:qty query param used to preserve the cart
 * when navigating away from /orders/new (e.g. to /doctors/new).
 *
 * Returns an array of { productId, quantity } entries.
 * Malformed or zero-quantity entries are silently dropped.
 */
export function parseCartParam(
  cartParam: string | undefined
): { productId: string; quantity: number }[] {
  if (!cartParam) return []
  return cartParam.split(',').flatMap((entry) => {
    const [productId, qtyStr] = entry.split(':')
    const quantity = parseInt(qtyStr ?? '1', 10)
    return productId && quantity > 0 ? [{ productId, quantity }] : []
  })
}
