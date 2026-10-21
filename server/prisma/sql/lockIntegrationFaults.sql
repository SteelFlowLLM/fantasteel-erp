-- 연동 장애를 풀기 전에 그 연결 대상의 장애 줄을 잠근다 (이슈 #518). 서버 둘이 같은 장애를 동시에 풀어도 먼저 잠근 쪽만 줄을 보고 복구 알림을 보낸다
-- @param {String} $1:providerKey
SELECT id, fault_kind, last_message, notified_at
  FROM integration_fault
 WHERE provider_key = $1::text
 ORDER BY id
   FOR UPDATE;
