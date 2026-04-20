---
name: rate-limit-abuse
description: Triages a rate-limit violations spike — classifies pattern (single-IP retry vs credential-stuffing vs form-spam DoS), rules out false positives, applies the right mitigation (Cloudflare block, Turnstile kill-switch, bucket tuning). Use when the user says "rate-limit spike", "credential stuffing", "HTTP 429 surge", "botnet", "form spam", "suspicious IPs", or when `rate_limit_suspicious_ips_total` fires. P2 at 10+ IPs/hour; P1 at 50+ IPs/hour OR one IP > 500 hits OR one IP hitting > 5 distinct buckets.
---

# Rate-limit abuse triage

The 15-min cron `/api/cron/rate-limit-report` rolls up the last hour
of HTTP 429 events and trips on thresholds. The goal is fast
classification: misbehaving client vs real attack, and the right
mitigation for each.

Full runbook: `docs/runbooks/rate-limit-abuse.md`.
Ledger: `public.rate_limit_violations` (30d retention, `ip_hash` only).
Metric: `rate_limit_suspicious_ips_total{severity}`.

## Severity ladder (from the cron's classifier)

| Severity    | Rule                                                                       |
| ----------- | -------------------------------------------------------------------------- |
| **P2 warn** | `distinct_ips ≥ 10` OR `max_hits_per_ip > 100`                             |
| **P1 crit** | `distinct_ips ≥ 50` OR `max_hits_per_ip > 500` OR `max_buckets_per_ip > 5` |

## Workflow

```
Rate-limit triage:
- [ ] 1. Current-hour top offenders pulled
- [ ] 2. Pattern classified (A/B/C from matrix below)
- [ ] 3. False-positive check (deploy artifact / synthetic / campaign / internal)
- [ ] 4. Mitigation applied matching pattern
- [ ] 5. Cloudflare log cross-referenced for raw IPs (if blocking)
- [ ] 6. 24h snapshot attached to incident (forensic)
- [ ] 7. If P1: Security notified within 30 min, DPO for LGPD trail
- [ ] 8. Post-mortem: rule review + Turnstile decision
```

## Step 1 — pull current-hour top offenders

```sql
-- Top offenders this hour
select ip_hash, total_hits, distinct_buckets, buckets, last_seen_at
  from public.rate_limit_report_view
 order by total_hits desc
 limit 20;

-- Credential-stuffing signature (one IP, many buckets)
select ip_hash, array_agg(distinct bucket) as buckets, sum(hits) as hits
  from public.rate_limit_violations
 where last_seen_at > now() - interval '1 hour'
 group by ip_hash
having count(distinct bucket) >= 4
 order by hits desc;

-- Burst vs trickle
select date_trunc('minute', last_seen_at) as minute,
       count(*) as rows, sum(hits) as hits
  from public.rate_limit_violations
 where last_seen_at > now() - interval '1 hour'
 group by 1
 order by 1 desc;
```

Note: raw IPs are never in the DB. `ip_hash = SHA-256(ip || RATE_LIMIT_IP_SALT)`. For forensic IP reversal, go to Cloudflare logs (step 5).

## Step 2 — classify the pattern

| Pattern                    | Likely cause                     | Mitigation                                |
| -------------------------- | -------------------------------- | ----------------------------------------- |
| 1 IP, 1 bucket             | Misbehaving client / retry loop  | Section 4A (no block)                     |
| 1 IP, 3+ buckets           | Credential stuffing              | Section 4B (block + Turnstile + Security) |
| Many IPs, 1 bucket         | Coordinated form spam / F5 storm | Section 4C (Turnstile + bucket tune)      |
| Many IPs, `auth.*` buckets | Credential-spraying botnet       | Section 4B + Cloudflare WAF               |
| Burst < 5 min then silence | Scanner / pen-test               | Confirm with Security before blocking     |

## Step 3 — rule out false positives FIRST

Before any block, verify:

1. **Deploy artifact**: a recent client build shipped a retry-storm bug?

   ```bash
   gh run list --workflow=deploy.yml --limit 5
   ```

2. **Synthetic monitor**: new k6 / Checkly / Uptime probe hitting a form?

   ```sql
   select array_agg(distinct metadata_json->>'ua')
     from public.rate_limit_violations
    where ip_hash = '<hash>' limit 5;
   ```

3. **Marketing blast / sale event**: 10× normal traffic legit? Check #announcements equivalent.

4. **Office VPN / staging synthetic**: ask the team before blocking.

If any is true → **do not block**. Raise the bucket budget instead (step 6).

## Step 4 — mitigations by pattern

### 4A. Single-IP single-bucket (misbehaving client)

No action. The limiter already returns 429 problem+json. If the IP is a known customer asking in support, help them understand `Retry-After` header.

