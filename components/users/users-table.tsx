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

interface User {
  id: string
  full_name: string
  email: string
  phone: string | null
  created_at: string
  user_roles: Array<{ role: string }>
}

export function UsersTable({ users }: { users: User[] }) {
  const [search, setSearch] = useState('')

  const filtered = users.filter((u) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      u.full_name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.user_roles.some((r) => r.role.toLowerCase().includes(q))
    )
  })

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 p-4">
        <div className="relative max-w-sm">
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
              <TableHead className="font-semibold">Papel</TableHead>
              <TableHead className="font-semibold">Cadastrado em</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-gray-400">
                  Nenhum usuário encontrado
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((user) => (
                <TableRow key={user.id} className="hover:bg-gray-50">
                  <TableCell className="font-medium">{user.full_name}</TableCell>
                  <TableCell className="text-gray-600">{user.email}</TableCell>
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
