'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Calendar, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

export interface DateRange {
  from: string // YYYY-MM-DD
  to: string // YYYY-MM-DD
}

type Preset = {
  label: string
  key: string
  getRange: () => DateRange
}

function today() {
  return new Date().toISOString().slice(0, 10)
}
function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}
function startOfMonth(offsetMonths = 0) {
  const d = new Date()
  d.setMonth(d.getMonth() + offsetMonths, 1)
  return d.toISOString().slice(0, 10)
}
function endOfMonth(offsetMonths = 0) {
  const d = new Date()
  d.setMonth(d.getMonth() + offsetMonths + 1, 0)
  return d.toISOString().slice(0, 10)
}
function startOfYear() {
  return `${new Date().getFullYear()}-01-01`
}

const PRESETS: Preset[] = [
  { label: 'Hoje', key: 'today', getRange: () => ({ from: today(), to: today() }) },
  { label: 'Esta semana', key: 'week', getRange: () => ({ from: daysAgo(6), to: today() }) },
  { label: 'Este mês', key: 'month', getRange: () => ({ from: startOfMonth(), to: endOfMonth() }) },
  {
    label: 'Mês anterior',
    key: 'prev',
    getRange: () => ({ from: startOfMonth(-1), to: endOfMonth(-1) }),
  },
  { label: 'Últimos 3 meses', key: '3m', getRange: () => ({ from: daysAgo(89), to: today() }) },
  { label: 'Últimos 6 meses', key: '6m', getRange: () => ({ from: daysAgo(179), to: today() }) },
  { label: 'Este ano', key: 'year', getRange: () => ({ from: startOfYear(), to: today() }) },
  { label: 'Personalizado', key: 'custom', getRange: () => ({ from: daysAgo(29), to: today() }) },
]

interface DateRangePickerProps {
  defaultPreset?: string
}

export function DateRangePicker({ defaultPreset = 'month' }: DateRangePickerProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [open, setOpen] = useState(false)
  const [activeKey, setActiveKey] = useState(defaultPreset)
  const [customFrom, setCustomFrom] = useState(daysAgo(29))
  const [customTo, setCustomTo] = useState(today())

  // Initialise from URL
  useEffect(() => {
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const preset = searchParams.get('preset')
    if (preset) setActiveKey(preset)
    if (from) setCustomFrom(from)
    if (to) setCustomTo(to)
    if (from && to && !preset) setActiveKey('custom')
  }, [searchParams])

  function apply(key: string, range: DateRange) {
    setActiveKey(key)
    setOpen(false)
    const params = new URLSearchParams(searchParams.toString())
    params.set('from', range.from)
    params.set('to', range.to)
    params.set('preset', key)
    params.delete('page')
    router.push(`${pathname}?${params.toString()}`)
  }

  function applyCustom() {
    apply('custom', { from: customFrom, to: customTo })
  }

  const activePreset = PRESETS.find((p) => p.key === activeKey)
  const activeRange =
    activeKey === 'custom'
      ? { from: customFrom, to: customTo }
      : (activePreset?.getRange() ?? PRESETS[2].getRange())

  const fmtDate = (s: string) =>
    new Date(s + 'T12:00:00').toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: '2-digit',
    })

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none"
      >
        <Calendar className="h-4 w-4 text-gray-400" />
        <span className="font-medium">{activePreset?.label ?? 'Período'}</span>
        <span className="text-gray-400">
          {fmtDate(activeRange.from)} – {fmtDate(activeRange.to)}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
      </button>

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
          <div className="absolute top-full right-0 z-20 mt-1.5 w-72 rounded-xl border border-gray-200 bg-white shadow-lg">
            <div className="p-2">
              {PRESETS.filter((p) => p.key !== 'custom').map((preset) => (
                <button
                  key={preset.key}
                  onClick={() => apply(preset.key, preset.getRange())}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                    activeKey === preset.key
                      ? 'bg-[hsl(213,75%,24%)] text-white'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <span>{preset.label}</span>
                  <span
                    className={`text-xs ${activeKey === preset.key ? 'text-blue-200' : 'text-gray-400'}`}
                  >
                    {fmtDate(preset.getRange().from)} – {fmtDate(preset.getRange().to)}
                  </span>
                </button>
              ))}

              {/* Custom range */}
              <div className="mt-2 border-t border-gray-100 px-1 pt-2">
                <p className="mb-2 text-xs font-medium tracking-wide text-gray-500 uppercase">
                  Personalizado
                </p>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Label htmlFor="date-range-from" className="text-xs text-gray-600">
                      De
                    </Label>
                    <input
                      id="date-range-from"
                      type="date"
                      value={customFrom}
                      max={customTo}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      className="mt-0.5 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:ring-2 focus:ring-blue-400 focus:outline-none"
                    />
                  </div>
                  <div className="flex-1">
                    <Label htmlFor="date-range-to" className="text-xs text-gray-600">
                      Até
                    </Label>
                    <input
                      id="date-range-to"
                      type="date"
                      value={customTo}
                      min={customFrom}
                      max={today()}
                      onChange={(e) => setCustomTo(e.target.value)}
                      className="mt-0.5 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:ring-2 focus:ring-blue-400 focus:outline-none"
                    />
                  </div>
                </div>
                <Button size="sm" onClick={applyCustom} className="mt-2 w-full">
                  Aplicar
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
