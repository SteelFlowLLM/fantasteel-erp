# sales-order · inventory · shipment 모듈에서 새로 지은 이름

용어 사전·업무 프로세스 정의서 11·12장에 없는 이름만 적는다. 스키마·shared에 이미 있는 이름(`salesOrderNo`, `orderedQty`, `shippedQty`, `reservedQty`, `availableQty`, `shortageQty`, `requestQty`, `shipmentRequestNo`, `goodsIssueNo`, `millSheetNo`, `pdfStatus`, `snapshot`, `isAutoReserved`, `scheduledReceiptTon`, `theoreticalWeightTon`, `isPassed` 등)은 제외했다.
**DB 테이블·컬럼·공통코드 값은 새로 만들지 않았다.** 아래는 모두 API 응답·요청 필드(계산값)와 코드 안의 이름이다.

## 수주 (sales-order)

| 이름 | 어디에 쓰는지 | 왜 필요한지 |
|---|---|---|
| `orderedTon`, `shippedTon`, `reservedTon` | 수주·예약 응답 | 매수 × 1매 이론중량 계산값 (REQ-SO-002: 톤은 저장하지 않고 계산해 표시) |
| `qtyUnit` | 수주·출하·재고·밀시트 응답 | 화면 수량 단위 `매`/`개` (shared `ITEM_QTY_UNIT` 값) |
| `passedQty` | 충족 현황 | "검사합격" 매수 = 자동 예약된 ACTIVE 예약 (REQ-SO-004의 검사합격 칸) |
| `inProductionQty` | 충족 현황 | "생산중" 매수 = 진행 계획 잔여 목표를 미확보 매수 안에서 자른 값 |
| `unsecuredQty` | 충족 현황 | 프로세스 정의서 4.5 "현재 미확보 매수" |
| `additionalPlanNeededQty` | 충족 현황 | 프로세스 정의서 4.5 "추가 계획 필요 매수" |
| `remainingTargetQty` | 충족 현황의 생산계획 | 프로세스 정의서 4.5 "진행 계획 잔여 목표 매수" |
| `cancelledQty` | 수주 품목 응답 | 부분 출하 뒤 취소된 잔량 (주문 − 출하). 취소 매수 컬럼이 없어 계산값으로 준다 |
| `progressRate` | 수주·품목 응답 | 진행률(%) |
| `daysToDue`, `isDeliveryRisk` | 수주 응답, 쿼리 `deliveryRiskOnly` | 납기 위험(TRM-107) 규칙 판정 결과와 남은 일수 |
| `salesOrderStatus` | 수주 응답, 쿼리 `status` | 품목 상태에서 계산한 헤더 상태 (shared `SALES_ORDER_STATUS`) |
| `workRoomId` | 수주 응답 | 수주 업무방(`chat_room`) id |
| `ownerEmployee` | 수주 응답 | 수주 담당 (스키마 관계 이름 그대로) |
| `allocationPurpose`, `allocationStatus`, `isHeatPassed`, `heatNo` | 충족 현황의 LOT | 그 LOT이 어떤 목적으로 배정됐고 히트가 합격인지 |
| `dueFrom`, `dueTo`, `keyword`, `page`, `size`, `rows`, `total` | 목록 쿼리·응답 | 필터·페이징 |
| `IdempotencyService`, 헤더 `Idempotency-Key` | 수주 등록·출고 확정 | 프로세스 정의서 12.2·13.2의 "요청 고유키"(claimRequestId). `idempotency_key.request_key`에는 `<범위>:<사원 id>:<키>`로 저장한다. 범위는 `SALES_ORDER_CREATE`, `GOODS_ISSUE:<출하요청 id>` |
| 업무방 멤버 부서 코드 `PRODUCTION`, `QUALITY`, `LOGISTICS`, `PURCHASE` | 수주 등록 | 생산부·품질부·물류부·구매부 부서장을 찾는 기준 (시드의 `department_code`) |
| 알림 중복 방지 키 `SO_CANCELLED:<수주 id>` | `notification.dedupe_key` | 수주 취소 알림 |

## 재고·배정 (inventory)

