# purchasing — 구매요청·부서장 승인·발주·입고

> 근거 약어: [02] 요구사항 정의서 · [03] 용어 사전 · [04] 업무 프로세스 정의서 · [05] 코드 컨벤션 · [06] 공통 코드 정의서 · [ERD] `docs/erd/fantasteel_erp_p1.dbml` · [CSV] API 목록 · [권한표] 역할별 메뉴 (v2) 3장. 🟡 = 확인 필요.
> 경로는 컨트롤러에 쓰는 모양(전역 prefix `/api/v1` 제외). 스켈레톤은 `@Controller()`이므로 메서드마다 전체 경로를 쓴다.

## 1. 담당 범위

| 항목 | 내용 |
| --- | --- |
| REQ | REQ-PUR-001~004, REQ-AUTH-004(부서장 승인), REQ-LOT-003·004(원료 LOT 채번·잔량), REQ-ACT-002(초안 확정 시 구매요청 생성 핸들러) |
| BP | BP-PUR-01 구매요청·승인·발주, BP-PUR-02 부분 입고·원료 LOT·반대 거래(발주 취소·잔량 마감·입고 취소, [04] 6장), 13.4 |
| 등급 | P1 (REQ-PUR-005 자동 초안은 P2, 만들지 않음) |

## 2. 테이블

| 구분 | 테이블 | 핵심 규칙 |
| --- | --- | --- |
| 쓰기 | `purchase_requisition` | `purchase_requisition_no`(PR-YYMM-NNNN), `item_id`(**원료 1품목**), `requested_ton` — CHECK `purchase_requisition_requested_ton_check`(> 0), `desired_receipt_date`, `requester_id`, `approver_id`·`approved_at`, `reject_reason`, `request_reason`, `production_plan_id`(근거 계획, MRP 중복 요청 방지), `action_draft_id` unique(Message → ERP), `purchase_requisition_status` |
| 쓰기 | `purchase_order` | `purchase_order_no`(PO-YYMM-NNNN), `supplier_id`(공급업체 1곳당 1건), `purchase_order_status`(기본 CONFIRMED, 발주 취소 CANCELLED·잔량 마감 CLOSED) — 상태는 조건부 UPDATE(`changePurchaseOrderStatus.sql`)로만 바꾼다 |
| 쓰기 | `purchase_order_item` | `purchase_requisition_id` **unique**(발주 품목 1행 = 구매요청 1건), `item_id`, `ordered_ton` — CHECK(> 0), `expected_receipt_date`. service: APPROVED 구매요청만, `ordered_ton ≤ requested_ton` |
| 쓰기 | `goods_receipt` | `goods_receipt_no`(GR-YYMM-NNNN), `purchase_order_item_id`, `received_ton` — CHECK(원래 입고 > 0, 취소 행 < 0), `received_date`(원료 FIFO 기준, 취소 행은 취소한 날), `reversed_goods_receipt_id` unique(입고 취소 행이면 원래 입고). service: 입고 합계(취소 행 포함) ≤ `ordered_ton`(발주 행 잠금). 등록이 곧 확정 |
| 쓰기 | `lot`(RAW_MATERIAL) | `goods_receipt_id` unique(입고 1건 = LOT 1개), `item_id`, `yard_id`, `initial_ton`=`remaining_ton`=입고량. 입고 취소 때 `lot_status` RECEIPT_CANCELLED·`remaining_ton` 0 (`cancelRawMaterialLotForReceipt.sql`) |
| 읽기 | `item`, `supplier`, `employee`, `department`, `production_plan`, `action_draft` | |

[ERD] 설계 결정이 [04]와 다른 곳(ERD를 따른다):
- 구매요청 1건 = 원료 1품목, 발주 품목 1행 = 구매요청 1건. [04] 11장의 `purchase_requisition`·`_item` 구조와 BP-PUR-01 "요청을 묶거나 나눌 때 배분량 보존"은 1:1로 단순화됐다(한 요청을 두 발주로 나눌 수 없음).
- 입고예정·입고 누계는 저장하지 않고 계산(`ordered_ton − 입고 합계`, 입고 합계는 입고 취소 행까지 더한 값). [04] 11장의 `scheduled_receipt_ton`·`received_ton` 컬럼은 없다. 컬럼 이름은 `required_ton`이 아니라 `requested_ton`(MRP 소요량과 구분). 발주 취소·잔량 마감한 발주는 입고예정에 들어가지 않는다.

