/**
 * RLS findings helper — registra suspeitas de bypass cross-tenant
 * em modo "warn-only" (default) ou "hard-fail" (toggle por env).
 *
 * Por que existir
 * ---------------
 * Temos um canário SQL diário (`/api/cron/rls-canary`) que prova,
 * via JWT forjado contra PostgREST, que um sujeito anônimo não vê
 * dados de tenant. Esse canário é direto na camada de banco.
 *
 * O complemento HTTP-level (este arquivo + `cross-tenant-rls.test.ts`)
 * cobre o que o canário não vê:
 *
 *   1. Stack completo: edge → middleware → route handler → admin client
 *      → response. Bypasses na camada de aplicação (ex: rota usa
 *      `createAdminClient()` mas esquece de checar membership) não
 *      aparecem no canário SQL.
 *   2. Path-traversal de UUIDs em rotas `/api/.../[id]`. Mesmo com RLS
 *      ativo no banco, uma rota pode aceitar um id de outro tenant e
 *      vazar via JOIN não-coberto.
 *
 * Modo warn-only por default
 * --------------------------
 * Em fase de pré-launch (plataforma viva mas sem tráfego comercial)
 * preferimos LOG sobre QUEBRA. Findings vão para:
 *
 *   1. `console.warn(...)` — visível no Playwright report.
 *   2. `test.info().annotations` — coloca destaque amarelo no HTML
 *      report do Playwright.
 *
 * Quando o tráfego comercial subir, basta exportar
 * `E2E_RLS_HARD_FAIL=true` no workflow CI para o helper passar a
 * lançar `Error()` em vez de só warning. Default propositalmente
 * conservador para não quebrar CI por falsos positivos durante a
 * estabilização (ex: fixture de tenant ainda não-provisionada).
 */

import type { TestInfo } from '@playwright/test'

const HARD_FAIL_ENV = process.env.E2E_RLS_HARD_FAIL === 'true'

export type RlsFinding = {
  /** Identificador curto e estável (ex: 'anon-coupons-mine'). */
  id: string
  /** Descrição humana do achado. */
  description: string
  /** Status HTTP retornado, se aplicável. */
  status?: number
  /** Detalhes opcionais (não imprime body de resposta cru). */
  details?: Record<string, unknown>
}

/**
 * Decide se o teste corrente deve quebrar (hard) ou só registrar (warn).
 * Permite override por chamada (ex: anon→200 com array vazio é warn,
 * anon→200 com leak real é hard mesmo no modo padrão).
 */
export function recordFinding(
  testInfo: TestInfo,
  finding: RlsFinding,
  opts: { forceHard?: boolean } = {}
): void {
  const tag = `[rls-finding/${finding.id}]`
  const summary = `${tag} ${finding.description}${
    finding.status !== undefined ? ` (status=${finding.status})` : ''
  }`

  // Anotação visível no HTML report.
  testInfo.annotations.push({
    type: 'rls-finding',
    description: summary,
  })

  const detailsJson = finding.details ? ` ${JSON.stringify(finding.details)}` : ''
  const fullMsg = `${summary}${detailsJson}`

  if (opts.forceHard || HARD_FAIL_ENV) {
    throw new Error(fullMsg)
  }

  console.warn(fullMsg)
}

/**
 * Reporta o estado **inicial** do teste como anotação informativa.
 * Útil para que quem ler o HTML report entenda em que modo o teste
 * rodou (warn-only vs hard).
 */
export function annotateRlsMode(testInfo: TestInfo): void {
  testInfo.annotations.push({
    type: 'rls-mode',
    description: HARD_FAIL_ENV ? 'hard-fail (E2E_RLS_HARD_FAIL=true)' : 'warn-only (default)',
  })
}

/** Lê o modo atual sem efeitos colaterais. Útil para test.fail() condicional. */
export function isHardFail(): boolean {
  return HARD_FAIL_ENV
}
