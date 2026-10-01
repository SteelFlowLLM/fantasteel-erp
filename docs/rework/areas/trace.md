# LOT 추적 · 작업 로그(이력 재현) · 통합 검색 (5단계 4·5·6번 화면)

- 2026-10-01, 병렬 작업(worktree) 영역. 근거: stage5.md 4~6번, 요구사항 REQ-LOT-005·REQ-LOG-001~003, 업무 프로세스 BP-LOT-01·BP-LOG-01·12.2(GET /lots/:id/trace?direction=, GET /business-events?salesOrderId=)·9.1(EV-), 용어 사전 TRM-068·072·073·074·084·086·116, 보고서 4 A-3·A-4·C, 보고서 6 A-1(통합 검색), PLAN 5장·6장·7장.
- 세 화면 모두 **조회 전용**이다. 변경 함수가 없으므로 이 영역이 새로 남기는 작업 로그도 없다.
- 거래 데이터(lot·lot_relation·business_event·business_event_lot 등)는 core-domain이 병렬로 만든다. 이 worktree에는 거래 시드가 없어서 화면은 빈 상태로 보이고, 테스트는 테스트 전용 고정 데이터(`features/lotTrace/testing/traceFixture.ts`)로 돌린다. **이 영역의 시드는 없다**(등록할 것 없음).

## 1. 화면·주소

| 화면 | 주소 | 여는 조건 (screens.ts, 바꾸지 않음) |
|---|---|---|
| LOT 추적 | `/lots/trace?lot=<LOT 번호>&direction=backward\|forward`, `/lots/trace?shipmentRequestNo=<출하요청 번호>` | 모든 사원 |
| 작업 로그 · 이력 재현 | `/business-events?salesOrderId=&lotId=&eventType=&actorType=&targetType=&from=&to=` | 모든 사원 |
| 통합 검색 | 상단 바 `SearchBox` | 모든 사원 |

### LOT 추적 (REQ-LOT-005, BP-LOT-01)
- 왼쪽 칸(B안 목록 칸): 방향(역추적 ← / 정추적 →), **LOT 번호·출하요청 번호** 검색(일부 입력, Enter = 정확히 같은 번호로 이동), 종류 칩(전체·코일·슬래브·히트·용선·원료)과 최근 LOT(생산완료일 최신순).
- 기본 방향: 코일·슬래브 = 역추적, 원료·용선·히트 = 정추적. LOT을 고른 뒤 방향을 바꿀 수 있다.
- 역추적: 코일 → 슬래브 → 히트 → 용선 · 합금철 → 원료. 슬래브 출하는 코일 단계 없이 그대로(데이터대로). 합금철은 히트에 바로 이어 용선 열에 둔다.
- 정추적: 원료·히트 → 영향받은 슬래브·코일 → **출하요청**(배정 SHIPMENT, CONFIRMED·CONSUMED) → 수주. '영향 요약' 카드: 슬래브·코일 수, 출고된/출고 전 제품, 출하요청, 수주(출고됨/출고 전, 가장 이른 납기, 영향 LOT 수).
- 출하요청 번호로 찾으면 그 출하요청에 배정·출고된 LOT 전부에서 역추적하고, 출하요청 노드를 맨 오른쪽에 둔다. 배정이 없으면 출하요청 정보와 "아직 배정된 LOT이 없어요".
- 계보는 `lot_relation`의 부모·자식 id만 따라간다(LOT 번호를 해석하지 않음). 같은 LOT은 한 번만 펼치고 자기 연결은 건너뛴다(`features/lotTrace/lib/traceGraph.ts`).
- 근거 표시: 원료 → 용선은 점선 + '기간 기반' 상자 + 기간, 용선·합금철 → 히트는 '실제 투입' + 투입 톤(LOT_RELATION_EVIDENCE 표시명 그대로). 고로·전로는 코드 그대로(BF2, BOF1).
- LOT 상세: 종류, 원료(이름·코드·원료 유형), **공급업체**(입고 → 발주 품목 → 발주의 공급업체), 입고 번호, 고로, 전로, 강종, 규격(코드·치수), 1매/1개 이론중량, 초기 수량, 잔량, 상위 히트, 생산계획, 야드, 생산완료일(날짜), 투입 소진, 출고, 여재, 불합격 처리 상태, 배정(용도·상태·수주 품목·출하요청·생산계획), 출하·밀시트, 바로 연결된 LOT(위·아래, 근거), 품질검사(공정, 판정, 판정에 쓴 기준 코드·버전, 항목 | 기준 | 측정값 | 판정). 링크: 수주·출하요청·생산계획·밀시트·검사 입력·이 LOT 작업 로그(`?lotId=`)·이 LOT부터 다시 추적.
- 보고서 4 C 반영: 'LOT 계보' → 'LOT 관계', '직접 투입' → '실제 투입', '공급사' → '공급업체', 출고번호 대신 출하요청, 출하요청 번호로 찾기, 고로·전로 코드 그대로, 라벨은 `codes/`에서만.

