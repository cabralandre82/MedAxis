# Dynamic Application Security Testing (DAST)

| Field          | Value                                                                             |
| -------------- | --------------------------------------------------------------------------------- |
| Owner          | Platform / Security                                                               |
| Tool           | [OWASP ZAP](https://www.zaproxy.org/) baseline scan via `zaproxy/action-baseline` |
| Cadence        | Weekly (Mon 07:00 UTC) + manual dispatch                                          |
| Target         | `https://clinipharma.com.br` (production apex)                                    |
| Scope          | Passive only — no active attacks against production                               |
| Last reviewed  | 2026-04-19                                                                        |
| Workflow       | `.github/workflows/zap-baseline.yml`                                              |
| Rule overrides | `.zap/rules.tsv`                                                                  |

## 1. Why a third layer of monitoring?

Our synthetic-monitoring story has three layers, and each catches a
class of failure the others physically cannot:

| Layer | Scope            | Cadence | Catches                                            |
| ----- | ---------------- | ------- | -------------------------------------------------- |
| 1     | In-cluster probe | 5 min   | Lambda boot, DB health, internal cron drift        |
| 2     | External probe   | 5 min   | DNS, TLS handshake, Vercel edge availability       |
| 3     | DAST (this doc)  | Weekly  | Security-header drift, TLS config, info disclosure |

Static analysis (CodeQL, Trivy, npm audit) and mutation testing
prove that the **code we wrote** is secure. DAST proves that the
**code we deployed** is configured securely once it has gone
through Vercel, the Edge runtime, and any platform-level overrides.
A correct CSP in `next.config.ts` doesn't help us if Vercel strips
the header for streaming responses.

## 2. What it scans

The ZAP baseline scan is **passive**: it spiders the site (including
the AJAX spider for our Next.js streaming pages), collects responses,
and runs ~50 passive checks against them. No active attacks (no SQLi
payloads, no XSS probes, no brute force) — those are reserved for a
future formal pentest with explicit scope and rules of engagement.

What we expect it to verify on every run:

- Strict-Transport-Security present, `max-age >= 31536000`, `includeSubDomains`
- Content-Security-Policy present and not Report-Only
- X-Content-Type-Options: nosniff
- X-Frame-Options or `frame-ancestors 'none'` in CSP
- Referrer-Policy set
- Permissions-Policy set
- Cookies have `Secure` and `HttpOnly` where appropriate
- TLS: only TLS 1.2+, no weak ciphers, OCSP stapling
- No directory listings, no `.git` exposed, no exposed admin paths
- No information disclosure in error pages (stack traces, framework versions)
- Cookies do not leak across subdomains

## 3. Suppressed rules

The active overrides live in `.zap/rules.tsv`. Each entry MUST carry
a one-line justification — drift in the rationale is a code-review
smell.

| ID    | Action | Why                                                                                                |
| ----- | ------ | -------------------------------------------------------------------------------------------------- |
| 10202 | IGNORE | We use Origin + double-submit cookie (`lib/security/csrf.ts`); ZAP heuristic flags every form.     |
| 10049 | IGNORE | Streaming RSC default; sensitive routes set their own `no-store` via dedicated handlers.           |
| 10054 | WARN   | Supabase SSR cookies use browser-default SameSite; CSRF mitigated one layer up.                    |
| 10021 | WARN   | `X-Content-Type-Options` enforced in `next.config.ts`; streaming may delay first-chunk inspection. |

Re-evaluate the entire table annually (next: 2027-04). Any new
IGNORE during interim must be paired with a tracking issue.

## 4. Gate and alerting

The workflow does NOT block the build directly. Instead:

1. ZAP runs and emits HTML + JSON + Markdown reports (uploaded as
   `zap-baseline-report-90d` artifact, 90-day retention for audit).
2. A parser bucketises findings by severity (`riskcode`).
3. **High** or **Medium** findings → open or update a GitHub issue
   tagged `zap-baseline-finding` + `security`. The job is marked as
   failed so the Actions tab shows a red ✗.
4. **Low** or **Info** findings → counted in the step summary only.
5. A clean run while an issue is open → adds a "latest scan clean"
   comment but does NOT auto-close. Humans triage DAST findings.

This deduplication mirrors the pattern from `external-probe.yml` and
`audit-chain-tampered` runbook so on-call sees one consistent
alerting shape regardless of which monitor fired.

## 5. Triage runbook

When the workflow opens or updates the tracking issue:

1. Open the workflow run linked in the issue body.
2. Download the `zap-baseline-report-90d` artifact.
3. Open `report_html.html` in a browser.
4. For each High/Medium finding:
   - **Real positive** → file a fix PR, close the issue when merged.
   - **False positive** → add a row to `.zap/rules.tsv` with a
     written justification, commit. The next scheduled run will
     not re-flag it.
   - **Accepted risk** → add to `docs/security/known-acceptable-vulns.md`
     with explicit owner, expiry date, and mitigation rationale.
5. Re-run the workflow manually (`gh workflow run zap-baseline.yml`)
   to confirm the finding count drops to 0.

If the finding is a runtime regression (e.g. a missing security
header that was present last week), prioritise the fix over
suppressing it — the gate is doing its job.

## 6. Cost & risk model

| Aspect              | Value                                                          |
| ------------------- | -------------------------------------------------------------- |
| Wall-clock per run  | ~5 min (spider + AJAX spider + passive scan)                   |
| Traffic generated   | ~300–500 requests against production over 5 minutes            |
| Rate-limit risk     | None observed — well under our edge limits                     |
| Production safety   | Passive only; no state-mutating requests, no payload injection |
| GitHub Actions cost | Free (public repo)                                             |

If the request volume becomes uncomfortable as we add routes, switch
the target to a staging URL and add a separate weekly pentest-style
scan against staging only.

## 7. Manual dispatch

```bash
# Default: scan production.
gh workflow run zap-baseline.yml --ref main

# Scan a Vercel preview after a security-sensitive PR.
gh workflow run zap-baseline.yml --ref main \
  -f target_url='https://my-pr-clinipharma-cabralandre82.vercel.app'
```

## 8. Promotion path

What this scan does NOT cover, with the trigger to revisit:

- **Active DAST (SQLi/XSS payloads)** — Trigger: scope a paid pentest
  and run `zap-full-scan` against staging only.
- **Authenticated scanning** — Trigger: we expand beyond the public
  surface area; today every interesting route requires a session
  cookie that ZAP can't acquire without a credential bypass we
  intentionally don't have.
- **API contract scanning** — Trigger: we publish a public OpenAPI
  spec; today our APIs are internal and exercised via E2E tests.
- **Subdomain take-over checks** — Trigger: we add wildcard DNS or
  a third-party SaaS subdomain delegation.

## 9. Change log

| Date       | Change                                                                |
| ---------- | --------------------------------------------------------------------- |
| 2026-04-19 | Initial activation. Weekly cadence, Medium+ gate, 4 suppressed rules. |
