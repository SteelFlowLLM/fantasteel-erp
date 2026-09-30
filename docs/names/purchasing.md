# purchasing · mrp · message-action 모듈에서 새로 지은 이름

용어 사전·프로세스 정의서 11·12장에 없는 이름만 적는다. 스키마·shared에 이미 있는 이름(`purchaseRequisitionNo`, `requiredTon`, `orderedTon`, `receivedTon`, `scheduledReceiptTon`, `netRequiredTon`, `approverId`, `sourceType`, `sourceDraftId`, `draftStatus`, `executionResult`, `rejectReason` 등)은 제외했다. DB 테이블·컬럼은 새로 만들지 않았다.

## 구매 (purchasing)

| 이름 | 어디에 쓰는지 | 왜 필요한지 |
|---|---|---|
| `ApproverPolicy` (`approver.policy.ts`) | 구매 모듈 내부 서비스 | 조직 모듈의 `ApproverResolver`가 없을 때도 돌도록 같은 규칙·같은 시그니처(`resolveApprover(tx, requesterEmployeeId)`)로 만든 내부 구현. 나중에 `ApproverResolver`로 합치면 없어진다 |
| `unorderedTon` | 구매요청 품목·발주 후보 응답 | 아직 발주하지 않은 양 = `requiredTon − orderedTon`. 계산값 |
| `outstandingTon` | 발주 품목·입고 응답, 작업 로그 | 미입고량 = `orderedTon − receivedTon`. 계산값 (용어 사전의 입고예정과 같은 양을 품목 단위로 본 것) |
| `totalRequiredTon`, `totalOrderedTon`, `totalReceivedTon`, `totalOutstandingTon`, `totalUnorderedTon` | 구매요청·발주·발주 후보 응답 | 목록에서 합계를 바로 보이려고. 계산값 |
| `GET /purchase-orders/orderable` | 경로 | 승인됐고 아직 다 발주하지 않은 구매요청 품목을 기본 공급업체별로 묶어 주는 발주 후보 |
| `mine`, `toApprove` | `GET /purchase-requisitions` 쿼리 | 내가 요청한 것 / 내가 승인할 것 |
| `purchaseRequisitions`, `counts.purchaseRequisition`, `counts.total` | `GET /approvals` 응답 | 승인함 목록과 건수. 승인 대상 종류가 늘면(P2 Agent 대응 후보) `counts`에 항목을 더한다 |
| `submit` | `POST /purchase-requisitions` 요청 필드 | 등록과 동시에 제출할지 |
| `sourceDraft` | 구매요청 상세 응답 | 원본 Action Draft와 원본 메시지 (스키마 관계 이름 그대로) |
| `PurchaseRequisitionActionHandler` | 구매 모듈 (`purchase-requisition-action.handler.ts`) | 프로세스 정의서 BP-ACT-01의 이름 그대로 |
| 알림 중복 방지 키 `PR_APPROVAL_REQUEST:<id>:<제출시각>`, `PR_APPROVED:<id>:<시각>`, `PR_REJECTED:<id>:<시각>`, `PR_ORDER_NEEDED:<id>`, `PO_CONFIRMED:<id>` | `notification.dedupe_key` | 같은 이벤트를 같은 사람에게 두 번 보내지 않으려고. 반려 뒤 재제출은 새 알림이 가야 해서 시각을 붙였다 |

## MRP (mrp)

| 이름 | 어디에 쓰는지 | 왜 필요한지 |
|---|---|---|
| `requiredHotMetalTon` | MRP 응답·작업 로그 | 필요 용선(용선 재고를 빼기 전). `mrp_run.hot_metal_ton`에는 재고를 뺀 값(`hotMetalTon`)을 넣었다 |
| `hotMetalRemainingTon` | MRP 응답·작업 로그 | 실행 시점의 용선 LOT 잔량 합계 |
| `plans` | MRP 응답·작업 로그 | 소요를 만든 생산계획 목록 (실행 시점) |
| `contributions` | MRP 원료 행 | 원료별로 어느 생산계획이 얼마를 요구하는지 |
| `coverage` (`openRequisitionTon`, `openRequisitions`, `openPurchaseOrders`, `orderedAfterRunTon`, `uncoveredTon`, `isCovered`) | MRP 원료 행 | 이미 진행 중인 구매요청·발주가 부족을 덮는지 (BP-PRD-01 "같은 계획의 구매요청을 중복 생성하지 않는다"를 P1에서는 화면 안내로 지키려고). 조회 시 계산값 |
| `runEmployee` | MRP 응답 | 실행한 사원 (`mrp_run.run_employee_id`에는 관계가 없어 따로 읽어 붙인다) |
| `shortageCount`, `totalNetRequiredTon` | `GET /mrp-runs` 목록 | 순소요가 있는 원료 수와 합계 |
| `GET /mrp-runs/:id` | 경로 | 과거 실행 조회 (SERVER-GUIDE 7장 표에는 `latest`까지만 있다) |

## Message → ERP (message-action)

| 이름 | 어디에 쓰는지 | 왜 필요한지 |
|---|---|---|
| `ActionDefinition`, `ActionRegistry`, `ACTION_DEFINITIONS` | message-action 모듈 | 업무 유형 등록 구조 (프로세스 정의서 12.3의 `ActionDefinition`, BP-ACT-01의 `ActionSchemaRegistry`에 해당) |
| `confirmer` = `'REQUESTER'` | 유형 정의·초안 응답 | 확정 주체 (12.3 예시의 값 그대로) |
| `requiredPermission` | 유형 정의 | 그 유형의 초안을 만들고 확정하는 데 필요한 시스템 권한 |
| `fieldLabels`, `unresolvedFields`, `actionTypeLabel` | 초안 응답 | 미확정 필드 안내와 화면 표시명 (BP-ACT-01 "미확정 필드로 보여주고 실행하지 않는다") |
| `attemptCount`, `errorCode`, `errorMessage`, `lastAttemptAt` | `action_draft.execution_result` JSON 키 | 실행 실패를 상태 추가 없이 기록 (프로세스 정의서 10장 "에러 코드·시도 횟수") |
| `purchaseRequisitionId`, `purchaseRequisitionNo` | `action_draft.execution_result` JSON 키 | 실행으로 생긴 구매요청 |
| 알림 중복 방지 키 `ACTION_DRAFT_CREATED:<id>` | `notification.dedupe_key` | 초안 생성 알림 |

## 확인이 필요한 결정 (이름은 아니지만 문서에 없던 것)

- 초안 생성 알림의 `notificationType`은 `APPROVAL_REQUEST`(요청자 확인 요청), 발주 확정·발주 필요 알림은 `PURCHASE`를 썼다.
- 구매요청의 `department_id`는 **요청자 소속 부서**를 넣는다 (스키마 주석·조직 모듈 `ApproverResolver`와 같다). 부서장이 요청해 상위 부서장이 승인해도 요청자 부서 그대로다.
