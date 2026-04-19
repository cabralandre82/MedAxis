#!/usr/bin/env bash
# DR Drill — Cenário 1: Simulação de DB Supabase indisponível.
#
# Pre-condition:
#   - BASE_URL apontando para STAGING.
#   - DR_DRILL_CONFIRM=yes-i-am-on-staging
#   - Acesso ao Vercel CLI (`vercel env`) com permissão.
#
# What it does:
#   1. Captura snapshot de saúde inicial.
#   2. Remove SUPABASE_SERVICE_ROLE_KEY no Vercel staging (rename → _BACKUP).
#   3. Force redeploy.
#   4. Monitora /api/health até detectar `database.ok=false` (timer detect).
#   5. Aguarda intervenção humana (Enter para restaurar).
#   6. Restaura a env var e força redeploy.
#   7. Aguarda /api/health voltar a 200 (timer recover).

source "$(dirname "$0")/_safety.sh"
require_staging
ensure_evidence_dir

dr_log "===== Cenário 1: DB outage simulation ====="

if [[ "$TABLETOP" == "1" ]]; then
  TABLETOP_SYNTHETIC_BODY='{"status":"ok","database":{"ok":true},"timestamp":"'$(date -Iseconds)'"}' \
    tabletop_curl "GET /api/health (baseline)" -sS "${BASE_URL}/api/health" \
    > "${DR_EVIDENCE_DIR}/health-before-$(date +%H%M%S).json"
else
  snapshot_health "before"
fi

dr_log "Step 1: rename SUPABASE_SERVICE_ROLE_KEY → SUPABASE_SERVICE_ROLE_KEY_BACKUP on Vercel staging"
tabletop_run vercel env rm SUPABASE_SERVICE_ROLE_KEY staging
tabletop_pause "Press Enter when env var was renamed and redeploy completed... "

start_timer
dr_log "Step 2: polling /api/health for database.ok=false (max 5min)"

DETECTED=0
for i in $(seq 1 60); do
  if [[ "$TABLETOP" == "1" ]]; then
    status='{"database":{"ok":false},"tabletop":true}'
  else
    status=$(curl -sS "${BASE_URL}/api/health" || echo "{}")
  fi
  if echo "$status" | grep -q '"database":{[^}]*"ok":false'; then
    DETECTED=1
    stop_timer "01-detect-db-outage"
    dr_log "✅ Detected DB outage on poll #$i"
    break
  fi
  sleep 5
done

if [[ $DETECTED -eq 0 ]]; then
  dr_log "❌ Did not detect DB outage in 5 min — check Vercel env propagation"
  exit 1
fi

if [[ "$TABLETOP" == "1" ]]; then
  TABLETOP_SYNTHETIC_BODY='{"status":"degraded","database":{"ok":false},"timestamp":"'$(date -Iseconds)'"}' \
    tabletop_curl "GET /api/health (during outage)" -sS "${BASE_URL}/api/health" \
    > "${DR_EVIDENCE_DIR}/health-during-outage-$(date +%H%M%S).json"
else
  snapshot_health "during-outage"
fi

dr_log "Step 3: restore SUPABASE_SERVICE_ROLE_KEY on Vercel"
tabletop_run vercel env add SUPABASE_SERVICE_ROLE_KEY staging
tabletop_pause "Press Enter when env var restored and redeploy started... "

start_timer
dr_log "Step 4: polling /api/health for database.ok=true (max 10min)"

RECOVERED=0
for i in $(seq 1 120); do
  if [[ "$TABLETOP" == "1" ]]; then
    status='{"database":{"ok":true},"tabletop":true}'
  else
    status=$(curl -sS "${BASE_URL}/api/health" || echo "{}")
  fi
  if echo "$status" | grep -q '"database":{[^}]*"ok":true'; then
    RECOVERED=1
    stop_timer "01-recover-db-outage"
    dr_log "✅ DB recovered on poll #$i"
    break
  fi
  sleep 5
done

if [[ $RECOVERED -eq 0 ]]; then
  dr_log "❌ DB did not recover in 10 min"
  exit 2
fi

if [[ "$TABLETOP" == "1" ]]; then
  TABLETOP_SYNTHETIC_BODY='{"status":"ok","database":{"ok":true},"timestamp":"'$(date -Iseconds)'"}' \
    tabletop_curl "GET /api/health (after recovery)" -sS "${BASE_URL}/api/health" \
    > "${DR_EVIDENCE_DIR}/health-after-$(date +%H%M%S).json"
else
  snapshot_health "after"
fi
dr_log "===== Cenário 1: COMPLETE ====="
