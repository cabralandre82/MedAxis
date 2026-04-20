# Threat Model — Clinipharma B2B

| Field          | Value                                                   |
| -------------- | ------------------------------------------------------- |
| Owner          | Engineering / Security                                  |
| Last reviewed  | 2026-04-18                                              |
| Next review    | 2026-07-18 (quarterly) — earlier if scope changes       |
| Methodology    | STRIDE per data-flow + LINDDUN privacy overlay          |
| Severity scale | Critical / High / Medium / Low (CVSS-aligned narrative) |
| Scope baseline | Production deployment on `clinipharma.com.br`           |

> This document is the canonical threat model for the platform.
> It is **paired** with:
>
> - `docs/security/self-audit-2026-04-17.md` (OWASP ASVS L1 evidence)
> - `docs/security/known-acceptable-vulns.md` (risk-accepted findings)
> - `docs/security/csp.md` (CSP rationale and rollout)
> - `docs/runbooks/` (incident playbooks per asset)
>
> If you add a new external integration, a new persisted PII field, or a
> new privileged role: update this document **in the same PR**.

## 1. System overview

Clinipharma is a Next.js 15 multi-tenant marketplace connecting Brazilian
**clinics** (orderers) and **pharmacies** (fulfillers) for prescription drug
B2B orders. Operationally critical: prescriptions are PII + sensitive
health data under LGPD; financial flows pass through Asaas; legal
documents are signed via ClickSign.

### 1.1 Trust boundaries

```
                  ┌──────────── INTERNET ────────────┐
                  ↓                                   ↓
          ┌──────────────┐                  ┌──────────────────┐
   user → │ Vercel Edge  │ ──── /api ────→  │ Vercel Functions │
          │  (CSP, CSRF, │                  │  (Node 20 SSR)   │
          │   rate-lim)  │                  └────────┬─────────┘
          └──────────────┘                           │
                                                     ↓
                  ┌──────────────────────────────────┴────────────────┐
                  │                                                   │
            ┌─────▼─────┐  ┌─────────────┐  ┌──────────┐  ┌──────────▼────────┐
            │ Supabase  │  │ Upstash     │  │ Sentry   │  │ External webhooks │
            │ Postgres  │  │ Redis       │  │ (errors) │  │ (Asaas/ClickSign) │
            │ + RLS+    │  │ (rate-lim,  │  │          │  │                   │
            │  Storage  │  │  cron lock) │  │          │  └───────────────────┘
            └───────────┘  └─────────────┘  └──────────┘
```

Each arrow is a trust boundary. The **Vercel Functions ⇆ Supabase** boundary
is the most security-critical: a compromised function with the
service-role key bypasses every RLS policy.

### 1.2 Assets

| Asset                            | Sensitivity | Persistence    |
| -------------------------------- | ----------- | -------------- |
| Doctor prescriptions (PDF + OCR) | Critical    | Storage + DB   |
| User PII (CPF, CNPJ, email)      | High        | Encrypted DB   |
| Auth sessions (JWT cookies)      | High        | Browser cookie |
| Payment intents (Asaas)          | High        | DB + 3p        |
| Audit log (`audit_log` table)    | High        | DB (immutable) |
| Service-role key                 | Critical    | Vercel env     |
| Encryption key (AES-GCM)         | Critical    | Vercel env     |
| ClickSign / Asaas API keys       | High        | Vercel env     |
| Order metadata                   | Medium      | DB             |
| Public catalog                   | Low         | DB             |

### 1.3 Actors

| Actor               | Trust   | Channel               |
| ------------------- | ------- | --------------------- |
| Anonymous visitor   | Low     | HTTPS (rate-limited)  |
| Pharmacy operator   | Medium  | Authenticated session |
| Clinic operator     | Medium  | Authenticated session |
| Doctor (prescriber) | Medium  | Authenticated session |
| Super-admin         | High    | Authenticated session |
| Cron worker         | High    | `CRON_SECRET` bearer  |
| Asaas / ClickSign   | Medium  | Webhook + HMAC sig    |
| Sentry / Vercel     | Medium  | Outbound only         |
| Attacker            | Hostile | Any                   |

