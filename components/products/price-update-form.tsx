'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { priceUpdateSchema, type PriceUpdateFormData } from '@/lib/validators'
import { updateProductPrice } from '@/services/products'
import { formatCurrency } from '@/lib/utils'
import { TrendingUp } from 'lucide-react'

interface Props {
  productId: string
  currentPrice: number
  /** Custom button label (default: "Atualizar preço") */
  label?: string
  /** When true renders the trigger as a filled amber button */
  highlight?: boolean
}

export function PriceUpdateForm({ productId, currentPrice, label, highlight = false }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PriceUpdateFormData>({
    resolver: zodResolver(priceUpdateSchema),
  })

  async function onSubmit(data: PriceUpdateFormData) {
    setLoading(true)
    const result = await updateProductPrice(productId, data)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Preço atualizado com sucesso!')
      setOpen(false)
      reset()
      router.refresh()
    }
    setLoading(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant={highlight ? 'default' : 'outline'}
            size="sm"
            className={
              highlight
                ? 'border-0 bg-amber-500 whitespace-nowrap text-white hover:bg-amber-600'
                : undefined
            }
          />
        }
      >
        <TrendingUp className="mr-2 h-4 w-4" />
        {label ?? 'Atualizar preço'}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Atualizar Preço</DialogTitle>
        </DialogHeader>
        <div className="mb-4 rounded-md bg-gray-50 p-3">
          <p className="text-sm text-gray-500">Preço atual</p>
          <p className="text-primary text-lg font-semibold">{formatCurrency(currentPrice)}</p>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new_price">Novo Preço (R$) *</Label>
            <Input
              id="new_price"
              type="number"
              step="0.01"
              min="0"
              {...register('new_price', { valueAsNumber: true })}
            />
            {errors.new_price && <p className="text-sm text-red-500">{errors.new_price.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="reason">Motivo da Alteração *</Label>
            <Textarea
              id="reason"
              rows={3}
              placeholder="Descreva o motivo da alteração de preço..."
              {...register('reason')}
            />
            {errors.reason && <p className="text-sm text-red-500">{errors.reason.message}</p>}
          </div>
          <div className="flex gap-3">
            <Button type="submit" disabled={loading}>
              {loading ? 'Salvando...' : 'Confirmar alteração'}
            </Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
