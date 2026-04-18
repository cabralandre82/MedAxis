import { requirePermissionPage, Permissions } from '@/lib/rbac/permissions'
import { createAdminClient } from '@/lib/db/admin'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export const dynamic = 'force-dynamic'

export default async function ServerLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ level?: string; q?: string }>
}) {
  // Wave 4 pilot: this route is the first to migrate from requireRole to
  // requirePermission. When the feature flag `rbac.fine_grained` is off
  // (default), the new helper transparently delegates to the legacy role
  // map defined in ROLE_FALLBACK, which reproduces the previous
  // SUPER_ADMIN / PLATFORM_ADMIN gate. Flip the flag to route through the
  // `has_permission` RPC (see migration 047).
  await requirePermissionPage(Permissions.SERVER_LOGS_READ)

  const { level, q } = await searchParams
  const admin = createAdminClient()

  let query = admin
    .from('server_logs')
    .select('id, level, message, route, request_id, context, created_at')
    .order('created_at', { ascending: false })
    .limit(200)

  if (level === 'error' || level === 'warn') {
    query = query.eq('level', level)
  }
  if (q) {
    query = query.ilike('message', `%${q}%`)
  }

  const { data: logs } = await query

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Logs do Servidor</h1>
        <p className="mt-1 text-sm text-slate-500">
          Erros e avisos persistidos — últimos 90 dias · 200 mais recentes
        </p>
      </div>

      {/* Filters */}
      <form className="flex flex-wrap items-center gap-3">
        <input
          name="q"
          defaultValue={q}
          placeholder="Buscar mensagem..."
          className="w-72 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
        />
        <select
          name="level"
          defaultValue={level ?? ''}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
        >
          <option value="">Todos os níveis</option>
          <option value="error">error</option>
          <option value="warn">warn</option>
        </select>
        <button
          type="submit"
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Filtrar
        </button>
      </form>

      {/* Count */}
      <p className="text-sm text-slate-500">{logs?.length ?? 0} entradas</p>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">Nível</th>
              <th className="px-4 py-3 font-medium">Mensagem</th>
              <th className="px-4 py-3 font-medium">Rota</th>
              <th className="px-4 py-3 font-medium">Data</th>
              <th className="px-4 py-3 font-medium">Contexto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {!logs?.length && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  Nenhum log encontrado.
                </td>
              </tr>
            )}
            {logs?.map((log) => (
              <tr key={log.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                      log.level === 'error'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {log.level}
                  </span>
                </td>
                <td className="max-w-sm px-4 py-3">
                  <span className="font-mono text-xs break-all text-slate-700">{log.message}</span>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{log.route ?? '—'}</td>
                <td className="px-4 py-3 text-xs whitespace-nowrap text-slate-500">
                  {format(new Date(log.created_at), 'dd/MM/yy HH:mm:ss', { locale: ptBR })}
                </td>
                <td className="px-4 py-3">
                  {log.context ? (
                    <details className="cursor-pointer">
                      <summary className="text-xs text-blue-600 hover:underline">ver</summary>
                      <pre className="mt-1 max-h-32 max-w-xs overflow-auto rounded bg-slate-100 p-2 text-xs">
                        {JSON.stringify(log.context, null, 2)}
                      </pre>
                    </details>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