## 2. STRIDE per critical data flow

Notation: **S**poofing · **T**ampering · **R**epudiation ·
**I**nformation disclosure · **D**enial of service · **E**levation of
privilege.

### 2.1 Login + session establishment

| Threat                                         | Vector                            | Severity | Mitigation (file/control)                                                                                      | Status |
| ---------------------------------------------- | --------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------- | --- |
| **S** Credential stuffing                      | Public `/api/auth/sign-in`        | High     | Rate-limit Redis (`lib/rate-limit.ts`), Supabase Auth lockout, audit log on failure                            | OK     |
| **S** Session token theft via XSS              | Inline script, npm dep compromise | High     | CSP nonce-only (`middleware.ts`), `HttpOnly` cookies, Trivy + CodeQL + npm audit + `tootallnate/once` accepted | OK     |
| **T** CSRF on state-changing API               | Cross-origin form post            | High     | `lib/security/csrf.ts` Origin/Referer + double-submit (env-gated), `SameSite=Lax` cookie default               | OK     |
| **R** User denies action                       | Lost audit trail                  | Medium   | `audit_logs` chained-hash table (`supabase/migrations/046_audit_hash_chain.sql`)                               | OK     |
| **I** Session fixation post-login              | Reused JWT after auth             | Medium   | Supabase rotates JWT on sign-in; we never echo it server-side                                                  | OK     |
| **D** Login flood                              | Bot army                          | Medium   | Edge rate-limit on `/api/auth/*`, Cloudflare-style 429, Sentry alert on surge                                  | OK     |
| **E** Anonymous access to authenticated routes | Bypass middleware                 | High     | `middleware.ts` matcher covers `/(?!api                                                                        | \_next | public)`, Supabase RLS as second layer | OK  |

### 2.2 Prescription upload + OCR

| Threat                                     | Vector                     | Severity | Mitigation                                                                                                | Status |
| ------------------------------------------ | -------------------------- | -------- | --------------------------------------------------------------------------------------------------------- | ------ |
| **S** Pharmacy uploads on behalf of clinic | Forged user_id in API call | High     | RLS `prescription_uploads` policy + server enforces `auth.uid()` mapping                                  | OK     |
| **T** Tampered PDF after OCR               | Storage object replaced    | High     | Storage bucket signed read-URLs, OCR result is stored hashed (`document_review.ts`)                       | OK     |
| **I** Cross-tenant prescription leak       | RLS misconfig              | Critical | RLS canary daily (`lib/rls-canary.ts`), test matrix in `tests/unit/rls.test.ts`                           | OK     |
| **I** OCR vendor leak                      | 3p sees raw prescription   | High     | OCR is local-first (Tesseract); Cloud OCR fallback only with explicit feature-flag and DPA-bound provider | OK     |
| **D** Storage bandwidth exhaustion         | Massive file upload        | Medium   | 10 MB body limit (`next.config.ts`), per-user upload counter in Redis                                     | OK     |

### 2.3 Order lifecycle

| Threat                                    | Vector                      | Severity | Mitigation                                                                      | Status |
| ----------------------------------------- | --------------------------- | -------- | ------------------------------------------------------------------------------- | ------ |
| **T** Status downgrade by malicious actor | API call with crafted state | High     | Service layer enforces state machine (`services/orders.ts`), transitions logged | OK     |
| **R** Pharmacy denies receipt             | "Never received the order"  | Medium   | Realtime updater + audit chain + ClickSign signed acknowledgement               | OK     |
| **I** Open-redirect via order URL         | `?next=//evil.com`          | Medium   | `lib/security/redirects.ts` allowlist                                           | OK     |
| **D** Stuck-order purge race              | Concurrent cron + manual    | Medium   | Distributed cron lock (`lib/cron/guarded.ts`)                                   | OK     |
| **E** Pharmacy escalates to admin         | Role spoofing               | High     | RBAC matrix in `lib/rbac.ts` + RLS, super-admin actions in audit log            | OK     |

### 2.4 Payment + webhooks

