'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Download, Trash2, Shield, Info } from 'lucide-react'

export default function PrivacyPage() {
  const [deletionReason, setDeletionReason] = useState('')
  const [exportLoading, setExportLoading] = useState(false)
  const [deletionLoading, setDeletionLoading] = useState(false)
  const [deletionSent, setDeletionSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleExport() {
    setExportLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/lgpd/export')
      if (!res.ok) throw new Error('Falha ao exportar dados')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `clinipharma-meus-dados-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('Não foi possível exportar seus dados. Tente novamente.')
    } finally {
      setExportLoading(false)
    }
  }

  async function handleDeletionRequest() {
    setDeletionLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/lgpd/deletion-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: deletionReason }),
      })
      if (!res.ok) throw new Error('Falha ao enviar solicitação')
      setDeletionSent(true)
    } catch {
      setError('Não foi possível enviar a solicitação. Tente novamente.')
    } finally {
      setDeletionLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div className="flex items-center gap-3">
        <Shield className="text-primary h-6 w-6" />
        <div>
          <h1 className="text-2xl font-bold">Privacidade e Dados Pessoais</h1>
          <p className="text-muted-foreground text-sm">
            Seus direitos conforme a Lei Geral de Proteção de Dados (LGPD)
          </p>
        </div>
      </div>

      <div className="border-border bg-muted/50 flex gap-3 rounded-lg border p-4 text-sm">
        <Info className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
        <p className="text-muted-foreground">
          A Clinipharma trata seus dados pessoais com base na LGPD (Lei 13.709/2018). Você tem
          direito de acessar, corrigir e solicitar a exclusão dos seus dados. Dados financeiros são
          mantidos por 10 anos conforme obrigação legal (CTN Art. 195).
        </p>
      </div>

      {/* Export */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Exportar Meus Dados
          </CardTitle>
          <CardDescription>
            Baixe um arquivo JSON com todos os seus dados pessoais armazenados na plataforma (LGPD
            Art. 18, I — direito de acesso).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleExport} disabled={exportLoading} variant="outline">
            {exportLoading ? 'Gerando arquivo...' : 'Baixar meus dados (.json)'}
          </Button>
        </CardContent>
      </Card>

      {/* Deletion Request */}
      <Card>
        <CardHeader>
          <CardTitle className="text-destructive flex items-center gap-2">
            <Trash2 className="h-5 w-5" />
            Solicitar Exclusão dos Dados
          </CardTitle>
          <CardDescription>
            Solicite a remoção dos seus dados pessoais identificáveis (LGPD Art. 18, VI). Dados
            financeiros obrigatórios não são deletados. Sua solicitação será analisada em até 15
            dias úteis.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {deletionSent ? (
            <div className="border-border bg-muted/50 text-muted-foreground rounded-lg border p-4 text-sm">
              Sua solicitação foi enviada com sucesso. Nossa equipe entrará em contato em até 15
              dias úteis.
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">Motivo (opcional)</label>
                <Textarea
                  placeholder="Informe o motivo da solicitação..."
                  value={deletionReason}
                  onChange={(e) => setDeletionReason(e.target.value)}
                  rows={3}
                  maxLength={500}
                />
              </div>
              <Button
                onClick={handleDeletionRequest}
                disabled={deletionLoading}
                variant="destructive"
              >
                {deletionLoading ? 'Enviando...' : 'Solicitar exclusão dos meus dados'}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-lg border p-4 text-sm">
          {error}
        </div>
      )}

      <p className="text-muted-foreground text-xs">
        Para dúvidas sobre privacidade, entre em contato com nosso Encarregado de Dados (DPO) pelo
        email <strong>privacidade@clinipharma.com.br</strong>.
      </p>
    </div>
  )
}
