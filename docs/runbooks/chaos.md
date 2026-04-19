# Chaos engineering — runbook

> Wave Hardening II — task **#9**.
> Status: **opt-in toolkit** ready for game-days. Default = OFF.
> Owners: SRE / Security WG. Contact: `#sre-oncall` (Slack).

---

## 1. Why this exists

We learned from the DR drill (postmortem `2026-04-18`) that we have
strong _per-component_ defences (circuit breakers, single-flight
locks, audit chain) but very little evidence that they compose well
under realistic, _partial_ failures — the kind of failure that hits
production at 03:00. Chaos engineering closes that loop: instead of
hoping the system is resilient, we prove it on demand.

The toolkit is built to be:

- **Surgical** — no all-region blast; you target one service at a
  time via `CHAOS_TARGETS=outbound:asaas`.
- **Triple-opt-in** for production — env var + ALLOW_PROD flag +
  shell ack string. Any single typo fails safe.
- **Write-safe** — the DB injector refuses to fire on
  `insert | update | delete | upsert`. Atomic write paths
  (`lib/services/atomic.server.ts`) do not import the chaos module
  at all (enforced by `tests/unit/lib/chaos/safety-invariants.test.ts`).
- **Observable** — every injection emits `chaos_injection_total{…}`
  so dashboards can show exactly what the operator did and when.

---

## 2. Mental model

```
              ┌─────────────────┐
   request ──►│  call site      │
              │  fetchWithTrace │
              │  withDbSpan     │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │  chaosTick(     │   ← reads cached ChaosConfig
              │    kind, svc)   │     (env-driven, parsed once)
              └────────┬────────┘
                       │
              ┌────────┴────────┐
              │                 │
              ▼                 ▼
    matchesTarget?     matchesTarget?
    (kind, svc)         (kind, svc)
              │                 │
              ▼                 ▼
    maybeInjectLatency   maybeInjectError
       (sleep)              (throw)
```

`chaosTick()` is the only public surface call sites use. It is a
no-op (sub-microsecond) when:

- chaos is disabled (default), OR
- the requested `(kind, service)` is not in `CHAOS_TARGETS`.

---

## 3. Configuration vocabulary

All toggles are **environment variables**. There is no runtime
flip-the-switch endpoint by design — env-driven config is auditable
in Vercel's deploy log and survives serverless cold-starts in a
known state.

| Variable               | Type                   | Default | Description                                                                                                                                    |
| ---------------------- | ---------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `CHAOS_ENABLED`        | literal `"true"`       | unset   | Master switch. Anything other than the exact string `"true"` is treated as off.                                                                |
| `CHAOS_ALLOW_PROD`     | literal `"true"`       | unset   | **Required** for `CHAOS_ENABLED` to take effect when `NODE_ENV=production` or `VERCEL_ENV=production`.                                         |
| `CHAOS_TARGETS`        | csv of `kind:service`  | empty   | Whitelist of injection points. Wildcards: `outbound:*`, `db:*`. Empty = no targets = no injections.                                            |
| `CHAOS_LATENCY_MS_MIN` | int ≥ 0                | 0       | Minimum injected sleep.                                                                                                                        |
| `CHAOS_LATENCY_MS_MAX` | int ≥ 0                | 0       | Maximum injected sleep. If less than `MIN`, the values are silently swapped.                                                                   |
| `CHAOS_LATENCY_RATE`   | float in [0, 1]        | 0       | Probability per matching call. Out-of-range values are clamped (a typo of `100` becomes `1.0`, never `100×`).                                  |
| `CHAOS_ERROR_RATE`     | float in [0, 1]        | 0       | Probability per matching call.                                                                                                                 |
| `CHAOS_ERROR_KIND`     | `network` \| `timeout` | network | `network` throws an `ECONNRESET`-shaped error; `timeout` throws an `AbortError` (matches what the real fetch timeout produces).                |
| `CHAOS_SEED`           | non-negative integer   | unset   | Optional PRNG seed. **Production should NEVER set this** — leave unset so each call is independently random. Tests use it for reproducibility. |

### Recognised target kinds

