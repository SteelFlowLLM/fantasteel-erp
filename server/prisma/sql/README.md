# TypedSQL (코드 컨벤션 8장)

Prisma Client로 표현하기 어려운 쿼리만 여기에 `.sql` 파일로 둔다.

- 집계(GROUP BY, 윈도우 함수): MRP 순소요, 수주 충족 현황
- 3개 이상 테이블 JOIN 또는 서브쿼리: LOT 정·역추적
- 잠금(`SELECT ... FOR UPDATE`)과 조건부 UPDATE: 재고 예약 매수, 출고 확정

## 규칙

- 파일 이름은 camelCase 동사구 (`getReservedQtyBySpec.sql`). 첫 줄에 목적 주석 한 줄
- 파라미터는 `-- @param {Int} $1:salesOrderId` 형식으로 적는다
- 삭제와 FK 컬럼 변경은 여기서 하지 않는다 (Prisma Client로만, 컨벤션 7-2)

## 타입 만들기

DB가 떠 있어야 한다. `npm run dev`는 서버를 띄우기 전에 자동으로 만든다.

```bash
npm run generate:sql -w @fantasteel/server
```

repository에서 부른다.

```ts
import { getReservedQtyBySpec } from '../../generated/prisma/sql';

findReservedQtyBySpec(tx: Tx, salesOrderId: number) {
  return tx.$queryRawTyped(getReservedQtyBySpec(salesOrderId));
}
```
