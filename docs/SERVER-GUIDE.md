# 서버 작업 안내 (v2)

v2는 철강 제조 ERP의 **P1 기능**을 NestJS + Prisma + PostgreSQL로 만든다. 이 문서는 서버 모듈을 나눠 만드는 사람(에이전트)이 같은 규칙으로 작업하기 위한 안내다.

## 1. 기준 문서와 우선순위

1. `v2/SPEC.md` — 사용자가 정한 범위·결정 (최우선)
2. `v2/docs/notion/` — 노션 설계 문서 스냅샷. **업무 규칙은 여기서 확인하고 만든다.**
   - `02-요구사항-정의서.md` (REQ-…), `04-업무-프로세스-정의서.md` (BP-…, 계산식·의사코드·API 예시), `03-용어-사전.md` (이름), `05-코드-컨벤션.md`
3. 이 문서 — 문서에서 TBD로 남은 것을 v2에서 어떻게 정했는지 (6장)

- **P1만 구현한다.** P2(Agent, Voice2ERP, AI 어시스턴트, 확장 유형, 정합성 보정 배치)·EX(과거 사례)는 만들지 않는다. AI·LLM 호출은 넣지 않는다.
- SPEC·문서에 없는 기능을 새로 만들지 않는다. 애매하면 만들지 말고 보고서에 적는다.
- `v1/` 은 참고용 초안이다. 읽어도 되지만 구조·이름을 따라 하지 않는다. **수정 금지.**

## 2. 폴더와 명령

```
v2/
  shared/   상수·타입 (@fantasteel/shared) — 공통코드, 이론중량 계산, API 타입
  server/   NestJS  (src/modules/<영역>/, src/common/, src/prisma/, prisma/schema.prisma)
  client/   React + Vite
  docs/     notion/ 스냅샷, api/<모듈>.md, names/<모듈>.md
```

- 로컬 DB는 이미 떠 있다: `postgresql://postgres:postgres@localhost:54322/<db>`. **각자 배정받은 DB와 포트만 쓴다** (다른 사람과 데이터가 섞이지 않게).
  ```bash
  cd v2/server
  export DATABASE_URL=postgresql://postgres:postgres@localhost:54322/<내 DB> DIRECT_URL=$DATABASE_URL API_PORT=<내 포트>
  npx prisma migrate deploy && npx tsx prisma/seed.ts     # 내 DB에 스키마·시드
  npx tsc --noEmit -p tsconfig.json                        # 타입 검사 (자주)
  npx nest build && node dist/main.js                      # 서버 실행 (백그라운드로 띄우고 끝나면 반드시 종료)
  npx jest src/modules/<내 모듈>                            # 단위 테스트
  ```
  `nest build`는 `dist/`를 지우고 다시 만들어 다른 사람의 실행과 겹칠 수 있다. 실행할 때는 **자기 출력 폴더**를 쓴다:
  `npx tsc -p tsconfig.json --outDir .run/<내이름> --incremental false && node .run/<내이름>/main.js` (반드시 `v2/server` 안의 `.run/` — `/tmp`에 두면 node_modules를 못 찾는다)
- 테스트 계정(비밀번호 `heatline`): 김영업 2104012(영업) · 오영업 1502003(영업부장) · 서구매 1907015(구매) · 남구매 1604007(구매부장) · 박생산 1803021(생산) · 최생산 2001009(생산, 제강파트장) · 강생산 1402002(생산부장) · 정품질 1911030(품질) · 윤물류 2005024(물류) · 이관리 1704010(관리자). 로그인: `POST /api/v1/auth/login {employeeNo, password}` → `data.accessToken` → `Authorization: Bearer …`
- 시드 재고: SS275 슬래브 250×1200×10000 6매·코일 4개, SM355 슬래브 4매·코일 4개, SPHC 슬래브 5매·코일 9개, 원료 LOT 5종.