| `kind`     | Where it fires                                                                         | Notes                                                                                              |
| ---------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `outbound` | Every call through `fetchWithTrace()` (`lib/trace.ts`)                                 | `service` is the `serviceName` option (or URL host fallback).                                      |
| `db`       | Every call through `withDbSpan()` (`lib/tracing.ts`) where `operation ∈ {select, rpc}` | `service` is the table name. Writes are exempted at the wiring layer.                              |
| `redis`    | Reserved — no wired call sites yet.                                                    | The kind exists in the parser so we can add a wired site later without breaking deployed env vars. |

---

## 4. Game-day flow

The expected loop is **always**: dry-run → preview → staging → (if
ever) production. Every scenario script defaults to dry-run.

### 4.1 Dry-run a scenario locally

```bash
./scripts/chaos/01-latency-outbound.sh
```

Output is purely descriptive — no `vercel env add` or `k6` runs.
Read the log under `docs/security/chaos-evidence/<date>/run.log` and
make sure the env-var manipulations look right.

### 4.2 Run for real against a preview deploy

```bash
CHAOS_DRY_RUN=0 \
CHAOS_TARGET_ENV=preview \
CHAOS_BASE_URL=https://preview-xyz.vercel.app \
  ./scripts/chaos/01-latency-outbound.sh
```

The shell wrapper:

1. snapshots `/api/health` and `/api/chaos/state` (baseline);
2. sets the chaos env vars on the target Vercel environment;
3. triggers a redeploy so the runtime picks them up;
4. drives synthetic load via `k6 run tests/load/realistic-workload.js`;
5. snapshots health again (during chaos);
6. strips the env vars + redeploys (recovery);
7. snapshots health one more time (after).

All four snapshots land in `docs/security/chaos-evidence/<date>/`.
Diff them to validate the SLO.

### 4.3 Production game-day

Triple opt-in, in this exact order:

1. `CHAOS_PROD_ACK=yes-i-am-on-call-and-have-paged-the-team` set in
   the shell.
2. `CHAOS_TARGET_ENV=production` on the script invocation.
3. The script ensures `CHAOS_ALLOW_PROD=true` is also pushed to the
   Vercel environment (otherwise the runtime guard refuses to fire
   even after a successful deploy — defence in depth).

Don't run a production game-day without:

- a war-room ticket open;
- on-call paged and acknowledging on `#sre-oncall`;
- a 30-minute hard timer set for kill-switch.

---

## 5. Kill switch

When in doubt, run:

```bash
CHAOS_TARGET_ENV=preview ./scripts/chaos/99-disable.sh
```

The disable script ignores `CHAOS_DRY_RUN` (it's the one script that
must always actually run) and idempotently strips every chaos env
var, then triggers a redeploy. Verify with the saved
`state-disabled-*.json`:

```json
{ "config": { "enabled": false, "blocked_by_prod": false, … } }
```

If the kill switch itself fails (e.g. Vercel CLI is down), you can
**manually** delete the env vars in the Vercel dashboard and click
"Redeploy" on the latest production deployment. The runtime applies
the change on the next cold start.

---

## 6. Observability

### Metrics

- `chaos_injection_total{kind,service,action}` — every injection.
  `action` ∈ {`latency`, `latency_zero`, `error_network`, `error_timeout`}.
- `chaos_injection_latency_ms{kind,service}` — distribution of
  actual injected sleeps.

### PromQL recipes

Injection rate during the last 5 min, by service:

```promql
sum by (service, action) (rate(chaos_injection_total[5m]))
```

Effective added latency (median):

```promql
histogram_quantile(
  0.5,
  sum by (service, le) (rate(chaos_injection_latency_ms_bucket[5m]))
)
```

Cross-check with the organic outbound histogram to see how much of
the user-visible latency was injected vs real:

```promql
histogram_quantile(0.95,
  sum by (service, le) (rate(http_outbound_duration_ms_bucket[5m])))
- on(service) histogram_quantile(0.5,
  sum by (service, le) (rate(chaos_injection_latency_ms_bucket[5m])))
```

### Admin inspector

`GET /api/chaos/state` returns the parsed configuration. Restricted
to `SUPER_ADMIN` / `PLATFORM_ADMIN`. Useful when you want to
confirm "is chaos currently armed in this environment?" without
reading env vars in the Vercel dashboard.

---

## 7. Wiring sites & blast radius

