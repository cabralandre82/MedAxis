'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Search, ExternalLink } from 'lucide-react'

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800',
  PENDING: 'bg-yellow-100 text-yellow-800',
  INACTIVE: 'bg-gray-100 text-gray-600',
  SUSPENDED: 'bg-red-100 text-red-800',
  BLOCKED: 'bg-red-100 text-red-800',
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Ativo',
  PENDING: 'Pendente',
  INACTIVE: 'Inativo',
  SUSPENDED: 'Suspenso',
  BLOCKED: 'Bloqueado',
}

interface Column {
  key: string
  label: string
  type?: 'status' | 'text'
}

interface EntityTableProps {
  data: Record<string, unknown>[]
  columns: Column[]
  detailPath: string
}

export function EntityTable({ data, columns, detailPath }: EntityTableProps) {
  const [search, setSearch] = useState('')

  const filtered = data.filter((row) => {
    if (!search) return true
    return columns.some((col) => {
      const val = String(row[col.key] ?? '').toLowerCase()
      return val.includes(search.toLowerCase())
    })
  })

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 p-4">
        <div className="relative max-w-sm">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              {columns.map((col) => (
                <TableHead key={col.key} className="font-semibold">
                  {col.label}
                </TableHead>
              ))}
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + 1} className="py-10 text-center text-gray-400">
                  Nenhum registro encontrado
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => (
                <TableRow key={String(row.id)} className="hover:bg-gray-50">
                  {columns.map((col) => (
                    <TableCell key={col.key}>
                      {col.type === 'status' ? (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            STATUS_STYLES[String(row[col.key])] ?? 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {STATUS_LABELS[String(row[col.key])] ?? String(row[col.key])}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-700">{String(row[col.key] ?? '—')}</span>
                      )}
                    </TableCell>
                  ))}
                  <TableCell>
                    <Link
                      href={`${detailPath}/${String(row.id)}`}
                      className="text-gray-400 transition-colors hover:text-[hsl(196,91%,36%)]"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