## 3. API

| Method | Path | 이름 | 권한 | 비고 ([CSV]) |
| --- | --- | --- | --- | --- |
| GET | `purchase-requisitions` | 구매요청 목록 | `PURCHASE_REQUISITION_CREATE` VIEW **또는 부서장** | 승인함은 `?approvable=true`: 내 부서원의 승인 대기만(내 요청 제외), 부서장이 아니면 COM-002. 응답에 발주번호(`purchaseOrderNo`, 미발주면 null)와 원료의 기본 공급업체(`defaultSupplierId`·`defaultSupplierName`, 발주 후보 묶기용) |
| POST | `purchase-requisitions` | 구매요청 등록 | `PURCHASE_REQUISITION_CREATE` USE | 부서장 미지정 시 PUR-001. 임시 저장 없음 |
| GET | `purchase-requisitions/:id` | 구매요청 상세 | VIEW **또는 그 요청의 승인권자** | 초안 연결(`action_draft_id`) 표시 |
| POST | `purchase-requisitions/:id/approve` | 구매요청 승인 | 권한 코드 없음 → `assertDepartmentHead` | 아니면 COM-002 |
| POST | `purchase-requisitions/:id/reject` | 구매요청 반려 | 권한 코드 없음 → `assertDepartmentHead` | |
| POST | `purchase-requisitions/:id/resubmit` | 구매요청 수정·재요청 | `PURCHASE_REQUISITION_CREATE` USE + 요청자 본인 | REJECTED → WAITING_APPROVAL |
| GET | `purchase-orders` | 발주 목록 | `PURCHASE_ORDER_CONFIRM` VIEW | |
| POST | `purchase-orders` | 발주 등록 | `PURCHASE_ORDER_CONFIRM` USE | 승인 전 발주 시 PUR-002 |
| GET | `purchase-orders/:id` | 발주 상세 | `PURCHASE_ORDER_CONFIRM` VIEW | |
| GET | `goods-receipts` | 입고 목록 | `GOODS_RECEIPT_CONFIRM` VIEW | |
| POST | `goods-receipts` | 입고 확정 | `GOODS_RECEIPT_CONFIRM` USE | 등록이 곧 확정. 미입고량 초과 시 PUR-003, 취소·마감된 발주면 PUR-007 |
| POST | `purchase-orders/:id/cancel` | 발주 취소 (API-284) | `PURCHASE_ORDER_CONFIRM` USE | 입고 누계 0만, 사유 필수. 입고가 있으면 PUR-004 |
| POST | `purchase-orders/:id/close` | 발주 잔량 마감 (API-285) | `PURCHASE_ORDER_CONFIRM` USE | 일부 입고만, 사유 필수. 아니면 PUR-005 |
| POST | `goods-receipts/:id/cancel` | 입고 취소 (API-286) | `GOODS_RECEIPT_CONFIRM` USE | 원료 LOT을 쓰지 않았을 때만, 사유 필수. 썼으면 PUR-006. 취소 행(음수 입고)을 돌려준다 |

- "또는 부서장"인 조회 API는 데코레이터 하나로 표현할 수 없다. 데코레이터 없이 service에서 `hasPermission(user, {permission: 'PURCHASE_REQUISITION_CREATE', level: 'VIEW'}) || user.headDepartmentIds.length > 0`로 확인하고, 부서장은 자기 부서원의 요청만 보이게 거른다.
- [권한표]: 구매 USE(3종), 나머지 역할은 3종 모두 VIEW(2026-10-15 업무 조회는 모든 역할). 승인 권한 코드는 없다(REQ-AUTH-004).
- ERD에 칸이 없는 값은 작업 로그(가장 최근 이벤트)에서 읽어 응답에 넣는다: 구매요청 `rejectedAt`(REJECTED일 때 `PURCHASE_REQUISITION_REJECTED` 시각), 발주 `orderedEmployeeName`(`PURCHASE_ORDER_CREATED` 사원)·`statusChange`(CANCELLED·CLOSED일 때 `PURCHASE_ORDER_CANCELLED`·`CLOSED`의 사유·사원·시각), 입고 `confirmedEmployeeName`(`GOODS_RECEIPT_CONFIRMED` 사원, 취소 행은 `GOODS_RECEIPT_CANCELLED` 사원)·`cancelReason`(`GOODS_RECEIPT_CANCELLED` 사유, 대상은 원래 입고).
- [CSV]에 같은 경로 행이 두 벌(12.2 명시 행 + 긴 비고 행) 있다. 내용은 같고 비고만 다르다.

