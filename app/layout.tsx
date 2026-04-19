import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import { Toaster } from '@/components/ui/sonner'
import { NONCE_HEADER } from '@/lib/security/csp'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Clinipharma',
    template: '%s | Clinipharma',
  },
  description: 'Plataforma B2B de intermediação médica entre clínicas, médicos e farmácias.',
  robots: 'noindex, nofollow',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Clinipharma',
  },
}

export const viewport: Viewport = {
  themeColor: '#0f3460',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Wave Hardening II #8 — read the per-request nonce minted by
  // `middleware.ts`. Calling `headers()` here is what tells Next.js
  // to attach the nonce to its own injected scripts (RSC chunks,
  // streaming hydration, devtool runtime). The framework looks up
  // the value through the `x-nonce` request header automatically;
  // we only have to *touch* it to opt this layout into dynamic
  // rendering. We also expose it on `data-csp-nonce` so client
  // libraries that need to inject their own `<style>` (e.g. Sonner,
  // Emotion) can read it without re-importing the security module.
  const headerStore = await headers()
  const nonce = headerStore.get(NONCE_HEADER) ?? ''
  return (
    <html lang="pt-BR" suppressHydrationWarning data-csp-nonce={nonce || undefined}>
      <body>
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  )
}