### 작업 로그 · 이력 재현 (REQ-LOG-001~003, BP-LOG-01)
- 필터: 이력 재현 대상(수주번호 고르기, LOT 번호 고르기), 주체(전체·사용자·시스템 = ACTOR_TYPE 표시명), 유형(BUSINESS_EVENT_TYPE 29개, 영역별 묶음), 대상(테이블), 기간(시작일~종료일, Asia/Seoul 날짜 포함). 조건은 모두 주소에 남는다. '조건 초기화'.
- 수주·LOT을 고르면 **이력 재현**: 수주 = `business_event.sales_order_id`, LOT = `business_event_lot`. 오래된 순, 같은 시각은 id 순(BP-LOG-01). 둘 다 고르면 둘 다 맞는 것. 아니면 전체 작업 로그를 최신순으로.
- 한 줄: 시각, 주체(사원 이름·부서 / '시스템'), 유형 표시명, 대상(테이블 한글명 + 번호 링크), 사유 코드, **EV- 번호**(`event_no`).
- 펼치면: 당시 기록(작업 로그 번호·주체·일시·유형·대상 = 한글명 + 테이블 DB명 + 번호·수주·**AI 경유 '준비 중 (P2)'**), 사유·근거(사유 코드·사유·**원본 메시지 링크**·Action Draft 링크), 변경 전 → 변경 후 표(바뀐 줄 강조), 관련 LOT 링크.
- 점 색은 `features/businessEvents/lib/eventTone.ts` 한 곳에서 정한다: 사용자 = 파랑, 시스템 = 회색, 불합격(검사 등록·판정의 불합격, 불합격 처리 상태 지정) = 빨강. 범례에 같은 규칙.
- '더 보기'는 50건씩 늘린다. 없는 수주·LOT id는 COM-003 화면("이 수주를 찾지 못했어요" + 조건 지우기).
- 다시 쓰는 부품: `features/businessEvents/components/EventTimeline.tsx`
  - `<EventTimeline filter={{ salesOrderId }} />` — 수주 상세 '이력' 탭에 그대로 넣는다(수주 열은 숨김). LOT은 `filter={{ lotId }}`.
  - `EventList`(이미 불러온 페이지 그리기), `EventLegend`(범례)도 내보낸다.
- 보고서 4 C 반영: 'Decision Replay' → '이력 재현', 대상 '생산 실적' → '작업 실적', '품질 검사' → '품질검사', 이벤트 29개만, `#id` 대신 EV- 번호, 사유 코드 8개(표시명이 06에 없어 코드 그대로), 원본 메시지 링크, AI 경유 P2 준비 중, 색 통일.