## 4. 업무 규칙

**구매요청 등록**(REQ-PUR-001)
- `itemId`는 RAW_MATERIAL 품목, `requestedTon > 0`(소수 3자리), `desiredReceiptDate`(date), 요청자·부서는 인증 컨텍스트에서 가져온다.
- 요청자 부서의 `head_employee_id`가 없으면 `PUR-001`. 상태는 바로 WAITING_APPROVAL([06]: 임시 저장 없음).
- `productionPlanId`가 있으면 같은 계획·품목의 진행 중 요청이 있는지 확인해 중복을 막는다(BP-PRD-01, [ERD] Note).
- message-action이 쓸 함수를 export한다: `createRequisition(tx, input, actor, { actionDraftId, messageId })`([04] 12.3 `purchasing.createRequisitionPendingApproval`, BP-ACT-01 "실행 핸들러는 해당 모듈 담당자가 구현"). 저장한 구매요청 행(관계 없음)을 돌려주고, 화면 응답은 커밋 뒤에 읽는다.

**승인·반려·재요청**(REQ-PUR-002, REQ-AUTH-004)
- 승인·반려는 WAITING_APPROVAL에서만. 요청자 사원을 조회해 `assertDepartmentHead(user, requester.departmentId)`(`common/auth/department-head.ts`). 부서에 부서장이 없으면 먼저 `PUR-001`.
- 승인: APPROVED, `approver_id`, `approved_at`. 반려: REJECTED, `approver_id`, `reject_reason`(필수 권장).
- 재요청: 요청자 본인만, REJECTED에서만. 수량·희망일·사유를 고쳐 WAITING_APPROVAL로([06] PURCHASE_REQUISITION_STATUS).
- 자동 승인은 없다. 부서장 본인 요청은 승인할 사람이 자기 자신뿐이라 등록·재요청 때 `PUR-001`로 거부한다(2026-10-12 결정). 부서장 부재(미지정)도 `PUR-001`. 다른 승인 경로는 TBD(16장).

**발주**(REQ-PUR-003)
- 요청 `{ supplierId, items: [{ purchaseRequisitionId, orderedTon, expectedReceiptDate }] }`. 공급업체 1곳당 1건에 여러 품목.
- 각 구매요청이 APPROVED가 아니면 `PUR-002`. `orderedTon ≤ requestedTon`, `item_id`는 구매요청 품목. 이미 발주된 요청은 `purchase_order_item.purchase_requisition_id` unique가 막는다(P2002 → COM-001).
- 생성 시 구매요청 ORDERED, 발주 CONFIRMED(입고예정 반영). 공급업체 메일 발송은 범위 밖.

**입고 확정**(REQ-PUR-004, BP-PUR-02)
- 발주 품목 행을 `SELECT … FOR UPDATE`(TypedSQL)로 잠그고 `입고 합계 + 이번 입고 ≤ ordered_ton`이 아니면 `PUR-003`. 입고량 0 이하는 거부.
- 같은 tx에서: 입고 저장(`nextDocumentNumber(tx,'GOODS_RECEIPT')`) → 원료 LOT 생성(`nextLotNumber(tx,'RAW_MATERIAL', item.itemCode, 날짜)` → `RM-원료코드-YYMMDD-NNN`, 야드 = 품목 기본 야드, `lot_status` AVAILABLE) → 발주 상태 갱신(모든 품목 입고 완료면 RECEIVED, 아니면 PARTIALLY_RECEIVED).
- 발주가 취소·마감(CANCELLED·CLOSED)이면 발주 행을 잠근 뒤 읽은 상태로 `PUR-007`(입고 확정). 발주 상태는 입고 누계로 정한다(`receiptStatusOf`: 모두 받음 RECEIVED, 일부 PARTIALLY_RECEIVED, 0 CONFIRMED).
- 원료 입고 검사는 없다. 확정 후 수정 API는 없고, 되돌리기는 아래 반대 거래로 한다.

