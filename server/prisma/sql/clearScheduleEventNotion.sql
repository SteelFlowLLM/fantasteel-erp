-- Notion에 넣지 않기로 바꾼 일정의 페이지를 휴지통으로 옮겼거나(clearPage) 캘린더 일정을 취소했으면(clearEvent) 그 id를 지운다 (이슈 #434).
-- 반영 시각도 지워 다시 넣기로 바꾸면 새로 만든다. updated_at은 건드리지 않는다
-- @param {Int} $1:id
-- @param {Boolean} $2:clearPage
-- @param {Boolean} $3:clearEvent
UPDATE schedule_event
   SET notion_page_id = CASE WHEN $2 THEN NULL ELSE notion_page_id END,
       notion_calendar_event_id = CASE WHEN $3 THEN NULL ELSE notion_calendar_event_id END,
       notion_synced_at = NULL
 WHERE id = $1
RETURNING id;
