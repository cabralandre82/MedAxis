# Fire Drill — 2026 Q2 — External Probe Alert Path

**Date:** 2026-04-19
**Driver:** Andre Cabral
**Reviewer:** N/A (solo execution, evidence linked below)
**Scope:** Verify the external synthetic monitoring (Layer 2) alert
pipeline end-to-end before relying on it in production.

## Why this drill

`external-probe.yml` shipped today (commit `c20befe`). Before the
on-call rotation can trust the alerts, we need ground truth that:

1. A failing probe actually opens a GitHub Issue.
2. The dedup rule (one open issue at a time) holds.
3. The 2-greens-to-close auto-recovery rule fires and is observable.

Doing this drill on day-1 is cheap; doing it during a real incident,
when an undetected bug in the alerting path becomes the incident on
top of the incident, is expensive.

## Drill steps

| #   | Action                                         | Expected                                                                                                                                             | Observed                                                                                                                                                                                         |
| --- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Dispatch with default URL                      | All 4 targets pass, no issue created                                                                                                                 | Run `24641241532` succeeded in 8 s, `recover` job no-op'd because no issue was open. PASS                                                                                                        |
| 2   | Dispatch with `target_url=https://httpbin.org` | All 4 targets fail (status mismatch on /api/health/\* and /login, both return 404 from httpbin), workflow exits red, `alert` job opens a fresh issue | Run `24641264948` failed in 7 s. Issue [#16](https://github.com/cabralandre82/clinipharma/issues/16) created at 23:01:39 UTC titled `🔴 External probe failing` with label `probe-failure`. PASS |
| 3   | Dispatch with default URL again (1st recovery) | All 4 targets pass, `recover` job comments `1 green run, waiting…` on issue #16, issue stays open                                                    | Run `24641273483` succeeded in 10 s. Comment landed exactly as expected. Issue stayed open. PASS                                                                                                 |
| 4   | Dispatch with default URL again (2nd recovery) | All 4 targets pass, `recover` job comments `Two consecutive green probe runs — auto-closing.` AND closes the issue                                   | Run `24641285571` succeeded. Issue #16 closed at 23:02:51 UTC, exit comment links back to the closing run. PASS                                                                                  |

End-to-end latency from probe failure to issue creation: under 30 s
(7 s probe + 3 s alert job + GitHub API).

End-to-end latency from second green run to auto-close: under 25 s.

## Evidence

- Workflow runs: <https://github.com/cabralandre82/clinipharma/actions/workflows/external-probe.yml>
- Drill issue: <https://github.com/cabralandre82/clinipharma/issues/16> (closed)
- Probe artifacts retained for 7 days (one `probe.jsonl` per run with
  status code, latency, body size per target)

## Findings

| ID  | Finding                                    | Severity | Action |
| --- | ------------------------------------------ | -------- | ------ |
| F-1 | None — all four steps behaved as designed. | —        | —      |

## Next drill

Quarterly cadence — 2026-Q3 by 2026-09-30. Owner: SRE on-call. Same
four steps; if any step regresses, treat as P2 and patch within 24 h.
