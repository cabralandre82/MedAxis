#!/usr/bin/env bash
# Safety helpers for chaos game-day scripts.
# Source this file at the top of every chaos/*.sh script:
#
#   source "$(dirname "$0")/_safety.sh"
#   require_target_env
#   chaos_step "Inject 200ms outbound latency on asaas"
#   ...
#
# Same DRY-RUN-by-default philosophy as scripts/dr/_safety.sh —
# without an explicit opt-in chaos toolkit only PRINTS what it would
# do. Three overlapping safety nets keep production safe:
#
#   1. CHAOS_DRY_RUN=1 (default): nothing is shipped to the runtime.
#      All `vercel env add` / `vercel env rm` / `curl` POSTs are
#      logged with their full args.
#   2. CHAOS_TARGET_ENV must be set to one of: preview, staging.
#      The literal string "production" is REJECTED unless
#      CHAOS_PROD_ACK=yes-i-am-on-call-and-have-paged-the-team is
#      ALSO present.
#   3. CHAOS_BASE_URL must NOT match the production hostname unless
#      the prod-ack envelope above is set.
#
# Even with all three, the runtime keeps a 4th interlock:
# `CHAOS_ALLOW_PROD=true` must be set in the deployed env vars.
# So a typo in any single layer fails safe.

set -euo pipefail

CHAOS_DRY_RUN="${CHAOS_DRY_RUN:-1}"
CHAOS_TARGET_ENV="${CHAOS_TARGET_ENV:-}"
CHAOS_BASE_URL="${CHAOS_BASE_URL:-}"
CHAOS_PROD_ACK="${CHAOS_PROD_ACK:-}"
CHAOS_EVIDENCE_DIR="${CHAOS_EVIDENCE_DIR:-./docs/security/chaos-evidence/$(date +%Y-%m-%d)}"

# --- guards ---------------------------------------------------------------

require_target_env() {
  if [[ "$CHAOS_DRY_RUN" == "1" ]]; then
    : "${CHAOS_BASE_URL:=http://chaos.local.invalid}"
    : "${CHAOS_TARGET_ENV:=dry-run}"
    echo "🟡 CHAOS DRY-RUN — nothing will be applied to a real runtime."
    echo "   To execute against staging/preview, set CHAOS_DRY_RUN=0,"
    echo "   CHAOS_TARGET_ENV=preview|staging and CHAOS_BASE_URL=<url>."
    return 0
  fi

  if [[ -z "$CHAOS_TARGET_ENV" ]]; then
    echo "❌ ABORT: CHAOS_TARGET_ENV must be set (preview|staging|production)." >&2
    exit 90
  fi

  if [[ "$CHAOS_TARGET_ENV" == "production" ]]; then
    if [[ "$CHAOS_PROD_ACK" != "yes-i-am-on-call-and-have-paged-the-team" ]]; then
      echo "❌ ABORT: production game-day requires CHAOS_PROD_ACK=" >&2
      echo "        yes-i-am-on-call-and-have-paged-the-team" >&2
      exit 91
    fi
    echo "🔴 PRODUCTION game-day acknowledged — proceed with extreme care."
  fi

  if [[ -z "$CHAOS_BASE_URL" ]]; then
    echo "❌ ABORT: CHAOS_BASE_URL must be set." >&2
    exit 92
  fi

  if [[ "$CHAOS_BASE_URL" == *"clinipharma.com.br"* ]] && \
     [[ "$CHAOS_BASE_URL" != *"staging"* ]] && \
     [[ "$CHAOS_BASE_URL" != *"preview"* ]] && \
     [[ "$CHAOS_TARGET_ENV" != "production" ]]; then
    echo "❌ ABORT: BASE_URL '$CHAOS_BASE_URL' resembles production but" >&2
    echo "        CHAOS_TARGET_ENV is '$CHAOS_TARGET_ENV'. Refusing." >&2
    exit 93
  fi
}

# --- evidence -------------------------------------------------------------

ensure_evidence_dir() {
  mkdir -p "$CHAOS_EVIDENCE_DIR"
  echo "📂 Evidence dir: $CHAOS_EVIDENCE_DIR"
}

chaos_log() {
  ensure_evidence_dir
  echo "[$(date -Iseconds)] $*" | tee -a "$CHAOS_EVIDENCE_DIR/run.log"
}

chaos_step() {
  echo ""
  echo "──────────────────────────────────────────────────────────────"
  chaos_log "STEP: $*"
  echo "──────────────────────────────────────────────────────────────"
}

# --- runtime helpers ------------------------------------------------------

# Wrap a command with dry-run logging. Use for any side-effecting call:
#   chaos_run vercel env add CHAOS_ENABLED true preview
chaos_run() {
  if [[ "$CHAOS_DRY_RUN" == "1" ]]; then
    chaos_log "🛠️  DRY-RUN — would run: $*"
    return 0
  fi
  chaos_log "▶️  RUN: $*"
  "$@"
}

# Snapshot the chaos state endpoint. Uses CHAOS_AUTH_COOKIE if set.
snapshot_chaos_state() {
  local label="${1:-state}"
  ensure_evidence_dir
  local out="$CHAOS_EVIDENCE_DIR/state-${label}-$(date +%H%M%S).json"
  if [[ "$CHAOS_DRY_RUN" == "1" ]]; then
    chaos_log "🌐 DRY-RUN — would GET ${CHAOS_BASE_URL}/api/chaos/state → $out"
    echo '{"dry_run":true}' > "$out"
    return 0
  fi
  curl -sS "${CHAOS_BASE_URL}/api/chaos/state" \
    -H "cookie: ${CHAOS_AUTH_COOKIE:-}" \
    -o "$out" \
    -w "HTTP %{http_code} in %{time_total}s\n"
}

# Snapshot /api/health for SLO comparison before/during/after.
snapshot_health() {
  local label="${1:-health}"
  ensure_evidence_dir
  local out="$CHAOS_EVIDENCE_DIR/health-${label}-$(date +%H%M%S).json"
  if [[ "$CHAOS_DRY_RUN" == "1" ]]; then
    chaos_log "🌐 DRY-RUN — would GET ${CHAOS_BASE_URL}/api/health → $out"
    echo '{"dry_run":true}' > "$out"
    return 0
  fi
  curl -sS "${CHAOS_BASE_URL}/api/health" -o "$out" \
    -w "HTTP %{http_code} in %{time_total}s\n"
}

# --- timer ----------------------------------------------------------------

CHAOS_TIMER_START=""

start_timer() {
  CHAOS_TIMER_START=$(date +%s)
  chaos_log "⏱️  Timer started"
}

stop_timer() {
  local label="${1:-scenario}"
  local end
  end=$(date +%s)
  local elapsed=$((end - CHAOS_TIMER_START))
  local mins=$((elapsed / 60))
  local secs=$((elapsed % 60))
  chaos_log "⏱️  ${label}: ${mins}m${secs}s (${elapsed}s total)"
  ensure_evidence_dir
  echo "$(date -Iseconds)|${label}|${elapsed}s" >> "$CHAOS_EVIDENCE_DIR/timings.csv"
}
