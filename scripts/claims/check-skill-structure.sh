#!/usr/bin/env bash
# scripts/claims/check-skill-structure.sh
# Claim: every .cursor/skills/*/SKILL.md has valid frontmatter (name + description),
# description <= 1024 chars, body < 500 lines, name matches directory.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

node <<'NODE'
const fs = require('fs');
const path = require('path');

const skillsDir = '.cursor/skills';
const findings = [];
let passed = 0;

if (!fs.existsSync(skillsDir)) {
  console.log(JSON.stringify({
    name: 'skill-structure',
    passed: 0, failed: 1, warnings: 0,
    findings: [{ severity: 'fail', claim: 'skills directory exists', detail: `${skillsDir} not found` }]
  }));
  process.exit(1);
}

const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
for (const d of entries) {
  if (!d.isDirectory()) continue;
  const dir = path.join(skillsDir, d.name);
  const skillPath = path.join(dir, 'SKILL.md');

  if (!fs.existsSync(skillPath)) {
    findings.push({ severity: 'fail', claim: 'SKILL.md present', detail: `missing SKILL.md`, location: dir });
    continue;
  }

  const raw = fs.readFileSync(skillPath, 'utf8');
  const lines = raw.split('\n');

  if (!raw.startsWith('---')) {
    findings.push({ severity: 'fail', claim: 'YAML frontmatter present', detail: 'file does not start with ---', location: skillPath });
    continue;
  }

  const closeIdx = lines.slice(1).findIndex(l => l === '---');
  if (closeIdx === -1) {
    findings.push({ severity: 'fail', claim: 'YAML frontmatter closes', detail: 'no closing --- found', location: skillPath });
    continue;
  }

  const frontmatter = lines.slice(1, closeIdx + 1).join('\n');
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const descMatch = frontmatter.match(/^description:\s*([\s\S]+?)(?=\n[a-z_]+:|$)/m);

  if (!nameMatch) {
    findings.push({ severity: 'fail', claim: 'frontmatter has name', detail: 'name field missing', location: skillPath });
    continue;
  }
  if (!descMatch) {
    findings.push({ severity: 'fail', claim: 'frontmatter has description', detail: 'description field missing', location: skillPath });
    continue;
  }

  const name = nameMatch[1].trim();
  const description = descMatch[1].trim();

  if (name !== d.name) {
    findings.push({ severity: 'fail', claim: 'skill name matches directory', detail: `name="${name}" but dir="${d.name}"`, location: skillPath });
    continue;
  }

  if (!/^[a-z0-9-]+$/.test(name) || name.length > 64) {
    findings.push({ severity: 'fail', claim: 'name format valid', detail: 'name must be lowercase a-z0-9-, max 64 chars', location: skillPath });
    continue;
  }

  if (description.length > 1024) {
    findings.push({ severity: 'fail', claim: 'description ≤ 1024 chars', detail: `length=${description.length}`, location: skillPath });
    continue;
  }
  if (description.length < 50) {
    findings.push({ severity: 'warn', claim: 'description is specific', detail: `length=${description.length} (too short to be useful)`, location: skillPath });
  }
  if (!/\b(Use when|use when)\b/.test(description)) {
    findings.push({ severity: 'warn', claim: 'description has trigger phrase', detail: "missing 'Use when...' clause", location: skillPath });
  }

  if (lines.length > 500) {
    findings.push({ severity: 'warn', claim: 'SKILL.md ≤ 500 lines', detail: `length=${lines.length} lines`, location: skillPath });
  }

  passed++;
}

const warnings = findings.filter(f => f.severity === 'warn').length;
const failed = findings.filter(f => f.severity === 'fail').length;

console.log(JSON.stringify({ name: 'skill-structure', passed, failed, warnings, findings }, null, 2));
process.exit(failed > 0 ? 1 : 0);
NODE
