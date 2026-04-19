#!/usr/bin/env bash
# DR Drill — Cenário 4: Audit log tampering detection.
#
# Pre-condition: BASE_URL apontando para STAGING.
#
# What it does:
#   1. Captura último seq do audit_log.
#   2. (MANUAL) tampera 1 linha via SQL direto no staging.
#   3. Aciona o cron de verificação (/api/cron/verify-audit-chain).
#   4. Confirma que o alerta foi disparado (Sentry, log).
#   5. Restaura a linha tamperada.

source "$(dirname "$0")/_safety.sh"
require_staging
ensure_evidence_dir

dr_log "===== Cenário 4: Audit chain tamper detection ====="

dr_log "Step 1: get current audit_log max(seq)"
cat > "${DR_EVIDENCE_DIR}/04-pre-tamper.sql" <<'SQL'
SELECT max(seq), max(created_at), count(*) FROM audit_log;
-- Pick a row that is at least 24h old to avoid disrupting recent operations:
SELECT seq, created_at, action, actor_id, hash
FROM audit_log
WHERE created_at < now() - interval '1 day'
ORDER BY created_at DESC
LIMIT 5;
SQL

dr_log "  (execute the SQL above and pick a row id to tamper)"
tabletop_pause "Press Enter when ready... "

start_timer

dr_log "Step 2: MANUAL — tamper the row"
dr_log "  Example SQL (REPLACE 12345 with your chosen seq):"
dr_log "    UPDATE audit_log SET action='TAMPERED' WHERE seq=12345;"
tabletop_run psql staging -c "UPDATE audit_log SET action='TAMPERED' WHERE seq=12345"
tabletop_pause "Press Enter when tamper is applied... "

dr_log "Step 3: trigger verification cron"
if [[ "$TABLETOP" == "1" ]]; then
  cat > "${DR_EVIDENCE_DIR}/04-verify-response.json" <<'EOF'
{"ok":false,"chain_break":true,"first_invalid_seq":12345,"detected_at":"TABLETOP","alert_sent":true}
EOF
  code=200
  dr_log "  /api/cron/verify-audit-chain → HTTP ${code} (TABLETOP synthetic)"
else
  code=$(curl -s -o "${DR_EVIDENCE_DIR}/04-verify-response.json" \
    -w "%{http_code}" \
    -H "x-cron-token: ${CRON_TOKEN:-}" \
    "${BASE_URL}/api/cron/verify-audit-chain")
  dr_log "  /api/cron/verify-audit-chain → HTTP ${code}"
fi

if grep -q '"ok":false\|chain_break\|tampered' "${DR_EVIDENCE_DIR}/04-verify-response.json"; then
  stop_timer "04-tamper-detection"
  dr_log "✅ Tamper DETECTED — alerting fired"
else
  dr_log "❌ Tamper NOT detected — investigate the chain verifier"
  exit 1
fi

dr_log "Step 4: MANUAL — restore the row"
dr_log "  UPDATE audit_log SET action='<original>' WHERE seq=12345;"
tabletop_run psql staging -c "UPDATE audit_log SET action='<original>' WHERE seq=12345"
tabletop_pause "Press Enter when restored... "

dr_log "Step 5: re-verify"
if [[ "$TABLETOP" == "1" ]]; then
  echo '{"ok":true,"chain_intact":true,"verified_at":"TABLETOP"}' \
    > "${DR_EVIDENCE_DIR}/04-verify-after.json"
else
  curl -s -H "x-cron-token: ${CRON_TOKEN:-}" \
    "${BASE_URL}/api/cron/verify-audit-chain" \
    > "${DR_EVIDENCE_DIR}/04-verify-after.json"
fi

dr_log "===== Cenário 4: COMPLETE ====="
