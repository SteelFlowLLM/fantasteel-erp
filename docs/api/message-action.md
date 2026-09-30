# message-action API

Message → ERP: 메신저 메시지에서 구매요청 초안(Action Draft)을 만들고, 요청자가 값을 입력·확정하면 구매요청이 생긴다 (REQ-ACT-001~004, BP-ACT-01).
모든 경로는 `/api/v1` 아래, 로그인 필요. 응답은 `{ success: true, data }` / 실패는 `{ success: false, error: { code, message } }`.
아래 타입과 예시는 실제 서버(포트 8805, DB `fs_pur`)에 curl로 호출한 응답에서 옮겼다.

**v2에는 AI 추출이 없다 (SPEC 8·9장).** 초안은 값이 빈 채로 만들어지고 요청자가 직접 입력한다. 화면의 "AI 자동 추출" 자리는 "준비 중 (P2)"로 둔다.

## 흐름과 상태

```text
POST /messages/:id/action-drafts      AI_GENERATED → (곧바로) WAITING_APPROVAL   값은 비어 있음, 요청자 = 메시지 작성자
PATCH /action-drafts/:id              요청자가 원료·수량·희망 입고일 입력 (WAITING_APPROVAL 동안)
POST /action-drafts/:id/confirm       WAITING_APPROVAL → APPROVED → 구매요청 생성 → EXECUTED
                                      생성된 구매요청은 WAITING_APPROVAL (부서장 승인 대기) — 초안 확정과 구매요청 승인은 별개다
POST /action-drafts/:id/reject        → REJECTED
```

`draftStatus`와 표시명은 `@fantasteel/shared`의 `DRAFT_STATUS` · `DRAFT_STATUS_LABEL` (생성 / 확인 대기 / 확정 / ERP 반영 / 반려).

## 권한

역할 권한 데코레이터 대신 업무 유형 정의의 권한을 service가 검사한다. 구매요청 유형은 `PURCHASE_REQUISITION_CREATE` USE (구매·생산).

| API | 누가 |
|---|---|
| `POST /messages/:id/action-drafts` | 그 메시지가 있는 **채팅방의 멤버** + `PURCHASE_REQUISITION_CREATE` USE |
| `GET /action-drafts`, `GET /action-drafts/:id` | 초안의 요청자 또는 원본 메시지 채팅방의 멤버 |
| `PATCH /action-drafts/:id`, `POST …/reject` | 초안의 **요청자만** |
| `POST /action-drafts/:id/confirm` | 초안의 **요청자만** + `PURCHASE_REQUISITION_CREATE` USE |

## 타입