### 건드리면 안 되는 것
- `server/prisma/schema.prisma`, `prisma/migrations/`, `prisma/seed.ts` — **스키마는 고정이다.** 컬럼이 꼭 더 필요하면 만들지 말고 보고서 "스키마 요청"에 적는다 (그동안은 기존 컬럼·JSON으로 우회).
- `server/src/common/`, `server/src/prisma/`, `server/src/app.module.ts`, `server/src/main.ts`, `shared/src/` 의 기존 파일
- 다른 사람 모듈 폴더, 그리고 아래 "핵심 서비스" 파일 (`stock.service.ts`, `production-plan.writer.ts`, `yield.calculator.ts`, `sales-order-status.service.ts`, `business-event.recorder.ts`, `notification.sender.ts`). 버그를 찾으면 고치지 말고 보고서에 적는다 (재현 방법 포함).
- 자기 모듈의 `<모듈>.module.ts`는 고쳐도 된다 (controller·provider 등록). 이미 `app.module.ts`에 등록돼 있다.
- `npm install`로 패키지를 추가하지 않는다 (필요하면 보고서에).

## 3. 코드 규칙 (코드 컨벤션 요약 — 전문은 `docs/notion/05-코드-컨벤션.md`)

- 레이어: **controller**(라우팅·DTO·권한 데코레이터, 업무 로직 금지) → **service**(업무 로직·트랜잭션·데이터에 따른 권한) → **repository**(DB 접근, 함수 첫 인자는 `tx`).
- 파일: `sales-order.controller.ts`, `sales-order.service.ts`, `sales-order.repository.ts`, `dto/create-sales-order.dto.ts`. 클래스 `SalesOrderService`, DTO `CreateSalesOrderDto`.
- API: `/api/v1` + kebab-case 복수 명사 (`@Controller('sales-orders')`), 상태 변경은 `POST /:id/동작`.
- 응답은 그냥 값을 return 한다 → 전역 인터셉터가 `{ success: true, data }`로 감싸고 Decimal은 문자열(이름이 `…Ton`이면 소수 3자리), Date는 ISO로 바꾼다.
- 오류는 `throw new AppException(ERROR_CODE.SO_002, '수량은 1 이상의 정수로 입력해 주세요')` (`src/common/errors/app.exception.ts`, 도우미 `notFound()`, `forbidden()`, `invalidState()`, `badInput()`). 에러 코드는 `ERROR_CODE`(shared)에 있는 것만 쓴다. 메시지는 한국어.
- DTO는 class-validator. 전역 ValidationPipe(`whitelist`, `forbidNonWhitelisted`, `transform`). 숫자 쿼리는 `@Type(() => Number)`.
- 권한: 컨트롤러에 `@RequireUse(PERMISSION…)`(변경) / `@RequireView(…)`(조회). 로그인 사원은 `@CurrentUser() user: AuthUser`. **클라이언트가 보낸 사원 ID·역할은 믿지 않는다.** 부서장 여부 등 데이터에 따른 권한은 service에서 검사한다.
- 트랜잭션: `this.prisma.tx(async (tx) => { … })` (`$transaction`을 직접 쓰지 않는다). 중첩 금지 — 다른 서비스 함수에는 `tx`를 넘긴다.
- 상태값: `@fantasteel/shared`의 상수만 (`RESERVATION_STATUS.ACTIVE`). 문자열 직접 입력·Prisma enum 금지. 새 코드 값이 필요하면 보고서에.
- 톤은 `Prisma.Decimal`로 계산 (`Float`·JS number 금지), 매수는 Int. 제품 톤은 저장하지 않고 `매수 × theoreticalWeightTon`으로 계산해 응답에 넣는다 (`calcWeightTon` in shared).
- `any` 금지, `console.log` 금지(Nest `Logger`), 주석은 "왜"만. `$queryRaw` 금지 (잠금은 `src/common/concurrency/locks.ts`).
- 이름: 용어 사전 변수명·DB명 → 업무 프로세스 정의서 11·12장 제안 이름. 동의어(사용 금지) 칸의 단어는 쓰지 않는다 (`order` 단독 금지 → `salesOrder`/`purchaseOrder`, 팀장 → 부서장, 거래처 → 고객사, 원자재 → 원료).

