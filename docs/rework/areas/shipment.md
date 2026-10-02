# 출하 영역 — 출하요청·LOT 배정·출고 확정·밀시트

- 2026-10-01, 워크트리 브랜치(병렬 작업). 근거: stage5.md 1~3번, 보고서 `1-sales-shipment.md` A-5~A-11과 C절, PLAN 7장 출하, 02 요구사항 REQ-SHP-001~004·REQ-INV-005/006/007/009·REQ-SO-005, 04 업무 프로세스 BP-SHP-01·4.2·9.1·9.3·10장·14.1 7~9단계.
- 업무 규칙(잔량·FIFO·배정·재검증·예약 전환·밀시트 스냅샷·작업 로그)은 모두 core 서비스(`@/mock/services`의 `shipments.ts`·`goodsIssues.ts`·`millSheets.ts`)가 한다. 이 영역은 **api 층(requireActor + core 호출 + 화면용 덧붙임)·훅·화면**만 만들었다.

## 1. 화면·경로

| 경로 | 화면 | 권한 (screens.ts 그대로) | 요구사항 |
|---|---|---|---|
| `/shipment-requests` | 출하요청 목록: 상태 칩(URL `?status=`, 공통 코드 표시명 배정 대기·배정 확정·출고 완료·취소), 고객사·출하 요청일 기간·검색, 표(출하요청 번호·상태·고객사·출하 요청일·품목·수주·요청 매수·이론중량·배정 a/r·요청자·다음 단계) | SHIPMENT_REQUEST_MANAGE 조회 이상(물류는 읽기 전용) | SHP-001 |
| `/shipment-requests/new` | 출하요청 등록: 왼쪽 고객사 → 그 고객사의 출하 가능 수주 품목(수주별 묶음, 체크), 본문 KPI·선택 품목 표(출하 매수 입력)·요청 정보(출하 요청일 DateInput, 요청자 = 지금 사원). `?salesOrderId=`로 들어오면 그 수주 품목을 출하 가능 전량으로 미리 고른다 | SHIPMENT_REQUEST_MANAGE 사용 | SHP-001, SO-002, BP-SHP-01 |
| `/shipment-requests/[id]` | 출하요청 배정: 왼쪽 출하요청 목록(검색·칩), 본문 머리(상태·수주 링크·작업 로그·취소·출고 확정 화면/밀시트 보기), 요약 띠 + 진행 단계, 상태별 안내, **품목별 배정 카드**(확정 배정 표 + FIFO 추천·후보 표, 변경·해제), 취소 확인 창 | SHIPMENT_REQUEST_MANAGE 조회 이상 | SHP-001, INV-006·007, BP-INV-02 |
| `/goods-issues` | 출고 확정: 왼쪽 칩 배정 확정·배정 대기·출고 완료(`?request=`로 선택), 본문 요약·재검증 결과 배너·배정 LOT 표(제품 검사·상위 히트·재고)·출고 전 확인·확정하면 바뀌는 것·[출고 확정]·출고 결과(출고 전환·누적 출고/수주 매수·품목 상태·밀시트) | GOODS_ISSUE_CONFIRM 조회 이상(영업은 읽기 전용) | SHP-002·003, INV-005, SO-005, 14.1-8 |
| `/mill-sheets` | 밀시트: 왼쪽 목록(출하요청별 묶음, 칩 전체·슬래브·코일, 검색), 본문 머리(PDF 배지·작업 로그·LOT 추적·PDF 생성) + **밀시트 종이**(스냅샷만으로 그림). 선택 `?id=` | MILL_SHEET_READ 조회 이상(영업·품질은 읽기 전용) | SHP-003·004, 14.1-9 |

새 경로는 없다(`screens.ts`·`routeTitles.ts` 변경 없음).

## 2. 흐름

