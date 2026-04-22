'use client'

import { useState, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Building2,
  Stethoscope,
  Upload,
  CheckCircle2,
  Loader2,
  X,
  FileText,
  AlertTriangle,
} from 'lucide-react'
import { CLINIC_REQUIRED_DOCS, DOCTOR_REQUIRED_DOCS } from '@/lib/registration-constants'

// ── Schemas ──────────────────────────────────────────────────────────────────

const baseSchema = z
  .object({
    full_name: z.string().min(2, 'Nome é obrigatório'),
    email: z.string().email('Email inválido'),
    password: z.string().min(8, 'Mínimo 8 caracteres'),
    confirm_password: z.string(),
    phone: z.string().optional(),
  })
  .refine((d) => d.password === d.confirm_password, {
    message: 'As senhas não coincidem',
    path: ['confirm_password'],
  })

const clinicSchema = baseSchema.extend({
  trade_name: z.string().min(2, 'Nome da clínica é obrigatório'),
  cnpj: z.string().min(14, 'CNPJ inválido'),
  address_line_1: z.string().min(5, 'Endereço é obrigatório'),
  address_line_2: z.string().optional(),
  city: z.string().min(2, 'Cidade é obrigatória'),
  state: z.string().length(2, 'UF deve ter 2 letras'),
})

const doctorSchema = baseSchema.extend({
  crm: z.string().min(4, 'CRM é obrigatório'),
  crm_state: z.string().length(2, 'UF do CRM deve ter 2 letras'),
  specialty: z.string().min(2, 'Especialidade é obrigatória'),
  cpf: z
    .string()
    .min(11, 'CPF inválido')
    .regex(/^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$|^\d{11}$/, 'CPF inválido'),
  clinic_cnpj: z.string().optional(),
  clinic_name: z.string().optional(),
})

type ClinicFormData = z.infer<typeof clinicSchema>
type DoctorFormData = z.infer<typeof doctorSchema>

// ── Helpers ───────────────────────────────────────────────────────────────────

interface UploadedFile {
  docType: string
  label: string
  file: File
  preview: string
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null
  return <p className="text-xs text-red-500">{msg}</p>
}

// ── Main component ────────────────────────────────────────────────────────────

type Step = 'type' | 'form' | 'docs' | 'done'
type RegType = 'CLINIC' | 'DOCTOR'

