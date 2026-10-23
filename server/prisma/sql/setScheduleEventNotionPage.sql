-- 일정 데이터베이스에 만든 페이지 id를 남긴다 (이슈 #391). 캘린더 반영이 실패해도 다음에 페이지를 또 만들지 않게 먼저 적는다. updated_at은 건드리지 않는다
-- @param {Int} $1:id
-- @param {String} $2:notionPageId
UPDATE schedule_event
   SET notion_page_id = $2
 WHERE id = $1
RETURNING id;
