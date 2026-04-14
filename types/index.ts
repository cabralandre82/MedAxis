export type EntityType = 'PHARMACY' | 'DISTRIBUTOR'
export type BuyerType = 'CLINIC' | 'DOCTOR'

export type UserRole =
  | 'SUPER_ADMIN'
  | 'PLATFORM_ADMIN'
  | 'CLINIC_ADMIN'
  | 'DOCTOR'
  | 'PHARMACY_ADMIN'
  | 'SALES_CONSULTANT'

export type EntityStatus = 'PENDING' | 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'BLOCKED'

export type OrderStatus =
  | 'DRAFT'
  | 'AWAITING_DOCUMENTS'
  | 'READY_FOR_REVIEW'
  | 'AWAITING_PAYMENT'
  | 'PAYMENT_UNDER_REVIEW'
  | 'PAYMENT_CONFIRMED'
  | 'COMMISSION_CALCULATED'
  | 'TRANSFER_PENDING'
  | 'TRANSFER_COMPLETED'
  | 'RELEASED_FOR_EXECUTION'
  | 'RECEIVED_BY_PHARMACY'
  | 'IN_EXECUTION'
  | 'READY'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELED'
  | 'WITH_ISSUE'

export type PaymentStatus = 'PENDING' | 'UNDER_REVIEW' | 'CONFIRMED' | 'FAILED' | 'REFUNDED'

export type TransferStatus = 'NOT_READY' | 'PENDING' | 'COMPLETED' | 'FAILED'

export type CommissionType = 'PERCENTAGE' | 'FIXED' | 'HYBRID'

export type MembershipRole = 'ADMIN' | 'STAFF'

export interface Profile {
  id: string
  full_name: string
  email: string
  phone?: string | null
  avatar_url?: string | null
  is_active: boolean
  registration_status: RegistrationStatus
  notification_preferences: Record<string, boolean>
  created_at: string
  updated_at: string
}

export interface UserRoleRecord {
  id: string
  user_id: string
  role: UserRole
  created_at: string
}

export interface ProfileWithRoles extends Profile {
  roles: UserRole[]
}

export interface SalesConsultant {
  id: string
  user_id?: string | null
  full_name: string
  email: string
  cnpj: string
  phone?: string | null
  bank_name?: string | null
  bank_agency?: string | null
  bank_account?: string | null
  pix_key?: string | null
  status: EntityStatus
  notes?: string | null
  created_at: string
  updated_at: string
}

export type ConsultantCommissionStatus = 'PENDING' | 'TRANSFER_PENDING' | 'PAID'
export type ConsultantTransferStatus = 'PENDING' | 'COMPLETED'

export interface ConsultantCommission {
  id: string
  order_id: string
  consultant_id: string
  order_total: number
  commission_rate: number
  commission_amount: number
  status: ConsultantCommissionStatus
  transfer_id?: string | null
  created_at: string
  updated_at: string
}

export interface ConsultantTransfer {
  id: string
  consultant_id: string
  gross_amount: number
  transfer_reference?: string | null
  transfer_date?: string | null
  notes?: string | null
  status: ConsultantTransferStatus
  confirmed_by?: string | null
  confirmed_at?: string | null
  created_at: string
  updated_at: string
}

export interface Clinic {
  id: string
  corporate_name: string
  trade_name: string
  cnpj: string
  state_registration?: string | null
  email: string
  phone?: string | null
  address_line_1: string
  address_line_2?: string | null
  city: string
  state: string
  zip_code: string
  consultant_id?: string | null
  status: EntityStatus
  notes?: string | null
  created_at: string
  updated_at: string
}

export interface ClinicMember {
  id: string
  clinic_id: string
  user_id: string
  membership_role: MembershipRole
  created_at: string
}

export interface Doctor {
  id: string
  full_name: string
  crm: string
  crm_state: string
  specialty?: string | null
  email: string
  phone?: string | null
  cpf?: string | null
  user_id?: string | null
  crm_validated_at?: string | null
  status: EntityStatus
  created_at: string
  updated_at: string
}

export interface DoctorAddress {
  id: string
  doctor_id: string
  label: string
  address_line_1: string
  address_line_2?: string | null
  city: string
  state: string
  zip_code: string
  is_default: boolean
  created_at: string
  updated_at: string
}

export interface DoctorClinicLink {
  id: string
  doctor_id: string
  clinic_id: string
  is_primary: boolean
  created_at: string
}

export interface Pharmacy {
  id: string
  corporate_name: string
  trade_name: string
  cnpj: string
  email: string
  phone?: string | null
  address_line_1: string
  address_line_2?: string | null
  city: string
  state: string
  zip_code: string
  responsible_person: string
  bank_name?: string | null
  bank_branch?: string | null
  bank_account?: string | null
  pix_key?: string | null
  status: EntityStatus
  entity_type: EntityType
  notes?: string | null
  created_at: string
  updated_at: string
}