### 모듈 예시 (패턴)
```ts
// modules/xxx/xxx.controller.ts
@Controller('sales-orders')
export class SalesOrderController {
  constructor(private readonly service: SalesOrderService) {}
  @Get() @RequireView(PERMISSION.ORDER_CREATE)
  list(@Query() q: ListSalesOrdersDto) { return this.service.list(q); }
  @Post() @RequireUse(PERMISSION.ORDER_CREATE)
  create(@Body() dto: CreateSalesOrderDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user); }
  @Post(':id/cancel') @HttpCode(200) @RequireUse(PERMISSION.ORDER_CANCEL)
  cancel(@Param('id', ParseIntPipe) id: number, @Body() dto: CancelDto, @CurrentUser() user: AuthUser) { return this.service.cancel(id, dto, user); }
}
// modules/xxx/xxx.service.ts
async create(dto, user) {
  return this.prisma.tx(async (tx) => {
    const row = await this.repo.create(tx, …);
    await this.events.record(tx, { actor: user, eventType: 'SALES_ORDER_REGISTERED', targetType: 'SALES_ORDER', targetId: row.id, targetNo: row.salesOrderNo, salesOrderId: row.id, summary: '…', after: row });
    this.realtime.changed('sales-orders');
    return row;
  });
}
```

## 4. 공통으로 쓰는 것 (이미 있음 — 읽고 그대로 쓴다)

| 무엇 | 어디 | 쓰임 |
|---|---|---|
| `PrismaService.tx(fn)` | `src/prisma/prisma.service.ts` | 업무 트랜잭션 |
| `NumberingService` | `src/common/numbering/` | `documentNo(tx,'SO'|'PP'|'PR'|'PO'|'RCV'|'SHP'|'GI'|'MS'|'MRP'|'QI')`, `rawMaterialLotNo`, `hotMetalNo`, `heatNo`, `slabNo`, `coilNo` |
| `locks.ts` | `src/common/concurrency/` | `lockProductInventory`, `lockLots`, `lockRow`, `lockRawMaterialInventory` |
| `RealtimeService` | `src/common/realtime/` | `changed('sales-orders', …)` 화면 갱신 신호, `toEmployees(ids, event, payload)` |
| `StorageService` | `src/common/storage/` | 첨부·PDF 저장 (`save`, `read`, `exists`) |
| `BusinessEventRecorder.record(tx, …)` | `modules/business-event/` | **작업 로그. 본 거래와 같은 tx에서** (REQ-LOG-001·002) |
| `NotificationSender` | `modules/notification/` | `toEmployees`, `toDepartment`, `toRole` (REQ-NTF-002) |
| `StockService` | `modules/inventory/stock.service.ts` | **재고·예약·배정 규칙 전부.** inventory·reservation·allocation 테이블을 직접 바꾸지 않는다 |
| `ProductionPlanWriter` | `modules/production/` | `createForShortage`, `handleSalesOrderItemCancelled` |
| `YieldCalculator` | `modules/production/` | `calcHeatPlan`, `rawMaterialRequirements`, `routingYields` |
| `SalesOrderStatusService.recalcItem(tx, itemId)` | `modules/sales-order/` | 출고·계획 변화 뒤 수주 품목 상태 재계산 |
| 공통코드·에러코드·권한·위젯 | `shared/src/codes/index.ts` | 상태값·라벨·`PERMISSION`·`ERROR_CODE`·`BUSINESS_EVENT_TYPE` |

실시간 주제 이름(`realtime.changed`)은 API 복수 명사를 쓴다: `sales-orders`, `inventories`, `lots`, `allocations`, `production-plans`, `production-results`, `mrp-runs`, `purchase-requisitions`, `purchase-orders`, `goods-receipts`, `quality-inspections`, `shipment-requests`, `goods-issues`, `mill-sheets`, `business-events`, `tasks`, `notifications`, `chat-rooms`, `action-drafts`, `employees`, `departments`, `master-data`, `dashboard`. 데이터를 바꾸면 해당 주제를 부른다.

## 5. 작업 로그·알림 규칙