1. **등록 → 바로 추천 (SHP-001)**: 등록에 성공하면 `/shipment-requests/{id}?new=1`로 간다. 배정 대기가 있는 품목 카드는 FIFO 추천이 펼쳐진 채로 열리고(추천 LOT 체크됨), 품목이 둘 이상이면 [추천대로 모두 확정]도 보인다. 추천은 저장하지 않는다. 확정하면 core가 ALLOCATION_RECOMMENDED(FIFO_RECOMMENDATION, 추천·선택 LOT) + ALLOCATION_CONFIRMED를 남긴다.
2. **배정 변경**: [변경] → 후보에서 1개(라디오) + 변경 사유(필수, 500자) → 기존 RELEASED + 새 CONFIRMED 한 번에(ALLOCATION_CHANGED, ALLOCATION_CHANGE). **배정 해제**: 확인 창 + 사유(선택). 둘 다 출고 확정 전(배정 대기·배정 확정)만.
3. **취소**: 배정 대기·배정 확정일 때만 버튼(출고 완료면 SHP-003). 확정 배정은 해제, 예약은 ACTIVE 그대로. 연 시점의 `updatedAt`을 보내 COM-001.
4. **출고 확정**: 재검증 결과(core `goodsIssueCheck`)를 먼저 보여 주고, 막히면 버튼을 끈다. 확정 실패는 토스트 대신 화면 배너(코드·문구·코드별 안내, "아무것도 출고되지 않았어요"). 성공하면 배정 CONSUMED·LOT 출고·예약 CONVERTED(부분이면 분할)·shipped_qty·품목 상태·재고·밀시트(출하요청 × 수주)·작업 로그를 core가 한 트랜잭션에서 처리.
5. **밀시트 PDF**: [PDF 생성] = `window.print()`. 종이 한 벌을 `<body>` 바로 아래 포털에 인쇄 전용으로 그려 A4로 찍는다(`MillSheetPrintPortal`). 인쇄를 시작하면 `pdf_path = mill-sheets/<번호>.pdf`를 남겨 'PDF 생성됨'. 인쇄를 시작하지 못하면 SHP-001 배너 + [다시 시도](같은 스냅샷, 출고는 다시 하지 않음). 이미 있으면 [PDF 다시 출력](경로는 그대로).

## 3. api 함수 (`client/src/api/`)

| 파일 | 함수 | 권한 | core 호출 |
|---|---|---|---|
| `shipmentRequests.ts` | `list`(행에 `salesOrders` = 수주 id·번호 짝, 수주 링크용), `detail(id)`, `shippableCustomers`, `shippableItems(customerId)` | VIEW SHIPMENT_REQUEST_MANAGE 또는 GOODS_ISSUE_CONFIRM | `listShipmentRequests`, `shipmentRequestDetail`, `shipmentRecommendation`, `shippableItemsOf` |
| | `create`, `confirmAllocations`, `changeAllocation`, `releaseAllocation`, `cancel` | USE SHIPMENT_REQUEST_MANAGE | `createShipmentRequest`, `confirmShipmentAllocations`, `changeShipmentAllocation`, `releaseShipmentAllocation`, `cancelShipmentRequest` |
| `goodsIssues.ts` | `queue`, `detail(shipmentRequestId)` | VIEW GOODS_ISSUE_CONFIRM | `goodsIssueQueue`, `goodsIssueCheck`, `shipmentRequestDetail`, `lotEligibility`, `heatOf` |
| | `confirm` | USE GOODS_ISSUE_CONFIRM | `confirmGoodsIssue` |
| `millSheets.ts` | `list`, `detail(id)` | VIEW MILL_SHEET_READ | `listMillSheets`, `millSheetDetail` |
| | `markPdfGenerated` | USE MILL_SHEET_READ | `markMillSheetPdfGenerated` |

- 조회 키는 각 파일 안(`shipmentRequestKeys`·`goodsIssueKeys`·`millSheetKeys`). 훅: `hooks/useShipmentRequests.ts`·`useGoodsIssues.ts`·`useMillSheets.ts` (변경은 `useAction` → 전체 조회 무효화 + BroadcastChannel로 다른 탭 갱신).
- 작업 로그: core가 모두 남긴다. 출하요청 취소·PDF 생성은 BUSINESS_EVENT_TYPE 29개에 맞는 유형이 없어 남기지 않는다(취소는 core가 ALLOCATION_RELEASED만 남김).
- 알림: NOTIFICATION_TYPE 5개에 출하 관련 유형이 없어 만들지 않았다(옛 화면의 "물류 담당에게 '출고 대기' 알림" 문구도 뺐다, 보고서 C-4-8).

## 4. 화면 쪽 계산 (`features/*/lib`, Vitest)

