export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[hsl(213,75%,24%)] via-[hsl(210,60%,30%)] to-[hsl(196,91%,36%)] p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mb-2 inline-flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-lg">
              <svg
                viewBox="0 0 24 24"
                className="h-6 w-6 text-[hsl(213,75%,24%)]"
                fill="currentColor"
              >
                <path d="M12 2a5 5 0 1 1 0 10A5 5 0 0 1 12 2zm0 12c5.33 0 8 2.67 8 4v2H4v-2c0-1.33 2.67-4 8-4z" />
              </svg>
            </div>
            <span className="text-2xl font-bold tracking-tight text-white">Clinipharma</span>
          </div>
          <p className="text-sm text-blue-100">Plataforma B2B de intermediação médica</p>
        </div>
        <div className="rounded-2xl bg-white p-8 shadow-2xl">{children}</div>
      </div>
    </div>
  )
}
