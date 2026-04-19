#!/usr/bin/env bash
# DR Drill — Cenário 2: Secret comprometido → rotação automática.
#
# Pre-condition:
#   - BASE_URL apontando para STAGING.
#   - Acesso ao manifesto de segredos (lib/secrets/*) configurado.
#
# What it does:
#   1. Captura estado inicial do manifest (npm run secrets:status).
#   2. Marca uma chave como "compromised" via npm script.
#   3. Dispara rotação (npm run secrets:rotate).
#   4. Verifica integridade do hash chain (npm run secrets:verify-chain).
#   5. Smoke test em endpoints críticos.

source "$(dirname "$0")/_safety.sh"
require_staging
ensure_evidence_dir

dr_log "===== Cenário 2: Secret leak simulation ====="
start_timer

dr_log "Step 1: capturing manifest state BEFORE rotation"
if [[ "$TABLETOP" == "1" ]]; then
  cat > "${DR_EVIDENCE_DIR}/manifest-before.txt" <<EOF
TABLETOP — synthetic manifest snapshot
secrets:
  ENCRYPTION_KEY:
    last_rotated_at: 2026-04-04T00:00:00Z
    next_rotation_at: 2026-04-18T00:00:00Z
    classification: critical
    chain_seq: 42
    chain_hash: sha256:beef...cafe
EOF
else
  npm run --silent secrets:status > "${DR_EVIDENCE_DIR}/manifest-before.txt" 2>&1 || true
fi

dr_log "Step 2: marking ENCRYPTION_KEY as compromised"
tabletop_run npm run --silent secrets:mark-compromised -- ENCRYPTION_KEY
if [[ "$TABLETOP" == "1" ]]; then
  echo "TABLETOP — would mark ENCRYPTION_KEY as compromised in manifest" \
    > "${DR_EVIDENCE_DIR}/mark-compromised.txt"
fi

dr_log "Step 3: triggering rotation (dry-run)"
if [[ "$TABLETOP" == "1" ]]; then
  cat > "${DR_EVIDENCE_DIR}/rotation-dry-run.txt" <<EOF
TABLETOP — synthetic dry-run output
[secrets:rotate] target=ENCRYPTION_KEY
[secrets:rotate] generating new value (32 bytes from /dev/urandom)
[secrets:rotate] would update Vercel env (project=clinipharma-staging)
[secrets:rotate] would append manifest entry seq=43, parent_hash=sha256:beef...cafe
[secrets:rotate] DRY-RUN: no side effects
EOF
else
  npm run --silent secrets:rotate -- --dry-run \
    > "${DR_EVIDENCE_DIR}/rotation-dry-run.txt" 2>&1
fi
dr_log "  (dry-run output saved; for real rotation in drill, remove --dry-run)"

dr_log "Step 4: verifying hash chain integrity"
if [[ "$TABLETOP" == "1" ]]; then
  echo "TABLETOP — synthetic hash chain verification: OK (42 entries verified, head=sha256:beef...cafe)" \
    > "${DR_EVIDENCE_DIR}/verify-chain.txt"
  dr_log "✅ Hash chain integrity OK (synthetic)"
elif npm run --silent secrets:verify-chain > "${DR_EVIDENCE_DIR}/verify-chain.txt" 2>&1; then
  dr_log "✅ Hash chain integrity OK"
else
  dr_log "❌ Hash chain BROKEN — open audit-chain-tampered runbook"
  stop_timer "02-secret-leak-FAILED"
  exit 1
fi

dr_log "Step 5: smoke test"
for ep in /api/health /api/health/deep; do
  if [[ "$TABLETOP" == "1" ]]; then
    code=200
    dr_log "  ${ep} → HTTP ${code} (TABLETOP synthetic)"
  else
    code=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}${ep}")
    dr_log "  ${ep} → HTTP ${code}"
    if [[ "$code" != "200" ]] && [[ "$code" != "503" ]]; then
      dr_log "❌ Unexpected status from ${ep}"
      exit 2
    fi
  fi
done

stop_timer "02-secret-leak-recovery"
dr_log "===== Cenário 2: COMPLETE ====="
