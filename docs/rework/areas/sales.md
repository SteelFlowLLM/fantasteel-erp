# 영업(수주) 화면 — 목록·등록·상세(충족 현황·생산 연결·예약·이력)·취소·업무방 열기·재생산

- 2026-10-01, 워크트리 브랜치(병렬 작업). 근거: stage3.md 화면 1~3, stage4.md "재생산 필요 N매", 보고서 1 A-1~A-4·A-10·A-11·C(수주), PLAN §5·§6-2·§6-5·§7 영업(수주), REQ-SO-001~006, REQ-INV-002~005, REQ-PRD-006, REQ-MSG-001, REQ-LOG-003, BP-SO-01/02, 14.1 1단계, 14.2(혼합·취소).
- 업무 규칙은 모두 core 서비스(`@/mock/services`, docs/rework/areas/core-domain.md)를 부른다. 이 영역은 권한 확인(`requireActor`)과 화면만 만든다. 다시 구현한 규칙 없음.

## 1. 화면·주소

| 주소 | 파일 | 내용 |
|---|---|---|
| `/sales-orders` | `features/sales/SalesOrderListScreen.tsx` | 필터 레일(상태·납기 위험만·고객사·품목 유형, 초기화, 적용 n) · 툴바(검색 "수주번호·고객사", 상태 단추, 건수, 작업 로그, 수주 등록) · 수주 표(수주번호·고객사·품목 요약·수주 매수·톤(계산값)·검사합격 / 수주·상태(+납기 위험·재생산 필요)·납기·담당, 50건씩) · 오른쪽 미리보기(`components/SalesOrderPreviewPane.tsx`: 머리·업무방·출하요청 만들기·상세 보기, 품목별 충족 지표, 생산 연결, 최근 작업 로그 8건) |
| `/sales-orders/new` | `features/sales/SalesOrderCreateScreen.tsx` | 왼쪽 입력(고객사, 담당 = 등록한 사원, 품목 줄: 유형·강종·규격(등록된 슬래브·코일만)·매수(정수, 글자를 지우지 않음)·납기(품목마다 DateInput), 1매 이론중량·톤 계산값·예약 가용 → 예약/부족 캡션, 행 추가는 앞 행의 유형·강종을 이어받음) · 오른쪽 미리보기(단계, KPI 수주 합계·재고 예약(예상)·부족 매수(예상), 품목별 예약 미리보기 표 + 부족분 히트 편성(히트 수·히트 톤·필요 용강량·예상 여재), "저장하면 이렇게 돼요") |
| `/sales-orders/[id]` | `features/sales/SalesOrderDetailScreen.tsx` | 왼쪽 수주 목록(검색, 전체/진행중/납기 위험 칩, 50건) · 머리(수주번호·고객사·상태·납기 위험·재생산 필요, 업무방·작업 로그·출하요청 만들기·수주 취소, 등록 일시·담당, 취소 불가 사유) · 취소된 수주 띠 · 탭 4개 |

