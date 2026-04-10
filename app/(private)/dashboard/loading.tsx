/**
 * Dashboard-specific loading skeleton.
 * More accurately mirrors the AdminDashboard KPI layout.
 */
export default function DashboardLoading() {
  return (
    <div className="animate-pulse space-y-6">
      {/* Greeting */}
      <div className="space-y-1.5">
        <div className="h-7 w-52 rounded-lg bg-gray-200" />
        <div className="h-4 w-36 rounded bg-gray-100" />
      </div>

      {/* KPI row — 4 cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-gray-100 bg-white p-5">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <div className="h-3 w-20 rounded bg-gray-100" />
                <div className="h-7 w-14 rounded-lg bg-gray-200" />
                <div className="h-3 w-16 rounded bg-gray-100" />
              </div>
              <div className="h-10 w-10 rounded-lg bg-gray-100" />
            </div>
          </div>
        ))}
      </div>

      {/* Secondary KPI row — 3 cards */}
      <div className="grid grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-gray-100 bg-white p-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1.5">
                <div className="h-3 w-16 rounded bg-gray-100" />
                <div className="h-6 w-10 rounded-lg bg-gray-200" />
              </div>
              <div className="h-8 w-8 rounded-lg bg-gray-100" />
            </div>
          </div>
        ))}
      </div>

      {/* Recent orders card */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="h-5 w-32 rounded bg-gray-200" />
          <div className="h-4 w-16 rounded bg-gray-100" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between border-b border-gray-50 py-3 last:border-0"
          >
            <div className="space-y-1">
              <div className="h-4 w-28 rounded bg-gray-100" />
              <div className="h-3 w-16 rounded bg-gray-100" />
            </div>
            <div className="h-5 w-20 rounded-full bg-gray-200" />
          </div>
        ))}
      </div>
    </div>
  )
}
