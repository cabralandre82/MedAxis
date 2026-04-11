import type { Metadata } from 'next'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Clinipharma',
    template: '%s | Clinipharma',
  },
  description: 'Plataforma B2B de intermediação médica entre clínicas, médicos e farmácias.',
  robots: 'noindex, nofollow',
  manifest: '/manifest.json',
  themeColor: '#0f3460',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Clinipharma',
  },
  viewport: {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  )
}