탭 (`features/sales/components/`)
- **충족 현황** `FulfillmentTab.tsx` — 품목별 표: 수주 매수·톤·납기·**예약 ÷ 미출하 · 생산중 ÷ 수주 · 검사합격 ÷ 수주 · 출하 ÷ 수주**(지표마다 막대 + "n / 분모" + %), 미확보, 추가 계획 필요, 합계 행. 아래 안내: 분모가 다르고 지표를 더하지 않는다(4.5). 재생산 필요 품목은 빨간 띠 + [재생산 계획 만들기](생산계획·히트 편성 USE, 확인 창). 추가 계획 필요가 여재로 채워질 수 있으면 안내 띠만. 출하 준비 카드(품목별 출하 가능 예약, 출하요청 목록·상태, 밀시트 번호), 업무방 카드, 품목별 생산계획 요약.
- **생산 연결** `ProductionLinkTab.tsx` — 연결 계획마다 편성표(부족 매수·수주 목표·누적 계획수율·필요 용강량·히트 수×용량·히트 전체 톤·히트당 슬래브·계획 슬래브·예상 슬래브 여재), 진행(제강·연주 히트, 슬래브·코일, 합격·판정 대기·불합격, 잔여 목표), 편성 히트 표(순번·히트 번호(LOT 추적 링크)·전로·생산일·히트 톤·성분 판정·연주·슬래브), 카드마다 [작업 실적] 단추(`/production/results?plan=`). 재생산·완료 후 여재 꼬리표. 수주 취소로 연결이 풀린 진행 계획도 "수주 연결 해제"로 보인다(작업 로그의 이 수주 계획 이벤트 기준).
- **예약** `ReservationTab.tsx` — 품목·규격 코드·상태(예약중/출고 전환/해제)·예약 매수·톤(계산값)·생성·변경. 해제 행은 흐리게.
- **이력** `HistoryTab.tsx` — 이 수주(`business_event.sales_order_id`)의 작업 로그를 **시간순**(동률은 id)으로: 주체(시스템/사원 이름)·유형 표시명·대상 번호·사유·LOT 번호(추적 링크). [작업 로그에서 보기] → `/business-events?salesOrderId=…`.

창
- `CancelSalesOrderModal.tsx` — 수주 취소(사유 필수 200자, `cancel_reason`). 취소하면 일어나는 일(예약 해제 n, 시작 전 계획 취소 n건, 진행중 계획은 연결 해제 + 완료 후 여재, 품목 취소·작업 로그). 화면을 연 시점의 `updatedAt`을 넘겨 COM-001.
- `OpenWorkRoomModal.tsx` — 업무방 열기: 조직도(부서 트리 + 사람, 이름·부서 검색)에서 멤버를 고른다. 나(연 사람)는 늘 포함, 이미 멤버는 체크·잠금. 만들기/가기 뒤 `/messenger?room=<id>`로 이동.

## 2. 흐름과 근거

| 흐름 | 근거 | 처리 |
|---|---|---|
| 수주 등록 → 재고 우선 예약 → 부족분 생산계획(히트 편성) | REQ-SO-001~003, BP-SO-01, 14.1-1, 14.2 | `salesOrderApi.create` → core `createSalesOrder` (작업 로그 SALES_ORDER_CREATED USER · RESERVATION_CREATED SYSTEM STOCK_FIRST · PRODUCTION_PLAN_CREATED SYSTEM ORDER_SHORTAGE). 저장 뒤 상세로 이동, 토스트 "SO-… 수주를 등록했어요 · 재고 예약 n매 · 부족 n매 → 생산계획 k건" |
| 등록 전 미리보기 | SO-003 | `salesOrderApi.preview` → core `previewSalesOrder` (같은 규격 앞 줄이 먼저 예약) |
| 충족 현황 | REQ-SO-004, 4.5 | core `fulfillmentOf.measures` 그대로(분모 포함) |
| 헤더 상태·납기 위험 | REQ-SO-005, 공통 코드 비고 | core `listSalesOrders`의 계산값 |
| 취소 | REQ-SO-006, BP-SO-02, 9.3 SO-003·SO-004, PLAN §6-2 | `salesOrderApi.cancel` → core `cancelSalesOrder`. 화면은 `cancelBlock`으로 버튼을 막고 9.3 문구를 보인다 |
| 재생산 | REQ-PRD-006, 14.1-6, stage4 | `salesOrderApi.createReproduction` → core `createReproductionPlan` (여재 먼저 예약, 남는 것만 is_reproduction 계획, REPRODUCTION_PLAN_CREATED). 자동 생성 없음 |
| 업무방 열기 | REQ-MSG-001 | `salesOrderApi.openWorkRoom` → core `openWorkRoom` (수주당 1방, 있으면 새 멤버만 더함, 시스템 메시지) |
| 이력 | REQ-LOG-003 | `salesOrderApi.timeline` → core `salesOrderTimeline` |

## 3. api (`client/src/api/salesOrders.ts`) · 훅 (`client/src/hooks/useSalesOrders.ts`)

