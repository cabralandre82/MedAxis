import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(value: number, currency = 'BRL'): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency,
  }).format(value)
}

/**
 * Date / time formatters — TIMEZONE-PINNED
 * --------------------------------------------------------------
 * The platform serves Brazilian users only. We pin the timezone to
 * `America/Sao_Paulo` on **both** server (Vercel runs UTC by default)
 * and client. If the timezone is not pinned, SSR renders 'às 14:30'
 * (UTC) and the client re-renders 'às 11:30' (BRT-3) → React reports
 * a hydration mismatch. This was Sentry issue
 * `2bd8f447e9274b5bbbd9676e00efeea4` on `/orders/[id]`.
 *
 * Using `Intl.DateTimeFormat` with `timeZone` is the only way to get
 * deterministic output — `date-fns/format` reads `Date.prototype.getHours`
 * which is environment-local. Keep the locale pt-BR here so months and
 * separators match what users expect.
 */
const BR_TIMEZONE = 'America/Sao_Paulo'

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: BR_TIMEZONE,
})

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: BR_TIMEZONE,
})

export function formatDate(date: string | Date): string {
  return dateFormatter.format(new Date(date))
}

export function formatDateTime(date: string | Date): string {
  // Intl renders "dd/MM/yyyy, HH:mm". We replace the comma with " às " to
  // match the legacy human-readable output the UI relied on.
  return dateTimeFormatter.format(new Date(date)).replace(', ', ' às ')
}

export function formatRelativeTime(date: string | Date): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: ptBR })
}

export function generateOrderCode(year: number, sequence: number): string {
  const seq = String(sequence).padStart(6, '0')
  return `CP-${year}-${seq}`
}

export function formatCNPJ(cnpj: string): string {
  const digits = cnpj.replace(/\D/g, '')
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
}

export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 11) {
    return digits.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3')
  }
  return digits.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3')
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str
  return str.slice(0, length) + '...'
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join('')
}

export function parsePage(raw: string | undefined, defaultPage = 1): number {
  const n = parseInt(raw ?? '', 10)
  return Number.isFinite(n) && n >= 1 ? n : defaultPage
}

export function paginationRange(page: number, pageSize: number): { from: number; to: number } {
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  return { from, to }
}

/** Returns a new Date advanced by `days` business days (skips Sat/Sun). */
export function addBusinessDays(date: Date, days: number): Date {
  const result = new Date(date)
  let added = 0
  while (added < days) {
    result.setDate(result.getDate() + 1)
    const dow = result.getDay()
    if (dow !== 0 && dow !== 6) added++
  }
  return result
}
