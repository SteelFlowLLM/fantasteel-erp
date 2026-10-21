-- 재고 행이 없으면 만든다. Prisma upsert는 같은 제품이 처음 적격이 되는 거래 둘이 겹치면 둘 다 INSERT를 시도해 unique 위반이 나므로, 충돌이면 넣지 않고 넘어간다
-- @param {Int} $1:itemId
INSERT INTO inventory (item_id, updated_at)
VALUES ($1, now())
ON CONFLICT (item_id) DO NOTHING
RETURNING id
