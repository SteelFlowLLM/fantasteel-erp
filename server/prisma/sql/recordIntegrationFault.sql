-- 연동 장애 한 번을 남긴다 (이슈 #518). 같은 연결·같은 종류의 장애가 풀리기 전이면 한 줄에 횟수를 더한다. 서버가 여러 대여도 한 줄만 생기게 ON CONFLICT로 쓴다
-- @param {String} $1:providerKey
-- @param {String} $2:faultKind
-- @param {String} $3:message
INSERT INTO integration_fault (provider_key, fault_kind, failure_count, last_message, first_failed_at, last_failed_at, created_at, updated_at)
VALUES ($1::text, $2::text, 1, $3::text, now(), now(), now(), now())
ON CONFLICT (provider_key, fault_kind) DO UPDATE
   SET failure_count = integration_fault.failure_count + 1,
       last_message = EXCLUDED.last_message,
       last_failed_at = now(),
       updated_at = now()
RETURNING id, failure_count;
