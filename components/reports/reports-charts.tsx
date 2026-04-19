'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts'
import { formatCurrency } from '@/lib/utils'

// ── Colors ────────────────────────────────────────────────────────────────────
const BRAND = 'hsl(213,75%,24%)'
const BRAND2 = 'hsl(196,91%,33%)'
const STATUS_COLORS = [
  '#1e3a5f',
  '#0891b2',
  '#059669',
  '#d97706',
  '#7c3aed',
  '#db2777',
  '#dc2626',
  '#64748b',
]

// ── Types ─────────────────────────────────────────────────────────────────────
export interface MonthlyData {
  month: string // "Jan/26"
  pedidos: number
  receita: number
}

export interface StatusData {
  name: string
  value: number
}

export interface PharmacyRevenueData {
  name: string
  receita: number
}

export interface ConsultantCommData {
  name: string
  comissao: number
}

// ── Custom tooltip ─────────────────────────────────────────────────────────────
function CurrencyTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color?: string }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-gray-700">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color ?? BRAND }}>
          {p.name}:{' '}
          {typeof p.value === 'number' && p.value > 100 ? formatCurrency(p.value) : p.value}
        </p>
      ))}
    </div>
  )
}

// ── Orders per month bar chart ────────────────────────────────────────────────
export function OrdersBarChart({ data }: { data: MonthlyData[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
        <Tooltip content={<CurrencyTooltip />} />
        <Bar dataKey="pedidos" name="Pedidos" fill={BRAND} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Revenue per month bar chart ───────────────────────────────────────────────
export function RevenueBarChart({ data }: { data: MonthlyData[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: 10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} />
        <YAxis
          tickFormatter={(v: number) => `R$${(v / 1000).toFixed(0)}k`}
          tick={{ fontSize: 11, fill: '#94a3b8' }}
        />
        <Tooltip content={<CurrencyTooltip />} />
        <Bar dataKey="receita" name="Receita (R$)" fill={BRAND2} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Status donut chart ────────────────────────────────────────────────────────
export function StatusPieChart({ data }: { data: StatusData[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={55}
          outerRadius={80}
          paddingAngle={2}
          dataKey="value"
        >
          {data.map((_, i) => (
            <Cell key={i} fill={STATUS_COLORS[i % STATUS_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(v) => [`${v} pedidos`, '']} />
        <Legend
          iconSize={8}
          iconType="circle"
          formatter={(value) => <span style={{ fontSize: 11 }}>{value}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}

// ── Pharmacy revenue bar chart ────────────────────────────────────────────────
export function PharmacyRevenueChart({ data }: { data: PharmacyRevenueData[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
        <XAxis
          type="number"
          tickFormatter={(v: number) => `R$${(v / 1000).toFixed(0)}k`}
          tick={{ fontSize: 10, fill: '#94a3b8' }}
        />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} width={90} />
        <Tooltip content={<CurrencyTooltip />} />
        <Bar dataKey="receita" name="Faturamento (R$)" fill={BRAND} radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Consultant commissions bar chart ──────────────────────────────────────────
export function ConsultantCommChart({ data }: { data: ConsultantCommData[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
        <XAxis
          type="number"
          tickFormatter={(v: number) => `R$${(v / 1000).toFixed(0)}k`}
          tick={{ fontSize: 10, fill: '#94a3b8' }}
        />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} width={90} />
        <Tooltip content={<CurrencyTooltip />} />
        <Bar dataKey="comissao" name="Comissão (R$)" fill="#7c3aed" radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
