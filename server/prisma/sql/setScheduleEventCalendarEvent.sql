-- Notion 캘린더에 만든 일정 id를 남긴다 (이슈 #391 2단계). updated_at은 건드리지 않는다
-- @param {Int} $1:id
-- @param {String} $2:eventId
UPDATE schedule_event
   SET notion_calendar_event_id = $2
 WHERE id = $1
RETURNING id;
