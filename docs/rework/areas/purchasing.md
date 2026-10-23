# 구매 — MRP·구매요청·승인함·발주·입고 (3단계 화면 5~9)

- 2026-10-01, 워크트리 브랜치(병렬 작업). 근거: stage3.md 화면 5~9, 02 요구사항 정의서 REQ-PRD-005·REQ-PUR-001~004(PUR-005는 P2)·REQ-AUTH-004·REQ-LOT-003·004, 04 업무 프로세스 정의서 BP-PRD-01·BP-PUR-01·02, 4.4, 9.1~9.3, 10장, 14.1 3단계, PLAN 7장 '구매', 감사 보고서 `reports/2-purchasing-mrp-actiondraft.md` A-0~A-8·C절.
- 업무 규칙·작업 로그·알림은 모두 core 서비스(`mock/services/mrp.ts`, `purchasing.ts`)가 한다. 이 영역은 **권한 확인(requireActor) + core 호출 + 화면용 조합**만 한다. 규칙을 다시 만들지 않았다.

## 1. 화면·라우트

| 라우트 | 화면 | 여는 조건(셸 SCREEN 표, 바꾸지 않음) | 읽기 전용 |
|---|---|---|---|
| `/mrp` | MRP: 필요일 기간(시작~끝) → 바로 계산(저장 없음). KPI(남은 히트·히트 톤·필요 용선·순소요 원료·예상 슬래브 여재), 원료·합금철 소요량 표(전체/순소요만), 구매요청 만들 순소요(계획·원료 줄마다 [구매요청 만들기]), 근거 생산계획 표, 계산 방법. [구매요청 자동 초안 준비 중 (P2)] | 조회 PURCHASE_REQUISITION_CREATE | 생산(조회) → 잠금 안내 + 버튼 막힘 |
| `/purchase-requisitions` | 왼쪽 목록(검색·상태 칩 4개·출처 칩·내 요청만) / 오른쪽 선택 요청 패널(`?pr=`). [구매요청 등록] 창 | 조회 PURCHASE_REQUISITION_CREATE | 생산·관리자(조회) |
| `/purchase-requisitions/[id]` | 같은 패널 한 화면. 경로: 목록 권한 → '구매요청', 없고 부서장 → '승인함' | 위와 같음(접두어 일치) | |
| `/approvals` | 부서장 승인함: 내가 부서장인 부서의 승인 대기 구매요청(먼저 온 것부터) / 패널에서 승인·반려(사유), [다음 PR-…] | 부서장 | — |
| `/purchase-orders` | 왼쪽: 발주할 구매요청(승인됨)을 기본 공급업체별로 묶음 + 발주 내역(상태 칩, 입고 진행 막대) / 오른쪽: 발주 작성(공급업체 묶음 표·체크·납기·[발주 확정]) 또는 발주 상세(`?po=`: KPI, 발주 품목, 입고 내역·원료 LOT) | 조회 PURCHASE_ORDER_CONFIRM | 관리자(조회) |
| `/goods-receipts` | 왼쪽: 입고예정 발주 품목 줄(납기순, 납기 지남 빨강, 입고예정·진행 막대) + 최근 입고 5건 / 오른쪽: 입고 작업(`?item=`·`?po=`: KPI, 입고 톤·입고일·야드(기본 야드 표시만) → 확인 창 → 입고 확정, 확정 결과 띠, 원료 LOT 형식, 입고 내역 [이 발주 품목/전체]) | 조회 GOODS_RECEIPT_CONFIRM | 관리자(조회) |