- REQ-LOG-002의 이벤트는 **빠짐없이** 기록한다. `summary`는 사실을 한 줄로 (예: `합격 재고 6매 예약`, `HT-1-260930-001 성분 검사 합격`). `salesOrderId`를 넣으면 수주 타임라인에, `lotIds`를 넣으면 LOT 타임라인에 나온다. 변경 전·후 값은 `before`/`after`.
- 사용자가 한 일은 `actor: user`, 시스템이 한 일(자동 예약·자동 판정·시뮬레이션)은 `actor: null`.
- 알림은 "다음에 일할 사람"에게 보낸다: 승인 요청 → 부서장, 승인·반려 결과 → 요청자, 생산계획 필요 → 생산 역할, 검사 대기 → 품질 역할, 배정 확정·출고 대기 → 물류 역할, 출고 완료 → 수주 담당 등. `linkPath`는 프론트 경로(8장).

## 6. v2에서 정한 업무 규칙 (문서에서 TBD였던 것)

**수량·중량**
- 수주 수량은 1 이상의 정수(슬래브 매, 코일 개). 소수·0·음수·누락은 `SO-002`. 톤은 응답에서 계산값으로만 준다.
- 사용된 규격(수주·재고·LOT가 참조)은 치수·이론중량 수정 불가 `MST-002`. 아직 안 쓰인 규격은 수정 허용.

**재고 (StockService 주석 참고)**
- 적격 LOT = 자기 검사 합격 + 상위 히트 성분 합격 + `lot_status = IN_STOCK`.
- 재고 풀 `inventory.on_hand_qty` = 적격 LOT 중 "귀속 슬래브"가 아닌 매수. 여재(미배정 합격 슬래브)는 풀에 들어 있다. 예약 가용 = `on_hand_qty − reserved_qty`.
- 귀속 슬래브 = 코일 수주 품목의 열연 투입용으로 잡아 둔 슬래브 (`lot.sales_order_item_id` = 코일 수주 품목). 풀에 넣지 않아 슬래브 판매 예약이 침범하지 못한다.
- 여재는 컬럼 없이 계산한다: 적격·IN_STOCK·`sales_order_item_id IS NULL`·CONFIRMED 배정 없는 슬래브.
- 검사 판정 뒤에는 반드시 `StockService.onLotJudged(tx, lotId)`를 부른다 → 풀 반영·자동 예약·귀속 판단을 해 준다.
- 출고 확정: 품목별로 `lockProductInventory` → 배정마다 `consumeForShipment` → `convertItemReservations(tx, itemId, 출고 매수)` → `sales_order_item.shipped_qty` 증가 → `recalcItem`.

**히트 편성·MRP (YieldCalculator)**
- 히트 용량(초기 250t)은 **용강(히트) 산출 기준**으로 본다. 누적 계획수율은 용강에서 시작: 연주 × 열연. 제강 수율은 용선 → 용강 환산에만 쓴다.
- 히트당 슬래브 계획 매수 = floor(히트 용량 × 연주 수율 ÷ 슬래브 1매 이론중량). 남는 슬래브는 여재.
- 코일 계획은 재고 풀의 여재 슬래브를 먼저 쓸 수 있다: `surplus_use_qty`만큼은 새로 만들지 않는다 (히트 수 계산에서 뺀다).
- LOT 채번 시점: 용선·히트·슬래브·코일 모두 **실적 등록(완료) 시**. 고로·전로 번호는 입력값(설비 마스터 없음, 시드는 고로 `1`, 전로 `1`·`2`).
- 원료 → 용선: 제선 실적에서 원단위만큼 원료 LOT을 입고일 FIFO로 차감하고, `lot_relation`은 `evidence_type = PERIOD` + 작업 기간. 용선 → 히트, 합금철 → 히트는 `DIRECT` + `input_ton`.
- 히트 미판정 상태에서도 연주는 진행할 수 있다. 다만 미합격 히트의 하위 제품은 예약·열연·출고에 못 쓴다.
- 실적 시뮬레이션(REQ-PRD-007): 화면에서 생산계획을 골라 실행. 남은 공정을 끝까지 만든다 — 제선 → 제강(성분 검사 자동 합격값) → 연주(0~5% 손실, 손실 매수 = floor(계획 매수 × 샘플 손실률)) → 슬래브 검사 → (코일이면) 필요한 슬래브만 FIFO 배정·열연 → 코일 검사. 주체는 SYSTEM, `is_simulated = true`, `reason_code = SIMULATION`. 난수 시드를 받아 재현 가능하게 한다. 원료가 부족하면 어떤 원료가 몇 톤 부족한지 알려 주고 멈춘다 (구매 흐름으로 이어지게).
- 검사 min/max는 경계 포함. 필수 측정값이 비어 있으면 합격 처리하지 않는다(PENDING 유지).