### 통합 검색 (보고서 6 A-1, PLAN 5장)
- 수주번호·LOT 번호·**출하요청 번호**(새로 추가)를 2글자부터 찾는다. 정확히 같은 번호 → 수주 → LOT → 출하요청 순, 최대 10건. Enter = 첫 결과.
- 이동: 수주 → `/sales-orders/:id`, LOT → `/lots/trace?lot=`, 출하요청 → `/shipment-requests/:id`.
- 그 화면을 열 수 없는 사원(조회 권한 없음)은 모든 사원이 여는 화면으로 보낸다: 수주 → `/business-events?salesOrderId=`(이력 재현), 출하요청 → `/lots/trace?shipmentRequestNo=`.
- placeholder: '수주번호·LOT 번호·출하요청 번호 검색'.

## 2. api 함수 (모두 `requireActor(tables)` — 계정 선택 없음·사용 안 함 사원이면 COM-002)

| 파일 | 함수 | 하는 일 | 오류 |
|---|---|---|---|
| `api/lotTrace.ts` | `lotTraceApi.searchLots({ keyword, lotType, limit })` | LOT 목록(정확히 같은 번호 먼저, 생산완료일 최신순) + 전체 수 | COM-002 |
| | `lotTraceApi.searchShipmentRequests(keyword)` | 출하요청 번호 찾기 | COM-002 |
| | `lotTraceApi.trace({ lotNo, direction? } \| { shipmentRequestNo })` | 노드·LOT 관계·출하요청·영향 요약 | 없는 번호 COM-003 |
| | `lotTraceApi.detail(lotId)` | LOT 상세 | 없는 id COM-003 |
| `api/businessEvents.ts` | `businessEventApi.list(filter)` | 작업 로그 + 전체 수 + 정렬 + 고른 수주·LOT | 없는 수주·LOT COM-003 |
| | `businessEventApi.searchSalesOrders(keyword)` | 이력 재현 수주 고르기 | COM-002 |
| | `filterBusinessEvents`, `compareEventsAsc`, `isReplayFilter` | 필터·정렬 규칙 (다른 화면에서 재사용 가능) | |
| `api/search.ts` | `searchApi.search(keyword)` | 통합 검색 | COM-002 |

- 조회 키: `lotTraceKeys`(`['lots', …]`), `businessEventKeys`(`['business-events', …]`)를 각 api 파일에 두었다. `queryKeys.search`는 그대로 쓴다.
- 훅: `hooks/useLotTrace.ts`(useLotSearch·useShipmentRequestSearch·useLotTrace·useLotDetail), `hooks/useBusinessEvents.ts`(useBusinessEvents·useSalesOrderOptions·useBusinessEventSubject), `hooks/useGlobalSearch.ts`(+ `useDebouncedValue`).
- 순수 함수: `features/lotTrace/lib/traceGraph.ts`(walkLotRelations·defaultTraceDirection), `lib/traceLayout.ts`(그래프 배치), `features/businessEvents/lib/eventDiff.ts`(변경 전·후 비교), `eventTone.ts`(점 색), `eventTargets.ts`(대상 한글명·이동 주소).

## 3. 테스트 (Vitest, 새로 36개)
- `features/lotTrace/lib/traceGraph.test.ts` 5 — 역추적·정추적·N:M 한 번만·순환/자기 연결·기본 방향.
- `features/businessEvents/lib/eventDiff.test.ts` 7 — 펴기·값 표시·바뀐 줄·색·대상 이름·이동 주소.
- `api/lotTrace.test.ts` 13 — 코일 역추적(기간 기반·실제 투입·합금철·고로/전로 코드), 슬래브 출하는 코일 단계 없음, 정추적(출하요청 2건·밀시트·영향 요약·수주), 방향 바꾸기, 출하요청 번호로 찾기, COM-003, COM-002(계정 없음·사용 안 함), 상세(공급업체·배정·출하·밀시트·검사 값·기준 버전), 목록·출하요청 찾기.
- `api/businessEvents.test.ts` 8 — 수주 이력 재현(오래된 순, 같은 시각 id 순), LOT 이력 재현, 한 줄 값(EV-·주체·대상·전후·사유·관련 LOT·링크), 최신순, 유형·주체·대상·기간 필터, 건수 제한, COM-003·COM-002, 수주 고르기.
- `api/search.test.ts` 3 — 세 종류 찾기·정확히 같은 번호 먼저, 권한 없는 사원의 대체 주소, 2글자 미만·COM-002.
- 전체: typecheck 0 오류, 테스트 16파일 113개 통과(이 worktree 기준).

