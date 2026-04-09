'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { UserRole } from '@/types'
import {
  LayoutDashboard,
  ShoppingBag,
  ClipboardList,
  Building2,
  UserCheck,
  Pill,
  Package,
  CreditCard,
  ArrowLeftRight,
  BarChart3,
  Settings,
  ScrollText,
  Users,
  Handshake,
  Wallet,
} from 'lucide-react'

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  roles: UserRole[]
}

const NAV_ITEMS: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    roles: [
      'SUPER_ADMIN',
      'PLATFORM_ADMIN',
      'CLINIC_ADMIN',
      'DOCTOR',
      'PHARMACY_ADMIN',
      'SALES_CONSULTANT',
    ],
  },
  {
    href: '/catalog',
    label: 'Catálogo',
    icon: ShoppingBag,
    roles: ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'CLINIC_ADMIN', 'DOCTOR', 'PHARMACY_ADMIN'],
  },
  {
    href: '/orders',
    label: 'Pedidos',
    icon: ClipboardList,
    roles: ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'CLINIC_ADMIN', 'DOCTOR', 'PHARMACY_ADMIN'],
  },
  {
    href: '/clinics',
    label: 'Clínicas',
    icon: Building2,
    roles: ['SUPER_ADMIN', 'PLATFORM_ADMIN'],
  },
  {
    href: '/doctors',
    label: 'Médicos',
    icon: UserCheck,
    roles: ['SUPER_ADMIN', 'PLATFORM_ADMIN'],
  },
  {
    href: '/pharmacies',
    label: 'Farmácias',
    icon: Pill,
    roles: ['SUPER_ADMIN', 'PLATFORM_ADMIN'],
  },
  {
    href: '/products',
    label: 'Produtos',
    icon: Package,
    roles: ['SUPER_ADMIN', 'PLATFORM_ADMIN'],
  },
  {
    href: '/payments',
    label: 'Pagamentos',
    icon: CreditCard,
    roles: ['SUPER_ADMIN', 'PLATFORM_ADMIN'],
  },
  {
    href: '/transfers',
    label: 'Repasses Farmácias',
    icon: ArrowLeftRight,
    roles: ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'PHARMACY_ADMIN'],
  },
  {
    href: '/consultants',
    label: 'Consultores',
    icon: Handshake,
    roles: ['SUPER_ADMIN', 'PLATFORM_ADMIN'],
  },
  {
    href: '/consultant-transfers',
    label: 'Repasses Consultores',
    icon: Wallet,
    roles: ['SUPER_ADMIN', 'PLATFORM_ADMIN'],
  },
  {
    href: '/reports',
    label: 'Relatórios',
    icon: BarChart3,
    roles: ['SUPER_ADMIN', 'PLATFORM_ADMIN'],
  },
  {
    href: '/audit',
    label: 'Auditoria',
    icon: ScrollText,
    roles: ['SUPER_ADMIN', 'PLATFORM_ADMIN'],
  },
  {
    href: '/users',
    label: 'Usuários',
    icon: Users,
    roles: ['SUPER_ADMIN', 'PLATFORM_ADMIN'],
  },
  {
    href: '/settings',
    label: 'Configurações',
    icon: Settings,
    roles: ['SUPER_ADMIN'],
  },
]

interface SidebarProps {
  userRoles: UserRole[]
}

export function Sidebar({ userRoles }: SidebarProps) {
  const pathname = usePathname()

  const visibleItems = NAV_ITEMS.filter((item) => item.roles.some((r) => userRoles.includes(r)))

  return (
    <aside className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-[hsl(213,75%,24%)]">
      {/* Logo */}
      <div className="flex h-16 items-center border-b border-white/10 px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white">
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5 text-[hsl(213,75%,24%)]"
              fill="currentColor"
            >
              <path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-7 3a1 1 0 0 1 1 1v3h3a1 1 0 0 1 0 2h-3v3a1 1 0 0 1-2 0v-3H8a1 1 0 0 1 0-2h3V7a1 1 0 0 1 1-1z" />
            </svg>
          </div>
          <span className="text-lg font-bold tracking-tight text-white">Clinipharma</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-0.5">
          {visibleItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            const Icon = item.icon
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
                    isActive
                      ? 'bg-white/15 text-white'
                      : 'text-blue-100 hover:bg-white/10 hover:text-white'
                  )}
                >
                  <Icon className="h-4.5 w-4.5 flex-shrink-0" />
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="border-t border-white/10 p-3">
        <p className="text-center text-xs text-blue-200/50">Clinipharma v0.2.0</p>
      </div>
    </aside>
  )
}