**구매**
- 승인권자 = 요청자 소속 부서의 부서장. 요청자가 그 부서의 부서장이면 상위 부서의 부서장. 찾지 못하면 제출 시 `PUR-001`. 자기 요청을 자기가 승인할 수 없다. 자동 승인 없음.
- 발주는 승인된 구매요청 품목으로만 만든다(`PUR-002`), 공급업체 1곳당 1건에 여러 품목. 발주는 만들면 바로 `CONFIRMED`(입고예정 반영).
- 입고예정 = 확정 발주의 `ordered_ton − received_ton` 합. 입고는 부분 입고 허용, 미입고량 초과 `PUR-003`. 확정 시 원료 LOT 생성 + `inventory.on_hand_ton` 증가(`StockService.adjustRawMaterialTon`).

**출하**
- 출하요청은 같은 고객사의 수주 품목만 묶는다. 요청 매수 ≤ 그 품목의 ACTIVE 예약 매수 − 다른 미출고 출하요청 매수.
- 출고 확정은 출하요청 단위(배정이 모두 끝난 요청 전체). 부분 출하는 출하요청을 나눠서 한다 (4매 요청 + 6매 요청).
- 밀시트는 출고 확정 시 (출고 × 수주 품목)마다 1장. 스냅샷에 고객사·수주·규격·LOT·히트·이론중량·히트 성분·검사 항목과 값·발행일을 복사한다. PDF는 저장된 스냅샷으로만 만든다.

**Message → ERP (SPEC 8·9)**
- AI 추출은 없다. `POST /messages/:id/action-drafts` → 원본 메시지가 연결된 Action Draft(`WAITING_APPROVAL`, payload 값은 비어 있음, `requesterId` = 메시지 작성자) → 요청자가 값 입력 → `confirm` → `APPROVED` → 구매요청 생성(`WAITING_APPROVAL`, `source_type = MESSAGE`, `source_draft_id`) → `EXECUTED` → 부서장 승인. `reject` → `REJECTED`. 필수값이 비면 `ACT-001`. 같은 메시지에 미처리 초안이 있으면 새로 만들지 않고 그것을 돌려준다.
- 유형 추가가 가능하도록 `ActionDefinition`(type, 검증기, 확정 주체, 핸들러) 레지스트리 구조로 만든다 (REQ-ACT-004). 등록하는 유형은 `PURCHASE_REQUISITION_CREATE` 1종.

## 7. 모듈과 API (업무 프로세스 정의서 12.2 기준)

각 모듈은 `docs/api/<모듈>.md`에 **실제로 만든** 엔드포인트와 요청·응답 모양(TypeScript 타입, 실제 curl 결과와 일치)을 적는다. 프론트가 이것만 보고 붙인다.