- `features/shipment/lib/shipmentForm.ts`: `requestQtyError`(정수가 아니면 SO-002 문구, 잔량 초과 SHP-002 문구 + "출하 가능 n매"), `validQtyOf`, `lineWeightTon`/`totalWeightTon`(십진 `calcWeightTon`·`sumTon`), `qtyUnitOf`(매·개), `isSameAsRecommendation`, `toggleLot`(필요 매수까지만 체크), `allocationLineSyncKey`·`panelAfterRefresh`(다시 불러온 뒤 배정 카드 패널 맞추기, 검토 반영 3).
- `features/millSheets/lib/millSheetView.ts`: `rangeText`(경계 포함 기준 표시), `inspectionColumns`(여러 히트·LOT 항목을 순서대로 한 번씩 — 열 머리만), `inspectionRangeGroups`(기준이 같은 행끼리 묶어 묶음마다 기준, 검토 반영 1), `lotRowsOf`, `productInspectionGroups`(연주·열연 검사 묶음), `standardText`(기준 코드 + 버전).
- **같은 규격 여러 줄 추천**: 한 출하요청에 같은 규격 품목이 두 줄 이상이면 core `shipmentRecommendation`(`mock/services/shipments.ts`)이 줄 순서대로 FIFO 후보에서 앞 줄이 고른 LOT을 빼고 나눠 추천한다. 그래서 [추천대로 모두 확정]이 INV-003에 걸리지 않고, 확정 함수가 작업 로그에 남기는 추천과 같다. 화면은 core 추천을 그대로 보인다(화면 쪽 나누기 함수는 없다).

## 5. 보고서 C 반영

- 용어: '출하번호' → '출하요청 번호'(C-2-6), '주문' → '수주 매수'(C-2-1), '검사증명서'·출고번호·검사번호 없음(C-2-4·5, C-4-4·5), '배정 확정 · 출고 대기'·'출고 대기'·'출고 완료'(직접 적은 라벨) → 공통 코드 SHIPMENT_REQUEST_STATUS 표시명(C-3-2), 품목 상태 공통 코드(OPEN 진행중 …, C-3-1), 판정 대기(C-3-7), LOT 상태 '재고'·'투입 소진'(C-3-6), 칩 '슬래브·코일'은 ITEM_TYPE 표시명(C-6-8).
- 없앤 것: 출하요청 메모(C-4-2, PLAN 5장), 출고 엔터티·'최근 출고' 목록(C-4-4 → 출고 완료 출하요청), PDF 상태 코드(C-3-11 → pdf_path 유무 배지 'PDF 생성됨/미생성'), 밀시트 종합 판정·'FantaSteel 제철소'(C-4-13), 출하 요청일 '오늘 이후' 제한(C-4-14), 알림 문구(C-4-8), '발행 완료'·'발행 없음' 직접 라벨.
- 규칙: 출하 매수는 글자를 지우지 않고 SO-002 문구(C-5-1), 톤은 십진 계산(C-5-2), 요청 시 추천 자동(C-1 SHP-001, C-5-11), 생산완료일은 날짜(C-5-12), 취소 문구에 '건' 대신 LOT 매수(C-5-14), 밀시트 1장 = 출하요청 × 수주(C-5-9), 출고 확정 거부 코드는 9.3대로 — 미검사·불합격 LOT은 INV-002('제품 또는 상위 히트가 미합격'), 예약·수주 잔량 초과만 SHP-002(검토 반영 2. 처음에 14.3의 '관련 REQ' 열 REQ-SHP-002를 에러 코드로 잘못 읽었다).
- 컨벤션: 화면은 `use*.ts` 훅으로만 조회(C-6-3), 컴포넌트 파일 PascalCase(C-6-6), `order` 단독 이름 없음(C-6-7), Tailwind만(인쇄 CSS 한 조각만 `<style>`, 이유는 4번 흐름), LOT마다 따로 조회하던 N+1 없음.
- 밀시트 종이: 옛 B안 모양(머리 로고·MILL SHEET·번호 상자, 정보 표, 1. 제품 LOT, 2. 화학성분, 3. 제품 검사, 맺음 문구)을 옮기고, 품목 표를 더했다(1장에 수주 품목이 여러 줄일 수 있음). 히트가 여럿이면 히트마다 성분 행(14.1-9), 검사 항목마다 기준(경계 포함)과 기준 코드·버전. 코일이면 '투입 슬래브' 열.

## 6. 시드

- 새 시드 없음. core 시드(`core.ts`)가 이미 출고 완료 1건(DR-2609-0001, 배정 CONSUMED, 예약 CONVERTED, MS-2609-0001-1 PDF 생성됨)과 배정 대기 1건(DR-2609-0002, SO-2609-002 6매)을 만든다. 14.1의 SS275 6매(HT-BOF1-260905-001-05~-10)는 건드리지 않는다. 등록할 시드 함수 없음.

## 7. 가정값

