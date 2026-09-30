# 새로 지은 이름 — lot · business-event · dashboard

용어 사전과 업무 프로세스 정의서 11·12장에 없는 이름만 적는다. 형식: 이름 · 어디에 쓰는지 · 왜 필요한지.
(공통코드 값은 새로 만들지 않았다 — `LOT_TYPE`, `LOT_RELATION_TYPE`, `LOT_EVIDENCE_TYPE`, `BUSINESS_EVENT_TYPE(_LABEL)`, `WIDGETS` 등 기존 상수만 사용.)

## 클래스·파일 (12.1의 `lot-trace/` 대신 `modules/lot/` 로 두었다 — 폴더명은 SERVER-GUIDE 지정)

| 이름 | 어디 | 왜 |
|---|---|---|
| `LotService` | `lot/lot.service.ts` | LOT 목록·상세·검색 (`LotTraceService`는 12.1에 있음) |
| `LotGraphService` | `lot/lot-graph.service.ts` | `lot_relation`을 내부 id로 따라가는 탐색(`walk`)과 순환 판정(`detectCycle`), 조상·자손 id(`lineageIds`). 역추적·정추적과 작업 로그의 "상·하위 LOT 포함"이 같이 쓴다 |
| `LotGraphModule` | `lot/lot-graph.module.ts` | 컨트롤러 없이 `LotGraphService`만 내보낸다. business-event가 `LotModule`(컨트롤러 있음)을 import 하면 `GET /lots/:id`가 다른 모듈의 `GET /lots/rejected`보다 먼저 등록되기 때문 |
| `LotRepository`, `BusinessEventRepository`, `DashboardRepository` | 각 모듈 | 컨벤션의 repository 계층 |
| `BusinessEventService` | `business-event/` | 12.1의 `DecisionReplayQuery` 역할 (수주·LOT 타임라인 조회) |
| `DashboardLayoutService`, `DashboardWidgetService`, `SearchService` | `dashboard/` | 배치 저장·위젯 집계·통합 검색을 나눈 서비스 |
| `dashboard-layout.ts` (`buildDefaultLayout`, `validatePlacements`, `parseStoredLayout`, `GRID_COLUMNS`) | `dashboard/` | 배치 규칙을 DB 없이 테스트하려고 순수 함수로 분리 |
| `delivery-risk.ts` (`daysToDue`, `isDeliveryRisk`) | `dashboard/` | REQ-AGT-004 납기 위험 규칙 (Agent가 나중에 재사용 가능) |
| `kst.ts` (`kstDayStart`, `kstDateString`, `kstTodayDate`, `lastDays`) | `dashboard/` | "오늘"·"하루"를 한국 시간으로 계산 |
| `testing/genealogy.fixture.ts` | `lot/testing/` | 테스트 전용: 시험용 LOT 관계·수주·출고를 만들고 지움 (운영 코드에서 사용 안 함) |

## LOT API 필드

| 이름 | 어디 | 왜 |
|---|---|---|
| `isEligible` | `LotView` | "적격 LOT"(자기 검사 합격 + 상위 히트 합격 + IN_STOCK, StockService 주석의 용어)을 화면이 바로 쓰게 |
| `isSurplus` | `LotView` (슬래브) | 여재 = 적격·수주 미귀속·CONFIRMED 배정 없음 (SERVER-GUIDE 6장 정의). 저장하지 않고 계산 |
| `title` | `LotView`, `LotTraceNode` | 화면 한 줄 표시용 이름 (LOT 번호를 파싱하지 않고 컬럼 값으로 조합) |
| `weightTon` | `LotView`, `LotTraceNode` | 슬래브·코일 1개의 이론중량 계산값 (`calcWeightTon(1, …)`) |
| `inspectionResult`, `inspectionResultLabel`, `inspection` | `LotView` | `is_passed`를 `INSPECTION_RESULT`(PENDING·PASS·FAIL)로 옮긴 값과 최근 검사 요약 |
| `parents`, `children`, `LotLink` | LOT 상세 | 바로 위·아래 LOT (`lot_relation`의 부모·자식) |
| `direction` = `backward` \| `forward` | 추적 쿼리 | 요구사항의 역추적·정추적 (값은 SERVER-GUIDE 7장 표기) |
| `nodes`, `edges`, `levels`, `summary`, `impact` | `LotTraceResponse` | 그래프 표시용 응답 구조 (지시서의 nodes/edges/levels) |
| `isRoot`, `depth` | `LotTraceNode` | 시작 LOT 표시와 시작점에서의 거리 |
| `isPeriodBased`, `evidenceLabel` | `LotTraceEdge` | `evidence_type = PERIOD`(기간 기반)를 정확한 투입량처럼 보이지 않게 하는 표시 |
| `hasCycle`, `truncated`, `hasPeriodEvidence`, `countByType` | `LotTraceResponse.summary` | 순환·상한(2000개) 도달·기간 기반 연결 유무·유형별 개수 |
| `salesOrderLinks` + `linkType` = `PRODUCED_FOR` \| `ALLOCATED` \| `SHIPPED` | `LotTraceNode` | LOT이 닿은 수주 품목이 "생산한 원래 수주 품목 / 배정된 품목 / 출고된 품목" 중 무엇인지 |
| `shipment` (`goodsIssueNo`, `shipmentRequestNo`, `millSheetNos` …) | `LotTraceNode` | 정추적에서 출고·밀시트·고객사까지 보여주기 위한 묶음 |
| `impact` (`shippedProductLotCount`, `unshippedProductLotCount`, `shipments`, `salesOrders`) | 정추적 응답 | 영향받은 출하·수주 요약 (리콜 범위 확인용) |

