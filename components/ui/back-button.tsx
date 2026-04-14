'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

interface BackButtonProps {
  /** Fallback URL used for right-click > open in new tab and keyboard navigation. */
  href: string
  label?: string
  className?: string
}

/**
 * Navigates back in browser history on left-click (router.back()).
 * Falls back to `href` for right-click / direct-link access scenarios.
 */
export function BackButton({ href, label = 'Voltar', className }: BackButtonProps) {
  const router = useRouter()

  return (
    <Link
      href={href}
      onClick={(e) => {
        e.preventDefault()
        router.back()
      }}
      className={`inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-gray-900 ${className ?? ''}`}
    >
      <ChevronLeft className="h-4 w-4" />
      {label}
    </Link>
  )
}
