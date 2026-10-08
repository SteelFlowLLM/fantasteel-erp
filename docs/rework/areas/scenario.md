# 시연 시나리오 14.1·14.2와 14.3 필수 검증 (화면 api 수준)

- 2026-10-01, 브랜치 `feature/screen-rework`(메인 체크아웃). 근거: 04 업무 프로세스 정의서 14.1·14.2·14.3, 02 요구사항 정의서(REQ-SO·INV·PRD·PUR·QC·SHP·LOT·LOG·ACT·MSG·MST), 9.3 에러 코드, `docs/rework/areas/*.md`(특히 core-domain 16·17장).
- **화면 api 함수만 부른다.** core 서비스를 직접 부르지 않고, 단계마다 그 일을 맡은 시드 사원으로 바꿔(actAs) 화면과 같은 권한 확인(COM-002)을 거친다. 시각은 `Date`만 가짜로 돌려 업무 번호(SO-2610-001 등)와 납기 계산을 고정했다.
- 새 시드(`resetToSeed`) 위에서 돌고, 단계마다 불변조건(`checkInvariants` — 예약·재고·배정·밀시트·LOT 번호)이 `[]`인지 본다.
- 이 작업에서 새로 만든 화면·기능·시드는 없다. 시험 파일과 이 문서만 더했다.

## 1. 시험 파일

| 파일 | 내용 |
|---|---|
| `client/src/api/scenario/scenarioKit.ts` | 도우미: `EMP`(시드 사원 12명 + 제선 윤성호·열연 한승우), `as(역할)`, `at(시각)`, `useScenarioClock()`, `inspectViaApi`(품질 담당이 기준 안 대표값으로 검사), `stockRawMaterials`(구매요청 → 부서장 승인 → 발주 → 전량 입고, core 서비스), `asPurchaseCore`(지금 사원으로 구매 core 서비스 호출)·`mockMrp`(core MRP를 서버 응답 모양으로): 구매 화면 api는 서버만 불러서 가짜 DB 시나리오는 core를 부른다, `expectClean` |
| `client/src/api/scenario/demo141.test.ts` | 14.1 1~10단계를 한 흐름으로 (1개 시험) |
| `client/src/api/scenario/demo142.test.ts` | 14.2 혼합·열연(1) / 취소(2) / 메신저(3) |
| `client/src/api/scenario/checks143.test.ts` | 14.3 P1 줄 가운데 14.1·14.2 흐름 밖의 것 7개 |

기존 core 시험(`client/src/mock/services/tests/scenario141·142.test.ts`)은 서비스 단위로 같은 흐름을 본다. 이번 시험은 그 위의 **화면 api 층**(권한·입력 변환·조회 모양)까지 끝까지 통과하는지 본다.

## 2. 14.1 P1 슬래브 수주 전체 흐름 — 결과: 모두 통과

