import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

interface LegalLayoutProps {
  title: string
  version: string
  effectiveDate: string
  updatedDate: string
  children: React.ReactNode
}

export function LegalLayout({
  title,
  version,
  effectiveDate,
  updatedDate,
  children,
}: LegalLayoutProps) {
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-6 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[hsl(213,75%,24%)]">
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="currentColor">
              <path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-7 3a1 1 0 0 1 1 1v3h3a1 1 0 0 1 0 2h-3v3a1 1 0 0 1-2 0v-3H8a1 1 0 0 1 0-2h3V7a1 1 0 0 1 1-1z" />
            </svg>
          </div>
          <span className="font-bold text-[hsl(213,75%,24%)]">Clinipharma</span>
          <span className="text-slate-300">|</span>
          <span className="text-sm text-slate-500">{title}</span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        {/* Document header */}
        <div className="mb-8 rounded-xl border bg-white p-6">
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
            <span>Versão {version}</span>
            <span>·</span>
            <span>Vigência: {effectiveDate}</span>
            <span>·</span>
            <span>Última atualização: {updatedDate}</span>
          </div>
        </div>

        {/* Content */}
        <div className="rounded-xl border bg-white px-8 py-8 text-sm leading-relaxed text-slate-700">
          {children}
        </div>

        {/* Footer nav — slate-600 (4.5:1+ on slate-50/white) for WCAG 2.1 AA */}
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-600">
          <Link href="/login" className="flex items-center gap-1 hover:text-slate-900">
            <ArrowLeft className="h-3 w-3" aria-hidden="true" />
            Voltar para o login
          </Link>
          <div className="flex gap-4">
            <Link href="/terms" className="hover:text-slate-900">
              Termos de Uso
            </Link>
            <Link href="/privacy" className="hover:text-slate-900">
              Política de Privacidade
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}

/* Helpers for consistent section styling */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-base font-bold text-slate-900">{title}</h2>
      <div className="space-y-2 text-slate-700">{children}</div>
    </section>
  )
}

export function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <h3 className="mb-1.5 font-semibold text-slate-800">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="text-slate-700">{children}</p>
}

export function UL({ items }: { items: string[] }) {
  return (
    <ul className="ml-4 space-y-1 text-slate-700">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

export function Highlight({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-3 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
      {children}
    </div>
  )
}

export function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      {children}
    </div>
  )
}
