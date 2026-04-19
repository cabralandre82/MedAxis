#!/usr/bin/env bash
# DR Drill — Cenário 3: Restore de backup PITR (Supabase).
#
# This is a documentation-only script. The actual restore is performed
# from the Supabase dashboard (PITR — Point-in-Time Recovery), since
# automating that would require credentials we explicitly DO NOT want
# in scripts. This script captures evidence and validates pre/post.
#
# Pre-condition:
#   - BASE_URL apontando para STAGING.
#   - Snapshot recente disponível no Supabase staging.

source "$(dirname "$0")/_safety.sh"
require_staging
ensure_evidence_dir

dr_log "===== Cenário 3: Backup restore drill ====="

dr_log "Step 1: capture pre-state — counts of key tables"
cat > "${DR_EVIDENCE_DIR}/pre-counts.sql" <<'SQL'
SELECT 'orders' AS t, count(*) FROM orders
UNION ALL SELECT 'audit_log', count(*) FROM audit_log
UNION ALL SELECT 'users', count(*) FROM users
UNION ALL SELECT 'order_items', count(*) FROM order_items;
SQL

if [[ "$TABLETOP" == "1" ]]; then
  cat > "${DR_EVIDENCE_DIR}/pre-counts.txt" <<'EOF'
TABLETOP — synthetic pre-restore counts
 t           | count
-------------+-------
 orders      |  1438
 audit_log   | 28931
 users       |   217
 order_items |  4392
EOF
fi

dr_log "  (run the SQL above against staging; save output as pre-counts.txt)"
tabletop_pause "Press Enter when pre-counts.txt is saved... "

start_timer

dr_log "Step 2: MANUAL — perform PITR via Supabase dashboard"
dr_log "  Target time: $(date -u -Iseconds -d '5 minutes ago')"
dr_log "  Console: https://supabase.com/dashboard/project/<staging-project-id>/database/backups"
tabletop_pause "Press Enter when restore starts... "

dr_log "Step 3: polling /api/health for database.ok=true"
RECOVERED=0
for i in $(seq 1 180); do
  if [[ "$TABLETOP" == "1" ]]; then
    status='{"database":{"ok":true},"tabletop":true}'
  else
    status=$(curl -sS "${BASE_URL}/api/health" || echo "{}")
  fi
  if echo "$status" | grep -q '"database":{[^}]*"ok":true'; then
    RECOVERED=1
    stop_timer "03-restore-recovery"
    dr_log "✅ DB healthy after restore (poll #$i)"
    break
  fi
  sleep 10
done

if [[ $RECOVERED -eq 0 ]]; then
  dr_log "❌ DB did not recover in 30 min"
  exit 1
fi

dr_log "Step 4: capture post-counts — compare with pre-counts.txt for RPO"
if [[ "$TABLETOP" == "1" ]]; then
  cat > "${DR_EVIDENCE_DIR}/post-counts.txt" <<'EOF'
TABLETOP — synthetic post-restore counts (PITR target: T-5min)
 t           | count
-------------+-------
 orders      |  1437   (−1 vs pre, RPO ≈ 4 min)
 audit_log   | 28929   (−2 vs pre)
 users       |   217   (=)
 order_items |  4391   (−1 vs pre)
EOF
fi
tabletop_pause "Press Enter when post-counts.txt is saved... "

dr_log "Step 5: hash chain verification"
if [[ "$TABLETOP" == "1" ]]; then
  echo "TABLETOP — synthetic chain verification after restore: OK with 2-row gap (expected after PITR)" \
    > "${DR_EVIDENCE_DIR}/post-restore-chain.txt"
  dr_log "✅ Audit chain integrity OK (synthetic, 2-row gap documented)"
elif npm run --silent audit:verify-chain > "${DR_EVIDENCE_DIR}/post-restore-chain.txt" 2>&1; then
  dr_log "✅ Audit chain integrity OK"
else
  dr_log "⚠️  Audit chain has gaps after restore — expected, document the diff"
fi

dr_log "===== Cenário 3: COMPLETE ====="
dr_log "Compare pre-counts.txt vs post-counts.txt to compute RPO."
