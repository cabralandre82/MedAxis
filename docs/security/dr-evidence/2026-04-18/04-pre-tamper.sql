SELECT max(seq), max(created_at), count(*) FROM audit_log;
-- Pick a row that is at least 24h old to avoid disrupting recent operations:
SELECT seq, created_at, action, actor_id, hash
FROM audit_log
WHERE created_at < now() - interval '1 day'
ORDER BY created_at DESC
LIMIT 5;