| 함수 | 권한 | 서비스 |
|---|---|---|
| `list()` → `SalesOrderListRow[]`(요약 + `itemLines`) | 수주 등록·취소 VIEW 이상 | `listSalesOrders` |
| `detail(id)` | 〃 | `salesOrderDetail` (없으면 COM-003) |
| `productionLinks(id)` → `{lineNo, plan}[]` | 〃 | `productionPlanView` (results 뺌) |
| `timeline(id)` | 〃 | `salesOrderTimeline` |
| `preview(lines)` | 수주 등록 VIEW 이상 | `previewSalesOrder` |
| `create(input)` | 수주 등록 USE | `createSalesOrder` |
| `cancel({salesOrderId, cancelReason, expectedUpdatedAt})` | 수주 취소 USE | `cancelSalesOrder` |
| `workRoom(id)` → `{chatRoomId, chatRoomName, memberEmployeeIds} \| null` | 수주 조회 | `workRoomOfSalesOrder` |
| `openWorkRoom({salesOrderId, memberEmployeeIds})` | 수주 조회 | `openWorkRoom` |
| `createReproduction({salesOrderItemId})` | 생산계획·히트 편성 USE | `createReproductionPlan` |

- 조회 키: `salesOrderKeys`(`['sales-orders', …]`) — 이 파일 안에 둠. 변경 뒤에는 `useAction`이 모든 조회를 무효화한다.
- 훅: `useSalesOrderList`, `useSalesOrderDetail`, `useSalesOrderProductionLinks`, `useSalesOrderTimeline`, `useSalesOrderPreview`(keepPreviousData), `useSalesOrderWorkRoom`.
- 순수 계산 `features/sales/lib/salesOrderForm.ts`(+테스트): 매수 확인(`/^\d+$/`, 1 이상, 글자를 지우지 않음), 줄 오류(문구는 SO-002 그대로), 미리보기 줄, 수량 단위(매/개/매·개), 분모 표시·% 버림, 목록 거르기.

## 4. 보고서 1 C 항목 반영

- C-2-1 '주문' → 모두 '수주'(수주 매수·수주 합계). C-2-2 '가용재고'(띄어 쓰지 않음)·'예약 가용'. C-2-3 '선입선출' → 'FIFO'. C-2-7 '생산 필요' → '부족 매수'. C-2-8 '남음' → '미확보'·'추가 계획 필요'(4.5). C-2-9 상태 표시명은 공통 코드 그대로(진행중·부분출하·출하완료·취소, 계획·진행중·완료, 예약중·출고 전환·해제, 판정 대기, 배정 대기·배정 확정·출고 완료).
- C-3-1 SALES_ORDER_ITEM_STATUS(OPEN 등) · C-3-8 계획 상태(CONFIRMED 없음) · C-3-10 권한 이름(SALES_ORDER_CREATE·SALES_ORDER_CANCEL·SHIPMENT_REQUEST_MANAGE·PRODUCTION_PLAN_CONFIRM) · C-3-13 SO-003·SO-004 문구.
- C-4-1 비고 없음. C-4-7 업무방 자동 멤버 문구 삭제 → 조직도에서 고름. C-4-9 납기 위험 배지·필터는 남김(PLAN §5), 'D-7 이내'·'이번 달' 칩과 납기 범위 필터는 넣지 않음. C-4-11 진행률 = 지표별 분모 명시(합산 공식 없음). C-4-12 생산계획 '여재 사용' 열 없음(편성표의 예상 슬래브 여재만). C-4-14 납기 '오늘 이후' 규칙 없음.
- C-5-3 납기는 품목마다(`sales_order_item.due_date`). C-5-6 취소는 9.3대로(출고분 있으면 SO-003, 진행 중 출하요청 있으면 SO-004 — 잔량 취소·출하요청 자동 취소 안내 삭제). C-5-14 출하요청 만들기는 출하요청 관리 USE를 확인, 진행률은 버림으로 통일.
- C-6 Tailwind만, 커스텀 훅으로 조회, `order` 단독 이름 없음(`CancelSalesOrderModal`, `salesOrderId`), 컴포넌트 파일 PascalCase, 훅은 `use*.ts`.

