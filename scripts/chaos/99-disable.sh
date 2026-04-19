#!/usr/bin/env bash
# Chaos emergency-disable — strips ALL chaos env vars and triggers
# a redeploy. Use this when:
#
#   • a game-day overran its planned window
#   • a real incident is happening and you want chaos OFF immediately
#   • you forgot which scenario you ran last and want a clean slate
#
# Idempotent: missing env vars are silently skipped.
#
# Usage:
#   CHAOS_TARGET_ENV=preview ./scripts/chaos/99-disable.sh
#   CHAOS_TARGET_ENV=staging ./scripts/chaos/99-disable.sh
#
# For production:
#   CHAOS_TARGET_ENV=production \
#   CHAOS_PROD_ACK=yes-i-am-on-call-and-have-paged-the-team \
#     ./scripts/chaos/99-disable.sh

source "$(dirname "$0")/_safety.sh"

# Allow this script to bypass DRY-RUN — disabling chaos must always
# work, dry-run mode included. The --yes on `vercel env rm` makes it
# idempotent against missing keys (Vercel CLI returns 1 if the var
# doesn't exist; we tolerate that).
CHAOS_DRY_RUN=0
require_target_env

start_timer
chaos_step "Stripping all chaos env vars from $CHAOS_TARGET_ENV"
for key in \
  CHAOS_ENABLED \
  CHAOS_ALLOW_PROD \
  CHAOS_TARGETS \
  CHAOS_LATENCY_MS_MIN \
  CHAOS_LATENCY_MS_MAX \
  CHAOS_LATENCY_RATE \
  CHAOS_ERROR_RATE \
  CHAOS_ERROR_KIND \
  CHAOS_SEED
do
  vercel env rm "$key" "$CHAOS_TARGET_ENV" --yes 2>/dev/null || \
    chaos_log "  (skip) $key not set in $CHAOS_TARGET_ENV"
done

chaos_step "Triggering redeploy so the runtime picks up the cleared env"
vercel deploy --prebuilt --target "$CHAOS_TARGET_ENV"

snapshot_chaos_state disabled
stop_timer "99-disable"
chaos_log "Chaos disarmed in $CHAOS_TARGET_ENV. Verify state-disabled-*.json shows enabled=false."
