#!/usr/bin/env node
// scripts/claims/check-skill-trigger-overlap.mjs
// Claim: no two skills' descriptions share a trigger phrase.
//
// Agent dispatch depends on the skill descriptions being a *disjoint
// partition* of the trigger space. When two skills both list
// "rate-limit spike" as a trigger, the AI router gets a coin flip —
// which is the same as "we have no runbook wired". This verifier is
// the deterministic guardian of that partition.
//
// Detection:
//   - Extracts trigger phrases from the `description:` field of every
//     .cursor/skills/*/SKILL.md (quoted substrings only).
//   - Normalizes (lowercase, collapse whitespace, strip surrounding
//     punctuation, normalize hyphens/underscores/spaces to space).
//   - Reports any normalized phrase that appears in ≥ 2 skills.
//
// Severity contract:
//   - fail — any overlap at all. Dispatch ambiguity is a P2 risk the
//            instant it lands in main.
//
// Pure-Node implementation — no ripgrep, no external deps.

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(new URL('.', import.meta.url).pathname, '../..');
process.chdir(repoRoot);

const findings = [];
let passed = 0;

function fail(claim, detail, location) {
  findings.push({ severity: 'fail', claim, detail, location });
}

function read(p) { return fs.readFileSync(p, 'utf8'); }
function exists(p) { return fs.existsSync(p); }

// Parse the frontmatter of a SKILL.md and return { name, description }.
// Frontmatter is YAML-lite: `key: value` lines between two `---` delimiters.
// Description can span multiple lines with trailing `>` or plain multi-line.
function parseFrontmatter(src) {
  if (!src.startsWith('---')) return null;
  const end = src.indexOf('\n---', 3);
  if (end < 0) return null;
  const body = src.slice(3, end);
  const out = {};
  let currentKey = null;
  for (const line of body.split('\n')) {
    const m = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
    if (m) {
      currentKey = m[1];
      out[currentKey] = m[2];
    } else if (currentKey && line.startsWith(' ')) {
      // YAML fold continuation
      out[currentKey] = (out[currentKey] || '') + ' ' + line.trim();
    }
  }
  return out;
}

// Extract trigger phrases (quoted substrings) from a description.
// Supports straight quotes, curly quotes, and backticks.
function extractPhrases(desc) {
  if (!desc) return [];
  const RE = /["'`“”‘’]([^"'`“”‘’\n]{3,80})["'`“”‘’]/g;
  const out = [];
  let m;
  while ((m = RE.exec(desc)) !== null) {
    out.push(m[1]);
  }
  return out;
}

// Normalize a phrase for comparison.
// - lowercase
// - trim surrounding punctuation
// - collapse internal whitespace
// - unify hyphens/underscores to space (so "rate-limit spike" ≡ "rate limit spike")
function normalize(phrase) {
  return phrase
    .toLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    .replace(/[-_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── 1. Collect (skill, phrase[]) tuples ───────────────────────────────────
const SKILLS_DIR = '.cursor/skills';
if (!exists(SKILLS_DIR)) {
  console.log(JSON.stringify({
    name: 'skill-trigger-overlap',
    passed: 0, failed: 0, warnings: 0, findings: [],
  }, null, 2));
  process.exit(0);
}

const skills = [];
for (const entry of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const skillPath = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
  if (!exists(skillPath)) continue;
  const fm = parseFrontmatter(read(skillPath));
  if (!fm || !fm.description) continue;
  const phrases = extractPhrases(fm.description);
  skills.push({
    name: fm.name || entry.name,
    path: skillPath,
    rawPhrases: phrases,
    normalized: phrases.map(normalize).filter(Boolean),
  });
}

// ── 2. Build inverse index: normalized → [{skill, raw}, ...] ──────────────
const index = new Map();
for (const s of skills) {
  for (let i = 0; i < s.normalized.length; i++) {
    const key = s.normalized[i];
    if (!key) continue;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ skill: s.name, path: s.path, raw: s.rawPhrases[i] });
  }
}

// ── 3. Flag any key claimed by ≥ 2 distinct skills ────────────────────────
for (const [norm, claimers] of index.entries()) {
  const distinctSkills = [...new Set(claimers.map(c => c.skill))];
  if (distinctSkills.length >= 2) {
    const examples = claimers
      .map(c => `"${c.raw}" in ${c.skill}`)
      .join(', ');
    fail(
      'skill trigger phrases are disjoint',
      `phrase "${norm}" is claimed by ${distinctSkills.length} skills: ${examples}`,
      claimers[0].path
    );
  } else {
    passed++;
  }
}

// Also emit an informational pass per skill that actually has phrases —
// so "N skills have triggers" shows up as positive signal in the count.
for (const s of skills) {
  if (s.normalized.length > 0) passed++;
}

const warnings = findings.filter(f => f.severity === 'warn').length;
const failed   = findings.filter(f => f.severity === 'fail').length;

console.log(JSON.stringify({
  name: 'skill-trigger-overlap',
  passed,
  failed,
  warnings,
  findings,
}, null, 2));

process.exit(failed > 0 ? 1 : 0);