| 이름 | 어디에 쓰는지 | 왜 필요한지 |
|---|---|---|
| `onHandTon`, `availableTon`, `reservedTon` (제품) | 재고 응답 | 매수 × 1매 이론중량 계산값 (REQ-INV-001) |
| `pendingInspectionQty` | 재고 응답 | 검사 대기 LOT 수 (자기 검사 또는 히트 검사 전) |
| `failedQty` | 재고 응답 | 불합격 LOT 수 (자기 불합격 또는 히트 불합격) |
| `earmarkedQty`, `isEarmarked` | 재고 응답, 배정 추천 | 열연 투입용 "귀속 슬래브"(SERVER-GUIDE 6장) 수·여부 |
| `surplusQty`, `surplusTon`, `ageDays` | 여재 응답 | 여재 매수·톤, 생산완료 뒤 지난 일수 (REQ-INV-008) |
| `steelGrade` | 재고·여재 쿼리 | 강종 코드 필터 |
| `requiredQty`, `confirmedQty`, `neededQty` | 배정 추천·확정 응답 | 필요한 전체 매수 / 이미 확정 / 아직 배정할 매수 |
| `recommendedLots`, `candidateLots`, `confirmedAllocations` | 배정 추천 응답 | FIFO 추천 / 고를 수 있는 전체 / 현재 확정 배정 |
| `shortageQty` (배정 추천 응답) | 배정 추천 응답 | 추천으로 못 채우는 매수. 용어 사전의 부족 매수(`shortageQty`)와 같은 뜻으로 재사용 |
| `lotIds`, `releaseAllocationIds`, `reason` | 배정 확정 요청 | 확정할 LOT / 같은 tx에서 먼저 해제할 배정 / 사유 |
| `recommendedLotNos`, `isRecommendationFollowed`, `releasedAllocationIds` | 배정 확정 응답·작업 로그 | 추천 내용과 추천대로 확정했는지 (REQ-INV-006 "추천은 작업 로그로만") |
| 알림 중복 방지 키 `SHIPMENT_ALLOCATED:<출하요청 id>` | `notification.dedupe_key` | 물류 "출고 대기" 알림 |

## 출하 (shipment)

| 이름 | 어디에 쓰는지 | 왜 필요한지 |
|---|---|---|
| `GET /shipment-requests/shippable` | 경로 | 지금 출하요청할 수 있는 수주 품목 (작업 지시에 있던 경로) |
| `shippableQty`, `shippableTon`, `requestedQty` | shippable 응답 | 출하요청 가능 매수 = ACTIVE 예약 − 다른 미출고 출하요청 매수 |
| `POST /shipment-requests/:id/goods-issue` | 경로 | 출고 확정. 프로세스 정의서 12.2 예시는 `POST /goods-issues/:id/confirm`이지만 SERVER-GUIDE 7장 경로를 따랐다 |
| `requestTon`, `allocatedQty` | 출하요청 응답 | 요청 톤(계산값), 배정된 LOT 수 |
| `issuedQty`, `issuedTon` | 출고 응답 | 이번 출고 매수·톤 |
| `requester`, `confirmedEmployee` | 출하요청·출고 응답 | 요청자·출고 확정자 (사번·이름) |
| `shipFrom`, `shipTo`, `from`, `to` | 목록 쿼리 | 날짜 범위 |
| `MillSheetSnapshot` 의 `customer`, `salesOrder`, `shipment`(`goodsIssuedAt`), `productSpec`, `qty`, `weightTon`, `heats[].composition`, `lots[].inspection`, `lots[].parentSlab` | `mill_sheet.snapshot` JSON | 발행 시점 값 복사본의 구조 (REQ-SHP-003). 안쪽 필드는 스키마 컬럼 이름을 그대로 썼다 |
| `heatNos`, `pdfUrl` | 밀시트 목록·상세 응답 | 목록 표시용 히트 번호, PDF 내려받기 경로 |
| 환경변수 `MILL_SHEET_FONT_PATH` | 서버 실행 환경 | 밀시트 PDF 한글 글꼴(.ttf) 경로 (작업 지시에 있던 이름) |
| 알림 중복 방지 키 `GOODS_ISSUE:<출고 id>:<수주 id>`, `SHIPMENT_REQUEST_CANCELLED:<출하요청 id>` | `notification.dedupe_key` | 출고 완료·출하요청 취소 알림 |
