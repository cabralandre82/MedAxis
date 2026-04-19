#!/usr/bin/env bash
# Chaos scenario #3 — DB read slowdown.
#
# Goal: validate that read-heavy endpoints (orders list, dashboard,
# audit list) degrade gracefully under DB slowness — that pagination
# limits + the request-level timeout (Next.js default 60s) keep the
# tab usable even when the DB takes 500-1500 ms per query.
#
# Default scenario:
#   • target: db:orders, db:audit_logs
#   • inject p=0.4 latency in [400, 1500] ms
#   • duration: 8 minutes
#   • SLO:
#       - p95 page load on /orders < 4500 ms (1.5s × 3 sequential queries)
#       - no 5xx
#       - no rate-limit violations from worried users smashing F5
#
# IMPORTANT: only `select` and `rpc` ops are injected. Writes (insert/
# update/delete) are exempted at the lib/tracing.ts layer regardless
# of CHAOS_TARGETS, so we cannot accidentally slow a checkout.

source "$(dirname "$0")/_safety.sh"
require_target_env

start_timer
chaos_step "Snapshot baseline"
snapshot_health baseline
snapshot_chaos_state before

chaos_step "Arm chaos: DB read latency"
chaos_run vercel env add CHAOS_ENABLED true "$CHAOS_TARGET_ENV"
chaos_run vercel env add CHAOS_TARGETS "db:orders,db:audit_logs" "$CHAOS_TARGET_ENV"
chaos_run vercel env add CHAOS_LATENCY_MS_MIN 400 "$CHAOS_TARGET_ENV"
chaos_run vercel env add CHAOS_LATENCY_MS_MAX 1500 "$CHAOS_TARGET_ENV"
chaos_run vercel env add CHAOS_LATENCY_RATE 0.4 "$CHAOS_TARGET_ENV"
if [[ "$CHAOS_TARGET_ENV" == "production" ]]; then
  chaos_run vercel env add CHAOS_ALLOW_PROD true "$CHAOS_TARGET_ENV"
fi
chaos_run vercel deploy --prebuilt --target "$CHAOS_TARGET_ENV"
snapshot_chaos_state armed

chaos_step "Drive read-heavy paths (8 min)"
chaos_run k6 run --duration 8m \
  -e BASE_URL="$CHAOS_BASE_URL" \
  tests/load/list-orders.js \
  || chaos_log "k6 exited non-zero (acceptable: degraded)"

snapshot_health under-chaos
snapshot_chaos_state during

chaos_step "Disarm and validate recovery"
chaos_run vercel env rm CHAOS_ENABLED "$CHAOS_TARGET_ENV" --yes
chaos_run vercel env rm CHAOS_TARGETS "$CHAOS_TARGET_ENV" --yes
chaos_run vercel env rm CHAOS_LATENCY_MS_MIN "$CHAOS_TARGET_ENV" --yes
chaos_run vercel env rm CHAOS_LATENCY_MS_MAX "$CHAOS_TARGET_ENV" --yes
chaos_run vercel env rm CHAOS_LATENCY_RATE "$CHAOS_TARGET_ENV" --yes
chaos_run vercel deploy --prebuilt --target "$CHAOS_TARGET_ENV"
sleep 30
snapshot_health recovery
snapshot_chaos_state after

stop_timer "03-db-slowdown"
chaos_log "Scenario complete. Inspect p95 of http_request_duration_ms{route=~\"/orders.*\"}."
