-- 내가 멤버인 채팅방별 안 읽은 수와 마지막 메시지 (REQ-MSG-004). 안 읽은 수 = 마지막 읽은 메시지 뒤에 남이 보낸 메시지 수 (삭제된 메시지·시스템 메시지 제외)
-- @param {Int} $1:employeeId
SELECT crm.chat_room_id,
       (SELECT count(*)::int
          FROM message u
         WHERE u.chat_room_id = crm.chat_room_id
           AND u.id > COALESCE(crm.last_read_message_id, 0)
           AND u.sender_id <> crm.employee_id
           AND u.deleted_at IS NULL) AS unread_count,
       lm.id AS last_message_id,
       lm.sender_id AS last_sender_id,
       lm.content AS last_content,
       lm.attachment_name AS last_attachment_name,
       lm.created_at AS last_created_at,
       lm.deleted_at AS last_deleted_at
FROM chat_room_member crm
LEFT JOIN LATERAL (
  SELECT m.id, m.sender_id, m.content, m.attachment_name, m.created_at, m.deleted_at
    FROM message m
   WHERE m.chat_room_id = crm.chat_room_id
   ORDER BY m.id DESC
   LIMIT 1
) lm ON true
WHERE crm.employee_id = $1;
