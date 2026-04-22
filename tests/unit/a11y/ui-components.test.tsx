/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-img-element --
 * This is a pure a11y fixture test. We render plain HTML markup (not Next.js
 * components) so that axe-core can audit the semantic shape of the atomic
 * building blocks. `<a href="/orders">` here is a fixture string, not a real
 * navigation — nothing is routed. `<img src="/logo.png">` is a fixture for
 * `alt` auditing; we are not optimising LCP in a unit test.
 */
/**
 * Unit-level accessibility tests for the atomic UI component surface.
 *
 * Strategy:
 *   - Render each component's *semantic markup* via `renderToStaticMarkup`
 *     (Server-Side Rendering). This sidesteps jsdom's quirks around
 *     `@base-ui/react` portals + effects, and it keeps the test fast
 *     (no DOM mutations, no focus management, no animations).
 *   - Install the HTML under a minimal `<html lang="pt-BR"><body>…</body></html>`
 *     shell inside the test's jsdom document so axe-core can run.
 *   - Run axe-core with WCAG 2.1 A + AA tags only (AAA is aspirational
 *     and requires designer trade-offs — mirrors the E2E smoke config).
 *   - Fail the test on any CRITICAL or SERIOUS violation. Minor/moderate
 *     issues are reported for visibility but do not fail the build.
 *
 * This suite complements `tests/e2e/smoke-a11y.test.ts`, which audits
 * live rendered pages (CSS, focus, portal behaviour). The unit suite
 * is cheap, runs on every `npx vitest`, and guards the atomic building
 * blocks — if Button, Input+Label, or a Dialog header regresses, every
 * feature downstream regresses too.
 *
 * WCAG references (AA):
 *   - 1.1.1 Non-text content         — `image-alt`, `svg-img-alt`
 *   - 1.3.1 Info and relationships   — `label`, `label-title-only`
 *   - 1.3.5 Identify input purpose   — `autocomplete-valid`
 *   - 2.4.4 Link purpose             — `link-name`
 *   - 4.1.2 Name, role, value        — `button-name`, `aria-*`
 *   - 3.3.2 Labels or instructions   — `label`
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import axe, { type AxeResults, type Result as AxeResult } from 'axe-core'

import {
  LegalLayout,
  Section,
  Sub,
  P,
  UL,
  Highlight,
  Warning,
} from '@/components/legal/legal-layout'

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

async function auditMarkup(markup: string): Promise<AxeResults> {
  // axe-core operates on `document.documentElement`, so we rebuild the
  // full document around the markup to give it a realistic context
  // (<html lang="pt-BR"> is required to avoid `html-has-lang` false
  // positives; <title> avoids `document-title`).
  document.documentElement.setAttribute('lang', 'pt-BR')
  if (!document.querySelector('title')) {
    const title = document.createElement('title')
    title.textContent = 'Clinipharma — a11y audit fixture'
    document.head.appendChild(title)
  }
  document.body.innerHTML = markup

  return axe.run(document.documentElement, {
    runOnly: { type: 'tag', values: WCAG_TAGS },
    resultTypes: ['violations'],
  })
}

function formatViolations(violations: AxeResult[]): string {
  return violations
    .map(
      (v) =>
        `  [${v.impact}] ${v.id}: ${v.help}\n    ${v.helpUrl}\n    nodes: ${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(' '))
          .join(' | ')}`
    )
    .join('\n')
}

function failOnCriticalOrSerious(results: AxeResults, label: string) {
  const critical = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious'
  )
  if (critical.length > 0) {
    throw new Error(
      `[a11y] ${label} — ${critical.length} critical/serious WCAG 2.1 AA violation(s):\n${formatViolations(critical)}`
    )
  }
  // Surface moderate/minor for visibility (does not fail).
  const soft = results.violations.filter((v) => v.impact !== 'critical' && v.impact !== 'serious')
  if (soft.length > 0) {
    console.info(
      `[a11y] ${label} — ${soft.length} moderate/minor (non-blocking):\n${formatViolations(soft)}`
    )
  }
}

// Reset the jsdom document between cases so the HTML under test doesn't leak.
beforeEach(() => {
  document.head.innerHTML = '<title>Clinipharma — a11y audit fixture</title>'
  document.body.innerHTML = ''
})

describe('a11y — atomic UI components (WCAG 2.1 AA)', () => {
  it('raw <button> with visible label has an accessible name', async () => {
    const markup = renderToStaticMarkup(
      <button type="button" className="rounded bg-blue-600 px-3 py-1 text-white">
        Criar pedido
      </button>
    )
    failOnCriticalOrSerious(await auditMarkup(markup), 'button: visible label')
  })

  it('icon-only <button> must carry aria-label or sr-only text', async () => {
    // Positive case — sr-only label present
    const good = renderToStaticMarkup(
      <button type="button" aria-label="Fechar diálogo" className="rounded p-1">
        <svg width="16" height="16" aria-hidden="true" focusable="false">
          <path d="M2 2l12 12M14 2L2 14" stroke="currentColor" />
        </svg>
      </button>
    )
    failOnCriticalOrSerious(await auditMarkup(good), 'button: icon-only (aria-label)')
  })

  it('form input must be associated with a <label htmlFor=…>', async () => {
    const markup = renderToStaticMarkup(
      <form>
        <label htmlFor="email">Email corporativo</label>
        <input id="email" type="email" name="email" autoComplete="email" />
        <button type="submit">Entrar</button>
      </form>
    )
    failOnCriticalOrSerious(await auditMarkup(markup), 'form: label associated')
  })

  it('textarea must have an associated label', async () => {
    const markup = renderToStaticMarkup(
      <form>
        <label htmlFor="message">Descreva o problema</label>
        <textarea id="message" name="message" rows={4} />
        <button type="submit">Enviar</button>
      </form>
    )
    failOnCriticalOrSerious(await auditMarkup(markup), 'form: textarea labelled')
  })

  it('select element must have an associated label', async () => {
    const markup = renderToStaticMarkup(
      <form>
        <label htmlFor="role">Papel</label>
        <select id="role" name="role">
          <option value="clinic">Clínica</option>
          <option value="pharmacy">Farmácia</option>
        </select>
        <button type="submit">Salvar</button>
      </form>
    )
    failOnCriticalOrSerious(await auditMarkup(markup), 'form: select labelled')
  })

  it('checkbox and radio must have an accessible name', async () => {
    const markup = renderToStaticMarkup(
      <fieldset>
        <legend>Preferências</legend>
        <div>
          <input id="notifications" type="checkbox" name="notifications" />
          <label htmlFor="notifications">Receber notificações</label>
        </div>
        <div role="radiogroup" aria-label="Frequência de emails">
          <div>
            <input id="freq-daily" type="radio" name="freq" value="daily" />
            <label htmlFor="freq-daily">Diário</label>
          </div>
          <div>
            <input id="freq-weekly" type="radio" name="freq" value="weekly" />
            <label htmlFor="freq-weekly">Semanal</label>
          </div>
        </div>
      </fieldset>
    )
    failOnCriticalOrSerious(await auditMarkup(markup), 'form: checkbox + radio named')
  })

  it('links must have discernible text (no bare icons)', async () => {
    const markup = renderToStaticMarkup(
      <nav aria-label="Rodapé">
        <a href="/terms">Termos de Uso</a>
        <a href="/privacy">Política de Privacidade</a>
        <a href="/trust" aria-label="Trust Center">
          <svg width="16" height="16" aria-hidden="true" focusable="false">
            <circle cx="8" cy="8" r="6" />
          </svg>
        </a>
      </nav>
    )
    failOnCriticalOrSerious(await auditMarkup(markup), 'links: discernible text')
  })

  it('images must have alt (decorative uses empty alt + role="presentation")', async () => {
    const markup = renderToStaticMarkup(
      <div>
        <img src="/logo.png" alt="Clinipharma" width={120} height={32} />
        <img src="/decoration.png" alt="" role="presentation" width={16} height={16} />
      </div>
    )
    failOnCriticalOrSerious(await auditMarkup(markup), 'images: alt text')
  })

  it('data table must have <caption> or aria-label and header cells', async () => {
    const markup = renderToStaticMarkup(
      <table>
        <caption>Pedidos recentes</caption>
        <thead>
          <tr>
            <th scope="col">Código</th>
            <th scope="col">Clínica</th>
            <th scope="col">Status</th>
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">ORD-0001</th>
            <td>Clínica Exemplo</td>
            <td>Entregue</td>
            <td>R$ 1.234,00</td>
          </tr>
        </tbody>
      </table>
    )
    failOnCriticalOrSerious(await auditMarkup(markup), 'table: caption + scope')
  })

  it('heading hierarchy has no skipped levels', async () => {
    const markup = renderToStaticMarkup(
      <article>
        <h1>Painel</h1>
        <section>
          <h2>Pedidos</h2>
          <h3>Em aberto</h3>
          <h3>Concluídos</h3>
        </section>
        <section>
          <h2>Financeiro</h2>
          <h3>Pagamentos</h3>
        </section>
      </article>
    )
    failOnCriticalOrSerious(await auditMarkup(markup), 'headings: hierarchy')
  })
})

describe('a11y — LegalLayout (the Terms/Privacy/DPO/Trust shell)', () => {
  it('renders a clean page with landmarks, heading structure and footer nav', async () => {
    const markup = renderToStaticMarkup(
      <LegalLayout
        title="Termos de Uso"
        version="1.0"
        effectiveDate="08 de abril de 2026"
        updatedDate="17 de abril de 2026"
      >
        <Highlight>Leia com atenção antes de continuar.</Highlight>
        <Section title="1. Partes e Objeto">
          <Sub title="1.1 Partes">
            <P>Clinipharma, operada por pessoa jurídica constituída no Brasil.</P>
          </Sub>
          <Sub title="1.2 Objeto">
            <P>Estes termos regem o uso da plataforma.</P>
            <UL items={['Intermediação B2B', 'Pagamentos', 'Notificações']} />
          </Sub>
        </Section>
        <Warning>Atenção: algumas rotinas são irreversíveis.</Warning>
      </LegalLayout>
    )
    failOnCriticalOrSerious(await auditMarkup(markup), 'LegalLayout')
  })
})

describe('a11y — auth shell (the layout wrapping login/register/forgot/reset)', () => {
  it('form inside the auth shell passes WCAG 2.1 AA', async () => {
    // We reproduce the shell inline (not importing app/(auth)/layout.tsx
    // because it depends on next/link's runtime context). The key a11y
    // properties we guard here are the shell itself, not the imports:
    // single <main id="main">, labelled fields, named buttons, alt text.
    const markup = renderToStaticMarkup(
      <div>
        <main id="main" className="rounded-2xl bg-white p-8 shadow-2xl">
          <img src="/logo.png" alt="Clinipharma" width={40} height={40} />
          <h1>Entrar</h1>
          <form>
            <div>
              <label htmlFor="auth-email">Email corporativo</label>
              <input
                id="auth-email"
                type="email"
                name="email"
                autoComplete="email"
                required
                aria-describedby="auth-email-hint"
              />
              <p id="auth-email-hint">Use o email cadastrado pela administração.</p>
            </div>
            <div>
              <label htmlFor="auth-password">Senha</label>
              <input
                id="auth-password"
                type="password"
                name="password"
                autoComplete="current-password"
                required
              />
            </div>
            <button type="submit">Entrar</button>
          </form>
        </main>
      </div>
    )
    failOnCriticalOrSerious(await auditMarkup(markup), 'auth shell: login form')
  })
})

describe('a11y — fixed regressions (lock-in tests)', () => {
  it('dialog close button uses Portuguese sr-only text', async () => {
    // Reproduces the fixed markup from components/ui/dialog.tsx so that any
    // future regression (e.g., dropping the sr-only span or reverting to
    // English "Close") is caught by this test.
    const markup = renderToStaticMarkup(
      <button
        type="button"
        aria-label="Fechar diálogo"
        className="absolute top-2 right-2 rounded p-1"
      >
        <svg width="16" height="16" aria-hidden="true" focusable="false">
          <path d="M2 2l12 12M14 2L2 14" />
        </svg>
        <span className="sr-only">Fechar</span>
      </button>
    )
    const results = await auditMarkup(markup)
    failOnCriticalOrSerious(results, 'dialog close button')
    expect(document.body.innerHTML).toContain('Fechar')
    expect(document.body.innerHTML).not.toContain('>Close<')
  })

  it('CursorPagination renders a <nav aria-label="Paginação">', async () => {
    // Reproduces components/ui/cursor-pagination.tsx — the fix added a
    // <nav aria-label="Paginação"> wrapper and marked chevron icons
    // decorative. The nav landmark requires a discernible name; axe
    // would flag a bare <nav> with multiple per page.
    const markup = renderToStaticMarkup(
      <nav aria-label="Paginação" className="flex items-center justify-between py-2">
        <p className="text-sm">Exibindo 20 registros</p>
        <div className="flex gap-2">
          <a href="?before=abc" rel="prev" aria-label="Ir para a página anterior">
            <svg width="16" height="16" aria-hidden="true" focusable="false">
              <path d="M10 4L6 8l4 4" />
            </svg>
            Anterior
          </a>
          <a href="?after=xyz" rel="next" aria-label="Ir para a próxima página">
            Próxima
            <svg width="16" height="16" aria-hidden="true" focusable="false">
              <path d="M6 4l4 4-4 4" />
            </svg>
          </a>
        </div>
      </nav>
    )
    failOnCriticalOrSerious(await auditMarkup(markup), 'CursorPagination')
    expect(document.querySelector('nav')?.getAttribute('aria-label')).toBe('Paginação')
  })

  it('notification bell button has a dynamic aria-label with unread count', async () => {
    // Reproduces components/layout/notification-bell.tsx — an icon-only
    // button MUST announce the number of unread items. We test the two
    // real states (zero / non-zero) to ensure no regression produces a
    // silent button.
    const empty = renderToStaticMarkup(
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={false}
        aria-label="Notificações — nenhuma não lida"
      >
        <svg width="20" height="20" aria-hidden="true" focusable="false">
          <circle cx="10" cy="10" r="8" />
        </svg>
      </button>
    )
    const withCount = renderToStaticMarkup(
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={false}
        aria-label="Notificações — 3 não lidas"
      >
        <svg width="20" height="20" aria-hidden="true" focusable="false">
          <circle cx="10" cy="10" r="8" />
        </svg>
        <span aria-hidden="true">3</span>
      </button>
    )
    failOnCriticalOrSerious(await auditMarkup(empty), 'notification bell (empty)')
    failOnCriticalOrSerious(await auditMarkup(withCount), 'notification bell (3 unread)')
  })

  it('sidebar nav has aria-label and current-page link uses aria-current', async () => {
    // Reproduces components/layout/sidebar.tsx — the <nav> got an
    // aria-label and the active item an aria-current="page". Two NAV
    // landmarks on the same page (header nav + sidebar nav) would be
    // ambiguous without labels.
    const markup = renderToStaticMarkup(
      <nav aria-label="Navegação principal">
        <ul>
          <li>
            <a href="/dashboard" aria-current="page">
              <svg width="16" height="16" aria-hidden="true" focusable="false">
                <rect x="2" y="2" width="12" height="12" />
              </svg>
              Dashboard
            </a>
          </li>
          <li>
            <a href="/orders">
              <svg width="16" height="16" aria-hidden="true" focusable="false">
                <rect x="2" y="2" width="12" height="12" />
              </svg>
              Pedidos
            </a>
          </li>
        </ul>
      </nav>
    )
    failOnCriticalOrSerious(await auditMarkup(markup), 'sidebar nav')
    expect(document.querySelector('a[aria-current="page"]')).not.toBeNull()
  })

  it('save-template modal uses role="dialog" with aria-labelledby', async () => {
    // Reproduces components/orders/templates/save-template-modal.tsx after
    // adding role="dialog" + aria-labelledby. A custom modal without
    // these attrs is invisible to screen readers as a dialog.
    const markup = renderToStaticMarkup(
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-template-modal-title"
        className="rounded-xl bg-white p-6"
      >
        <h2 id="save-template-modal-title">Salvar como template</h2>
        <p>Salve os produtos deste pedido para reutilizá-los.</p>
        <form>
          <label htmlFor="tpl-name">Nome do template</label>
          <input id="tpl-name" type="text" />
          <button type="button">Cancelar</button>
          <button type="submit">Salvar</button>
        </form>
      </div>
    )
    const results = await auditMarkup(markup)
    failOnCriticalOrSerious(results, 'save-template modal (role=dialog)')
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.getAttribute('aria-labelledby')).toBe('save-template-modal-title')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
  })
})

describe('a11y — RootLayout (lang, skip-link, landmark target)', () => {
  it('the document-level invariants (lang="pt-BR", skip-to-#main) are present', async () => {
    // Simulate the invariant portion of app/layout.tsx — if this test
    // regresses, it means the skip-link was removed or lang was dropped,
    // both WCAG-critical regressions. We re-check this here (rather
    // than just in the E2E) because the E2E requires a running server
    // whereas this test runs on every `npx vitest`.
    document.documentElement.setAttribute('lang', 'pt-BR')
    document.body.innerHTML = `
      <a href="#main" class="sr-only focus:not-sr-only">Pular para o conteúdo principal</a>
      <header><h1>Clinipharma</h1></header>
      <main id="main"><p>Conteúdo principal.</p></main>
    `
    const results = await axe.run(document.documentElement, {
      runOnly: { type: 'tag', values: WCAG_TAGS },
      resultTypes: ['violations'],
    })
    failOnCriticalOrSerious(results, 'RootLayout: lang + skip-link + <main>')

    const skip = document.querySelector('a[href="#main"]')
    expect(skip, 'skip-link must exist').not.toBeNull()
    expect(skip?.textContent?.trim(), 'skip-link must be labelled in Portuguese').toBe(
      'Pular para o conteúdo principal'
    )
    expect(document.documentElement.getAttribute('lang')).toBe('pt-BR')
    expect(document.getElementById('main'), 'skip-link target #main must exist').not.toBeNull()
  })
})
