#!/usr/bin/env bash
# scripts/claims/run-all.sh
# Drives every claim verifier under scripts/claims/, collects results, emits a
# single Markdown summary + JSON bundle. Designed to run weekly in CI.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RESULTS_DIR="$SCRIPT_DIR/.results"

mkdir -p "$RESULTS_DIR"
rm -f "$RESULTS_DIR"/*.json "$RESULTS_DIR"/summary.md 2>/dev/null || true

cd "$REPO_ROOT"

VERIFIERS=(
  "check-skill-structure.sh"
  "check-cross-links.sh"
  "check-cron-claims.mjs"
  "check-feature-flags.mjs"
  "check-invariants.sh"
  "check-metric-emission.mjs"
  "check-skill-trigger-overlap.mjs"
  "check-rls-policy-coverage.mjs"
  "check-env-documented.mjs"
  "check-retention-policies.mjs"
  "check-dsar-sla.mjs"
  "check-cron-scheduled.mjs"
)

EXIT_CODE=0

echo "# Claims audit — $(date -u +"%Y-%m-%d %H:%M UTC")" >"$RESULTS_DIR/summary.md"
echo "" >>"$RESULTS_DIR/summary.md"
echo "| Verifier | Status | Passed | Failed | Warnings |" >>"$RESULTS_DIR/summary.md"
echo "| --- | --- | ---: | ---: | ---: |" >>"$RESULTS_DIR/summary.md"

for script in "${VERIFIERS[@]}"; do
  name="${script%.*}"
  path="$SCRIPT_DIR/$script"

  if [[ ! -x "$path" ]]; then
    echo "::error::verifier $script missing or not executable"
    EXIT_CODE=1
    continue
  fi

  out="$RESULTS_DIR/${name}.json"
  echo "▶ running $script..."

  if "$path" >"$out" 2>"$RESULTS_DIR/${name}.stderr"; then
    status="pass"
  else
    status="fail"
    EXIT_CODE=1
  fi

  if ! node -e "JSON.parse(require('fs').readFileSync('$out','utf8'))" 2>/dev/null; then
    echo "::error::verifier $script produced invalid JSON"
    cat "$RESULTS_DIR/${name}.stderr" >&2 || true
    echo "| $name | **ERROR** | — | — | — |" >>"$RESULTS_DIR/summary.md"
    EXIT_CODE=1
    continue
  fi

  passed=$(node -e "console.log(require('$out').passed ?? 0)")
  failed=$(node -e "console.log(require('$out').failed ?? 0)")
  warnings=$(node -e "console.log(require('$out').warnings ?? 0)")

  icon="✅"
  [[ "$status" == "fail" ]] && icon="❌"
  [[ "$warnings" -gt 0 && "$status" == "pass" ]] && icon="⚠️"

  echo "| $name | $icon | $passed | $failed | $warnings |" >>"$RESULTS_DIR/summary.md"
done

echo "" >>"$RESULTS_DIR/summary.md"
echo "## Findings" >>"$RESULTS_DIR/summary.md"
echo "" >>"$RESULTS_DIR/summary.md"

for script in "${VERIFIERS[@]}"; do
  name="${script%.*}"
  out="$RESULTS_DIR/${name}.json"
  [[ -f "$out" ]] || continue

  node <<NODE >>"$RESULTS_DIR/summary.md"
const r = require('$out');
const findings = r.findings || [];
if (findings.length === 0) process.exit(0);
console.log('### ' + r.name);
console.log();
for (const f of findings) {
  const sev = f.severity || 'info';
  const icon = sev === 'fail' ? '❌' : sev === 'warn' ? '⚠️' : 'ℹ️';
  console.log('- ' + icon + ' **' + (f.claim || '(claim)') + '** — ' + (f.detail || ''));
  if (f.location) console.log('  - \`' + f.location + '\`');
}
console.log();
NODE
done

echo ""
echo "Summary written to $RESULTS_DIR/summary.md"
echo ""
cat "$RESULTS_DIR/summary.md"

exit "$EXIT_CODE"
