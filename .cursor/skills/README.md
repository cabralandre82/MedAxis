# .cursor/skills — operational skills index

Skills are agent-discoverable, executable runbook companions. Each skill
is a compact, actionable `SKILL.md` with frontmatter (`name`,
`description`) that tells the agent when to auto-apply it.

**Progressive disclosure model**:

- **`.cursor/skills/<name>/SKILL.md`** — compact, executable, step-by-step. The agent reads this when a trigger matches.
- **`docs/runbooks/<name>.md`** — full narrative, legal context, decision rationale, historical appendix. The human reads this when they need the "why".

A skill is NOT a substitute for the runbook. It's the fast-path. The
narrative runbook is the authoritative source of truth — if they diverge,
the runbook wins and the skill must be updated.

---

## When to add a skill (vs leave a pure runbook)

| Add a skill when                                          | Leave as runbook-only when    |
| --------------------------------------------------------- | ----------------------------- |
| The response has a clear decision tree                    | Pure reference material       |
| There are executable commands the agent would run         | Pure theory / background      |
| The scenario repeats (DSAR, rotation, legal hold)         | One-off historical drill      |
| The wrong choice has legal or data-integrity consequences | Purely stylistic / convention |

---

## Current skills

### Incident intake (use first)

| Skill                                       | Trigger                                                            | Runbook                   |
| ------------------------------------------- | ------------------------------------------------------------------ | ------------------------- |
| [`incident-open`](./incident-open/SKILL.md) | Any alert fires; user says "got an alert" / "começou um incidente" | `docs/runbooks/README.md` |

### Compliance / legal (highest regulatory exposure)

| Skill                                                 | Trigger                                                             | Runbook                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------- |
| [`dsar-fulfill`](./dsar-fulfill/SKILL.md)             | DSAR request to process, SLA approaching / missed                   | `docs/runbooks/dsar-sla-missed.md`      |
| [`legal-hold-apply`](./legal-hold-apply/SKILL.md)     | ANPD / PROCON / judicial / MPF / ANVISA preservation order received | `docs/runbooks/legal-hold-received.md`  |
| [`audit-chain-verify`](./audit-chain-verify/SKILL.md) | `verify-audit-chain` cron failed; Sentry "audit chain tampered"     | `docs/runbooks/audit-chain-tampered.md` |

### Security (P1 when confirmed)

| Skill                                                     | Trigger                                                                      | Runbook                              |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------ |
| [`secret-compromise`](./secret-compromise/SKILL.md)       | Secret confirmed / suspected leaked; employee offboarding                    | `docs/runbooks/secret-compromise.md` |
| [`secret-rotate`](./secret-rotate/SKILL.md)               | Scheduled 90d (A/B) or 180d (C) rotation due                                 | `docs/runbooks/secret-rotation.md`   |
| [`rls-violation-triage`](./rls-violation-triage/SKILL.md) | `/api/cron/rls-canary` reports violations; `rls_canary_violations_total > 0` | `docs/runbooks/rls-violation.md`     |

### Disaster recovery

| Skill                                       | Trigger                                                   | Runbook                           |
| ------------------------------------------- | --------------------------------------------------------- | --------------------------------- |
| [`backup-verify`](./backup-verify/SKILL.md) | Backup freshness alert; restore drill failed; chain break | `docs/runbooks/backup-missing.md` |

### Financial integrity

| Skill                                   | Trigger                                       | Runbook                        |
| --------------------------------------- | --------------------------------------------- | ------------------------------ |
| [`money-drift`](./money-drift/SKILL.md) | `money_drift_view` non-empty; cents ≠ numeric | `docs/runbooks/money-drift.md` |

### Infrastructure / availability

| Skill                                                   | Trigger                                                                | Runbook                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------- |
| [`health-check-triage`](./health-check-triage/SKILL.md) | `/api/health/*` degraded; UptimeRobot 503; routing entry to sub-skills | `docs/runbooks/health-check-failing.md` |
| [`rate-limit-abuse`](./rate-limit-abuse/SKILL.md)       | HTTP 429 spike; credential stuffing; form spam DoS                     | `docs/runbooks/rate-limit-abuse.md`     |

---

## Runbooks without a dedicated skill (yet)

Skills are added on demand. These runbooks are fully usable without a
skill — they just require the agent to read them linearly.

| Runbook                     | Why no skill (yet)                             |
| --------------------------- | ---------------------------------------------- |
| `alerts-noisy.md`           | Pure tuning exercise, not incident-driven      |
| `atomic-rpc-mismatch.md`    | Debugging pattern, not a recurring action      |
| `chaos.md`                  | Chaos engineering catalog — reference material |
| `cron-double-run.md`        | Specific bug pattern                           |
| `csrf-block-surge.md`       | Investigation, not fixed procedure             |
| `dr-drill-2026-04.md`       | Historical one-off drill (already executed)    |
| `fire-drill-2026-Q2.md`     | Scheduled drill — skillify if recurring        |
| `observability-gap.md`      | Investigation guide                            |
| `rbac-permission-denied.md` | Debugging                                      |
| `vercel-cron-quota.md`      | Infra issue — skillify if it recurs            |
| `webhook-replay.md`         | Debugging                                      |

Add skills as trigger patterns stabilise.

---

## Writing a new skill

Follow `~/.cursor/skills-cursor/create-skill/SKILL.md`. Conventions
specific to this repo:

1. **Trigger terms in Portuguese AND English.** The operator writes in Portuguese; Copilot writes in English. Skill descriptions should match both.
2. **Start with a workflow checklist** the agent copies into the incident issue.
3. **Include concrete SQL / shell commands** — skills save tokens by avoiding code generation.
4. **Cross-link back to the narrative runbook** at top + bottom of the file.
5. **Anti-patterns section is mandatory.** "Never" rules are the actual moat.
6. **Keep it under 300 lines.** Progressive disclosure — detail goes to the runbook.

---

## Skill ↔ Rule ↔ Runbook taxonomy

The platform has three AI-agent-facing documents. Each has a distinct role:

| Artefact                    | When read                                             | What it does                                                              |
| --------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------- |
| `.cursor/rules/*.mdc`       | Automatically on matching globs / `alwaysApply: true` | **Prevents** — invariants the agent must not violate when editing code    |
| `.cursor/skills/*/SKILL.md` | On matching description trigger                       | **Executes** — guides the agent through a multi-step procedure            |
| `docs/runbooks/*.md`        | Linked from skills or rules; read on demand           | **Explains** — full context, why, regulatory rationale, historical detail |

Rule prevents accidents. Skill guides procedure. Runbook owns truth.

---

## Related

- Cursor rules for this repo: `.cursor/rules/`
- Runbooks master index: `docs/runbooks/README.md`
- AGENTS.md (canonical agent guide): `AGENTS.md`
- Solo-operator playbook: `docs/SOLO_OPERATOR.md`
