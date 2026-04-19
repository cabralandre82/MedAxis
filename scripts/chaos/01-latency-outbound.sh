#!/usr/bin/env bash
# Chaos scenario #1 — outbound HTTP latency injection.
#
# Goal: validate that downstream services (Asaas, Clicksign, Resend,
# Zenvia) being slow does NOT cascade into request failures or
# circuit-breaker thrashing — the timeouts in `fetchWithTrace`
# (default 10s) plus the per-provider circuit breaker (lib/circuit-breaker.ts)
# should keep the user-facing path responsive.
#
# Default scenario:
#   • target: outbound:asaas
#   • inject p=0.3 latency in [200, 800] ms
#   • duration: 10 minutes
#   • SLO: p95 organic latency must stay under 1500 ms,
#     circuit breaker must NOT open more than once.
#
# Usage:
#   CHAOS_TARGET_ENV=preview \
#   CHAOS_BASE_URL=https://preview-xyz.vercel.app \
#   CHAOS_DRY_RUN=0 \
#     ./scripts/chaos/01-latency-outbound.sh
#
# Always start in DRY-RUN to validate the runbook:
#   ./scripts/chaos/01-latency-outbound.sh

source "$(dirname "$0")/_safety.sh"
require_target_env

start_timer
chaos_step "Snapshot baseline health & chaos state"
snapshot_health baseline
snapshot_chaos_state before

chaos_step "Arm chaos: outbound latency"
chaos_run vercel env add CHAOS_ENABLED true "$CHAOS_TARGET_ENV"
chaos_run vercel env add CHAOS_TARGETS outbound:asaas "$CHAOS_TARGET_ENV"
chaos_run vercel env add CHAOS_LATENCY_MS_MIN 200 "$CHAOS_TARGET_ENV"
chaos_run vercel env add CHAOS_LATENCY_MS_MAX 800 "$CHAOS_TARGET_ENV"
chaos_run vercel env add CHAOS_LATENCY_RATE 0.3 "$CHAOS_TARGET_ENV"
if [[ "$CHAOS_TARGET_ENV" == "production" ]]; then
  chaos_run vercel env add CHAOS_ALLOW_PROD true "$CHAOS_TARGET_ENV"
fi

chaos_step "Trigger redeploy so env vars take effect"
chaos_run vercel deploy --prebuilt --target "$CHAOS_TARGET_ENV"
snapshot_chaos_state armed

chaos_step "Drive synthetic load (10 min)"
chaos_run k6 run --duration 10m \
  -e BASE_URL="$CHAOS_BASE_URL" \
  tests/load/realistic-workload.js \
  || chaos_log "k6 exited non-zero (acceptable: degraded path)"

chaos_step "Snapshot health under chaos"
snapshot_health under-chaos
snapshot_chaos_state during

chaos_step "Disarm chaos"
chaos_run vercel env rm CHAOS_ENABLED "$CHAOS_TARGET_ENV" --yes
chaos_run vercel env rm CHAOS_TARGETS "$CHAOS_TARGET_ENV" --yes
chaos_run vercel env rm CHAOS_LATENCY_MS_MIN "$CHAOS_TARGET_ENV" --yes
chaos_run vercel env rm CHAOS_LATENCY_MS_MAX "$CHAOS_TARGET_ENV" --yes
chaos_run vercel env rm CHAOS_LATENCY_RATE "$CHAOS_TARGET_ENV" --yes
chaos_run vercel deploy --prebuilt --target "$CHAOS_TARGET_ENV"
snapshot_chaos_state after

chaos_step "Snapshot recovery health"
sleep 30
snapshot_health recovery

stop_timer "01-latency-outbound"
chaos_log "Scenario complete. Compare baseline ↔ under-chaos ↔ recovery in $CHAOS_EVIDENCE_DIR"
