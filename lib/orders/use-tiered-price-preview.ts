'use client'

/**
 * Hook React: cache local de previews de preço para produtos em
 * `pricing_mode='TIERED_PROFILE'`.
 *
 * Problema
 * --------
 * O carrinho do `/orders/new` mostra um total ao vivo. Para produtos
 * FIXED basta `price_current × quantity` (mais cupom). Para produtos
 * TIERED, o preço unitário VARIA conforme o tier que cobre a
 * quantidade — então mudar quantidade de 1 → 4 pode mudar o preço
 * unitário de R$ 1.500 para R$ 1.300, e isso precisa refletir
 * imediatamente na UI.
 *
 * Decisão: chamar `/api/pricing/preview` ao vivo com cache.
 * ---------------------------------------------------------------
 * - Mais barato chamar 1 RPC ao mudar qty do que importar a tabela
 *   de tiers para o client e replicar a lógica TS-side (drift =
 *   ghost money).
 * - Cache key `productId|qty|couponId|clinicId|doctorId`. Cache
 *   miss → fetch; hit → reusa.
 * - Erros (no_active_profile, no_tier_for_quantity) são guardados
 *   no cache também — UI mostra mensagem claramente sem reabrir
 *   conexão.
 *
 * Não-objetivos
 * -------------
 * - NÃO é fonte da verdade. O `freeze_order_item_price` trigger
 *   reavalia tudo no INSERT — se o estado do servidor mudar entre
 *   o preview e o submit (cupom expirou, novo profile publicado),
 *   o pedido pode acabar custando algo diferente. UI deve avisar
 *   "preço-vivo, sujeito a confirmação". Já era assim com cupom.
 *
 * Interface
 * ---------
 *   const cache = useTieredPricePreview({ items, scope })
 *   const entry = cache.get(productId, quantity, couponId)
 *   // entry: { state: 'pending' | 'ok' | 'error', unitCents?, breakdown?, error? }
 *
 * Itens são tracked vía effect — o hook automaticamente re-busca
 * quando a array muda (deduplicação por chave).
 */

import { useEffect, useRef, useState } from 'react'
import type { PricingBreakdown } from '@/types'

type TierEntryState = 'pending' | 'ok' | 'error'

export interface TierEntry {
  state: TierEntryState
  unitCents?: number
  breakdown?: PricingBreakdown
  errorReason?: string
}

interface ItemKey {
  productId: string
  quantity: number
  /** Optional coupon to include in the preview. Null means "no coupon". */
  couponId?: string | null
}

interface Scope {
  /** SUPER_ADMIN may pass these explicitly; non-admin sees them ignored
   *  by /api/pricing/preview (resolves from session). Pass them for
   *  cache key consistency only. */
  clinicId?: string | null
  doctorId?: string | null
}

interface ApiOk {
  ok: true
  breakdown: PricingBreakdown
}
interface ApiErr {
  ok: false
  reason: string
}
type ApiResponse = ApiOk | ApiErr

function buildKey(item: ItemKey, scope: Scope): string {
  return [
    item.productId,
    String(item.quantity),
    item.couponId ?? '',
    scope.clinicId ?? '',
    scope.doctorId ?? '',
  ].join('|')
}

interface CacheValue extends TierEntry {
  /** Set once a fetch resolves; lets us cancel stale fetches without
   *  setting state. */
  inflight?: AbortController
}

export interface TieredPriceCache {
  get(productId: string, quantity: number, couponId?: string | null): TierEntry | undefined
}

export function useTieredPricePreview(items: ItemKey[], scope: Scope = {}): TieredPriceCache {
  // Map<key, CacheValue>. Stored as plain object inside state for React
  // re-render triggering — Map mutations don't trigger React updates.
  const [cache, setCache] = useState<Record<string, CacheValue>>({})
  const cacheRef = useRef<Record<string, CacheValue>>({})
  cacheRef.current = cache

  // Pre-compute the effect's dependency string here — keeping the
  // `.join` directly inside the deps array trips the eslint
  // react-hooks/exhaustive-deps complex-expression warning.
  const itemsDigest = items.map((i) => `${i.productId}:${i.quantity}:${i.couponId ?? ''}`).join(',')
  const scopeClinic = scope.clinicId ?? ''
  const scopeDoctor = scope.doctorId ?? ''

  useEffect(() => {
    let cancelled = false
    const requested = new Set<string>()

    for (const item of items) {
      const key = buildKey(item, scope)
      requested.add(key)
      const existing = cacheRef.current[key]
      if (existing) continue // already fetched or in-flight

      const ctrl = new AbortController()

      // Mark pending immediately so the UI shows a loader.
      setCache((prev) => ({
        ...prev,
        [key]: { state: 'pending', inflight: ctrl },
      }))

      const params = new URLSearchParams({
        product_id: item.productId,
        quantity: String(item.quantity),
      })
      if (scope.clinicId) params.set('clinic_id', scope.clinicId)
      if (scope.doctorId) params.set('doctor_id', scope.doctorId)
      if (item.couponId) params.set('coupon_id', item.couponId)

      fetch(`/api/pricing/preview?${params.toString()}`, {
        method: 'GET',
        cache: 'no-store',
        signal: ctrl.signal,
      })
        .then(async (r) => {
          if (cancelled) return
          if (!r.ok) {
            // 4xx/5xx: protocol error. Store as 'error' with reason.
            const json: ApiResponse | { error: string } = await r.json().catch(() => ({}))
            const reason =
              'reason' in json && typeof json.reason === 'string'
                ? json.reason
                : 'reason' in (json as Record<string, unknown>)
                  ? String((json as { reason: unknown }).reason)
                  : 'http_error'
            setCache((prev) => ({
              ...prev,
              [key]: { state: 'error', errorReason: reason },
            }))
            return
          }
          const json: ApiResponse = await r.json()
          if (cancelled) return
          if (json.ok) {
            setCache((prev) => ({
              ...prev,
              [key]: {
                state: 'ok',
                unitCents: json.breakdown.final_unit_price_cents,
                breakdown: json.breakdown,
              },
            }))
          } else {
            setCache((prev) => ({
              ...prev,
              [key]: { state: 'error', errorReason: json.reason },
            }))
          }
        })
        .catch((err) => {
          if (cancelled) return
          if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') {
            return
          }
          setCache((prev) => ({
            ...prev,
            [key]: { state: 'error', errorReason: 'network' },
          }))
        })
    }

    return () => {
      cancelled = true
      // Don't tear down inflight requests on unmount of items — the
      // cache is intentionally sticky across qty changes (a user that
      // scrubs 1→2→3→2 should hit cache on the way back). Aborting on
      // page unmount happens via cancelled flag above.
    }
    // `items` is intentionally excluded from deps: itemsDigest is a
    // stable string snapshot of the same data and is what we actually
    // diff against. Including the array would re-run the effect on
    // every render even when contents are identical.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsDigest, scopeClinic, scopeDoctor])

  return {
    get(productId: string, quantity: number, couponId?: string | null) {
      const key = buildKey({ productId, quantity, couponId }, scope)
      return cache[key]
    },
  }
}
