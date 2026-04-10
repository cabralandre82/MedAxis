import ExcelJS from 'exceljs'

export function toCSV(
  rows: Record<string, unknown>[],
  opts: { skipHeader?: boolean } = {}
): string {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v)
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }
  const dataLines = rows.map((r) => headers.map((h) => escape(r[h])).join(','))
  const lines = opts.skipHeader ? dataLines : [headers.join(','), ...dataLines]
  return lines.join('\n')
}

export async function toXLSX(
  sheets: Array<{ name: string; rows: Record<string, unknown>[] }>
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  for (const { name, rows } of sheets) {
    const ws = wb.addWorksheet(name.slice(0, 31))
    if (rows.length > 0) {
      const headers = Object.keys(rows[0])
      ws.addRow(headers)
      // Style header row
      ws.getRow(1).font = { bold: true }
      ws.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE2E8F0' },
      }
      for (const row of rows) {
        ws.addRow(headers.map((h) => row[h] ?? ''))
      }
      // Auto-width columns
      ws.columns.forEach((col) => {
        col.width = 18
      })
    }
  }
  const buffer = await wb.xlsx.writeBuffer()
  return new Uint8Array(buffer)
}