```ts
type DraftStatus = 'AI_GENERATED' | 'WAITING_APPROVAL' | 'APPROVED' | 'EXECUTED' | 'REJECTED';
type ActionType = 'PURCHASE_REQUISITION_CREATE';

interface EmployeeBrief {
  id: number; employeeNo: string; employeeName: string; jobGrade: string;
  department: { id: number; departmentName: string };
}

/** 구매요청 초안의 payload (@fantasteel/shared PurchaseRequisitionDraftPayload). 미확정 값은 null */
interface PurchaseRequisitionDraftPayload {
  rawMaterialId: number | null;
  requiredTon: string | null;          // '3.000'
  desiredReceiptDate: string | null;   // 'YYYY-MM-DD'
  requesterId: number;                 // 원본 메시지 작성자. 바꿀 수 없다
  requestReason?: string | null;
}

/** 모든 초안 API의 응답, GET /action-drafts 의 원소 */
interface ActionDraftView {
  id: number;
  actionType: ActionType;
  actionTypeLabel: string;             // '구매요청'
  confirmer: 'REQUESTER';              // 확정 주체
  payload: PurchaseRequisitionDraftPayload;
  /** 아직 확정할 수 없는 payload 필드 (비어 있거나 현재 기준정보와 맞지 않음). 비어 있어야 확정할 수 있다. 끝난 초안은 [] */
  unresolvedFields: string[];          // ['rawMaterialId', 'requiredTon', 'desiredReceiptDate']
  fieldLabels: Record<string, string>; // { rawMaterialId: '원료', requiredTon: '수량(톤)', desiredReceiptDate: '희망 입고일', requesterId: '요청자', requestReason: '요청 사유' }
  draftStatus: DraftStatus;
  requesterId: number;
  requester: EmployeeBrief;
  messageId: number | null;
  /** 원본 메시지 */
  message: {
    id: number;
    content: string;
    messageType: string;               // 'TEXT' | 'FILE'
    createdAt: string;
    sender: EmployeeBrief | null;
    chatRoom: { id: number; chatRoomType: string; chatRoomName: string | null };
  } | null;
  /**
   * 실행 결과.
   *  성공: { purchaseRequisitionId, purchaseRequisitionNo, attemptCount }
   *  실패(상태는 APPROVED 유지): { errorCode, errorMessage, attemptCount, lastAttemptAt }
   */
  executionResult:
    | { purchaseRequisitionId: number; purchaseRequisitionNo: string; attemptCount: number }
    | { errorCode: string | null; errorMessage: string; attemptCount: number; lastAttemptAt: string }
    | null;
  /** 생성된 구매요청 (EXECUTED일 때). 부서장 승인 진행 상태를 같이 보여 줄 수 있다 */
  purchaseRequisition: { id: number; purchaseRequisitionNo: string; purchaseRequisitionStatus: string } | null;
  rejectReason: string | null;
  confirmedAt: string | null;          // 요청자 확정 시각
  executedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

## 엔드포인트

### `POST /messages/:id/action-drafts` → `201 ActionDraftView`

```ts
interface CreateActionDraftBody { actionType: 'PURCHASE_REQUISITION_CREATE' }
```
- 요청자(확정 주체)는 **메시지 작성자**다. 다른 멤버가 눌러도 작성자 앞으로 만들어지고, 작성자에게 알림(`APPROVAL_REQUEST`, `linkPath = /action-drafts/:id`)이 간다.
- 같은 메시지·같은 유형의 **미처리 초안**(`EXECUTED`·`REJECTED`가 아닌 것)이 있으면 새로 만들지 않고 그 초안을 돌려준다 (이때도 `201`, `id`가 같다).
- 시스템 메시지는 `400 COM-003`. 작업 로그 `ACTION_DRAFT_CREATED` (`messageId` 포함).

### `GET /action-drafts` → `ActionDraftView[]` (최신순)

| 쿼리 | 뜻 |
|---|---|
| `mine=true` | 내가 요청자인(내가 확정해야 하는) 초안만. 없으면 "내가 요청자이거나 원본 채팅방 멤버"인 초안 |
| `status` | `DraftStatus` |

### `GET /action-drafts/:id` → `ActionDraftView`

### `PATCH /action-drafts/:id` → `ActionDraftView`

```ts
interface UpdateActionDraftBody {
  /** 바꿀 항목만 보낸다. null = 아직 모름(비움) */
  payload: {
    rawMaterialId?: number | null;         // 등록돼 있고 사용 중인 원료
    requiredTon?: string | number | null;  // > 0, 소수 3자리 이하 → '3.000'으로 저장
    desiredReceiptDate?: string | null;    // 'YYYY-MM-DD', 오늘 이후
    requestReason?: string | null;         // 500자 이하
  };
}
```
`WAITING_APPROVAL`일 때만. 값이 틀리면 `400 COM-003`(없는 원료, 0 이하 수량, 지난 날짜, `requesterId` 변경, 모르는 항목).

### `POST /action-drafts/:id/confirm` → `200 ActionDraftView` (본문 없음)

- `unresolvedFields`가 남아 있으면 `400 ACT-001` — message에 빠진 항목이 표시명(필드명)으로 나온다.
- 성공하면 `draftStatus = 'EXECUTED'`, `executionResult = { purchaseRequisitionId, purchaseRequisitionNo, attemptCount }`.
  생성된 구매요청은 `sourceType = 'MESSAGE'`, `sourceDraftId = 초안 id`, 상태 `WAITING_APPROVAL`이고 승인권자(부서장)에게 승인 요청 알림이 간다 → 이후는 `purchasing.md`의 승인 흐름.
- **이미 실행된 초안을 다시 확정**하면 아무것도 만들지 않고 현재 초안을 `200`으로 돌려준다 (구매요청은 1건).
- **실행 핸들러가 실패**하면(예: 부서장 미지정 `PUR-001`) 그 오류가 그대로 응답으로 오고, 초안은 `APPROVED`로 남으며 `executionResult`에 `errorCode`·`attemptCount`가 기록된다. 원인을 고친 뒤 다시 `confirm`하면 실행만 재시도한다.
- 작업 로그: `ACTION_DRAFT_APPROVED` → `PURCHASE_REQUISITION_CONFIRMED` → `ACTION_DRAFT_EXECUTED` (모두 `messageId`·`actionDraftId` 포함).

### `POST /action-drafts/:id/reject` → `200 ActionDraftView`

```ts
interface RejectActionDraftBody { rejectReason: string }   // 필수, 1~500자
```
`WAITING_APPROVAL`(또는 실행에 실패해 멈춘 `APPROVED`)에서만. → `REJECTED`. 작업 로그 `ACTION_DRAFT_REJECTED`.

## 예시

```jsonc
// POST /messages/49/action-drafts (서구매가 누름, 메시지 작성자는 최생산)  {"actionType":"PURCHASE_REQUISITION_CREATE"}
{ "success": true, "data": {
  "id": 45, "actionType": "PURCHASE_REQUISITION_CREATE",
  "payload": { "requesterId": 10, "requiredTon": null, "rawMaterialId": null, "requestReason": null, "desiredReceiptDate": null },
  "draftStatus": "WAITING_APPROVAL", "requesterId": 10, "messageId": 49, "executionResult": null, "rejectReason": null,
  "confirmedAt": null, "executedAt": null, "rejectedAt": null, "createdAt": "2026-09-30T11:28:56.020Z", "updatedAt": "2026-09-30T11:28:56.021Z",
  "requester": { "id": 10, "employeeNo": "2001009", "employeeName": "최생산", "jobGrade": "대리", "department": { "id": 6, "departmentName": "제강파트" } },
  "message": { "id": 49, "content": "다음 주 제강 계획 때문에 합금철 FeMn 3톤이 더 필요합니다. 10일까지 입고 부탁드려요.", "messageType": "TEXT", "createdAt": "…",
    "sender": { "id": 10, "employeeNo": "2001009", "employeeName": "최생산", "jobGrade": "대리", "department": { "id": 6, "departmentName": "제강파트" } },
    "chatRoom": { "id": 45, "chatRoomType": "GROUP", "chatRoomName": "원료 수급 협의" } },
  "purchaseRequisition": null, "actionTypeLabel": "구매요청", "confirmer": "REQUESTER",
  "fieldLabels": { "rawMaterialId": "원료", "requiredTon": "수량(톤)", "desiredReceiptDate": "희망 입고일", "requesterId": "요청자", "requestReason": "요청 사유" },
  "unresolvedFields": ["rawMaterialId", "requiredTon", "desiredReceiptDate"] } }

