import { ShieldX } from 'lucide-react'
import { ButtonLink } from '@/components/ui/button-link'

export default function UnauthorizedPage() {
  return (
    <div className="space-y-4 text-center">
      <div className="flex justify-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
          <ShieldX className="h-8 w-8 text-red-500" />
        </div>
      </div>
      <h1 className="text-xl font-semibold text-gray-900">Acesso negado</h1>
      <p className="text-sm text-gray-500">
        Você não tem permissão para acessar esta página. Entre em contato com o administrador.
      </p>
      <ButtonLink href="/dashboard" className="w-full">
        Voltar ao início
      </ButtonLink>
    </div>
  )
}