### 4B. Credential stuffing (single IP, many buckets OR credential spraying botnet)

1. **Recover raw IP at Cloudflare**:
   - Cloudflare → Security → Events → filter `/api/auth/**` last hour
   - Recompute `sha256(ip || RATE_LIMIT_IP_SALT)` locally for each IP and match to the alert's `ip_hash`

2. **Block at Cloudflare (NOT app layer)** — save CPU:

   ```
   Cloudflare → Security → WAF → Custom Rules
   (ip.src eq <X.X.X.X>) or (ip.geoip.asnum eq <N>)  →  Block
   TTL: 24h, then re-evaluate
   ```

3. **Flip Turnstile on affected routes**:

   ```sql
   update public.feature_flags
      set enabled = true, updated_at = now()
    where key = 'security.turnstile_enforce';
   ```

4. **File security incident + notify DPO** (LGPD accountability trail — required even if no data leaked).

### 4C. Many-IP single-bucket (form spam / DoS)

Typically `lgpd.deletion` or `register.submit`, coming from residential proxies. Manual IP blocks won't scale.

1. **Turnstile kill-switch** (same SQL as 4B step 3) — stops non-browser automation because widget requires real browser fingerprint.

2. **Cloudflare Rate Limiting** at the edge:

   ```
   Rule: 1 req / 30s / IP for path /api/<form-path>
   Action: Block
   Duration: 1h
   ```

   Immediate mitigation while we deploy a code fix.

3. **Lower the bucket budget** in `lib/rate-limit.ts` temporarily. Deploy required.

4. **Schema-level validation** in the route before DB insert if payload is obvious garbage (emoji in CPF field, random strings as name) → stops polluting `dsar_requests` or registration queues.

## Step 5 — Cloudflare log export (forensic)

For any P1 event, request a 24h window at Cloudflare → Logpush → Export for the targeted path. Attach to the incident issue. This is your raw-IP trail for a possible law-enforcement or ANPD request.

## Step 6 — bucket tuning (false-positive recovery)

If the alert was legit traffic that got throttled:

1. Find the limiter in `lib/rate-limit.ts` (e.g. `lgpdFormLimiter`).
2. Change `{ windowMs: 60_000 * 60, max: 3 }` → new value.
3. Add a comment explaining _why_ the new limit — future reviewers must see rationale.
4. Open a PR — production config change goes through review.

Do **not** silence the alert. Tune the bucket instead. If the cron classifier itself is wrong, raise the threshold in `app/api/cron/rate-limit-report/route.ts` `classifyReport()`.

## Step 7 — post-incident (P1 only)

1. **24h audit snapshot** to the incident ticket:

   ```sql
   select * from public.rate_limit_violations
    where last_seen_at > now() - interval '24 hours'
    order by last_seen_at desc;
   ```

2. **Cloudflare log** attached (24h window for the targeted path).

3. **Retrospective**:
   - Attacker fingerprint (ASN, geography, UA pattern, bucket mix)
   - What we blocked (IPs, ASNs, Turnstile activation scope)
   - Turnstile disposition: if enabled during incident, monitor 7 days. False-positive < 0.1% → leave on.

4. **Rule review**: did the classifier fire at the right severity? Tune if needed (e.g. `>= 4` buckets instead of `> 5`).

## Quick reference

| Command                                                                              | Purpose                      |
| ------------------------------------------------------------------------------------ | ---------------------------- |
| `select * from public.rate_limit_report_view;`                                       | Current-hour rollup          |
| `select public.rate_limit_purge_old(30);`                                            | Manual retention purge       |
| `update feature_flags set enabled = true where key = 'security.turnstile_enforce';`  | Turnstile kill-switch ON     |
| `update feature_flags set enabled = false where key = 'security.turnstile_enforce';` | Turnstile OFF (after review) |
| `curl /api/cron/rate-limit-report -H "Authorization: Bearer $CRON_SECRET"`           | Manual cron invocation       |

## Anti-patterns

- **Never block at the app layer** — Cloudflare WAF costs $0 CPU; app layer makes the problem worse.
- **Never skip the false-positive check** — blocking a marketing blast damages revenue.
- **Never leave Turnstile on permanently without 7-day review** — it has real conversion cost.
- **Never store raw IP in the DB** — we only have hash. Cloudflare owns the raw data.
- **Never lower a bucket silently** — config change without rationale = future confusion.

## Related

- Full runbook: `docs/runbooks/rate-limit-abuse.md`
- Source cron: `app/api/cron/rate-limit-report/route.ts`
- Limiter: `lib/rate-limit.ts`
- Security rule: `.cursor/rules/security.mdc` §rate-limiting
- Feature flags: `security.turnstile_enforce`
