#!/usr/bin/env bash
# DR Drill — Cenário 5: Region failure (Vercel/Supabase total outage).
#
# Pre-condition: BASE_URL apontando para STAGING.
#
# This scenario is mostly procedural — most of it is comms and decision
# making. The script captures the timeline and validates fallback states.

source "$(dirname "$0")/_safety.sh"
require_staging
ensure_evidence_dir

dr_log "===== Cenário 5: Region failure drill ====="

start_timer

dr_log "Step 1: confirm scenario via external status pages"
dr_log "  → status.vercel-status.com"
dr_log "  → status.supabase.com"
dr_log "  → status.cloudflare.com"
tabletop_pause "Press Enter when external status confirmed... "

stop_timer "05-confirm-external"

start_timer
dr_log "Step 2: enable Cloudflare Workers fallback page"
dr_log "  (manual — log into Cloudflare dashboard, enable 'maintenance' worker)"
tabletop_run wrangler deploy maintenance-worker --env production
tabletop_pause "Press Enter when fallback live... "
stop_timer "05-fallback-enable"

start_timer
dr_log "Step 3: comms"
dr_log "  - update /status (status.clinipharma.com.br) with 'major outage'"
dr_log "  - send email to all partner ops contacts (template: docs/templates/incident-comms.md)"
dr_log "  - post to internal Slack #incidents channel"
tabletop_pause "Press Enter when comms sent... "
stop_timer "05-comms-sent"

dr_log "Step 4: monitor recovery"
dr_log "  - poll vendor status pages every 5 min"
dr_log "  - check /api/health every 30s once vendor is green"
tabletop_pause "Press Enter when service recovered... "

start_timer
dr_log "Step 5: post-recovery validation"
for ep in /api/health /api/health/deep; do
  if [[ "$TABLETOP" == "1" ]]; then
    code=200
    dr_log "  ${ep} → HTTP ${code} (TABLETOP synthetic)"
  else
    code=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}${ep}")
    dr_log "  ${ep} → HTTP ${code}"
  fi
done

dr_log "  - verify cron jobs resumed (Inngest dashboard)"
dr_log "  - verify queued notifications drained"
dr_log "  - check error rate in Sentry returned to baseline"
stop_timer "05-post-recovery-validation"

dr_log "===== Cenário 5: COMPLETE ====="