## 4. 가정값
| 무엇 | 값 | 이유·출처 |
|---|---|---|
| 다른 화면 주소의 쿼리 이름 | `/production/plans?plan=`, `/production/results?result=`, `/purchase-orders?id=`, `/goods-receipts?id=`, `/mill-sheets?id=`, `/quality/inspections?lot=<LOT id>`, `/messenger?room=<채팅방>&message=<메시지>` | 옛 화면의 약속을 따랐다. 각 영역이 다른 이름을 쓰면 병합 때 `eventTargets.ts`의 `targetHref` 한 곳과 LOT 상세 링크만 고치면 된다 |
| 원료 LOT의 공급업체 | 입고(goods_receipt) → 발주 품목 → 발주의 supplier_id. 입고가 없으면 표시하지 않음(품목 기본 공급업체로 대신하지 않음) | 실제 그 LOT의 공급업체만 보이기 위해 |
| 정추적의 출하요청 | 배정 SHIPMENT 중 CONFIRMED(출고 전)와 CONSUMED(출고) 모두, 취소된 출하요청은 뺌 | 불합격 영향 범위 확인(TRM-073)에는 출고 전 배정도 필요 |
| 영향 수주 | 배정(CONFIRMED·CONSUMED)의 수주 품목 + LOT 생산계획의 수주 품목 | ERD 연결 그대로 |
| 불합격 이벤트 판단(빨강) | `INSPECTION_REGISTERED`의 after_data에 `inspectionResult: 'FAIL'`, 또는 `DISPOSITION_SET` | 자동 판정 결과를 after_data에 남긴다는 전제(아래 7장) |
| 대상 한글명 | 용어 사전 엔티티 한글명(예: production_result = 작업 실적, quality_inspection = 품질검사, action_draft = Action Draft). 없는 테이블은 DB명 | 용어 사전 |
| 대상 필터 목록 | sales_order, sales_order_item, production_plan, production_result, quality_inspection, lot, reservation, allocation, purchase_requisition, purchase_order, goods_receipt, shipment_request, shipment_request_item, mill_sheet, action_draft | 29개 이벤트의 대상 테이블 (shipment_request_item = 출하 배정 추천, 검토 반영 때 추가) |
| 사유 코드 표시 | 코드 그대로(STOCK_FIRST 등) | 06에 표시명이 없다(codes/businessEvent.ts 주석) |
| 작업 로그 한 번에 불러오는 수 | 50건, '더 보기'로 50건씩 | 옛 화면과 같음 |
| LOT 목록 수 | 최근 40개, 검색 20개 | 옛 화면과 같음 |

## 5. 뺀 것 (문서에 없거나 보고서 C·PLAN이 정리하라고 한 것)
- 작업 로그: '상·하위 LOT 포함', 키워드 검색, 정렬 버튼(이력 재현 = 오래된 순, 전체 = 최신순으로 고정), '과거 사례 검색'·'비슷한 과거 사례'(EX, CASE-004 호출 위치가 아님 — PLAN 7장 협업), KEY_LABEL 한글 키 이름(키는 ERD 컬럼 camelCase 그대로).
- LOT 추적: '최대 2,000개' 잘림 경고·순환 경고 띠(순환은 따라가지 않게만 막음), '예약·배정 가능/불가' 칩, 출고번호.
- 작업 로그 요약 문장(옛 summary): ERD business_event에 칸이 없다.

