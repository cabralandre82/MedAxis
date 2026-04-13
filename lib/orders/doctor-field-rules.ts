/**
 * Determines whether the "requesting doctor" field should be shown and/or
 * required when placing an order.
 *
 * Rules:
 * - No linked doctors → field is hidden (clinic has no doctors at all)
 * - Has linked doctors + no prescription product in cart → optional
 * - Has linked doctors + at least one prescription product in cart → required
 */
export function resolveDoctorFieldState(
  cartItems: { requires_prescription: boolean }[],
  linkedDoctors: unknown[]
): { show: boolean; required: boolean } {
  if (linkedDoctors.length === 0) return { show: false, required: false }
  const required = cartItems.some((item) => item.requires_prescription)
  return { show: true, required }
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
