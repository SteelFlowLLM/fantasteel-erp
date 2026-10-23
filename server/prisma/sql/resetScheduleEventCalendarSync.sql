-- 캘린더 설정을 바꾸면 다시 반영할 일정을 고른다 (이슈 #391 2단계). since 뒤에 끝나는 일정은 반영 시각을 지워 다시 보내고,
-- 캘린더를 바꿨으면(clearEvents) 옛 캘린더의 일정 id를 지워 새 캘린더에 새로 만든다. updated_at은 건드리지 않는다
-- @param {DateTime} $1:since
-- @param {Boolean} $2:clearEvents
UPDATE schedule_event
   SET notion_calendar_event_id = CASE WHEN $2 THEN NULL ELSE notion_calendar_event_id END,
       notion_synced_at = CASE WHEN end_at >= $1 THEN NULL ELSE notion_synced_at END
 WHERE end_at >= $1
    OR ($2 AND notion_calendar_event_id IS NOT NULL)
RETURNING id;