| 항목 | 값 | 이유 |
|---|---|---|
| 조회 권한 | 출하요청 조회 = SHIPMENT_REQUEST_MANAGE 또는 GOODS_ISSUE_CONFIRM 조회 이상, 출고 확정 조회 = GOODS_ISSUE_CONFIRM 조회 이상, 밀시트 조회 = MILL_SHEET_READ 조회 이상 | 화면 여는 조건(screens.ts)과 맞춤. 출고 화면이 출하요청 내용을 읽어야 함 |
| PDF 생성 권한 | MILL_SHEET_READ 사용(물류). 영업·품질(조회)은 종이만 본다 | 표시명 '밀시트 조회·출력', 2장 USE = 물류 |
| PDF 생성 시점 | 인쇄 창을 열면(`window.print()`가 오류 없이 끝나면) 생성됨으로 본다 | 브라우저는 인쇄·PDF 저장 완료를 알려 주지 않는다 |
| 화면 링크 쿼리 | 출고 확정 `?request=<출하요청 id>`, 밀시트 `?id=<밀시트 id>`, LOT 추적 `/lots/trace?lot=<LOT 번호>` · `/lots/trace?shipmentRequestNo=<출하요청 번호>`(LOT 추적 화면과 같은 이름), 작업 로그 `/business-events?salesOrderId=<수주 id>`, 출하요청 등록 `?salesOrderId=<수주 id>` | 다른 영역(LOT 추적·작업 로그·수주)과 병합 때 맞춰야 함 |
| 같은 규격 여러 줄 추천 | 줄 순서대로 나눠 추천 (core `shipmentRecommendation`) | 4장 |

## 8. 공유 파일 변경

- 없음. (`screens.ts`·`routeTitles.ts`·core 서비스·codes·components 그대로)

## 9. 확인이 필요한 것 / 남은 일

1. 레일 배지(배정 대기·배정 확정 건수)는 셸의 `NavBadgeKey`가 공유 파일이라 넣지 않았다.
2. 화면은 typecheck·Vitest로만 확인했다(병렬 규칙상 dev 서버·next build 금지). 병합 뒤 브라우저로 14.1 7~9단계를 눌러 보고, 특히 인쇄 미리보기(A4 한 장에 들어가는지)를 확인해야 한다.
3. 부분 출고 뒤 잔량 취소(16장 TBD)는 9.3대로 SO-003(수주 영역).

## 10. 시험

- `client/src/api/shipment.test.ts` 8개(검토 반영 뒤에도 8개, 출고 재검증 시험에 INV-002·SHP-002 구분을 더함): 14.1 7~9단계 흐름(배정 대기 요청 FIFO 추천 → 확정 → 부분 출고 6 = CONVERTED 6/ACTIVE 6·부분출하 → 같은 고객사 두 수주 묶어 요청(추천이 바로 옴, 줄마다 다른 LOT) → 출고 → 모두 CONVERTED·출하완료, 밀시트 2장 MS-…-1/-2, 히트별 성분 행, 검사값 잠금, 수주 타임라인 이벤트, 불변조건), PDF 생성(경로·재호출·COM-002·COM-003), SO-002·SHP-002·입력 오류, 권한 COM-002(등록·배정·취소·출고·조회), INV-001~004, 변경(사유 필수·LOT당 CONFIRMED 1건·ALLOCATION_CHANGE)·해제, 출고 재검증 INV-001·INV-002(미검사 LOT)·SHP-002(잔량 초과, 아무것도 출고 안 됨)·COM-001, 취소 SHP-003·COM-001·예약 유지.
- `features/shipment/lib/shipmentForm.test.ts` 9개, `features/millSheets/lib/millSheetView.test.ts` 6개(검토 반영 뒤).
- `npm run typecheck -w @fantasteel/client` 0 오류, `npm run test -w @fantasteel/client` 547개 통과(검토 반영 뒤, 병합된 전체).

## 11. 검토 반영 (2026-10-02)