| Site                                                          | Wired?                         | Blast radius (max)                                                              |
| ------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------- |
| `lib/trace.ts → fetchWithTrace`                               | yes (`outbound`)               | One outbound HTTP per call.                                                     |
| `lib/tracing.ts → withDbSpan(select\|rpc)`                    | yes (`db`)                     | One DB read per call.                                                           |
| `lib/tracing.ts → withDbSpan(insert\|update\|delete\|upsert)` | **no — exempt**                | Writes are NEVER injected. Enforced by safety-invariants test.                  |
| `lib/services/atomic.server.ts`                               | **no — does not import chaos** | Atomic critical-write RPCs untouched. Enforced by safety-invariants test.       |
| `lib/cron/guarded.ts`                                         | not wired                      | Could be added when needed (single-flight lock would protect against re-entry). |

Adding a new wiring site requires:

1. Importing `chaosTick` from `@/lib/chaos/injector`.
2. Calling it with the appropriate `(kind, service)` where the
   injection should fire.
3. Adding the new `kind` (if any) to `lib/chaos/config.ts → KINDS`
   and the safety-invariants test.
4. Documenting the wiring in §7 of this file.

---

## 8. Safety net summary

| Layer                  | What it enforces                                                                     | Where                                           |
| ---------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Env parser             | `CHAOS_ENABLED` must be the literal `"true"` (no truthy strings).                    | `lib/chaos/config.ts → readChaosConfig`         |
| Production interlock   | Env-side: `CHAOS_ALLOW_PROD=true` required when `NODE_ENV=production`.               | `lib/chaos/config.ts`                           |
| Empty-target guard     | An empty `CHAOS_TARGETS` causes `matchesTarget` to always return false (typo guard). | `lib/chaos/config.ts → matchesTarget`           |
| DB write exemption     | `withDbSpan` only calls `chaosTick` for `select` and `rpc`.                          | `lib/tracing.ts`                                |
| Atomic write isolation | `lib/services/atomic.server.ts` has zero imports from `lib/chaos/*`.                 | enforced by safety-invariants test              |
| Shell triple-opt-in    | `CHAOS_TARGET_ENV=production` requires `CHAOS_PROD_ACK=…` ack string.                | `scripts/chaos/_safety.sh → require_target_env` |
| Kill switch            | `99-disable.sh` forces `CHAOS_DRY_RUN=0` so the disarm path always runs.             | `scripts/chaos/99-disable.sh`                   |

A single failure in any one layer must NOT result in a customer
write being touched by chaos. The safety-invariants test would
break red on any change that violates this composition.

---

## 9. Related artifacts

- Code: `lib/chaos/config.ts`, `lib/chaos/injector.ts`,
  `lib/trace.ts` (wired), `lib/tracing.ts` (wired),
  `app/api/chaos/state/route.ts`.
- Scripts: `scripts/chaos/_safety.sh`, `scripts/chaos/01-…`,
  `scripts/chaos/02-…`, `scripts/chaos/03-…`,
  `scripts/chaos/99-disable.sh`.
- Tests: `tests/unit/lib/chaos/config.test.ts` (21),
  `tests/unit/lib/chaos/injector.test.ts` (12),
  `tests/unit/lib/chaos/safety-invariants.test.ts` (9),
  `tests/unit/api/chaos-state.test.ts` (5).
- Metrics: `docs/observability/metrics.md` §3.13.
- Trust Center entry: control **CC-16** in `app/trust/page.tsx`.
- Postmortem context: `docs/security/dr-evidence/2026-04-18/postmortem.md`
  (item G3 — "no chaos toolkit", now closed by this work).

---

## 10. What's NOT in this toolkit (yet)

- **Process-level crashes** (kill -9 a serverless function). Vercel
  doesn't expose that primitive; we'd need self-hosted Kubernetes.
- **Network partitions between services**. Same constraint.
- **Disk full / memory pressure**. Outside Vercel control.
- **Browser-side faults** (slow JS, throttled CPU). Best handled by
  Lighthouse / WebPageTest in CI, not this runtime injector.
- **Schedule-based chaos** (random latency 1× / day). Intentionally
  off — every injection should be a deliberate, observed game-day,
  not a background hum that confuses on-call.
