-- 연동 장애 알림 맡기 (이슈 #518): 알릴 만큼 실패가 이어졌고, 아직 안 알렸거나 마지막 알림이 repeatMs보다 오래됐을 때만 알림 시각을 지금으로 적는다.
-- 반환 행이 있는 서버만 알림을 보낸다: 서버가 여러 대여도 같은 장애 알림이 두 번 가지 않는다
-- @param {String} $1:providerKey
-- @param {String} $2:faultKind
-- @param {Int} $3:minFailures
-- @param {Int} $4:repeatMs
UPDATE integration_fault
   SET notified_at = now(),
       updated_at = now()
 WHERE provider_key = $1::text
   AND fault_kind = $2::text
   AND failure_count >= $3::int
   AND (notified_at IS NULL OR notified_at <= now() - $4::int * interval '1 millisecond')
RETURNING id, last_message, failure_count;