**반대 거래: 발주 취소·잔량 마감·입고 취소**(BP-PUR-02, 2026-10-22 이슈 #500)
- 셋 다 사유 필수(`reason`, 500자, 공백만이면 COM-004). 작업 로그 `reason`에 남긴다(테이블에 칸이 없다).
- 권한: 발주 취소·잔량 마감은 발주 권한(`PURCHASE_ORDER_CONFIRM` USE), 입고 취소는 입고 권한(`GOODS_RECEIPT_CONFIRM` USE) — 입고를 되돌리는 일이라 입고 확정과 같은 권한이다(2026-10-22 결정).
- 발주 취소: 상태 확인(이미 CANCELLED·CLOSED면 COM-001, PARTIALLY_RECEIVED·RECEIVED면 PUR-004) → 조건부 UPDATE CONFIRMED → CANCELLED(0건이면 그사이 입고가 들어온 것 → COM-001) → 연결 구매요청 ORDERED → ORDER_CANCELLED(id 순) → 작업 로그. 같은 요청은 다시 발주하지 않는다(발주 품목 1행 = 구매요청 1건 unique, 발주 등록이 COM-001). 같은 계획·원료로 새 요청은 된다.
- 잔량 마감: PARTIALLY_RECEIVED만(CONFIRMED·RECEIVED는 PUR-005). 조건부 UPDATE → CLOSED 뒤에 품목·입고를 읽어 마감량(`closedTon` = 발주량 − 입고 누계)을 작업 로그에 남긴다. 구매요청은 ORDERED 그대로 두고, 같은 계획·원료 중복 확인(`findOpenRequisitionForPlan`)과 MRP '이미 요청함'(`findRequisitionsForPlans`)에서 뺀다.
- 입고 취소: 취소 행은 다시 취소할 수 없다(COM-004) → 발주 행 잠금(`lockPurchaseOrderByItemId`, 입고 확정과 같은 잠금) → 이미 취소된 입고면 COM-001 → 발주가 CANCELLED면 PUR-007(입고 누계 0일 때만 취소되므로 실제로는 남은 입고가 없다) → 작업 로그 채번 잠금 → 원료 LOT 조건부 UPDATE(AVAILABLE·잔량 = 처음 양·`lot_relation` 부모 없음·배정 없음일 때만 RECEIPT_CANCELLED·잔량 0, 아니면 PUR-006. `RETURNING`의 처음 양이 작업 로그 변경 전 잔량) → 음수 입고 저장(`nextDocumentNumber(tx,'GOODS_RECEIPT')`, 입고일 = 오늘) → 발주 상태 다시 계산(잔량 마감한 발주는 CLOSED 그대로, 입고 누계만 줄어 닫은 양이 는다) → 작업 로그(LOT 포함).
- 잠금 순서: 발주 → 작업 로그 채번(EV 앞부분) → 원료 LOT. 제선 실적은 시작 작업 로그(채번 잠금)를 남긴 뒤 원료 LOT을 FIFO로 잠그므로, 입고 취소가 LOT을 먼저 잡으면 교착이 난다(시험으로 확인). 겹치면 먼저 잡은 쪽만 반영되고, 입고 취소가 지면 LOT 조건(잔량 = 처음 양)에서 빠져 PUR-006, 제선이 지면 원료 부족 INV-001이다.
- 응답: 취소·마감한 발주는 미입고량 0, 남은 양은 `closedTon`·`totalClosedTon`. 원래 입고는 `reversalGoodsReceiptNo`, 취소 행은 `reversedGoodsReceiptId`·`reversedGoodsReceiptNo`로 서로 가리킨다. 입고에는 `purchaseOrderStatus`·`lotStatus`·`isCancellable`(LOT 조건부 UPDATE와 같은 조건 + 취소한 발주 아님)을 실어, 발주 조회 권한이 없는 사원의 화면도 단추를 바르게 정한다.
- 불변식(`npm run check-invariants`): ④ 잔량 0인 원료 LOT은 소진 또는 입고 취소, ⑫ 입고 취소 LOT은 잔량 0·취소 행 있음, ⑬ 취소 행은 원래 입고와 같은 품목·반대 톤이고 발주 품목 입고 누계는 0 ~ 발주량.

**트랜잭션 안 조회**(2026-10-08)
- 트랜잭션 안에서는 관계를 여러 개 한꺼번에 읽지 않는다. Prisma가 트랜잭션 연결 하나에 쿼리를 겹쳐 보내 pg 경고("client is already executing a query", pg@9에서 제거 예정)가 난다.
- 업무 확인에 필요한 관계 하나(요청자 부서, 계획의 수주)만 읽고, 응답 모양(목록·상세 include)은 커밋 뒤에 읽는다. `purchase-tx-queries.spec.ts`가 겹침이 없는지 확인한다.

## 5. 오류 코드·작업 로그

| 코드 | 언제 |
| --- | --- |
| PUR-001 | 요청자 부서의 부서장 미지정(등록·승인) |
| PUR-002 | 승인 전(APPROVED 아님) 발주 |
| PUR-003 | 발주 미입고량 초과 입고 |
| PUR-004 | 입고가 있는 발주 취소 |
| PUR-005 | 일부 입고가 아닌 발주(입고 없음·전량 입고) 잔량 마감 |
| PUR-006 | 쓴 원료 LOT(투입·배정·잔량 감소)의 입고 취소 |
| PUR-007 | 취소·마감된 발주에 입고 확정(취소한 발주의 입고 취소도) |
| COM-002 | 부서장이 아닌 사람의 승인·반려, 요청자 아닌 사람의 재요청 |
| COM-003 | 품목·공급업체·구매요청·발주 품목 없음 |
| COM-001 | 같은 구매요청 중복 발주(P2002), 발주 취소된 요청 발주, 이미 취소·마감한 발주, 이미 취소한 입고, 그사이 상태가 바뀜(조건부 UPDATE 0건) |

| 이벤트 | actor | target | salesOrderId | lotIds | 기타 |
| --- | --- | --- | --- | --- | --- |
| PURCHASE_REQUISITION_CREATED | USER | `purchase_requisition` | 계획이 수주에 연결돼 있으면 | - | 초안에서 왔으면 `actionDraftId`·`messageId` |
| PURCHASE_REQUISITION_APPROVED | USER(부서장) | `purchase_requisition` | 〃 | - | |
| PURCHASE_REQUISITION_REJECTED | USER(부서장) | `purchase_requisition` | 〃 | - | `reason` = 반려 사유 |
| PURCHASE_ORDER_CREATED | USER | `purchase_order` | - | - | |
| GOODS_RECEIPT_CONFIRMED | USER | `goods_receipt` | - | 생성된 원료 LOT | after: 입고 번호·발주·원료 코드·입고량·입고일·LOT·야드 id·발주 상태·입고 누계 |
| PURCHASE_ORDER_CANCELLED | USER | `purchase_order` | - | - | `reason` 필수. after: 발주 상태 CANCELLED, 품목별 연결 구매요청(ORDER_CANCELLED) |
| PURCHASE_ORDER_CLOSED | USER | `purchase_order` | - | - | `reason` 필수. before: 남은 양, after: 상태 CLOSED·마감량·품목별 발주량·입고 누계·마감량 |
| GOODS_RECEIPT_CANCELLED | USER | 원래 `goods_receipt` | - | 취소한 원료 LOT | `reason` 필수. before: 발주 상태·입고 누계·LOT 상태·잔량, after: 원래 입고 번호(`goodsReceiptNo`, 작업 로그 화면의 대상 번호)·취소 행 번호(`reversalGoodsReceiptNo`)·음수 입고량·LOT RECEIPT_CANCELLED·발주 상태·입고 누계 |

## 6. 다른 모듈과의 경계

| 방향 | 상대 | 내용 |
| --- | --- | --- |
| 호출됨 | message-action | `createRequisition(tx, …)` — 초안 확정 tx 안에서 |
| 읽힘 | mrp | 발주 품목·입고 합계(입고예정, 발주 확정·부분 입고만), 계획별 기존 구매요청(발주 취소·잔량 마감한 요청 제외 — mrp.repository가 같은 기준을 따로 둔다) |
| 읽힘 | production | 원료 LOT FIFO(`goods_receipt.received_date`) |
| 호출 | organization(데이터) | 요청자 부서·부서장 |
| 호출 | notification | `notifyEmployees(tx, …)` — 등록·재요청 → 부서장에게 APPROVAL_REQUESTED(`/approvals?pr={id}`), 승인·반려 → 요청자에게 APPROVAL_RESULT(`/purchase-requisitions?pr={id}`, 반려는 사유 포함). 작업 로그 id로 중복 방지 (부서장 본인 요청은 등록되지 않으므로 자기 자신에게 가는 알림은 없음) |

`PurchasingService`를 `exports`에 넣는다.

## 7. 테스트

[04] 14.3 관련 행:

| 검증 | 기대 결과 |
| --- | --- |
| 구매요청 승인 전 발주 | 차단, PUR-002 |
| 부분 입고·확정 재시도 | 잔량 정확, LOT 중복 없음 (PUR-004, LOT-004) |
| 부서장 아닌 사람 승인 | COM-002 (REQ-AUTH-004) |
| 부서장 없는 부서원 요청 | PUR-001 |
| 미입고량 초과 입고 | PUR-003 |
| 발주 취소·잔량 마감·입고 취소와 MRP 입고예정·같은 계획 재요청, 입고 확정·잔량 마감·제선 FIFO와의 경합 | `purchase-reversal.spec.ts` (이슈 #500) |
| 세 API의 사유 길이(400)·권한(403) | `purchase-reversal.routes.spec.ts` |
| 메시지 초안 확정 | 구매요청 WAITING_APPROVAL + `action_draft_id` 연결 (message-action과 함께) |

실행: `npm test -w @fantasteel/server -- purchasing`(묶음 DB `fs_pur`, message-action과 같은 DB). 시드: 구매 2207005, 구매부장 1702004.

## 8. 확인 필요 🟡

| 항목 | 내용 | 근거 |
| --- | --- | --- |
| 부서장 자기 요청·부재 | 구매부장(시드 1702004)이 직접 요청하면 승인권자가 자기 자신이다. 자동 승인 금지. **2026-10-12 결정: 등록·재요청 때 `PUR-001`로 거부**(승인 대기에 영영 머물지 않게. 화면 등록 창도 미리 막는다). 상위 부서장 승인 같은 다른 경로는 TBD | [04] 2장·16장 |
| 다른 역할 요청자 | Message → ERP로 영업·생산 사원이 요청자가 되면 그 부서장(예: 영업부장)이 승인하는데, 영업부장은 PR 조회 권한이 없었다 → 조회 API를 "권한 또는 부서장"으로 열었다. 2026-10-15부터 업무 조회는 모든 역할이라 기본 권한으로는 부서장도 조회 권한이 있고, 이 규칙은 관리자가 조회 권한을 뺀 경우에 쓰인다. 요청자에게 `PURCHASE_REQUISITION_CREATE` USE가 필요한지도 미정(message-action.md 8장) | [권한표], [CSV] 목록 비고 |
| 재요청 이벤트 | BUSINESS_EVENT_TYPE에 재요청이 없다 | [CSV] 재요청 비고, [06] |
| 오류 코드 | 승인량 초과(`ordered_ton > requested_ton`), 잘못된 공급업체, 같은 계획 중복 요청, 상태 전이 위반(이미 승인된 요청 승인 등)에 쓸 코드가 없다 | [04] BP-PUR-01 예외, 9.3 |
| "잘못된 공급업체" | 품목 기본 공급업체와 다른 공급업체로 발주하는 것을 막는지, 기본값만 제안하는지 | [04] BP-PUR-01, REQ-MST-007 |
| 입고 반복 확정 | "반복 확정 차단"을 요청 키로 막을지 미정. 지금은 미입고량 검사만 막는다 | [CSV], 08 공통 규약 |
| 원료 LOT 날짜 | `RM-…-YYMMDD`의 날짜를 입고일(`received_date`)로 할지 등록일로 할지 | [04] 9.2 |
| 발주 묶음 주기 | TBD | [04] BP-PUR-01 |

## 9. 같은 계획·원료 구매요청 중복 (2026-10-21, #478)

- 근거 생산계획이 있는 구매요청(등록·반려 후 재요청)은 진행 중 요청을 확인하기 전에 그 계획 행을 잠근다(`lockProductionPlan.sql`). MRP '요청' 더블클릭·두 사람 동시 요청이 둘 다 '없음'을 보고 두 건을 만들던 것을 막는다(뒤 요청은 COM-004). 고유 제약은 더하지 않았다(반려된 요청은 같은 계획·원료로 다시 만들 수 있어 부분 unique가 필요하고, 잠금으로 충분하다).