## 5. 시드

- 새 시드 없음. core 시드(SO-2609-001~005, 업무방 1개)로 모든 화면이 채워진다. 등록할 것 없음.

## 6. 가정값 (6개 문서에 없어 정한 것)

| 항목 | 값 | 이유 |
|---|---|---|
| 수주 화면 조회 권한 | 수주 등록·수주 취소 중 하나라도 VIEW 이상 (screens.ts와 같음). 조회 api도 같은 규칙으로 COM-002 | BP-AUTH-01 "각 API에서 권한 재확인" |
| 업무방 열기 권한 | 수주를 볼 수 있는 사원이면 누구나(사용 권한 코드 없음) | 업무방·메신저는 권한 코드가 없다(공통 코드 PERMISSION) |
| 업무방 수주 요약 | 그 업무방 멤버이면서 수주 조회 권한(수주 등록·취소 VIEW 이상)도 있어야 볼 수 있다. 권한이 없으면 메신저가 "denied"(수주 조회 권한 없음)로 보인다 | 04 BP-MSG-01 "방 멤버 권한과 ERP 대상 조회 권한을 모두 확인한다". 요약은 메신저 영역(`messengerApi.getRoom`)이 만든다 |
| 목록 진행 막대 | 검사합격(= 예약 + 출하) ÷ 수주 매수 | core 충족 지표 `passed`, 4.5 분모 명시 |
| 생산 연결의 '연결 해제' 계획 | 지금 연결된 계획 + 작업 로그에 이 수주로 남은 생산계획 이벤트의 계획 | 취소 뒤에도 어떤 계획이 여재로 넘어갔는지 보이게 |
| 미리보기 납기 | 미리보기는 납기를 쓰지 않으므로 서비스 입력 확인용으로 오늘 날짜를 넣는다(저장 안 함) | core `previewSalesOrder`가 납기 형식을 확인함 |
| 다른 영역 주소 | `/messenger?room=`, `/shipment-requests/new?salesOrderId=`, `/shipment-requests/<id>`, `/mill-sheets?id=`, `/production/plans?plan=`, `/production/results?plan=`, `/lots/trace?lot=`, `/business-events?salesOrderId=` | 옛 화면 주소를 따름. 병합 때 각 영역 주소와 맞춰야 함 |

## 7. 공유 파일 변경

- 없음. (screens.ts·routeTitles.ts에 이미 `/sales-orders`, `/sales-orders/new`, `/sales-orders/[id]`가 있음.)

## 8. 확인·테스트

- `npm run typecheck -w @fantasteel/client` 0 오류, `npm run test -w @fantasteel/client` 167개 통과(이 영역 21개).
  - `api/salesOrders.test.ts` 15개: 목록·권한(생산 VIEW 통과, 구매·물류 COM-002), 분모 지표, COM-003, 미리보기(14.1 6/4, 같은 규격 두 줄, SO-001·002), 등록(14.1 작업 로그 순서·주체·사유, 혼합 수주 14.2, COM-002·SO-001·SO-002·COM-003·납기 누락에 아무것도 저장 안 됨), 취소(SO-003·SO-004·COM-002·사유 필수·COM-001·해제/계획 취소·다시 취소 거부·풀린 재고 가용, 진행 중 계획 연결 해제 + SURPLUS_CONVERTED), 재생산(COM-002·생성·재생산 필요 0·중복 거부·COM-003), 업무방(생성·멤버 추가·COM-003·COM-002). 변경 뒤 `checkInvariants` = [].
  - `features/sales/lib/salesOrderForm.test.ts` 6개.
- 지시대로 dev 서버·`next build`는 돌리지 않았다. 화면은 타입 검사와 코드 검토로만 확인했다(병합 단계 빌드·화면 확인 필요).

## 9. 남은 일·확인 필요