export function RegistrationForm() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('type')
  const [regType, setRegType] = useState<RegType>('CLINIC')
  const [loading, setLoading] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [uploads, setUploads] = useState<UploadedFile[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [activeDocType, setActiveDocType] = useState<{ type: string; label: string } | null>(null)
  const [draftId, setDraftId] = useState<string | null>(null)

  const requiredDocs = regType === 'CLINIC' ? CLINIC_REQUIRED_DOCS : DOCTOR_REQUIRED_DOCS
  const missingDocs = requiredDocs.filter((d) => !uploads.find((u) => u.docType === d.type))
  const hasDocs = missingDocs.length === 0

  const clinicForm = useForm<ClinicFormData>({ resolver: zodResolver(clinicSchema) })
  const doctorForm = useForm<DoctorFormData>({ resolver: zodResolver(doctorSchema) })
  const activeForm = regType === 'CLINIC' ? clinicForm : doctorForm

  // ── Step 1: choose type ──
  if (step === 'type') {
    return (
      <div className="space-y-4">
        <p className="text-center text-sm font-medium text-gray-700">Qual é o seu perfil?</p>
        <div className="grid grid-cols-2 gap-4">
          {[
            {
              type: 'CLINIC' as RegType,
              icon: Building2,
              title: 'Clínica / Consultório',
              desc: 'Pessoa jurídica com CNPJ',
            },
            {
              type: 'DOCTOR' as RegType,
              icon: Stethoscope,
              title: 'Médico',
              desc: 'Registro individual com CRM',
            },
          ].map(({ type, icon: Icon, title, desc }) => (
            <button
              key={type}
              onClick={() => {
                setRegType(type)
                setStep('form')
              }}
              className="flex flex-col items-center gap-3 rounded-xl border-2 border-gray-200 bg-white p-6 text-center transition-all hover:border-[hsl(213,75%,24%)] hover:bg-blue-50"
            >
              <Icon className="h-10 w-10 text-[hsl(213,75%,24%)]" />
              <div>
                <p className="font-semibold text-gray-900">{title}</p>
                <p className="text-xs text-gray-500">{desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ── Step: done ──
  if (step === 'done') {
    return (
      <div className="flex flex-col items-center gap-4 py-6 text-center">
        <CheckCircle2 className="h-14 w-14 text-green-500" />
        <h2 className="text-lg font-semibold text-gray-900">Solicitação enviada!</h2>
        <p className="max-w-sm text-sm text-gray-600">
          Criamos seu acesso. Você já pode entrar na plataforma — seu cadastro ficará em{' '}
          <strong>análise</strong> até a aprovação da nossa equipe.
        </p>
        {!hasDocs && (
          <p className="max-w-sm rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Sua solicitação foi recebida <strong>sem documentos</strong>. Nossa equipe entrará em
            contato para orientá-lo sobre o envio.
          </p>
        )}
        <Button onClick={() => router.push('/login')} className="mt-2">
          Ir para o login
        </Button>
      </div>
    )
  }

  // ── Step 2 → step 3: save draft silently ──

  async function handleFormNext(_data: ClinicFormData | DoctorFormData) {
    setSavingDraft(true)
    try {
      const formData = activeForm.getValues()
      const res = await fetch('/api/registration/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: regType, form_data: formData }),
      })
      if (res.ok) {
        const json = await res.json()
        setDraftId(json.draft_id ?? null)
      }
      // Draft save failure is silent — doesn't block the user
    } catch {
      // noop
    } finally {
      setSavingDraft(false)
      setStep('docs')
    }
  }

  // ── Step 3: docs + submit ──
  function handleFileSelect(docType: string, label: string) {
    setActiveDocType({ type: docType, label })
    fileInputRef.current?.click()
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !activeDocType) return
    setUploads((prev) => {
      const filtered = prev.filter((u) => u.docType !== activeDocType.type)
      return [
        ...filtered,
        { docType: activeDocType.type, label: activeDocType.label, file, preview: file.name },
      ]
    })
    e.target.value = ''
  }

  function removeUpload(docType: string) {
    setUploads((prev) => prev.filter((u) => u.docType !== docType))
  }

  async function handleSubmit() {
    setLoading(true)
    try {
      const formData = activeForm.getValues()
      const fd = new FormData()
      fd.append('type', regType)
      fd.append('form_data', JSON.stringify(formData))
      if (draftId) fd.append('draft_id', draftId)

      uploads.forEach((u) => {
        fd.append(`doc_${u.docType}`, u.file)
        fd.append(`doc_${u.docType}_label`, u.label)
      })

      const res = await fetch('/api/registration/submit', { method: 'POST', body: fd })
      const json = await res.json()

      if (!res.ok) {
        toast.error(json.error ?? 'Erro ao enviar solicitação')
        return
      }

      setStep('done')
    } catch {
      toast.error('Erro ao enviar. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  // ── Form fields ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeFormAny = activeForm as any
  const register = activeFormAny.register
  const rhfSubmit = activeFormAny.handleSubmit
  const errors = activeFormAny.formState.errors
  const e = errors as Record<string, { message?: string }>

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <button
          onClick={() => setStep(step === 'docs' ? 'form' : 'type')}
          className="hover:text-gray-800"
        >
          ← Voltar
        </button>
        <span className="ml-auto">{step === 'form' ? '1/2 — Dados' : '2/2 — Documentos'}</span>
      </div>

      {step === 'form' && (
        <form onSubmit={rhfSubmit(handleFormNext as never)} className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-4 py-2.5">
            {regType === 'CLINIC' ? (
              <Building2 className="h-4 w-4 text-blue-700" />
            ) : (
              <Stethoscope className="h-4 w-4 text-blue-700" />
            )}
            <span className="text-sm font-medium text-blue-800">
              {regType === 'CLINIC' ? 'Clínica / Consultório' : 'Médico'}
            </span>
          </div>

          {/* Common fields */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Nome completo do responsável *</Label>
              <Input placeholder="João da Silva" {...register('full_name')} />
              <FieldError msg={e.full_name?.message} />
            </div>

            {regType === 'CLINIC' && (
              <>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Nome da clínica / consultório *</Label>
                  <Input placeholder="Clínica Exemplo" {...register('trade_name' as never)} />
                  <FieldError msg={e.trade_name?.message} />
                </div>
                <div className="space-y-1.5">
                  <Label>CNPJ *</Label>
                  <Input placeholder="00.000.000/0000-00" {...register('cnpj' as never)} />
                  <FieldError msg={e.cnpj?.message} />
                </div>
              </>
            )}

            {regType === 'DOCTOR' && (
              <>
                <div className="space-y-1.5">
                  <Label>CRM *</Label>
                  <Input placeholder="123456" {...register('crm' as never)} />
                  <FieldError msg={e.crm?.message} />
                </div>
                <div className="space-y-1.5">
                  <Label>UF do CRM *</Label>
                  <Input placeholder="SP" maxLength={2} {...register('crm_state' as never)} />
                  <FieldError msg={e.crm_state?.message} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Especialidade *</Label>
                  <Input placeholder="Dermatologia" {...register('specialty' as never)} />
                  <FieldError msg={e.specialty?.message} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>CPF *</Label>
                  <Input placeholder="000.000.000-00" {...register('cpf' as never)} />
                  <FieldError msg={(e as Record<string, { message?: string }>).cpf?.message} />
                  <p className="text-xs text-gray-400">
                    Necessário para emissão de nota fiscal nas compras realizadas como pessoa
                    física.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>
                    CNPJ da clínica onde atua <span className="text-gray-400">(opcional)</span>
                  </Label>
                  <Input placeholder="00.000.000/0000-00" {...register('clinic_cnpj' as never)} />
                </div>
                <div className="space-y-1.5">
                  <Label>
                    Nome da clínica <span className="text-gray-400">(opcional)</span>
                  </Label>
                  <Input placeholder="Clínica Exemplo" {...register('clinic_name' as never)} />
                </div>
              </>
            )}

            <div className="space-y-1.5">
              <Label>Email de acesso *</Label>
              <Input type="email" placeholder="voce@exemplo.com" {...register('email')} />
              <FieldError msg={e.email?.message} />
            </div>
            <div className="space-y-1.5">
              <Label>Telefone</Label>
              <Input placeholder="(00) 00000-0000" {...register('phone')} />
            </div>

            {regType === 'CLINIC' && (
              <>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Endereço *</Label>
                  <Input placeholder="Rua Exemplo, 123" {...register('address_line_1' as never)} />
                  <FieldError msg={e.address_line_1?.message} />
                </div>
                <div className="space-y-1.5">
                  <Label>Complemento</Label>
                  <Input placeholder="Sala 10" {...register('address_line_2' as never)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Cidade *</Label>
                  <Input placeholder="São Paulo" {...register('city' as never)} />
                  <FieldError msg={e.city?.message} />
                </div>
                <div className="space-y-1.5">
                  <Label>UF *</Label>
                  <Input placeholder="SP" maxLength={2} {...register('state' as never)} />
                  <FieldError msg={e.state?.message} />
                </div>
              </>
            )}

            <div className="space-y-1.5">
              <Label>Senha *</Label>
              <Input type="password" placeholder="Mínimo 8 caracteres" {...register('password')} />
              <FieldError msg={e.password?.message} />
            </div>
            <div className="space-y-1.5">
              <Label>Confirmar senha *</Label>
              <Input
                type="password"
                placeholder="Repita a senha"
                {...register('confirm_password')}
              />
              <FieldError msg={e.confirm_password?.message} />
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={savingDraft}>
            {savingDraft ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Preparando...
              </>
            ) : (
              'Continuar para documentos →'
            )}
          </Button>
        </form>
      )}

      {step === 'docs' && (
        <div className="space-y-5">
          {/* Warning when no docs uploaded */}
          {!hasDocs && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="text-sm font-medium text-amber-800">Documentos obrigatórios</p>
                <p className="mt-0.5 text-xs text-amber-700">
                  Você pode enviar sua solicitação sem documentos — mas o processo de aprovação só
                  inicia após o envio. Nossa equipe entrará em contato.
                </p>
              </div>
            </div>
          )}

          <p className="text-sm text-gray-600">
            Envie os documentos abaixo. Arquivos aceitos: PDF, JPG, PNG (máx. 10 MB cada).
          </p>

          <div className="space-y-3">
            <p className="text-xs font-semibold tracking-wider text-gray-500 uppercase">
              Documentos obrigatórios
            </p>
            {requiredDocs.map((doc) => {
              const uploaded = uploads.find((u) => u.docType === doc.type)
              return (
                <div
                  key={doc.type}
                  className={`flex items-center justify-between rounded-lg border p-3 ${
                    uploaded ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <FileText
                      className={`h-4 w-4 ${uploaded ? 'text-green-600' : 'text-gray-400'}`}
                    />
                    <span className="text-sm text-gray-700">{doc.label}</span>
                    {uploaded && (
                      <Badge className="bg-green-100 text-xs text-green-700">
                        {uploaded.preview}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleFileSelect(doc.type, doc.label)}
                    >
                      <Upload className="mr-1 h-3.5 w-3.5" />
                      {uploaded ? 'Trocar' : 'Enviar'}
                    </Button>
                    {uploaded && (
                      <button
                        type="button"
                        onClick={() => removeUpload(doc.type)}
                        aria-label={`Remover documento ${doc.label}`}
                        title="Remover"
                      >
                        <X
                          className="h-4 w-4 text-gray-400 hover:text-red-500"
                          aria-hidden="true"
                        />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={handleFileChange}
          />

          <Button onClick={handleSubmit} disabled={loading} className="w-full">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Enviando...
              </>
            ) : hasDocs ? (
              'Enviar solicitação'
            ) : (
              'Enviar sem documentos por enquanto'
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
