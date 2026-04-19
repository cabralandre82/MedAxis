import { Metadata } from 'next'
import { StatusBoard } from '@/components/status/status-board'

export const metadata: Metadata = {
  title: 'Status de Serviços — Clinipharma',
  description:
    'Estado em tempo real dos serviços da plataforma Clinipharma: aplicação, banco de dados, autenticação, pagamentos, IA, comunicação.',
  alternates: { canonical: '/status' },
}

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function StatusPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[hsl(213,75%,24%)]">
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="currentColor">
              <path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-7 3a1 1 0 0 1 1 1v3h3a1 1 0 0 1 0 2h-3v3a1 1 0 0 1-2 0v-3H8a1 1 0 0 1 0-2h3V7a1 1 0 0 1 1-1z" />
            </svg>
          </div>
          <span className="font-bold text-[hsl(213,75%,24%)]">Clinipharma</span>
          <span className="text-slate-300">|</span>
          <span className="text-sm text-slate-500">Status</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">
        <StatusBoard />
      </main>
    </div>
  )
}