export interface ProductCategory {
  id: string
  name: string
  slug: string
  description?: string | null
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface Product {
  id: string
  category_id: string
  pharmacy_id: string
  sku: string
  name: string
  slug: string
  concentration: string
  presentation: string
  short_description: string
  long_description?: string | null
  characteristics_json: Record<string, unknown>
  price_current: number
  pharmacy_cost: number
  currency: string
  estimated_deadline_days: number
  active: boolean
  status: 'active' | 'unavailable' | 'inactive'
  featured: boolean
  is_manipulated: boolean
  created_at: string
  updated_at: string
  requires_prescription: boolean
  prescription_type: 'SIMPLE' | 'SPECIAL_CONTROL' | 'ANTIMICROBIAL' | null
  max_units_per_prescription: number | null
}

export interface ProductWithRelations extends Product {
  category: ProductCategory
  pharmacy: Pharmacy
  images: ProductImage[]
}

export interface ProductImage {
  id: string
  product_id: string
  storage_path: string
  public_url?: string | null
  alt_text?: string | null
  sort_order: number
  created_at: string
}

export type RegistrationStatus = 'PENDING' | 'PENDING_DOCS' | 'APPROVED' | 'REJECTED'
export type RegistrationType = 'CLINIC' | 'DOCTOR'

export interface RequestedDoc {
  type: string
  label: string
  custom_text?: string
}

export interface RegistrationRequest {
  id: string
  type: RegistrationType
  status: RegistrationStatus
  form_data: Record<string, unknown>
  user_id: string | null
  entity_id: string | null
  admin_notes: string | null
  requested_docs: RequestedDoc[] | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

export interface RegistrationDocument {
  id: string
  request_id: string
  document_type: string
  label: string
  filename: string
  storage_path: string
  public_url: string | null
  uploaded_at: string
}

export interface ProductInterest {
  id: string
  product_id: string
  user_id: string
  name: string
  whatsapp: string
  created_at: string
  product?: { name: string; sku: string }
  user?: { email: string }
}

export interface ProductPriceHistory {
  id: string
  product_id: string
  old_price: number
  new_price: number
  changed_by_user_id: string | null
  reason: string | null
  created_at: string
}

export interface OrderItem {
  id: string
  order_id: string
  product_id: string
  quantity: number
  unit_price: number
  total_price: number
  pharmacy_cost_per_unit?: number | null
  platform_commission_per_unit?: number | null
  created_at: string
  product?: Product
}

export interface Order {
  id: string
  code: string
  buyer_type: BuyerType
  clinic_id: string | null
  doctor_id: string | null
  pharmacy_id: string
  delivery_address_id?: string | null
  total_price: number
  payment_status: PaymentStatus
  transfer_status: TransferStatus
  order_status: OrderStatus
  notes?: string | null
  created_by_user_id: string
  created_at: string
  updated_at: string
  order_items?: OrderItem[]
}

export interface OrderWithRelations extends Order {
  clinic: Clinic | null
  doctor: Doctor | null
  pharmacy: Pharmacy
  product: Product
  documents: OrderDocument[]
  status_history: OrderStatusHistory[]
  payment?: Payment | null
  commission?: Commission | null
  transfer?: Transfer | null
}

export interface OrderDocument {
  id: string
  order_id: string
  document_type: string
  storage_path: string
  original_filename: string
  mime_type: string
  file_size: number
  uploaded_by_user_id: string
  created_at: string
}

export interface OrderStatusHistory {
  id: string
  order_id: string
  old_status?: OrderStatus | null
  new_status: OrderStatus
  changed_by_user_id: string
  reason?: string | null
  created_at: string
  changed_by?: Profile
}

export interface OrderOperationalUpdate {
  id: string
  order_id: string
  pharmacy_id: string
  status: string
  description: string
  created_by_user_id: string
  created_at: string
}

export interface Payment {
  id: string
  order_id: string
  payer_profile_id?: string | null
  gross_amount: number
  status: PaymentStatus
  payment_method: string
  reference_code?: string | null
  proof_storage_path?: string | null
  confirmed_by_user_id?: string | null
  confirmed_at?: string | null
  notes?: string | null
  created_at: string
  updated_at: string
}

export interface Commission {
  id: string
  order_id: string
  commission_type: CommissionType
  commission_percentage?: number | null
  commission_fixed_amount?: number | null
  commission_total_amount: number
  calculated_by_user_id?: string | null
  created_at: string
}

export interface Transfer {
  id: string
  order_id: string
  pharmacy_id: string
  gross_amount: number
  commission_amount: number
  net_amount: number
  status: TransferStatus
  transfer_reference?: string | null
  proof_storage_path?: string | null
  processed_by_user_id?: string | null
  processed_at?: string | null
  notes?: string | null
  created_at: string
  updated_at: string
}

export interface AuditLog {
  id: string
  actor_user_id?: string | null
  actor_role?: string | null
  entity_type: string
  entity_id: string
  action: string
  old_values_json?: Record<string, unknown> | null
  new_values_json?: Record<string, unknown> | null
  metadata_json?: Record<string, unknown> | null
  ip?: string | null
  user_agent?: string | null
  created_at: string
}

export interface AppSetting {
  id: string
  key: string
  value_json: unknown
  description?: string | null
  updated_by_user_id?: string | null
  updated_at: string
}
