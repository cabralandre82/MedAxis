'use client'

import { useState } from 'react'
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
import { resetUserPassword } from '@/services/users'
import { KeyRound } from 'lucide-react'

interface Props {
  userId: string
  userName: string
}

export function ResetPasswordDialog({ userId, userName }: Props) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) {
      toast.error('Senha deve ter pelo menos 8 caracteres')
      return
    }
    setLoading(true)
    const result = await resetUserPassword(userId, password)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Senha redefinida com sucesso!')
      setOpen(false)
      setPassword('')
    }
    setLoading(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <KeyRound className="mr-2 h-4 w-4" />
        Redefinir senha
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Redefinir senha — {userName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-password">Nova senha *</Label>
            <Input
              id="new-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
            />
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs text-amber-700">
              O usuário será capaz de fazer login imediatamente com essa nova senha. Comunique a
              nova senha por canal seguro.
            </p>
          </div>
          <div className="flex gap-3">
            <Button type="submit" disabled={loading}>
              {loading ? 'Salvando...' : 'Confirmar nova senha'}
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
