-- 채번 전에 번호 앞부분(EV-261014- 등)을 트랜잭션이 끝날 때까지 잠근다. 동시 거래가 같은 "최댓값 + 1"을 받지 않고 차례로 번호를 받게 한다
-- @param {String} $1:prefix
SELECT 1 AS locked
FROM pg_advisory_xact_lock(hashtext($1));
