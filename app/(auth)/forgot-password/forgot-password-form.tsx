'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import Link from 'next/link'
import { toast } from 'sonner'
import { forgotPasswordSchema } from '@/lib/validators'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, CheckCircle2 } from 'lucide-react'

type FormData = { email: string }

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(forgotPasswordSchema),
  })

  async function onSubmit(data: FormData) {
    setLoading(true)
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.email }),
      })

      if (!res.ok) {
        toast.error('Erro ao enviar email. Tente novamente.')
        return
      }

      setSent(true)
    } catch {
      toast.error('Ocorreu um erro. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="space-y-4 text-center">
        <div className="flex justify-center">
          <CheckCircle2 className="h-12 w-12 text-green-500" />
        </div>
        <p className="text-sm text-gray-600">
          Email de recuperação enviado. Verifique sua caixa de entrada.
        </p>
        <Link href="/login" className="text-sm text-[hsl(196,91%,36%)] hover:underline">
          Voltar ao login
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          placeholder="seu@email.com.br"
          {...register('email')}
          className={errors.email ? 'border-red-500' : ''}
        />
        {errors.email && <p className="text-xs text-red-500">{errors.email.message}</p>}
      </div>

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Enviando...
          </>
        ) : (
          'Enviar link de recuperação'
        )}
      </Button>

      <div className="text-center">
        <Link href="/login" className="text-sm text-gray-500 hover:text-gray-700">
          Voltar ao login
        </Link>
      </div>
    </form>
  )
}
