'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Search, ExternalLink } from 'lucide-react'
import { formatDate } from '@/lib/utils'

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  PLATFORM_ADMIN: 'Admin',
  CLINIC_ADMIN: 'Clínica',
  DOCTOR: 'Médico',
  PHARMACY_ADMIN: 'Farmácia',
}

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'bg-red-100 text-red-800',
  PLATFORM_ADMIN: 'bg-blue-100 text-blue-800',
  CLINIC_ADMIN: 'bg-green-100 text-green-800',
  DOCTOR: 'bg-purple-100 text-purple-800',
  PHARMACY_ADMIN: 'bg-orange-100 text-orange-800',
}

type StatusFilter = 'all' | 'active' | 'inactive'

interface User {
  id: string
  full_name: string
  email: string
  phone: string | null
  created_at: string
  is_active: boolean
  user_roles: Array<{ role: string }>
}

export function UsersTable({ users }: { users: User[] }) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const totalActive = users.filter((u) => u.is_active).length
  const totalInactive = users.filter((u) => !u.is_active).length

  const filtered = users.filter((u) => {
    if (statusFilter === 'active' && !u.is_active) return false
    if (statusFilter === 'inactive' && u.is_active) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (
      u.full_name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.user_roles.some((r) => r.role.toLowerCase().includes(q))
    )
  })

  const tabClass = (tab: StatusFilter) =>
    `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
      statusFilter === tab
        ? 'bg-white shadow-sm text-gray-900'
        : 'text-gray-500 hover:text-gray-700'
    }`

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex flex-col gap-3 border-b border-gray-100 p-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Status tabs */}
        <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1">
          <button className={tabClass('all')} onClick={() => setStatusFilter('all')}>
            Todos
            <span className="ml-1.5 rounded-full bg-gray-200 px-1.5 py-0.5 text-xs font-semibold text-gray-600">
              {users.length}
            </span>
          </button>
          <button className={tabClass('active')} onClick={() => setStatusFilter('active')}>
            Ativos
            <span className="ml-1.5 rounded-full bg-green-100 px-1.5 py-0.5 text-xs font-semibold text-green-700">
              {totalActive}
            </span>
          </button>
          <button className={tabClass('inactive')} onClick={() => setStatusFilter('inactive')}>
            Desativados
            {totalInactive > 0 && (
              <span className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">
                {totalInactive}
              </span>
            )}
          </button>
        </div>

        {/* Search */}
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Buscar por nome, email ou papel..."
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
              <TableHead className="font-semibold">Nome</TableHead>
              <TableHead className="font-semibold">Email</TableHead>
              <TableHead className="font-semibold">Status</TableHead>
              <TableHead className="font-semibold">Papel</TableHead>
              <TableHead className="font-semibold">Cadastrado em</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-gray-400">
                  Nenhum usuário encontrado
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((user) => (
                <TableRow key={user.id} className="hover:bg-gray-50">
                  <TableCell className="font-medium">{user.full_name}</TableCell>
                  <TableCell className="text-gray-600">{user.email}</TableCell>
                  <TableCell>
                    {user.is_active ? (
                      <Badge className="bg-green-100 text-green-700">Ativo</Badge>
                    ) : (
                      <Badge className="bg-red-100 text-red-700">Desativado</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {user.user_roles.length > 0 ? (
                        user.user_roles.map((r) => (
                          <Badge
                            key={r.role}
                            className={ROLE_COLORS[r.role] ?? 'bg-gray-100 text-gray-700'}
                          >
                            {ROLE_LABELS[r.role] ?? r.role}
                          </Badge>
                        ))
                      ) : (
                        <Badge className="bg-gray-100 text-gray-500">Sem papel</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-gray-500">{formatDate(user.created_at)}</TableCell>
                  <TableCell>
                    <Link
                      href={`/users/${user.id}`}
                      className="hover:text-primary text-gray-400 transition-colors"
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
