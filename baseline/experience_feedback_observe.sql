-- Experience feedback loop observation script (SQLite)
-- DB: ~/.openvia/data/capabilities.db
-- Usage (PowerShell):
--   sqlite3 "$env:USERPROFILE/.openvia/data/capabilities.db" ".read baseline/experience_feedback_observe.sql"

.headers on
.mode column

SELECT '=== 1) recent key events (last 200) ===' AS section;
SELECT
  e.id,
  datetime(e.created_at / 1000, 'unixepoch', 'localtime') AS ts_local,
  e.event_type,
  e.scene,
  e.signal,
  e.success,
  e.user_id,
  e.goal_id
FROM experience_events e
WHERE e.event_type IN (
  'tool_call_failed',
  'tool_call_recovered',
  'tool_call_succeeded',
  'duplicate_tool_call_blocked',
  'loop_guard_blocked',
  'max_iterations_reached',
  'rule_hit',
  'rule_effective',
  'rule_ineffective'
)
ORDER BY e.id DESC
LIMIT 200;

SELECT '=== 2) fail -> recover pairs (same scene + signal, last 24h) ===' AS section;
WITH failed AS (
  SELECT id, created_at, scene, signal, user_id, goal_id
  FROM experience_events
  WHERE event_type = 'tool_call_failed'
    AND created_at >= (strftime('%s','now') - 24 * 3600) * 1000
),
recovered AS (
  SELECT id, created_at, scene, signal, user_id, goal_id
  FROM experience_events
  WHERE event_type = 'tool_call_recovered'
    AND created_at >= (strftime('%s','now') - 24 * 3600) * 1000
)
SELECT
  f.id AS failed_event_id,
  r.id AS recovered_event_id,
  f.scene,
  f.signal,
  f.user_id,
  f.goal_id,
  ROUND((r.created_at - f.created_at) / 1000.0, 1) AS recover_seconds
FROM failed f
JOIN recovered r
  ON r.scene = f.scene
 AND r.signal = f.signal
 AND r.user_id = f.user_id
 AND r.created_at > f.created_at
WHERE NOT EXISTS (
  SELECT 1
  FROM recovered r2
  WHERE r2.scene = f.scene
    AND r2.signal = f.signal
    AND r2.user_id = f.user_id
    AND r2.created_at > f.created_at
    AND r2.created_at < r.created_at
)
ORDER BY r.created_at DESC
LIMIT 100;

SELECT '=== 3) auto-promoted rules summary ===' AS section;
SELECT
  r.id,
  r.source,
  r.scene,
  r.pattern,
  r.priority,
  ROUND(r.confidence, 3) AS confidence,
  r.hit_count,
  r.effective_count,
  r.ineffective_count,
  r.effective_streak,
  datetime(r.updated_at / 1000, 'unixepoch', 'localtime') AS updated_local
FROM experience_rules r
WHERE r.source LIKE 'auto:%'
ORDER BY r.updated_at DESC
LIMIT 100;

SELECT '=== 4) queue status and backlog ===' AS section;
SELECT
  q.status,
  COUNT(*) AS cnt,
  MIN(datetime(q.created_at / 1000, 'unixepoch', 'localtime')) AS oldest_created,
  MAX(datetime(q.updated_at / 1000, 'unixepoch', 'localtime')) AS newest_updated
FROM experience_processing_queue q
GROUP BY q.status
ORDER BY cnt DESC;

SELECT
  q.id,
  q.event_id,
  q.status,
  q.attempts,
  q.last_error,
  datetime(q.available_at / 1000, 'unixepoch', 'localtime') AS available_local,
  datetime(q.updated_at / 1000, 'unixepoch', 'localtime') AS updated_local
FROM experience_processing_queue q
WHERE q.status IN ('pending', 'processing')
ORDER BY q.id ASC
LIMIT 100;