1. 업무방 머리의 수주 요약은 메신저 영역(`messengerApi.getRoom`의 `salesOrderState`·`salesOrder`)이 만든다. 병합(a288b08) 때 `salesOrderApi.roomSummary`·`useSalesOrderRoomSummary`는 지웠다. 방 멤버이면서 수주 조회 권한이 있어야 요약이 보이고, 없으면 "denied"다(BP-MSG-01).
2. 출하요청·밀시트·생산계획 화면의 쿼리 이름(`?salesOrderId=`, `?id=`, `?plan=`)이 각 영역과 같은지 병합 때 확인.
3. 업무방 열기는 작업 로그 유형이 29개 안에 없어 남기지 않는다(시스템 메시지만).
4. 예약 탭의 '구분'(재고 우선/자동 예약) 열은 예약 행에 사유가 없어 빼고, 이력 탭에서 보게 했다.

## 10. 검토 반영 (2026-10-02)

| 지적 | 근거 | 고친 것 |
|---|---|---|
| 업무방 수주 요약 가정값이 "멤버면 수주 조회 권한 없이 본다"로 남음. 지운 `roomSummary`·`useSalesOrderRoomSummary`가 문서에 남음 | 04 BP-MSG-01 "방 멤버 권한과 ERP 대상 조회 권한을 모두 확인한다" | §3 api 표의 `roomSummary` 행과 훅 목록의 `useSalesOrderRoomSummary`를 지웠다. §6 가정값과 `docs/rework/seed-assumptions.md`의 같은 행을 "멤버 **이면서** 수주 조회 권한, 없으면 메신저 denied"로 고쳤다. §9-1도 다시 썼다 |
| `api/salesOrders.ts`의 `salesOrderKeys` 위에 지운 코드를 설명하는 주석이 남음 | 같은 BP-MSG-01 | 주석을 지웠다 |
| 밀시트 주소가 `/mill-sheets?millSheet=` | `MillSheetScreen`·`FulfillmentTab`은 `?id=` | §6·§9-2를 `/mill-sheets?id=`로 고쳤다 (코드는 이미 `?id=`) |
| 생산 연결 탭 안내가 "작업 실적과 실적 시뮬레이션은 생산계획 화면에서 해요" | PLAN §7 생산·재고, stage3.md 화면 4 (`/production/results?plan=…`) | "작업 실적 화면에서 해요"로 고치고, 계획 카드마다 [작업 실적] 단추(`/production/results?plan=<id>`, 생산계획 화면과 같은 모양)를 달았다 |
| 편성표 빈 안내에 금지어 '배합' 단독 사용 | 03 용어 사전 TRM-027 배합 원단위(동의어 '배합' 사용 금지) | "편성표를 계산할 수 없어요 (계획 수율·배합 원단위·규격 매핑 확인 필요)" |
| 충족 지표 막대 `muted` 색이 `bg-[#9db6d1]` | 05 §9, B안 토큰(`--color-chart-3`) | `bg-chart-3` (같은 색) |
| 매수 변수에 `Qty`가 없음 | 05 §2 [강제] "매수는 Qty" | `reserveTotal`→`reserveTotalQty`, `shortageTotal`→`shortageTotalQty`(SalesOrderCreateScreen), `need`→`reproductionNeedQty`(FulfillmentTab) |

- 테스트: `api/salesOrders.test.ts`에 1개 더함 — 업무방 멤버(물류)라도 수주 조회 권한이 없으면 `salesOrderApi.detail`·`workRoom`이 COM-002이고 `messengerApi.getRoom`의 `salesOrderState`가 `denied`, 영업은 `ok`(BP-MSG-01).
- 공유 파일 변경: `docs/rework/seed-assumptions.md` 업무방 수주 요약 1행만 고침(위 BP-MSG-01).
- 확인: `npm run typecheck -w @fantasteel/client` 0 오류, `npm run test -w @fantasteel/client` 543개 통과(74 파일). dev 서버·`next build`는 돌리지 않았다.
