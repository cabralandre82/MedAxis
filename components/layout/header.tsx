'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/db/client'
import { getInitials } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LogOut, User, ChevronDown } from 'lucide-react'
import { NotificationBell } from '@/components/layout/notification-bell'
import { GlobalSearch } from '@/components/layout/global-search'
import type { ProfileWithRoles } from '@/types'

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  PLATFORM_ADMIN: 'Admin da Plataforma',
  CLINIC_ADMIN: 'Admin de Clínica',
  DOCTOR: 'Médico',
  PHARMACY_ADMIN: 'Admin de Farmácia',
}

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'bg-purple-100 text-purple-800',
  PLATFORM_ADMIN: 'bg-blue-100 text-blue-800',
  CLINIC_ADMIN: 'bg-green-100 text-green-800',
  DOCTOR: 'bg-teal-100 text-teal-800',
  PHARMACY_ADMIN: 'bg-orange-100 text-orange-800',
}

interface HeaderProps {
  user: ProfileWithRoles
  title?: string
}

export function Header({ user, title }: HeaderProps) {
  const router = useRouter()
  const supabase = createClient()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const primaryRole = user.roles[0]

  return (
    <header className="flex h-16 flex-shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6">
      <div>{title && <h1 className="text-lg font-semibold text-gray-900">{title}</h1>}</div>

      <div className="flex items-center gap-3">
        <GlobalSearch />
        <NotificationBell />
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors outline-none hover:bg-gray-50">
            <Avatar className="h-8 w-8">
              <AvatarImage src={user.avatar_url ?? undefined} />
              <AvatarFallback className="bg-[hsl(213,75%,24%)] text-xs font-semibold text-white">
                {getInitials(user.full_name)}
              </AvatarFallback>
            </Avatar>
            <div className="hidden text-left sm:block">
              <p className="text-sm leading-tight font-medium text-gray-900">{user.full_name}</p>
              {primaryRole && (
                <p className="text-xs text-gray-500">{ROLE_LABELS[primaryRole] ?? primaryRole}</p>
              )}
            </div>
            <ChevronDown className="h-4 w-4 text-gray-400" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div>
                <p className="font-medium">{user.full_name}</p>
                <p className="text-xs font-normal text-gray-500">{user.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {user.roles.map((role) => (
              <div key={role} className="px-2 py-1">
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_COLORS[role] ?? 'bg-gray-100 text-gray-800'}`}
                >
                  {ROLE_LABELS[role] ?? role}
                </span>
              </div>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push('/profile')}>
              <User className="h-4 w-4" />
              Meu perfil
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={handleSignOut}>
              <LogOut className="h-4 w-4" />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
