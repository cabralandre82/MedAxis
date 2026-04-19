#!/usr/bin/env bash
# Chaos scenario #2 — outbound HTTP error injection.
#
# Goal: validate that the circuit breaker opens correctly under
# sustained downstream failure AND that retry-with-backoff in the
# Inngest workers does NOT amplify the failure into a thundering herd.
#
# Default scenario:
#   • target: outbound:clicksign
#   • inject p=0.5 network errors (ECONNRESET style)
#   • duration: 5 minutes
#   • SLO:
#       - circuit breaker for clicksign opens within 60s of arming
#       - no payment-confirmation orders get stuck (SLA workflow takes over)
#       - no AuditChainBreak alert fires
#
# Usage:
#   CHAOS_TARGET_ENV=staging \
#   CHAOS_BASE_URL=https://staging.clinipharma.com.br \
#   CHAOS_DRY_RUN=0 \
#     ./scripts/chaos/02-error-rate-outbound.sh

source "$(dirname "$0")/_safety.sh"
require_target_env

start_timer
chaos_step "Snapshot baseline"
snapshot_health baseline
snapshot_chaos_state before

chaos_step "Arm chaos: outbound errors"
chaos_run vercel env add CHAOS_ENABLED true "$CHAOS_TARGET_ENV"
chaos_run vercel env add CHAOS_TARGETS outbound:clicksign "$CHAOS_TARGET_ENV"
chaos_run vercel env add CHAOS_ERROR_RATE 0.5 "$CHAOS_TARGET_ENV"
chaos_run vercel env add CHAOS_ERROR_KIND network "$CHAOS_TARGET_ENV"
if [[ "$CHAOS_TARGET_ENV" == "production" ]]; then
  chaos_run vercel env add CHAOS_ALLOW_PROD true "$CHAOS_TARGET_ENV"
fi
chaos_run vercel deploy --prebuilt --target "$CHAOS_TARGET_ENV"
snapshot_chaos_state armed

chaos_step "Drive contract-signing flows (5 min)"
chaos_run k6 run --duration 5m \
  -e BASE_URL="$CHAOS_BASE_URL" \
  tests/load/realistic-workload.js \
  || chaos_log "k6 exited non-zero (expected: errors)"

snapshot_health under-chaos
snapshot_chaos_state during

chaos_step "Disarm and validate recovery"
chaos_run vercel env rm CHAOS_ENABLED "$CHAOS_TARGET_ENV" --yes
chaos_run vercel env rm CHAOS_TARGETS "$CHAOS_TARGET_ENV" --yes
chaos_run vercel env rm CHAOS_ERROR_RATE "$CHAOS_TARGET_ENV" --yes
chaos_run vercel env rm CHAOS_ERROR_KIND "$CHAOS_TARGET_ENV" --yes
chaos_run vercel deploy --prebuilt --target "$CHAOS_TARGET_ENV"
sleep 60
snapshot_health recovery
snapshot_chaos_state after

stop_timer "02-error-rate-outbound"
chaos_log "Scenario complete. Verify: circuit breaker reopened (closed), no stuck orders."
