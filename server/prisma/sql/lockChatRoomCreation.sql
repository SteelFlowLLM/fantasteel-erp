-- 같은 1:1 방(두 사원)·같은 수주의 업무방을 만드는 요청을 트랜잭션이 끝날 때까지 한 줄로 세운다 (이슈 #488). 동시에 눌러도 방이 두 개 생기지 않게
-- @param {String} $1:key
SELECT 1 AS locked
FROM pg_advisory_xact_lock(hashtext('chat_room_create:' || $1));