// PATCH /action-drafts/45 (최생산)  {"payload":{"rawMaterialId":4,"requiredTon":"3"}}
//   → "payload": { "requesterId": 10, "requiredTon": "3.000", "rawMaterialId": 4, "requestReason": null, "desiredReceiptDate": null }, "unresolvedFields": ["desiredReceiptDate"]

// POST /action-drafts/45/confirm (값이 덜 채워졌을 때)
{ "success": false, "error": { "code": "ACT-001", "message": "확정하려면 다음 값을 입력해 주세요: 희망 입고일(desiredReceiptDate)" } }

// POST /action-drafts/45/confirm (최생산, 값을 다 채운 뒤)
{ "success": true, "data": {
  "id": 45, "draftStatus": "EXECUTED",
  "payload": { "requesterId": 10, "requiredTon": "3.000", "rawMaterialId": 4, "requestReason": "다음 주 제강 계획", "desiredReceiptDate": "2026-10-10" },
  "executionResult": { "attemptCount": 1, "purchaseRequisitionId": 88, "purchaseRequisitionNo": "PR-20260930-0076" },
  "confirmedAt": "2026-09-30T11:28:56.476Z", "executedAt": "2026-09-30T11:28:56.484Z",
  "purchaseRequisition": { "id": 88, "purchaseRequisitionNo": "PR-20260930-0076", "purchaseRequisitionStatus": "WAITING_APPROVAL" },
  "unresolvedFields": []
  /* 나머지 필드는 위와 같다 */ } }

// POST /action-drafts/46/reject  {"rejectReason":"석탄은 재고로 충분해 요청하지 않음"}
//   → "draftStatus": "REJECTED", "rejectReason": "석탄은 재고로 충분해 요청하지 않음", "rejectedAt": "2026-09-30T11:29:33.399Z", "purchaseRequisition": null
```

## 오류

| HTTP | code | 언제 | message 예 |
|---|---|---|---|
| 400 | `ACT-001` | 필수값(원료·수량·희망 입고일)이 확정되지 않았는데 확정 | 확정하려면 다음 값을 입력해 주세요: 원료(rawMaterialId), 수량(톤)(requiredTon), 희망 입고일(desiredReceiptDate) |
| 400 | `PUR-001` | 확정은 됐지만 구매요청 제출 단계에서 승인권자가 없음 (초안은 `APPROVED`로 남는다) | 승인권자(부서장)가 지정되어 있지 않아 제출할 수 없습니다… |
| 400 | `COM-003` | 지원하지 않는 유형, 시스템 메시지, 잘못된 payload 값, 반려 사유 없음 | 수량(톤)은 0보다 큰 숫자(소수 3자리 이하)로 입력해 주세요 |
| 403 | `COM-002` | 채팅방 멤버가 아님 / 구매요청 등록 권한 없음 / 요청자가 아닌데 수정·확정·반려 / 볼 수 없는 초안 | 초안의 요청자만 수정·확정·반려할 수 있습니다 |
| 404 | `COM-004` | 메시지·초안 없음 | 메시지을(를) 찾을 수 없습니다 |
| 409 | `COM-005` | 이미 처리된 초안을 수정·확정·반려 | 확인 대기 상태의 초안만 확정할 수 있습니다 |

## 유형 확장 (REQ-ACT-004)

`modules/message-action/action-definition.ts`의 `ActionDefinition`(type · label · confirmer · requiredPermission · fieldLabels · initialPayload · applyPatch · validate · execute)을 구현한 정의 1개와 해당 업무 모듈의 실행 핸들러 1개를 만들고, `message-action.module.ts`의 `ACTION_DEFINITIONS`에 넣으면 된다. 초안의 생성·수정·확정·반려 흐름(`ActionDraftService`)과 이 API는 그대로다. 지금 등록된 유형은 `PURCHASE_REQUISITION_CREATE` 1종(핸들러 `purchasing/purchase-requisition-action.handler.ts`).

실시간 주제: `action-drafts`, `purchase-requisitions`, `business-events`, 사원별 `notification`.
