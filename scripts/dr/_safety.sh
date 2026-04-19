#!/usr/bin/env bash
# Safety helpers for DR drill scripts.
# Source this file at the top of every dr/*.sh script.
#
#   source "$(dirname "$0")/_safety.sh"
#   require_staging
#   start_timer
#   ...
#   stop_timer "scenario-1"
#
# Modes:
#   TABLETOP=1   (default) — non-destructive walkthrough; manual steps and
#                 destructive operations are LOGGED but not executed. Suitable
#                 for runbook validation, classroom exercises and quarterly
#                 drills when no live staging environment is available.
#   DRILL_ENV=staging — REAL execution against staging. Requires:
#                       - BASE_URL pointing at the staging URL
#                       - DR_DRILL_CONFIRM=yes-i-am-on-staging
#                       - Vercel CLI and Supabase staging credentials
#                       - TABLETOP=0 explicitly set

set -euo pipefail

TABLETOP="${TABLETOP:-1}"

# --- guards ---------------------------------------------------------------

require_staging() {
  if [[ "$TABLETOP" == "1" ]]; then
    : "${BASE_URL:=http://staging.local.invalid}"  # placeholder — never resolved in tabletop
    echo "🟡 TABLETOP MODE — destructive steps will be logged, not executed."
    echo "   To run a real drill, set TABLETOP=0 DRILL_ENV=staging and provide credentials."
    return 0
  fi

  : "${BASE_URL:?BASE_URL must be set (use the staging URL)}"
  if [[ "${DRILL_ENV:-}" != "staging" ]]; then
    echo "❌ ABORT: real drill requires DRILL_ENV=staging." >&2
    exit 97
  fi
  if [[ "$BASE_URL" == *"clinipharma.com.br"* ]] && [[ "$BASE_URL" != *"staging"* ]]; then
    echo "❌ ABORT: BASE_URL '$BASE_URL' looks like PRODUCTION." >&2
    echo "   DR drills must run against staging only." >&2
    exit 99
  fi

  if [[ -z "${DR_DRILL_CONFIRM:-}" ]] || [[ "$DR_DRILL_CONFIRM" != "yes-i-am-on-staging" ]]; then
    echo "❌ ABORT: set DR_DRILL_CONFIRM=yes-i-am-on-staging to run." >&2
    exit 98
  fi
}

# --- tabletop helpers -----------------------------------------------------

# Replaces an interactive `read -p` prompt. In TABLETOP, logs the prompt and
# a synthetic "decision time" delay. In real drill, behaves like read.
tabletop_pause() {
  local prompt="${1:-Press Enter to continue...}"
  if [[ "$TABLETOP" == "1" ]]; then
    dr_log "🕒 TABLETOP — would await human action: ${prompt}"
    # Simulate realistic decision/communication latency (1-3s, not 30+ min)
    sleep 1
    return 0
  fi
  read -p "$prompt" -r
}

# Replaces a destructive command (npm script, vercel env unset, SQL update,
# curl POST that mutates state). In TABLETOP, logs intent and returns 0.
tabletop_run() {
  if [[ "$TABLETOP" == "1" ]]; then
    dr_log "🛠️  TABLETOP — would run: $*"
    return 0
  fi
  "$@"
}

# Replaces a curl that polls a real endpoint. In TABLETOP, returns a synthetic
# response in $TABLETOP_SYNTHETIC_BODY (caller can override per-step) and HTTP
# 200. In real drill, executes the actual curl and writes to the file.
tabletop_curl() {
  local description="$1"; shift
  if [[ "$TABLETOP" == "1" ]]; then
    dr_log "🌐 TABLETOP — would curl: ${description}"
    echo "${TABLETOP_SYNTHETIC_BODY:-{\"ok\":true,\"tabletop\":true\}}"
    return 0
  fi
  curl "$@"
}

# --- timer ----------------------------------------------------------------

DR_TIMER_START=""

start_timer() {
  DR_TIMER_START=$(date +%s)
  echo "⏱️  Timer started at $(date -Iseconds)"
}

stop_timer() {
  local label="${1:-scenario}"
  local end
  end=$(date +%s)
  local elapsed=$((end - DR_TIMER_START))
  local mins=$((elapsed / 60))
  local secs=$((elapsed % 60))
  echo "⏱️  ${label}: ${mins}m${secs}s (${elapsed}s total)"
  echo "$(date -Iseconds)|${label}|${elapsed}s" >> "${DR_EVIDENCE_DIR:-./dr-evidence}/timings.csv"
}

# --- evidence -------------------------------------------------------------

ensure_evidence_dir() {
  DR_EVIDENCE_DIR="${DR_EVIDENCE_DIR:-./docs/security/dr-evidence/$(date +%Y-%m-%d)}"
  mkdir -p "$DR_EVIDENCE_DIR"
  echo "📂 Evidence dir: $DR_EVIDENCE_DIR"
}

snapshot_health() {
  local name="${1:-snapshot}"
  ensure_evidence_dir
  curl -sS "${BASE_URL}/api/health" \
    -o "${DR_EVIDENCE_DIR}/health-${name}-$(date +%H%M%S).json" \
    -w "HTTP %{http_code} in %{time_total}s\n"
}

# --- log ------------------------------------------------------------------

dr_log() {
  echo "[$(date -Iseconds)] $*" | tee -a "${DR_EVIDENCE_DIR:-./dr-evidence}/run.log"
}