| 단계 | 사원 (역할) | 부른 화면 api | 확인한 값 |
|---|---|---|---|
| 시작 | 박서영 (영업) | `salesOrderApi.preview`, `inventoryApi.listProducts` | SS275 250×1,200×10,000 1매 23.550t, 10매 **235.500t**, 예약 가용 6 |
| 1 | 박서영 | `salesOrderApi.create/detail/timeline` | SO-2610-001, **6매 ACTIVE**(STOCK_FIRST·SYSTEM) + **부족 4매 PP-2610-0001**(ORDER_SHORTAGE), 수주 품목 행에 톤 칸 없음 |
| 2 | 강민석 (생산 부서장) | `productionPlanApi.list/detail`, `salesOrderApi.productionLinks` | 누적 수율 0.9800, 필요 용강 96.122t, 히트 1개, **히트 전체 톤 250.000t와 수주 목표 94.200t를 따로**, 예상 여재 6매 |
| 3 | 정다은 (구매) · 최준혁 (구매 부서장) | `mrpApi.requirements`, `purchaseRequisitionApi.create/detail`, `purchaseOrderApi.orderableItems/create`, `approvalApi.inbox/approve`, `notificationApi.list`, `goodsReceiptApi.receive` | MRP: 실리코망가니즈만 순소요 1.500t(입고예정 3.5t는 10-28 도착이라 10-20 필요일에 못 씀), 합금철 소요 2.500t = 250 × 10 ÷ 1,000. PR-2610-0001(출처 MRP, 승인 대기) → 같은 계획·원료 중복 입력 오류 → **승인 전 발주 PUR-002** → 영업 부서장 승인 COM-002 → 구매 부서장 승인(APPROVAL_REQUESTED·APPROVAL_RESULT 알림) → PO-2610-0001(기본 공급업체 SUP-04, 납기 10-10) → 1.501t PUR-003 → 1.000t **부분 입고**(RM-SMN01-261002-001, 잔량 0.500t) → 같은 1t 재시도 PUR-003·LOT 늘지 않음 → 0.500t 입고 완료 |
| 4 | 조은서 (제강) | `productionResultApi.simulate/work`, `lotTraceApi.trace` | 시드 42: 제선 → 제강 → 연주, 계획 10매·손실률 0~5%·손실 floor, 실적 모두 시뮬레이션 표시. 원료→용선 **PERIOD_BASED**(기간 있음), 용선·합금철→히트 **ACTUAL_INPUT**, 합금철 입고일 FIFO 1.000·1.000·0.500 |
| 5 | 서민지 (품질) | `inspectionApi.detail/register`, `salesOrderApi.detail/timeline` | 슬래브 1매 표면 불합격, 나머지 합격, 히트 판정 전에는 예약 6 그대로 → 히트 합격 시 **부족분 4매만 자동 예약(SYSTEM)**, 남은 합격 슬래브 여재 → 같은 히트 슬래브가 뒤늦게 불합격돼도 같은 히트 여재가 채워 예약 10 유지 |
| 6 | 강민석 | `productionPlanApi.detail/createReproduction/list` | 재생산 필요 0·추가 계획 필요 0 → 재생산 요청은 입력 오류, 재생산 계획 0건. 대조: 시드 SO-2609-005(히트 불합격·여재 없음)는 **재생산 PP-2610-0002(8매)**, 다시 누르면 입력 오류 |
| 7 | 박서영 | `shipmentRequestApi.shippableItems/create/detail/confirmAllocations` | 출하 가능 10, DR-2610-0001 4매 FIFO = 기존 재고 -05~-08, 7매 요청 SHP-002, DR 6매 = -09·-10 + 새 생산 -02~-05, **LOT 10개 확정**, ALLOCATION_RECOMMENDED(FIFO_RECOMMENDATION) 2건·ALLOCATION_CONFIRMED 10건 |
| 8 | 권예진 (물류) | `goodsIssueApi.detail/confirm`, `millSheetApi.list`, `salesOrderApi.detail/list/cancel` | 4매 출고 → **CONVERTED 4·ACTIVE 6**, 헤더 부분출하, 출고 재시도 COM-001·밀시트 1장 그대로 → 6매 출고 → **CONVERTED 10·출하완료**, 취소 SO-003 |
| 9 | 권예진 · 서민지 | `millSheetApi.detail/markPdfGenerated`, `inspectionApi.detail/register` | MS-2610-0001-1(히트 HT-BOF1-260905-001), MS-2610-0002-1(**두 히트**, C 0.18 / 0.21), 고객사·총 6매·141.300t·KS D 3503:2026, PDF 생성 두 번 눌러도 같은 경로, 밀시트에 들어간 히트는 측정값 잠금 |
| 10 | 서민지 · 박서영 · 정다은 · 최준혁 | `lotTraceApi.trace/detail`, `salesOrderApi.timeline`, `businessEventApi.list`, `messengerApi.listRooms/listMessages`, `actionDraftApi.createFromMessage/get/update/confirm/execute`, `purchaseRequisitionApi.list/detail`, `approvalApi.approve` | 출하요청 번호로 역추적 → 두 히트·원료 4종, 새 합금철 LOT 정추적 → 둘째 출하요청·SO-2610-001(출고됨). 수주 타임라인 17개 유형 시간순, 작업 로그 화면 건수와 같음. 업무방 메시지 → 초안(요청자 = 보낸 사람, 물류는 COM-002, 같은 메시지 재생성 안 함) → 필수값 없으면 ACT-001 → 값 채움 → 요청자 아닌 사람 확정 COM-002 → **요청자 확정 → 구매요청(출처 MESSAGE, 승인 대기)** → 재실행 입력 오류 → **부서장 승인**. 로그: DRAFT_CREATED → DRAFT_CONFIRMED → PURCHASE_REQUISITION_CREATED → DRAFT_EXECUTED → PURCHASE_REQUISITION_APPROVED, 방에 시스템 메시지 |