| Threat                          | Vector                       | Severity | Mitigation                                                         | Status |
| ------------------------------- | ---------------------------- | -------- | ------------------------------------------------------------------ | ------ |
| **S** Forged Asaas webhook      | Spoofed `POST /api/webhooks` | Critical | HMAC-SHA256 verification, `webhook_events` dedup, IP allowlist     | OK     |
| **T** Replay of legitimate hook | Re-sent old payload          | High     | `dedup.ts` on `received_at + signature`, idempotency keys          | OK     |
| **R** Asaas refund disputed     | "We didn't charge"           | Medium   | Asaas-side audit + our `audit_log` mirror                          | OK     |
| **I** Asaas key leak            | Repo / log exposure          | High     | Logger PII redaction includes `api_key`, secrets pulled at runtime | OK     |
| **D** Webhook flood             | Asaas burst on outage        | Medium   | Backlog queue + circuit breaker (`lib/circuit-breaker.ts`)         | OK     |

### 2.5 Cron jobs

| Threat                          | Vector                   | Severity | Mitigation                                          | Status |
| ------------------------------- | ------------------------ | -------- | --------------------------------------------------- | ------ |
| **S** Unauthenticated cron call | Public POST to /api/cron | High     | `CRON_SECRET` bearer + `safeEqualString`            | OK     |
| **D** Duplicate executions      | Vercel + manual trigger  | Medium   | Redis-backed distributed lock                       | OK     |
| **R** Silent failure            | Job fails without alert  | Medium   | `cron_runs` table + freshness in `/api/health/deep` | OK     |

## 3. Privacy threats (LINDDUN overlay)

| Threat                                  | Mitigation                                                            | Status |
| --------------------------------------- | --------------------------------------------------------------------- | ------ |
| **L**inkability across tenants          | RLS isolation + canary; `audit_log.actor_id` not exposed cross-tenant | OK     |
| **I**dentifiability of prescription PII | Field-level AES-GCM, key rotation tiers                               | OK     |
| **N**on-repudiation gaps                | Chained-hash audit log                                                | OK     |
| **D**etectability of holds              | Legal-hold table separated from audit                                 | OK     |
| **D**isclosure of information           | Logger redactor (CPF/CNPJ/email/phone/JWT/Bearer)                     | OK     |
| Content-**U**nawareness                 | Privacy policy + DPO endpoint (`/dpo`)                                | OK     |
| **N**on-compliance with policy          | DPA versioning (clinics + pharmacies), retention cron                 | OK     |

## 4. Out-of-scope (explicit)

These are **acknowledged risks the platform does not currently defend
against**, with rationale:

- **Stolen device of a logged-in admin**. Mitigation is end-user MFA +
  short-lived sessions; we recommend MFA but do not enforce it. Review
  trigger: first time we onboard a customer with > 50 admins or first
  audit finding.
- **Insider threat at Vercel/Supabase**. We trust SOC-2 and DPA controls;
  defence is encryption-at-rest by Supabase + ours layered on top.
- **Sophisticated supply-chain attack on a transitive dep with no CVE**.
  Defended by SBOM publication + license check, but a 0-day in a tier-3
  dep is residual risk.
- **DDoS at Vercel Edge**. Vercel handles L3/L4; we handle L7 rate
  limiting only. Promotion path: Cloudflare-front + WAF when budget allows.

## 5. Re-review triggers

This document **must** be revisited whenever any of the following happens:

1. New external integration (payment processor, OCR vendor, signing
   provider, mailer, SMS).
2. New persisted PII field, or change to retention period of an existing
   field.
3. New privileged role (anything with bypass-RLS capability).
4. Any incident with severity ≥ Medium that exposed a gap in this model.
5. Architectural changes (e.g. moving from monolithic Next.js to split
   front/back).
6. Quarterly cadence (calendar reminder).

## 6. Sign-off log

| Date       | Reviewer   | Notes                                            |
| ---------- | ---------- | ------------------------------------------------ |
| 2026-04-18 | Engenharia | Initial publication, paired with self-audit ASVS |
