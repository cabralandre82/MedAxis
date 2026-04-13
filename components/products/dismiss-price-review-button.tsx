'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle } from 'lucide-react'
import { dismissPriceReview } from '@/services/products'

interface Props {
  productId: string
}

export function DismissPriceReviewButton({ productId }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleDismiss() {
    setLoading(true)
    const result = await dismissPriceReview(productId)
    if (!result.error) {
      router.refresh()
    }
    setLoading(false)
  }

  return (
    <button
      onClick={handleDismiss}
      disabled={loading}
      className="inline-flex items-center gap-1.5 rounded-lg border border-orange-300 bg-white px-3 py-1.5 text-sm font-medium text-orange-700 transition-colors hover:bg-orange-50 disabled:opacity-50"
    >
      <CheckCircle className="h-4 w-4" />
      {loading ? 'Salvando…' : 'Confirmar sem alterar'}
    </button>
  )
}