## 작업 로그 API

| 이름 | 어디 | 왜 |
|---|---|---|
| `includeLineage` | 쿼리 | 지시서에서 정한 이름. LOT의 조상·자손 LOT의 이벤트까지 포함 |
| `isLineageOnly` | `BusinessEventView` | `includeLineage` 조회에서 요청한 LOT이 아니라 조상·자손 LOT의 이벤트임을 표시 |
| `order` = `asc` \| `desc`, `cursor`, `nextCursor`, `hasMore` | 쿼리·응답 | 시간순 타임라인(asc)/최근순 목록(desc)과 커서 방식 페이지 나누기. (`order`는 정렬 방향이며 수주를 뜻하지 않는다) |
| `actorLabel` | `BusinessEventView` | 사용자면 이름, 시스템이면 "시스템" |
| `actor`, `lots`, `salesOrderNo`, `eventTypeLabel`, `before`, `after` | `BusinessEventView` | 목록에서 바로 그리려고 사원·LOT 번호·수주번호·라벨을 풀어 준 값 (`before`/`after`는 `before_data`/`after_data`) |

## 대시보드 API

| 이름 | 어디 | 왜 |
|---|---|---|
| `placements`, `isDefault` | `DashboardLayoutResponse` | 지시서의 `WidgetPlacement[]`를 감싸고, 기본 배치인지 알려 주려고 |
| `available`, `grade` (`P2`), `generatedAt` | 위젯 응답 | P2 위젯은 `{ available: false, grade: 'P2' }`만, 나머지는 `available: true` |
| `definitions`, `definition`, `rule`, `note` | 위젯 응답 | 지표 정의(분모·포함 관계)를 화면 툴팁에 쓰라고 응답에 넣음 (업무 프로세스 정의서 4.5) |
| PROCESS_FLOW `stages[].key`: `OPEN_PLANS`, `HEAT_AWAITING_INSPECTION`, `SLAB_AWAITING_INSPECTION`, `COIL_AWAITING_INSPECTION`, `QUALIFIED_SLAB`, `QUALIFIED_COIL`, `OPEN_SHIPMENT_REQUESTS`, `ISSUED_TODAY` | 공정 흐름 위젯 | 지시서의 단계별 건수를 프론트가 구분할 식별자 |
| `issuedToday` | 공정 흐름 위젯 | 오늘 출고한 출고 건수·LOT 수 |
| `salesOrders`, `totalOpenSalesOrders`, `deliveryRiskDays` | 수주 충족 위젯 | 진행 중 수주 목록과 전체 건수, 기준일(생산 설정) |
| `inProductionQty` | 수주 충족 위젯 | 진행 중 생산계획의 잔여 목표 매수 = 목표 − 불합격 아닌 생산 LOT 수 (4.5의 "진행 계획 잔여 목표 매수") |
| `reservedQty`(위젯), `progressRate` | 수주 충족 위젯 | ACTIVE 예약 매수 / 출하 ÷ 주문 (분모 명시) |
| `daysToDue`, `isDeliveryRisk`, `isOverdue` | 수주 충족·납기 위험 위젯 | 납기 위험 규칙 결과 |
| `plannedYieldRate`, `actualYieldRate`, `qtyAttainmentRate` | 공정별 수율 위젯 | 라우팅 계획 수율 / 산출 톤 ÷ 투입 톤 / 산출 매수 ÷ 계획 매수 |
| `scheduledReceiptTon`, `grossRequiredTon`, `netRequiredTon`, `mrpRun` | 원료 잔량 위젯 | 입고예정·MRP 총소요·순소요 (컬럼 `scheduled_receipt_ton`, `required_ton`, `net_required_ton`에서) |
| `inspectedCount`, `failedCount`, `rejectRate`, `byProcess` | 불합격률 위젯 | 판정된 검사 수·불합격 수·비율 |
| `requisitionsByStatus`, `openPurchaseOrders` (`purchaseOrders`, `outstandingTon`) | 구매 진행 위젯 | 구매요청 상태별 건수, 미입고 톤 |
| `series` (`issuedQty`, `slabQty`, `coilQty`, `issuedTon`) | 출하 실적·생산량 위젯 | 최근 N일 일별 집계 (빈 날 0) |
| `summary` (`count`, `totalTon`, `maxAgeDays`, `avgAgeDays`), `ageDays` | 여재 보유 기간 위젯 | 여재 개수·톤·보유 일수 |
| 검색 결과 `kind`, `kindLabel`, `label`, `linkPath` | `GET /search` | 지시서의 `{ kind, label, linkPath }` + 화면 라벨. `kind` 값은 `EVENT_TARGET_TYPE` 이름(`SALES_ORDER`, `LOT`, `PRODUCTION_PLAN`, `PURCHASE_REQUISITION`, `SHIPMENT_REQUEST`, `MILL_SHEET`) 재사용 |

## 공통코드 요청

없음 (새 코드 값을 만들지 않았다).