## 6. 공유 파일 변경
- 없음. `features/shell/SearchBox.tsx`는 이 영역 소유로 받았다(placeholder·주석만 고침). `features/shell/screens.ts`·`useShellTitle`·`PopPanel`·`components/**`·`codes/**`·`mock/**`는 읽기만 했다.
- 새 화면 주소를 만들지 않았으므로 `screens.ts`·`routeTitles.ts`는 그대로다.

## 7. 병합 때 확인할 것 (core-domain·다른 영역에 기대는 부분)
1. core가 작업 로그를 남길 때 `salesOrderId`(수주 이력 재현)와 `lotIds`(LOT 이력 재현, business_event_lot)를 채워야 타임라인에 보인다. 출고 확정은 모든 LOT을 lotIds로.
2. `INSPECTION_REGISTERED`의 after_data에 `inspectionResult`를 넣어야 불합격이 빨간 점으로 보인다.
3. `targetType`은 테이블 DB명(예: `shipment_request`), `targetNo`는 업무 번호·LOT 번호.
4. 수주 상세(3단계 영역)의 '이력' 탭은 `<EventTimeline filter={{ salesOrderId }} />`를 넣고, '작업 로그에서 보기' 링크는 `/business-events?salesOrderId=<id>`.
5. 다른 화면에서 LOT 작업 로그로 보낼 때는 `/business-events?lotId=<id>`(LOT 번호가 아니라 id), LOT 추적은 `/lots/trace?lot=<LOT 번호>`.
6. 위 4장 첫 줄의 쿼리 이름이 각 영역과 다르면 `eventTargets.ts`를 맞춘다.

## 8. 남은 것·알려진 한계
- 브라우저 확인은 하지 않았다(병렬 규칙: dev 서버·빌드 금지). 병합 뒤 시드가 들어오면 14.1 시나리오로 클릭 확인이 필요하다.
- 거래 시드가 들어오기 전까지 세 화면은 빈 상태로 보인다.
- 'AI 경유'(REQ-AST-010, P2)는 표시 자리만 '준비 중 (P2)'이다. `is_ai_assisted`는 늘 false.

## 9. 검토 반영 (2026-10-02)