## 3. 14.2 P1 코일·혼합·취소 — 결과: 모두 통과

| 항목 | 확인한 값 |
|---|---|
| 혼합 수주에서 코일 부족분만 계획 | 보람강관: 코일 SS275 4.5mm 3개 + 슬래브 250×1,200 2매 → 슬래브는 재고 예약 2로 끝, **계획은 코일 1건뿐**(누적 수율 0.9596, 필요 용강 90.116t, 대응 슬래브 250×1,500) |
| 필요 슬래브만 열연 배정 | 시뮬레이션은 연주까지(판정 대기라 열연 건너뜀), 검사 합격 뒤 필요 3·추천 3. 코일 계획 슬래브는 슬래브 수주에 자동 예약하지 않는다 |
| 판매 슬래브 예약 비침범 | 다른 수주가 같은 슬래브 6매 예약 → 예약 가용 2·추천 2, 2매 + 1매 확정 INV-001, 같은 LOT 다시 INV-003, 배정 변경은 사유 필수 |
| 열연·판매가 같은 슬래브 (14.3) | 출하 FIFO 추천에 열연 배정 LOT이 없다. 열연 배정 LOT을 출하에 넣으면 INV-003, 출하 배정 LOT을 열연에 넣으면 INV-003 → CONFIRMED 배정은 하나만 |
| 슬래브 1매 → 코일 1개 | 코일 번호 `C`+슬래브 번호(HT- 뺌), 코일 규격 이론중량 28.825t, 열연 실적 2개·57.650t·**추가 손실 없음**, 코일 ← 슬래브 1:1 ACTUAL_INPUT, 소진 슬래브 재배정 INV-004, 판정 대기 슬래브 배정 INV-002 |
| 코일 검사·자동 예약 | 코일 2개 합격 → 코일 품목에 자동 예약 2 |
| 시작 전 취소 | 사유 없으면 입력 오류, 취소 → 계획 CANCELLED·예약 RELEASED·예약 가용 6 복구, 로그 SALES_ORDER_CANCELLED·RESERVATION_RELEASED·PRODUCTION_PLAN_CANCELLED(ORDER_CANCELLED) |
| 연주 진행 중 취소 | 제선·제강 실적 + 연주 **시작만** 기록(진행중) → 취소 → 계획은 진행중·수주 연결 해제·완료 후 여재, SURPLUS_CONVERTED(SURPLUS_CONVERSION), 수주 생산 연결 탭에 품목 번호 없이 남음 → 같은 실적으로 연주 완료 → 슬래브 10매 여재·계획 완료 → 합격해도 자동 예약 없음, 여재 16매(시드 6 + 10) |
| 진행 중 출하요청 | 시드 SO-2609-002(DR-2609-0002 배정 대기) 취소 SO-004 |
| 메신저 | 업무방에 첨부 + `@강민석 SO-2609-003` → 강민석 MENTION 1건(`/messenger?room=`), 안 읽은 수 +1 → 읽음 처리 0, 정다은 업무방 새 메시지 알림, ERP 링크 `/sales-orders/{id}` → 수주 상세 열림, 멤버만 첨부 받기(아니면 COM-002) |

## 4. 14.3 요구사항별 필수 검증 체크리스트