- 패널(`features/purchasing/components/RequisitionPanel.tsx`)은 목록·상세·승인함이 같이 쓴다: 번호·상태·출처, 진행 단계(등록 → 부서장 승인 → 발주), 반려 사유 띠, 요청 내용(원료·수량·근거 생산계획·발주번호, 희망 입고일·요청자·승인권자·요청 근거·승인/반려 일시), 출처 카드(Message → ERP면 원본 메시지·초안 링크·채팅방 이동, MRP면 근거 계획, 직접), 연결 발주(발주·입고·입고예정·납기·상태), 처리 카드(승인권자: 반려 사유 입력·승인 / 요청자: 반려 뒤 [고쳐 다시 요청] / 그 밖: 잠금 안내).
- 등록·다시 요청 창(`RequisitionFormModal.tsx`): 원료 품목 · 수량(톤) 줄 반복(원료 선택 + 톤 + MRP 근거 계획 꼬리표 + 지우기, 기본 공급업체·기본 야드 안내), 희망 입고일, 요청 근거(500자). 요청자·부서는 자동. 부서장이 없으면 미리 PUR-001 안내. 입력 오류는 칸 아래, 9.3 오류는 띠.
- 모든 화면: 불러오는 중·오류·권한 없음(QueryBoundary), 빈 상태 문구, 상태 배지 색, 주소 파라미터로 선택 유지(알림 링크 `/approvals?pr=`·`/purchase-requisitions?pr=`가 그대로 열린다).

## 2. 흐름 → 요구사항

| 흐름 | REQ / BP |
|---|---|
| 기간 → 계획별 남은 히트 → 히트 톤 → 필요 용선(÷ 제강 수율) → 철광석·석탄·석회석(× t/t)·합금철(히트 톤 × kg/t ÷ 1,000) → 총소요 − 원료 LOT 잔량 − 입고예정 = 순소요, 필요일, 예상 슬래브 여재. 용선 잔량은 빼지 않음. 실행 이력 없음 | REQ-PRD-005, BP-PRD-01, 4.4, PLAN 7장 |
| MRP 줄 → [구매요청 만들기] → 창에 원료·순소요 톤·희망 입고일(필요일이 오늘 이후면)·요청 근거 문구 미리 채움 → production_plan_id 연결. 같은 계획·원료는 MRP 표에 '이미 요청했어요 · PR-…', 만들 때도 입력 오류 | BP-PRD-01 "중복 생성 안 함", PLAN 7장 |
| 구매요청 등록 = 바로 승인 대기(작성 중·임시 저장 없음), 부서장 없으면 PUR-001, 부서장에게 APPROVAL_REQUESTED 알림(core) | REQ-PUR-001, 공통 코드 PURCHASE_REQUISITION_STATUS |
| 승인함: 요청 부서 부서장만 승인·반려(다른 부서장 COM-002), 반려 사유 필수, 요청자에게 APPROVAL_RESULT 알림(core). 권한 코드가 아니라 부서장 여부로 판단 | REQ-PUR-002, REQ-AUTH-004 |
| 반려 → 요청자가 고쳐 다시 요청 → 승인 대기(요청자만, COM-002) | 10장 REJECTED → WAITING_APPROVAL |
| 발주: 승인된 요청 품목만(PUR-002), 품목 기본 공급업체별 발주 1건(여러 줄), 발주량 = 요청 톤, 납기 = 입력값 또는 가장 이른 희망 입고일, CONFIRMED → 입고예정 반영, 요청 모든 줄 발주 → ORDERED | REQ-PUR-003, BP-PUR-01 |
| 입고: 등록 = 확정(상태·수정 없음), 미입고량 초과 PUR-003, 야드 = 원료 기본 야드 자동, 원료 LOT RM-원료코드-YYMMDD-NNN(잔량 = 입고 톤), 입고 누계·미입고량은 계산값(ERD), 발주 상태 PARTIALLY_RECEIVED/RECEIVED, GOODS_RECEIPT_CONFIRMED(core) | REQ-PUR-004, REQ-LOT-003·004, BP-PUR-02, 9.2 |
| 14.1 3단계(합금철 부족 → 구매요청 → 승인 → 발주 → 부분 입고 → RM LOT)를 화면으로 그대로 따라갈 수 있다 | 14.1 |

