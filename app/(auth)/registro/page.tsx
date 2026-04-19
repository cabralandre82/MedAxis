import { Metadata } from 'next'
import Link from 'next/link'
import { RegistrationForm } from './registration-form'

export const metadata: Metadata = { title: 'Solicitar cadastro | Clinipharma' }

export default function RegistroPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-bold text-gray-900">Solicitar cadastro</h1>
        <p className="text-sm text-gray-500">
          Preencha o formulário abaixo. Nossa equipe analisará sua solicitação em até 2 dias úteis.
        </p>
      </div>

      <RegistrationForm />

      <p className="text-center text-sm text-gray-500">
        Já tem cadastro?{' '}
        <Link href="/login" className="font-medium text-[hsl(196,91%,33%)] hover:underline">
          Entrar
        </Link>
      </p>
    </div>
  )
}