| # | 검증 | 기대 결과 | 관련 REQ | 확인 위치 | 결과 |
|---|---|---|---|---|---|
| 1 | 23.550t 규격 10매 입력 | 허용, 235.500t 계산 표시, 톤 저장 안 됨 | SO-002 | checks143 'SO-002', demo141 1단계 | 통과 (미리보기·상세 235.500t, 수주 품목 행에 톤 칸 없음) |
| 2 | 10.5매·0매·음수·누락 | 거부, SO-002 | SO-002 | checks143 'SO-002' | 통과 (`'10.5'`·`0`·`-1`·`''`·`'3매'`, 미리보기·등록 모두 SO-002) |
| 3 | 사용된 규격의 치수 수정 | 거부, MST-002, 새 규격 추가 안내 | MST-003 | checks143 'MST-003' | 통과 (detail "다른 치수는 새 규격으로 추가해 주세요", 화면도 같은 안내) |
| 4 | 코일 규격 중량이 슬래브보다 큼 | 매핑 등록 거부 | MST-004 | checks143 'MST-004' | 통과 (입력 오류, 매핑 안 생김) |
| 5 | 동일 규격 동시 주문 | ACTIVE 예약 합계 ≤ 가용 재고 | INV-009 | checks143 'INV-009' | 통과 (5매 주문 3건 동시 → 예약 합계 6 = 가용 6, 나머지 9매 계획) |
| 6 | 열연·판매가 같은 슬래브 선택 | CONFIRMED 배정 하나만 성공 | INV-006·009 | demo142 1번 시험 | 통과 (양쪽 모두 INV-003) |
| 7 | 미합격 히트 하위 제품 | 예약·배정·출고 차단 | INV-003·007, SHP-002 | checks143 'INV-003·007' | 통과 (SPHC 히트 불합격 슬래브는 예약 0, 배정 뒤 히트 불합격 → 배정 해제(QUALITY_FAILURE)·출고 불가(INV-001)·후보에서 빠짐·직접 배정 INV-002) |
| 8 | 합격 생산분 | 원래 수주 부족분만 자동 예약 | INV-004 | demo141 5단계 | 통과 (9매 합격 중 부족 4매만, 나머지 여재) |
| 9 | 불합격 처리 상태 지정 | 상태·사유 기록, 재고 처리 없음 | QC-004 | checks143 'QC-004' | 통과 (보류·사유 기록, 재고 화면 값 그대로, DISPOSITION_SET 1건, 사유 빈칸·합격 LOT 입력 오류, 영업 COM-002) |
| 10 | 구매요청 승인 전 발주 | 차단, PUR-002 | PUR-002 | demo141 3단계 | 통과 |
| 11 | 부분 입고·확정 재시도 | 잔량 정확, LOT 중복 없음 | PUR-004, LOT-004 | demo141 3단계 | 통과 (1.000 → 잔량 0.500, 재시도 PUR-003·LOT 수 그대로, 0.500 → 완료, LOT 번호 001·001(입고일별)) |
| 12 | 합금철 소요 계산 | 히트 톤 × kg/t ÷ 1,000 | MST-006, PRD-005 | demo141 3·4단계 | 통과 (250 × 10 ÷ 1,000 = 2.500t, 히트 투입 합계 2.500t) |
| 13 | 부분 출고 | 해당 매수 CONVERTED, 헤더 부분출하 | SO-005, INV-005 | demo141 8단계 | 통과 |
| 14 | 출고 재시도·PDF 실패 | 출고·문서 중복 없음, PDF만 재시도 | SHP-002~004 | demo141 8·9단계 + 서면 | 통과 (출고 재시도 COM-001·밀시트 수 그대로, PDF 생성 재시도는 같은 경로). **서면 확인**: PDF 실패는 브라우저 인쇄 단계라 api 밖 — `MillSheetScreen`이 SHP-001을 보이고 같은 스냅샷으로 인쇄만 다시 하며 출고는 부르지 않는다 |
| 15 | 메시지 초안 확정·반려 | 확정 시 구매요청 생성 후 부서장 승인, 반려 시 REJECTED | ACT-001~003 | demo141 10단계, checks143 'ACT-001~003' | 통과 (반려 사유 필수, REJECTED 뒤 확정 불가·구매요청 없음, 같은 메시지로 새 초안 가능) |
| 16 | Agent 같은 대상 미처리 초안 (P2) | 새 초안 생성 안 함 | AGT-005 | 서면 | P2 — 화면은 '준비 중'(Agent 화면 예시만). 시험 대상 아님 |
| 17 | 납기 3일 이내·미출하 (P2) | DUE_RISK 알림 | AGT-004 | 서면 | P2 — 알림 배치 없음. 납기 위험 표시(`isDueRisk`)는 수주 목록·대시보드 계산값으로만 있다 |
| 18 | AI 어시스턴트 숫자 답변 (P2) | DB 조회 결과·출처, 데이터 변경 없음 | AST-004·005·009 | 서면 | P2 — '준비 중'. 시험 대상 아님 |
| 19 | 연주 시드 손실 | 계획 수율 고정, 0~5%, 열연 추가 손실 없음 | PRD-007 | checks143 'PRD-007', demo141 4단계, demo142 열연 | 통과 (계획 매수 = 히트 최대 매수 10, 손실률 0~0.05, 손실 = floor, 같은 시드·같은 상태 재실행 결과 같음, 열연 실적 손실 0) |