## 3. api 함수 (모두 `requireActor` 먼저)

| 파일 | 함수 | 권한 | core |
|---|---|---|---|
| `api/mrp.ts` | `mrpApi.requirements({from,to})` (+ `mrpKeys`, `MRP_VIEW_PERMISSIONS`) | 조회 PURCHASE_REQUISITION_CREATE 또는 PRODUCTION_PLAN_CONFIRM. 기간 형식·순서 입력 오류 | `computeMrp` |
| `api/purchasing.ts` | `purchaseRequisitionApi.list / detail(id) / formContext / create / resubmit` | list: 조회 PRC·PO / detail: 조회 PRC·PO 또는 요청자 또는 요청 부서 부서장(아니면 COM-002, 없으면 COM-003) / create·resubmit: 사용 PRC | `listPurchaseRequisitions`, `requisitionView`, `canApproveRequisition`, `actionDraftView`, `createPurchaseRequisition`, `resubmitPurchaseRequisition` |
| | `purchaseOrderApi.list / candidateItems / create` | list: 조회 PO·GR·PRC / candidateItems: 조회 PO / create(공급업체별 발주 목록): 사용 PO | `listPurchaseOrders`, `orderableRequisitions`, `createPurchaseOrder` |
| | `toTonText` | — | 잘 쓴 톤 입력을 '1.500' 모양으로 맞춤(아래 가정값) |
| `api/approvals.ts` | `approvalApi.countWaiting`(셸 배지, 그대로) / `inbox / approve / reject` | 부서장(`requireDepartmentHead`) | `approvalInbox`, `approvePurchaseRequisition`, `rejectPurchaseRequisition` |
| `api/goodsReceipts.ts` | `goodsReceiptApi.lines / list / receive` | lines·list: 조회 GR·PO / receive: 사용 GR | `listPurchaseOrders`, `listGoodsReceipts`, `receiveGoods` |

- 조회 키는 각 api 파일 안(`mrpKeys`, `purchaseRequisitionKeys`, `purchaseOrderKeys`, `approvalKeys`, `goodsReceiptKeys`). 변경은 `useAction`이 모든 조회를 무효화하므로 MRP·재고·LOT·알림 배지가 함께 바뀐다.
- 훅: `hooks/useMrp.ts`, `usePurchaseRequisitions.ts`, `usePurchaseOrders.ts`, `useApprovals.ts`, `useGoodsReceipts.ts`. 화면 전용 훅: `features/purchasing/hooks/useUrlParams.ts`.
- 순수 함수(`features/purchasing/lib/purchasingView.ts`, Vitest): MRP 기본 기간, 원료 요약, 톤 입력 초기값, 진행률(십진 나눗셈), 기본 공급업체별 묶음, 가장 이른 날짜, 납기 지남, RM LOT 형식, MRP 요청 근거 문구, 출처 표시명.
- 작업 로그: 이 영역의 변경은 모두 core가 남긴다(PURCHASE_REQUISITION_CREATED/APPROVED/REJECTED, PURCHASE_ORDER_CREATED, GOODS_RECEIPT_CONFIRMED). 따로 남긴 것 없음.

## 4. 시드

- **추가하지 않았다.** core 시드(PR-2609-0006 철광석 승인·미발주, PR-2609-0007 석회석 승인 대기(최준혁 승인함), PO-2609-0005 실리코망가니즈 부분 입고(입고예정 3.5t, 10-28), 입고 6건·RM LOT)로 모든 목록이 채워진다. 등록할 시드 함수 없음.

## 5. 가정값 (6개 문서에 없음 — 확인 필요)