| # | 지적 | 고친 것 | 근거 |
|---|---|---|---|
| 1 | 밀시트 종이가 항목마다 처음 나온 검사의 기준 한 줄만 찍어, 강종이 다른 히트(SS275 C ≤0.25 · SM355A C ≤0.20)나 두께 구간이 다른 코일(두께 허용차 ±0.20·±0.28, 항복강도·연신율 구간)에 틀린 기준이 보였다 | `inspectionRangeGroups`: 기준 코드·버전과 항목별 min/max(스냅샷 그대로)가 같은 행끼리 묶고, `MillSheetPaper`가 묶음마다 '기준' 행(+ 기준 코드·버전)을 그 행들 바로 위에 둔다. 묶음 순서 = 처음 나온 순서, 묶음 안 순서는 그대로. `inspectionColumns`는 열 머리(이름·단위)만 돌려준다. 시험: 강종 두 가지 히트, 코일 두께 구간 두 가지 + 검사 없는 행 | 02 REQ-SHP-003, 04 BP-SHP-01 문서 보존, 14.1-9 |
| 2 | 출고 확정에서 미검사·불합격 LOT을 SHP-002로 거부해 화면에 'SHP-002 출하 가능 매수를 넘었습니다'가 함께 보였다 | core `goodsIssueCheck`(`mock/services/goodsIssues.ts` 40행, 한 줄)를 INV-002로. SHP-002는 예약·수주 잔량 초과(35행)에만. 화면 `ERROR_HINT`를 INV-002(배정 화면에서 합격 LOT으로 변경)·SHP-002(출하요청 취소 후 매수 줄여 다시 요청)로 나눔. 주석(core 3행, `api/goodsIssues.ts`, 화면 머리)과 시험(`api/shipment.test.ts`, `mock/services/tests/errors.test.ts`)을 고치고, 잔량 초과 SHP-002 경우를 시험에 더함 | 04 9.3 INV-002·SHP-002, 02 REQ-SHP-002 |
| 3 | [추천대로 모두 확정] 뒤에도 품목 카드가 추천 패널을 연 채 '선택 N / 필요 0'·'추천과 다르게 골랐어요'와 옛 LOT을 보였다 | 카드가 다시 불러온 데이터(바꿀 수 있는지·배정 대기·확정 배정·추천 LOT)를 `allocationLineSyncKey`로 비교해, 바뀌면 고른 LOT을 새 추천으로 되돌리고 `panelAfterRefresh`로 패널을 맞춘다(배정 대기 0이면 추천 닫기, 바꾸려던 배정이 없어지면 변경 닫기). effect 없이 렌더 중 이전 값과 비교하는 방식 | 02 REQ-SHP-001·REQ-INV-006, stage5 1번 |
| 4 | 주소에 `?request=`가 없을 때(레일 메뉴) [출고 확정] 뒤 선택이 다음 배정 확정 요청으로 넘어가 출고 결과 카드를 볼 수 없었다 | [출고 확정]을 누르는 순간 `router.replace('/goods-issues?request=<id>')`로 그 요청을 주소에 고정한다(성공 콜백은 조회 무효화 뒤에 불려 이미 선택이 넘어간 뒤라 누를 때 고정). 출고 뒤 왼쪽 칩도 그 요청의 상태(출고 완료)를 따라간다 | 04 BP-SHP-01 출력, 14.1 8~9단계, 2장 흐름 4 |
| 5 | 출하요청 목록이 행 클릭으로만 열려 배정 대기·취소 행은 키보드로 열 수 없었다 | 출하요청 번호 = `ShipmentRequestLink`, 수주 = `SalesOrderLink`(첫 수주 + '외 n', 마우스를 올리면 전체), 배정 대기의 다음 단계 'LOT 배정 →' = 상세 링크. 행 클릭은 마우스 지름길로 남김. 수주 id·번호 짝을 위해 `list` 행에 `salesOrders`를 더함 | 보고서 1 A-5, common.md 'B안의 좋은 동작 유지' |
| 6 | 출하요청 등록에서 고객사 품목 조회가 실패하면 '출하요청할 수 있는 품목이 없어요'로 보였다 | 품목 목록을 `QueryBoundary`로 감싸 불러오는 중·오류(다시 시도)를 보이고, 불러온 뒤에만 '품목 없음'을 보인다 | common.md Hard rules (StateView/QueryBoundary) |
| 7 | 이 메모가 코드와 달랐다(`distributeRecommendation`, LOT 추적 `?q=`) | 3장 표의 `distributeRecommendation` 행 삭제, 4장을 core `shipmentRecommendation`이 나눈다로, 7장 링크를 `?lot=`·`?shipmentRequestNo=`로, 9장의 해결된 병합 할 일(1·2) 삭제 | common.md 메모 = 코드 |

- **공유 파일 변경(검토 반영)**: `client/src/mock/services/goodsIssues.ts` 40행 코드 1줄(SHP-002 → INV-002) + 3행 주석, `client/src/mock/services/tests/errors.test.ts` 기대 코드 1줄 + 제목. core 문서 `docs/rework/areas/core-domain.md` 12장 `confirmGoodsIssue` 행의 '미검사·불합격 SHP-002'는 병합 때 'INV-002'로 맞춰야 한다(공유 문서라 이 작업에서는 고치지 않음).
- 화면 동작(3·4·5·6)은 시험 환경이 node(DOM 없음)라 순수 함수 시험(3)과 typecheck로만 확인했다. 병합 뒤 브라우저로 [추천대로 모두 확정]·레일에서 들어간 출고 확정·목록 키보드 이동을 눌러 봐야 한다.