## 5. 발견한 문제와 수정

- **화면 api 수준에서 실패한 단계는 없었다.** 14.1 1~10단계, 14.2 전 항목, 14.3 P1 16줄이 모두 처음 시험 그대로(시험 쪽 필드 이름만 맞춤) 통과했다. 그래서 업무 코드는 고치지 않았다.
- 시험을 쓰며 확인한 것 (버그 아님, 기록만):
  - 생산계획 상세의 `reproduction.canReproduce`는 "품목이 진행중인지"다. 재생산 버튼은 화면이 `canReproduce && additionalPlanQty > 0`일 때만 보인다(`ProductionPlanScreen`). 재생산이 필요 없을 때 api를 직접 부르면 입력 오류로 막힌다.
  - 화면 연결: 시나리오에 쓴 api 34개가 모두 화면(features·hooks)에서 불린다. 입고·출고 확정 버튼은 처리 중에 막혀 두 번 눌리지 않는다.
  - 재생산 계획 만들기 api가 세 화면(수주·생산계획·불합격 관리)에 있지만 모두 같은 core `createReproductionPlan` 하나를 부른다(규칙 구현 1곳).

## 6. 확인이 필요한 것 / 한계

1. **동시 주문(14.3-5)**: 가짜 DB는 트랜잭션을 하나씩 처리하므로 "동시"는 `Promise.all`로 흉내 낸 것이다. 실제 서버에서는 같은 규격 예약 시 행 잠금(또는 직렬화)이 있어야 같은 결과가 나온다.
2. **14.3-7의 출고 차단 코드**: 배정 뒤 히트가 불합격이면 core가 그 배정을 먼저 해제하므로 출고 확정은 '배정 대기'(INV-001)로 막힌다. 배정이 남은 채 미검사·불합격 LOT을 출고하려는 경우는 이 흐름에서 생기지 않는다. 그 경우 core는 9.3 INV-002('제품 또는 상위 히트가 미합격')로 막는다(`mock/services/goodsIssues.ts` `goodsIssueCheck`, core-domain 12장). SHP-002는 예약·수주 잔량 초과에만 쓴다(검토 반영, shipment.md 2번).
3. P2 줄(16~18)은 기능이 '준비 중'이라 시험하지 않았다.
4. 화면 클릭(브라우저) 시연은 이 작업에서 돌리지 않았다. 화면 값 표시(235.500t 계산값, 히트 톤·수주 목표 분리, 시뮬레이션 시드·손실률, CONVERTED/ACTIVE, 밀시트 PDF 상태, ERP 링크)는 해당 화면 코드가 같은 api 값을 그리는지 코드로 확인했다.

## 7. 확인

- `npm run typecheck -w @fantasteel/client` 0 오류
- `npm run test -w @fantasteel/client` 74개 파일 · 542개 시험 통과 (이번에 더한 시나리오 시험 3개 파일 · 11개)
- `npm run build -w @fantasteel/client` 성공