| 항목 | 값 | 이유·근거 |
|---|---|---|
| MRP 기본 기간 | 이번 달 1일 ~ 다음 달 마지막 날 (필요일 기준) | 12.2는 `from&to`만 정함. 납기가 한두 달 안인 수주를 한 번에 보게 |
| MRP 조회 권한 | PURCHASE_REQUISITION_CREATE 또는 PRODUCTION_PLAN_CONFIRM 조회 이상 | stage3 "VIEW for 구매·생산". 화면 여는 조건(셸 표)은 PRC 조회 |
| 구매요청 상세 조회 | 조회 권한(PRC·PO)이 없어도 요청자·요청 부서 부서장은 볼 수 있다 | 다른 부서 사원이 Message → ERP로 만든 요청을 그 부서장이 승인함에서 본다(REQ-AUTH-004) |
| 톤 입력 저장 모양 | api 층에서 올바른 입력(숫자, 소수 3자리 이하, 쉼표 허용)은 `decimal(12,3)` 모양('1.5' → '1.500')으로 맞춰 넘긴다. 틀린 입력은 그대로 넘겨 core가 입력 오류로 알린다 | core `checkDecimal`이 자리수를 채우지 않아 '100'·'1.5'로 저장되던 것. core-domain 규약 "톤은 문자열 소수 3자리" |
| 출처 표시명 | MRP 계획 / Message → ERP / 직접 | 계산값(코드 그룹 아님, C-3 7). stage3 문구 |
| 희망 입고일 | 선택 입력(빈칸 허용), 오늘 이전도 막지 않음 | core가 선택으로 둠. "오늘 이후" 규칙은 문서 밖(C-4) |
| 입고일 | 필수, 미래·과거 제한 없음, 기본값 오늘 | "오늘 이전" 규칙은 문서 밖(C-4) |
| 발주 작성 기본 선택 | 주소에 `?pr=`이 있으면 그 요청 품목, `?supplier=`면 그 공급업체 묶음, 없으면 첫 공급업체 묶음 | 옛 화면 동작(A-7) |
| 입고 확정 확인 창 | 확정 전에 한 번 묻는다 | 확정 = 등록이라 되돌릴 수 없음(10장 "확정 후 수정 차단") |

## 6. 문서 밖 기능 처리 (C-4)

