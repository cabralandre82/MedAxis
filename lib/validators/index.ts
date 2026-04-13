import { z } from 'zod'

const brazilianPhone = z
  .string()
  .min(1, 'Telefone é obrigatório')
  .regex(/^[\d\s\(\)\-\+]+$/, 'Telefone inválido')

const brazilianCNPJ = z
  .string()
  .min(1, 'CNPJ é obrigatório')
  .regex(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$|^\d{14}$/, 'CNPJ inválido')

// --- Auth ---

export const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres'),
})

export type LoginFormData = z.infer<typeof loginSchema>

export const forgotPasswordSchema = z.object({
  email: z.string().email('Email inválido'),
})

export const resetPasswordSchema = z
  .object({
    password: z.string().min(8, 'Senha deve ter pelo menos 8 caracteres'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Senhas não conferem',
    path: ['confirmPassword'],
  })

// --- Clinic ---

export const clinicSchema = z.object({
  corporate_name: z.string().min(2, 'Razão social é obrigatória'),
  trade_name: z.string().min(2, 'Nome fantasia é obrigatório'),
  cnpj: brazilianCNPJ,
  state_registration: z.string().optional(),
  email: z.string().email('Email inválido'),
  phone: brazilianPhone.optional(),
  address_line_1: z.string().min(5, 'Endereço é obrigatório'),
  address_line_2: z.string().optional(),
  city: z.string().min(2, 'Cidade é obrigatória'),
  state: z.string().length(2, 'UF deve ter 2 letras'),
  zip_code: z.string().regex(/^\d{5}-?\d{3}$/, 'CEP inválido'),
  notes: z.string().optional(),
})

export type ClinicFormData = z.infer<typeof clinicSchema>

// --- Doctor ---

export const doctorSchema = z.object({
  full_name: z.string().min(2, 'Nome completo é obrigatório'),
  crm: z.string().min(4, 'CRM é obrigatório'),
  crm_state: z.string().length(2, 'UF do CRM deve ter 2 letras'),
  specialty: z.string().optional(),
  email: z.string().email('Email inválido'),
  phone: brazilianPhone.optional(),
})

export type DoctorFormData = z.infer<typeof doctorSchema>

// --- Pharmacy ---

export const pharmacySchema = z.object({
  corporate_name: z.string().min(2, 'Razão social é obrigatória'),
  trade_name: z.string().min(2, 'Nome fantasia é obrigatório'),
  cnpj: brazilianCNPJ,
  email: z.string().email('Email inválido'),
  phone: brazilianPhone.optional(),
  address_line_1: z.string().min(5, 'Endereço é obrigatório'),
  address_line_2: z.string().optional(),
  city: z.string().min(2, 'Cidade é obrigatória'),
  state: z.string().length(2, 'UF deve ter 2 letras'),
  zip_code: z.string().regex(/^\d{5}-?\d{3}$/, 'CEP inválido'),
  responsible_person: z.string().min(2, 'Responsável é obrigatório'),
  bank_name: z.string().optional(),
  bank_branch: z.string().optional(),
  bank_account: z.string().optional(),
  pix_key: z.string().optional(),
  notes: z.string().optional(),
})

export type PharmacyFormData = z.infer<typeof pharmacySchema>

// --- Product ---

export const productSchema = z.object({
  category_id: z.string().uuid('Categoria inválida'),
  pharmacy_id: z.string().uuid('Farmácia inválida'),
  sku: z.string().min(2).optional(), // gerado automaticamente no backend se omitido
  name: z.string().min(2, 'Nome é obrigatório'),
  slug: z.string().min(2, 'Slug é obrigatório'),
  concentration: z.string().min(1, 'Concentração é obrigatória'),
  presentation: z.string().min(1, 'Apresentação é obrigatória'),
  short_description: z.string().min(10, 'Descrição curta muito curta'),
  long_description: z.string().optional(),
  characteristics_json: z.record(z.string(), z.unknown()).optional(),
  price_current: z.number().positive('Preço deve ser positivo'),
  pharmacy_cost: z.number().min(0, 'Repasse à farmácia deve ser ≥ 0'),
  estimated_deadline_days: z.number().int().positive('Prazo deve ser positivo'),
  active: z.boolean().optional(),
  status: z.enum(['active', 'unavailable', 'inactive']).optional(),
  featured: z.boolean().optional(),
  // Prescription control
  requires_prescription: z.boolean().optional(),
  prescription_type: z.enum(['SIMPLE', 'SPECIAL_CONTROL', 'ANTIMICROBIAL']).nullable().optional(),
  max_units_per_prescription: z.number().int().min(1).nullable().optional(),
})

export type ProductFormData = z.infer<typeof productSchema>

export const productInterestSchema = z.object({
  product_id: z.string().uuid(),
  name: z.string().min(2, 'Nome é obrigatório'),
  whatsapp: z.string().min(8, 'WhatsApp inválido'),
})

export const priceUpdateSchema = z.object({
  new_price: z.number().positive('Novo preço deve ser positivo'),
  reason: z.string().min(10, 'Informe o motivo da alteração (mínimo 10 caracteres)'),
})

export type PriceUpdateFormData = z.infer<typeof priceUpdateSchema>

// --- Order ---

export const orderItemSchema = z.object({
  product_id: z.string().uuid('Produto inválido'),
  quantity: z.number().int().positive('Quantidade deve ser positiva'),
})

export const orderSchema = z.object({
  clinic_id: z.string().uuid('Clínica inválida'),
  doctor_id: z.string().uuid('Médico inválido'),
  notes: z.string().optional(),
  items: z.array(orderItemSchema).min(1, 'Adicione ao menos um produto'),
})

export type OrderFormData = z.infer<typeof orderSchema>

// --- Payment confirmation ---

export const paymentConfirmationSchema = z.object({
  payment_method: z.string().min(1, 'Método de pagamento é obrigatório'),
  reference_code: z.string().optional(),
  notes: z.string().optional(),
})

export type PaymentConfirmationFormData = z.infer<typeof paymentConfirmationSchema>

// --- Transfer ---

export const transferSchema = z.object({
  transfer_reference: z.string().min(1, 'Referência da transferência é obrigatória'),
  notes: z.string().optional(),
})

export type TransferFormData = z.infer<typeof transferSchema>

// --- Commission ---

export const commissionSchema = z.object({
  commission_type: z.enum(['PERCENTAGE', 'FIXED']),
  commission_percentage: z.number().min(0).max(100).optional(),
  commission_fixed_amount: z.number().min(0).optional(),
})

export type CommissionFormData = z.infer<typeof commissionSchema>

// --- Sales Consultant ---

export const salesConsultantSchema = z.object({
  full_name: z.string().min(2, 'Nome completo é obrigatório'),
  email: z.string().email('Email inválido'),
  cnpj: brazilianCNPJ,
  phone: brazilianPhone.optional(),
  bank_name: z.string().optional(),
  bank_agency: z.string().optional(),
  bank_account: z.string().optional(),
  pix_key: z.string().optional(),
  notes: z.string().optional(),
})

export type SalesConsultantFormData = z.infer<typeof salesConsultantSchema>

export const consultantTransferSchema = z.object({
  transfer_reference: z.string().min(1, 'Referência da transferência é obrigatória'),
  notes: z.string().optional(),
})
