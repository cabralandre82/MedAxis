import { Clock, XCircle, Upload } from 'lucide-react'
import Link from 'next/link'
import type { RegistrationStatus } from '@/types'

interface RegistrationStatusBannerProps {
  status: RegistrationStatus
}

export function RegistrationStatusBanner({ status }: RegistrationStatusBannerProps) {
  if (status === 'APPROVED') return null

  const config = {
    PENDING: {
      icon: Clock,
      bg: 'bg-amber-50 border-amber-200',
      iconColor: 'text-amber-500',
      title: 'Cadastro em análise',
      body: 'Sua solicitação está sendo analisada pela equipe Clinipharma. Em até 2 dias úteis você receberá uma resposta por email.',
      cta: null,
    },
    PENDING_DOCS: {
      icon: Upload,
      bg: 'bg-orange-50 border-orange-200',
      iconColor: 'text-orange-500',
      title: 'Documentos pendentes',
      body: 'A equipe Clinipharma solicitou documentos adicionais para concluir a análise do seu cadastro. Verifique seu email e faça o upload abaixo.',
      cta: { label: 'Enviar documentos', href: '/profile' },
    },
    REJECTED: {
      icon: XCircle,
      bg: 'bg-red-50 border-red-200',
      iconColor: 'text-red-500',
      title: 'Cadastro não aprovado',
      body: 'Infelizmente sua solicitação não foi aprovada. Verifique seu email para mais detalhes. Em caso de dúvidas, entre em contato conosco.',
      cta: null,
    },
  } as const

  const c = config[status as keyof typeof config]
  if (!c) return null

  const Icon = c.icon

  return (
    <div className={`flex items-start gap-4 rounded-xl border p-4 ${c.bg}`}>
      <Icon className={`mt-0.5 h-5 w-5 flex-shrink-0 ${c.iconColor}`} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-gray-900">{c.title}</p>
        <p className="mt-0.5 text-sm text-gray-600">{c.body}</p>
        {c.cta && (
          <Link
            href={c.cta.href}
            className="mt-2 inline-block text-sm font-medium text-[hsl(196,91%,33%)] hover:underline"
          >
            {c.cta.label} →
          </Link>
        )}
      </div>
    </div>
  )
}