| 지적 | 근거 | 고친 것 |
|---|---|---|
| 정추적 영향 요약의 '출고 전 제품'이 코일로 투입 소진된 슬래브까지 셈 | 03 TRM-073, 06 LOT_STATUS(CONSUMED = 투입 소진), REQ-LOT-005 | `api/lotTrace.ts` impactOf: 출고 전 제품 = 재고(AVAILABLE)인 슬래브·코일만. 투입 소진 수는 `consumedLotCount`로 따로 주고, 영향 요약 카드에 "투입 소진 N개는 다음 공정 LOT에 들어가 출고 전 제품에서 뺐어요" 한 줄(표시명은 `LOT_STATUS_LABEL.CONSUMED`). 테스트 기대값 4 → 2 |
| 열연 투입 배정(HOT_ROLLING)의 수주가 영향 수주에 안 잡힘 | BP-LOT-01 '→ 대상 수주', ERD allocation.production_plan_id(HOT_ROLLING일 때), 14.2 | `allocationSalesOrderItemId`: sales_order_item_id가 비어 있는 HOT_ROLLING 배정은 production_plan → sales_order_item으로 수주를 찾는다. 영향 요약과 LOT 상세 배정 줄 모두 같은 함수 |
| 슬래브·코일에서 정추적하면 출하요청은 나오는데 수주·출고 수는 0 | REQ-LOT-005, BP-LOT-01 | impactOf가 시작 LOT도 슬래브·코일이면 영향 제품으로 센다(출하요청 목록과 같은 범위). 원료·용선·히트 시작은 원래대로 빠진다 |
| 배정 추천(대상 `shipment_request_item`)을 대상 필터로 못 고르고 번호에 링크가 없음 (지적 2건) | REQ-LOG-002, BP-LOG-01, trace.md 3·4장 | `TARGET_FILTER_TABLES`에 `shipment_request_item`(출하요청 품목) 추가 → 주소 `?targetType=`도 남는다. `businessEventApi` toView가 출하요청 품목의 `shipmentRequestId`를 찾아 넘기고, `targetHref`가 `/shipment-requests/:id`로 보낸다(작업 로그·수주 이력 재현 모두) |
| 변경 전 → 변경 후 표에 공통 코드가 영문, 객체 배열이 JSON 덩어리 | PLAN 4장 '표시명 = 화면 문구', 06 각 코드 그룹, REQ-LOG-001, PLAN 7장 QC-003 | `eventDiff.ts`: 키 이름(경로 마지막) = 코드 그룹(05 4장 camelCase) 표로 `@/codes`의 *_LABEL 표시명을 보인다(allocationStatus, allocationPurpose, reservationStatus, shipmentRequestStatus, salesOrderItemStatus, inspectionResult, dispositionStatus, lotStatus, lotType, processType, draftStatus, productionPlanStatus, purchaseRequisitionStatus, purchaseOrderStatus, lotRelationEvidence, itemType, rawMaterialType, actionType, actorType). 객체 배열은 줄 이름(inspectionItemCode → lineNo → lotNo → id, 없으면 순번)으로 펴서 줄마다 비교(예: `values.C.measuredValue`). 항목 키 열은 그대로 DB 경로 |
| LOT 상세의 '불합격 처리 상태'·'처리 상태' | 03 TRM-079 '불합격 상태', 보고서 4 C-2 | 섹션 제목·줄 이름을 '불합격 상태', '처리 시각' → '지정 시각'. 배지는 품질 화면의 `DispositionBadge`를 그대로 쓴다(보류·격하·폐기 색이 품질 화면과 같아짐) |
| 그래프 열 제목·노드·범례에 표시명을 다시 직접 적음 | common.md 'labels only from codes', 보고서 4 C-3·C-6 | `traceLayout.ts` 열 제목 = `LOT_TYPE_LABEL`, 합금철 = `RAW_MATERIAL_TYPE_LABEL.FERROALLOY`(TraceGraph·LotTraceScreen 범례도), 작업 로그 범례 '불합격' = `INSPECTION_RESULT_LABEL.FAIL`. 출하요청 열 제목은 용어 사전 화면 문구라 그대로 |
| 같은 상태 배지 색이 화면마다 다름 | common.md 'badges colored by status' | `TraceBits.LotStatusBadge` = 재고 화면 `lotStatusTone`(재고 파랑, 투입 소진·출고 회색), `ShipmentStatusBadge` = 출하 화면 `ShipmentRequestStatusBadge` 그대로, LOT 상세 배정 상태 = 출하 화면 `AllocationStatusBadge`(소진 초록) |

- 테스트: `eventDiff.test.ts` +3(코드 표시명, 검사 값 줄 비교, 출하요청 품목 이동), `api/lotTrace.test.ts` +2(시작 LOT 포함, HOT_ROLLING 수주)·기대값 수정, `api/businessEvents.test.ts` +1(배정 추천 대상 필터·링크). 전체 typecheck 0 오류, 74파일 547개 통과.
- 공유 파일 변경: 없음. 다른 영역 파일은 읽기(import)만 했다: `features/inventory/lib/inventoryDisplay.ts`(lotStatusTone), `features/shipment/components/ShipmentBadges.tsx`(ShipmentRequestStatusBadge·AllocationStatusBadge), `features/quality/components/QualityBadges.tsx`(DispositionBadge). 그쪽 색을 바꾸면 LOT 추적도 같이 바뀐다.

