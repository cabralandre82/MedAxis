'use client'

import { useState } from 'react'
import { Download, FileSpreadsheet, FileText, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'

type ExportType = 'orders' | 'payments' | 'transfers' | 'commissions'

interface ExportButtonProps {
  type: ExportType
  label?: string
  extraParams?: string
}

export function ExportButton({ type, label = 'Exportar', extraParams = '' }: ExportButtonProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState<'csv' | 'xlsx' | null>(null)

  async function download(format: 'csv' | 'xlsx') {
    setLoading(format)
    setOpen(false)
    try {
      const res = await fetch(`/api/export?type=${type}&format=${format}${extraParams}`)
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const cd = res.headers.get('Content-Disposition') ?? ''
      const match = cd.match(/filename="(.+?)"/)
      a.download = match?.[1] ?? `export.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert('Erro ao exportar. Tente novamente.')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen((o) => !o)}
        disabled={loading !== null}
        className="gap-1.5"
      >
        {loading ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
        {label}
        <ChevronDown className="h-3 w-3 text-gray-400" />
      </Button>

      {open && (
        <>
          {/* Click-outside backdrop. Hidden from AT — focus management is
              handled by the trigger button above. */}
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute top-9 right-0 z-20 min-w-[160px] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
            <button
              onClick={() => download('csv')}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              <FileText className="h-4 w-4 text-gray-400" />
              CSV
            </button>
            <button
              onClick={() => download('xlsx')}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              <FileSpreadsheet className="h-4 w-4 text-green-600" />
              Excel (.xlsx)
            </button>
          </div>
        </>
      )}
    </div>
  )
}