- 뺀 것: 구매요청 '작성 중'·임시 저장·제출 단계, MRP 실행 이력·실행번호·'만들어야 할 용선(용선 잔량 차감)', 승인함 'Agent 대응 후보'·'처리 완료(최근 30건)', '상위 부서장 승인' 안내, 발주 톤 나눠 발주(core: 요청 톤 그대로), 입고 초안 → 확정 2단계·비고·야드 선택·입고일 ≤ 오늘, 희망 입고일·납기 ≥ 오늘.
- 목록의 '확인 대기 초안' 구역은 넣지 않았다(문서 밖 C-4, 초안은 Message → ERP 영역 화면 `/action-drafts`). 출처가 Message → ERP인 요청은 패널에서 [초안 #id 보기]로 간다.
- 남긴 것(PLAN 5장 "필터·검색 남긴다"): 구매요청 검색·상태 칩·출처 칩·내 요청만, 발주 상태 칩, 입고 검색·[입고예정/전체].

## 7. 공유 파일 변경

- 없음. (`api/approvals.ts`는 이 영역 소유 — 셸 배지용 `countWaiting`은 그대로 두고 `inbox/approve/reject`를 더했다.) `screens.ts`·`routeTitles.ts`는 이미 모든 라우트가 있어 고치지 않았다.

## 8. 확인이 필요한 것 / 남은 일

1. **core `checkDecimal` 자리수**: 톤을 '1.500'으로 채워 저장하도록 core에서 고치면 `toTonText`는 지워도 된다(병합 때 결정).
2. 셸 알림 드롭다운 항목은 `/tasks?tab=notifications…`로 가고 `notification.link_path`(`/approvals?pr=`)로 바로 가지 않는다(알림 영역). 두 화면은 `?pr=`를 받도록 만들어 두었다.
3. `/purchase-requisitions/[id]`는 셸 표상 PRC 조회가 있어야 열린다. 조회 권한이 없는 부서장(예: 영업 부서장이 영업 사원의 Message → ERP 요청을 승인)은 승인함 안 패널로 본다(요청서 보기 버튼을 숨김). 상세 라우트도 열어 줄지 결정 필요.
4. LOT 링크는 `/lots/trace?lot=<LOT 번호>`, 채팅방 링크는 `/messenger?room=<id>`로 걸었다. 그 화면 영역이 이 파라미터를 받는지 병합 때 확인.
5. 부서장 본인 요청·부서장 부재 경로(16장 TBD)는 core대로 "막지 않음 / PUR-001"이고 화면에 규칙처럼 쓰지 않았다.
6. dev 서버·`next build`는 병렬 규칙대로 돌리지 않았다(병합 단계에서 빌드·브라우저 확인 필요).

## 9. 확인

- `npm run typecheck -w @fantasteel/client` 0 오류.
- `npm run test -w @fantasteel/client` 전체 통과. 이 영역 시험: `api/purchasingFlow.test.ts`(15: MRP 계산·기간 밖·권한·기간 오류, 톤 정규화, 등록·알림·작업 로그, MRP 줄 연결·중복 금지, 입력 확인·COM-003, COM-002·PUR-001, 상세 권한, 승인함·COM-001·결과 알림, 반려 → 재요청, PUR-002·공급업체별 발주·ORDERED, 부분 입고·RM LOT·PUR-003·입력 오류, 입고 권한), `features/purchasing/lib/purchasingView.test.ts`(5). (2026-10-08: 구매 화면 api의 가짜 DB 분기를 지우며 `purchasingFlow`·`purchasingResubmit`도 삭제. 같은 규칙은 서버 구매 테스트가 본다)

## 10. 검토 반영 (2026-10-02)

| # | 지적 (근거) | 고친 것 |
|---|---|---|
| 1 | MRP가 필요일이 기간 밖인 계획을 차감 **전에** 빼서, 기간 전(밀린) 계획이 잔량·입고예정을 안 쓴 것처럼 계산하고, 기간 밖 계획 몫 입고예정을 다른 수주가 쓰고, 기간에 따라 결과가 달라짐 (02 REQ-PRD-005, 04 4.4·BP-PRD-01) | 새 서비스 `computeMrpForPeriod`(처음 `mock/services/ext/purchasing.ts`, 2026-10-02 core `mock/services/mrp.ts`로 옮김): 계획·진행중이고 남은 히트가 있는 계획 **전부**를 필요일 순으로 차감(core `computeMrp` 전체 기간 + `netRequirements`)한 뒤 필요일 ≤ 종료일만 보인다. 시작일 전 계획은 밀린 소요로 함께 보이고 `beforePeriod`로 표시(화면 '기간 전' 배지, 구매요청 줄도 같음). 기간 뒤 계획 몫 입고예정은 그 계획 전용으로 남는다. `api/mrp.ts`가 이 함수를 부른다. 시험 `api/mrpPeriod.test.ts`(기간 전 계획 + 잔량, 기간 뒤 계획 몫 발주) |
| 2 | 재요청 때 알림은 요청자 **지금** 부서의 부서장에게 가는데 승인 확인은 옛 `department_id`로 해서, 부서를 옮기면 알림 받은 부서장은 COM-002, 옛 부서장 승인함에만 남음 (02 REQ-AUTH-004, 04 10장) | core `resubmitPurchaseRequisition`이 `department_id`를 다시 요청한 시점의 요청자 소속 부서로 바꾼다(등록 때 "요청 시점 소속"과 같은 규칙). 알림·승인함·승인 확인이 한 부서를 본다. 시험 `api/purchasingResubmit.test.ts` |
| 3 | 구매요청 패널 '연결 발주'의 발주번호 링크가 발주 화면을 못 여는 역할(생산: PRC 조회만)에게도 보여 잠금 화면으로 감 (02 REQ-AUTH-003, shell `screens.ts`) | 발주 확정 조회 이상(`useCanView(PURCHASE_ORDER_CONFIRM)`)일 때만 링크, 아니면 글자로. 카드는 그대로 보인다 |
| 4 | 발주 작성의 납기 안내가 고른 품목 전체의 가장 이른 희망 입고일 하나만 보여, 공급업체별로 다른 실제 납기와 다름 (04 BP-PUR-01) | 순수 함수 `plannedPurchaseOrders`(공급업체 1곳당 발주 1건, 납기 = 입력값 또는 그 묶음의 가장 이른 희망 입고일 — core `createPurchaseOrders`와 같음)로 '만들어질 발주'에 발주마다 "공급업체 · 납기 · 품목 수 · 톤"을 보인다. 시험 `purchasingView.test.ts` |
| 5 | `order` 단독 이름 (05 2장 [강제]) | `purchaseOrders`·`purchaseOrderRows`·`filteredPurchaseOrders`·`canConfirmPurchaseOrder`·`PurchaseOrderForm`·`PURCHASE_ORDER_TONE`·`purchaseOrder{Received,Ordered,Scheduled}Ton`·`purchaseOrderLines`/`RequisitionPurchaseOrderLine`/`requisitionPurchaseOrderLines`·`PurchaseOrderCandidateItem`/`purchaseOrderApi.candidateItems`/`purchaseOrderKeys.candidateItems`/`usePurchaseOrderCandidateItems`·`createBigSalesOrder`. ERD 컬럼 이름(`orderedTon` 등)과 core 함수 `orderableRequisitionItems`는 그대로 |
| 6 | 용어 사전에 없는 약어 `pr` (03 TRM-063, 05 2장) | 변수 `pr`·`prItems`·`prItem`·`prParam` → `purchaseRequisition`·`purchaseRequisitionItems`·`purchaseRequisitionItem`·`purchaseRequisitionIdParam`. 주소 키 `?pr=`는 core 알림 `linkPath`가 써서 그대로 |

### 가정값 (추가)

| 항목 | 값 | 근거 |
|---|---|---|
| MRP 기간 결과 | 필요일 ≤ 종료일인 열린 계획을 보이고, 시작일 전 계획은 '기간 전'(밀린 소요)으로 함께 보인다. 기간 뒤 계획은 보이지 않지만 차감(계획 몫 입고예정 보호)에는 들어간다 | 04 4.4 "같은 공급을 계획별로 중복 차감하지 않는다", REQ-PRD-005. 밀린 소요를 어떻게 보일지는 문서에 없음 |
| 재요청 승인 부서 | 다시 요청한 시점의 요청자 소속 부서 | REQ-AUTH-004 "요청자 소속 부서의 부서장", core 등록 규칙 "부서 = 요청 시점 소속" |

### 공유 파일 변경 (검토 반영)

- **새 파일** `client/src/mock/services/ext/purchasing.ts` — `computeMrpForPeriod`·`MrpPeriodView`·`MrpPeriodPlanRow`. 병합 때 core `mock/services/mrp.ts`의 `computeMrp`를 이 동작(전체 차감 → 기간 필터, `beforePeriod`)으로 바꾸고 이 파일을 지우는 것을 권한다. 대시보드(`api/dashboard.ts`, 이 영역 밖)는 `MRP_EARLIEST`부터 계산해 기간 전 계획 문제는 피하지만, 종료일 뒤 계획 몫 입고예정 보호는 core를 고쳐야 같아진다. → 2026-10-02 core `mrp.ts`로 옮기고 이 파일을 지웠다. `computeMrp`(필요일 from~to)와 `computeMrpForPeriod`(필요일 ≤ to + `beforePeriod`)가 계산 한 벌(`mrpViewOf`)을 같이 쓰고 보일 범위만 다르다. core 테스트가 기간 from~to 결과를 확인하므로 `computeMrp`의 보일 범위는 바꾸지 않았다.
- **core 2줄** `client/src/mock/services/purchasing.ts` `resubmitPurchaseRequisition` — `headOfRequesterDepartment`에서 `departmentId`도 받고 갱신 값에 `departmentId`를 넣었다.
- `client/src/api/scenario/demo141.test.ts` — `purchaseOrderApi.orderableItems` → `candidateItems` 이름 바꿈만(2곳).

### 확인

- `npm run typecheck -w @fantasteel/client` 0 오류, `npm run test -w @fantasteel/client` 76개 파일 546개 통과(새 시험: MRP 기간 2, 재요청 부서 이동 1, 만들어질 발주 1).

## 11. 브라우저 점검 반영 (2026-10-02)

- **MRP 원료·합금철 소요량 표의 줄 산수** (04 4.4 "필요일까지 도착하는 확정 발주의 미입고량만", 02 REQ-PRD-005 "다른 수주의 입고예정에서 제외", BP-PRD-01): '입고예정' 칸이 확정 발주의 미입고량 **전체**라 14.1 수주 뒤 실리코망가니즈 줄이 "총소요 2.500 − 잔량 1.000 − 입고예정 3.500 → 순소요 1.500"으로 읽혔다(3.500t는 10-28 도착이라 10-20 필요일에 못 씀). 계산 규칙은 그대로 두고 표시만 바꿨다.
  - '입고예정' 칸 = 이 계획들이 필요일까지 받아 쓰는 몫(`coveredScheduledTon`), 뺀 몫은 칸 아래 작은 글씨로 이유별: "다른 계획 몫 X t 제외"(다른 수주의 열린 계획 전용) · "필요일 뒤 도착 X t 제외"(납기 없음 포함) · "앞선 계획 몫 X t 제외"(표에 없는 앞선 계획이 먼저 씀) · "남는 몫 X t"(소요가 이미 채워짐). 칸 툴팁에 합계.
  - '원료 LOT 잔량' 칸 = 이 계획들이 쓸 수 있는 잔량(`usableOnHandTon` = 합계 − 표에 없는 앞선 계획이 먼저 쓴 몫). 이 화면은 기간 전 계획도 함께 보여 늘 합계와 같다.
  - 그래서 모든 줄이 "총소요 − 잔량 − 입고예정 = 순소요(0보다 작으면 0)"로 맞는다. 14.1: 2.500 − 1.000 − 0.000 = 1.500, 아래 "필요일 뒤 도착 3.500 t 제외".
  - 계산은 core에 둔다: lib `mrp.ts` `supplyBreakdownOf`(소요 줄마다 쓴 공급 `takes`로 나눔), 서비스 `mrp.ts` `mrpMaterialRows`·`mrpSuppliesOf`(core `computeMrp`와 기간 MRP `computeMrpForPeriod`가 같이 씀, ext의 공급 목록 사본은 지웠다). 화면 문구는 `purchasingView.ts` `mrpScheduledReceiptNotes`·`mrpOnHandNotes`.
  - 시험: `lib/mrp.test.ts`(줄 산수 6: 필요일 뒤 도착·다른 계획 몫·일부만 씀·앞선 계획·남는 몫·계획 몫 남김), `api/mrpPeriod.test.ts`(14.1 수주 뒤 기본 기간 합금철 줄, 발주 뒤 1.500t가 칸으로, 다른 계획 몫 10,000t·8,222.222t), `purchasingView.test.ts`(작은 글씨 문구), `review.test.ts`(좁은 기간의 앞선 계획 몫).
- **시드 원료 입고량** (core-domain 16-2, 가정값): 철광석·석탄·석회석을 늘려 14.1 뒤에도 구매 없이 히트 4개를 더 만든다. 그래서 '원료가 모자라는' 시험 수주를 키웠다: `purchasingFlow.test.ts`·`mrpPeriod.test.ts`의 큰 수주 36매 → 66매(6히트, 철광석 2,666.667t > 잔량 2,333.330t).