| 모듈 | 주요 API |
|---|---|
| organization | `GET/POST/PATCH /employees`, `POST /employees/:id/unlock`·`reset-password`, `GET/POST/PATCH /departments`(계층·부서장, 순환 금지), `GET /departments/tree`(조직도: 트리 + 인원·직급·부서장 여부), `GET /roles`, `GET/PUT /roles/:id/permissions` |
| master-data | `/items`, `/raw-materials`, `/steel-grades`(+성분 규격), `/product-specs`, `/spec-mappings`, `/routings`, `/specific-consumptions`, `/customers`, `/suppliers`, `/yards`, `/production-settings`, `/inspection-items` |
| sales-order | `GET/POST /sales-orders`, `GET /sales-orders/:id`, `POST /sales-orders/:id/cancel`, `GET /sales-orders/:id/fulfillment`, `GET /sales-orders/:id/reservations` |
| inventory | `GET /inventories`(제품: 합격·가용·예약 매수 + 톤 계산값 / 원료: 톤), `GET /inventories/surplus`(여재), `POST /allocations/recommend`, `POST /allocations`, `POST /allocations/:id/release` |
| production | `GET /production-plans`, `GET /production-plans/:id`, `POST /production-plans`(재생산), `POST /production-plans/:id/heat-preview`·`confirm`·`cancel`·`simulate-results`, `GET/POST /production-results`, `POST /production-results/:id/start`·`complete` |
| mrp | `POST /mrp-runs`, `GET /mrp-runs`, `GET /mrp-runs/latest` |
| purchasing | `GET/POST /purchase-requisitions`, `GET /:id`, `PATCH /:id`, `POST /:id/submit`·`approve`·`reject`, `GET/POST /purchase-orders`, `GET/POST /goods-receipts`, `POST /goods-receipts/:id/confirm`, `GET /approvals`(내가 승인할 것) |
| quality | `GET /quality-inspections`(검사 대기 포함), `POST /quality-inspections`, `GET /lots/rejected`, `POST /lots/:id/disposition` |
| shipment | `GET/POST /shipment-requests`, `GET /:id`, `POST /:id/cancel`, `POST /shipment-requests/:id/goods-issue`(출고 확정), `GET /goods-issues`, `GET /mill-sheets`, `GET /mill-sheets/:id`, `POST /mill-sheets/:id/pdf`, `GET /mill-sheets/:id/pdf` |
| lot | `GET /lots`, `GET /lots/:id`, `GET /lots/:id/trace?direction=backward|forward`, `GET /lots/search?q=` |
| business-event | `GET /business-events?salesOrderId=&lotId=&eventType=&from=&to=` |
| notification | `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/:id/read`, `POST /notifications/read-all`, `GET/POST /tasks`, `PATCH /tasks/:id`, `POST /tasks/:id/status` |
| messenger | `GET/POST /chat-rooms`, `GET /chat-rooms/:id`, `GET/POST /chat-rooms/:id/messages`, `POST /chat-rooms/:id/files`, `GET /messages/:id/file`, `PUT /chat-rooms/:id/read`, `GET /chat-rooms/unread-count`, 소켓 이벤트 `message` |
| message-action | `POST /messages/:id/action-drafts`, `GET /action-drafts`, `GET /action-drafts/:id`, `PATCH /action-drafts/:id`, `POST /action-drafts/:id/confirm`·`reject` |
| dashboard | `GET /dashboard/widgets/:widgetCode`(위젯별 데이터), `GET/PUT /dashboard/layout`, `GET /search?q=`(통합 검색: 수주번호·LOT번호 등 → 이동할 화면) |

## 8. 프론트 경로 (알림·업무의 `linkPath`에 쓴다)

`/dashboard` · `/sales-orders` · `/sales-orders/new` · `/sales-orders/:id` · `/mrp` · `/purchase-requisitions` · `/purchase-requisitions/:id` · `/action-drafts/:id` · `/purchase-orders` · `/goods-receipts` · `/production/plans?plan=:id` · `/production/results?plan=:id` · `/production/rolling?plan=:id` · `/quality/inspections?lot=:id` · `/quality/rejected?lot=:id` · `/shipment-requests/new` · `/shipment-requests/:id` · `/goods-issues?request=:id` · `/mill-sheets?id=:id` · `/lots/trace?lot=:lotNo` · `/business-events?salesOrderId=:id` · `/tasks` · `/messenger?room=:id` · `/approvals` · `/admin/employees` · `/admin/organization` · `/admin/master-data`

## 9. 끝낼 때

1. `npx tsc --noEmit -p tsconfig.json` 통과, 내 모듈 단위 테스트 통과. **예약·배정·MRP·이론중량·출고 확정 로직은 단위 테스트 필수** (코드 컨벤션 11장).
2. 내 DB·포트로 서버를 띄워 curl로 실제 흐름을 돌려 본다 (정상 + 주요 예외). 띄운 서버는 종료한다.
3. `docs/api/<모듈>.md` 작성.
4. 용어 사전·프로세스 정의서 11·12장 어디에도 없는 이름을 새로 지었으면 `docs/names/<모듈>.md`에 적는다 (이름 · 어디에 쓰는지 · 왜 필요한지).
5. 보고서: 만든 것 / 실제로 돌려 확인한 것과 결과 / 못 한 것·가정한 것 / 스키마·공통 코드 요청 / 핵심 서비스에서 찾은 문제.
