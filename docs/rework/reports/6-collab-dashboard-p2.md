# 감사 보고서: 협업(업무·알림·메신저) · 대시보드(P3) · 준비 중 화면(P2/EX) — 읽기 전용

## 0. 범위와 전제
- 저장소 파일은 하나도 수정·생성·삭제하지 않았습니다.
- 지정 파일 49개(4,989줄)를 끝까지 모두 읽었습니다. 줄 수 목록은 맨 끝 부록에 있습니다.
- 대조 문서는 지정된 것만 읽었습니다.
  - 노션: 요구사항 정의서, 용어 사전, 공통 코드 정의서, 프로젝트 기획안, 코드 컨벤션(페이지 전체를 받아 2·3·4·9장과 11장 참고)
  - 업무 프로세스 정의서: process.md 1~1530행 전체
  - 다른 노션 페이지, server/, prisma, docs/api, docs/names, SERVER-GUIDE는 열지 않았습니다.
- 코드 주석이 근거로 드는 SPEC.md(“SPEC 3번, 5-1, 5-3, 5-4, 5-5, 7·8번, 9장 #2”)는 지시 범위 밖이라 대조하지 않았습니다. 그래서 C-4의 “문서에 없음”은 지정 문서 기준이며, 그중 일부는 SPEC.md에서 정한 사항일 수 있습니다.
- 지정 목록 밖에서 보조로 읽은 파일
  - 끝까지 읽음: App.tsx, components/ui.tsx, hooks/useApi.ts, hooks/useRealtime.ts, stores/auth.ts, shell/shellTitle.tsx, api/directory.ts, api/queryClient.ts, api/client.ts, shared/src/codes/index.ts
  - 일부만 읽음: features/sales/salesUi.tsx 176~190행, components/DateInput.tsx 1~25행, styles/app.css(검색만)

---

# A. 화면 인벤토리

## A-1. 셸 (Shell.tsx · nav.ts · titles.ts · shellData.ts · AiPanel.tsx)

**라우트 구조**
- 로그인 후 모든 화면은 `Protected → Shell`로 감쌉니다(App.tsx:47-67). `/`로 들어오면 `/dashboard`로 보냅니다(App.tsx:76).
- 범위 안 라우트: `/dashboard`, `/tasks`, `/messenger`, `/agent`, `/meetings`, `/past-cases`(App.tsx:77,101-102,106-108).

**왼쪽 레일 공통 순서** (nav.ts:62-84)
1. 대시보드(`/dashboard`)
2. 역할별 업무 메뉴. 권한 중 하나라도 VIEW 이상이면 보입니다(63).
3. 부서장(`headDepartmentIds.length>0`)에게만: 승인함(`/approvals`, 배지 approvals), Agent(`/agent`, P2)(65-70)
4. 구분선 뒤: LOT 추적(`/lots/trace`) · 작업 로그(`/business-events`) · 사례 검색(`/past-cases`, EX)
5. 구분선 뒤: 업무·알림(`/tasks`, 배지 notifications) · 메신저(`/messenger`, 배지 chat) · 회의록(`/meetings`, P2)

- 준비 중 메뉴는 레일 항목 오른쪽 위에 `P2`/`EX` 글자만 표시하고, 마우스를 올리면 `"{label} · 준비 중 ({grade})"`를 보여 줍니다(Shell.tsx:241,244). 링크는 눌립니다.
- 레일 배지는 99를 넘으면 `99+`로 표시합니다(245).

**역할별 업무 메뉴** (nav.ts:21-60, 표기는 `라벨(경로, 권한[, 배지])`)

| 역할 | 메뉴 |
|---|---|
| SALES | 수주(/sales-orders, ORDER_CREATE) · 등록(/sales-orders/new, ORDER_CREATE) · 출하요청(/shipment-requests, SHIPMENT_REQUEST, 배지 shipmentWaiting) · 재고(/inventories) · 밀시트(/mill-sheets, MILLSHEET_READ) |
| PURCHASE | MRP(/mrp, PURCHASE_REQUISITION_CREATE) · 구매요청(/purchase-requisitions, 같은 권한, /action-drafts/도 이 메뉴로 표시) · 발주(PO_CONFIRM) · 입고(RECEIPT_CONFIRM) · 재고 |
| PRODUCTION | 생산계획(PLAN_CONFIRM, 배지 plansToConfirm) · 공정 실적(RESULT_CONFIRM) · 열연 투입(ROLLING_ALLOCATE) · 구매요청 · 재고 |
| QUALITY | 검사 입력(INSPECTION_REGISTER, 배지 inspectionsPending) · 불합격 관리(DISPOSITION_SET) · 재고 · 밀시트 |
| LOGISTICS | 출고 확정(GOODS_ISSUE_CONFIRM, 배지 goodsIssueWaiting) · 밀시트 · 재고 |
| ADMIN | 사용자(EMPLOYEE_MANAGE) · 부서·권한(ORG_MANAGE) · 기준정보(MASTER_MANAGE) · 재고 |

**배지 출처** (shellData.ts:58-71). 모두 60초마다 다시 조회합니다(24).

| 배지 | 조회 | 조건 |
|---|---|---|
| notifications | GET /notifications/unread-count `.count` | 없음 |
| chat | GET /chat-rooms/unread-count `.totalUnreadCount` | 없음 |
| shipmentWaiting | GET /shipment-requests?status=REQUESTED 결과 개수 | SHIPMENT_REQUEST 또는 GOODS_ISSUE_CONFIRM VIEW |
| goodsIssueWaiting | GET /shipment-requests?status=ALLOCATED 결과 개수 | 위와 같음 |
| plansToConfirm | GET /production-plans?status=PLANNED 결과 개수 | PLAN_CONFIRM USE |
| approvals | GET /approvals `.counts.purchaseRequisition` | 없음 |
| inspectionsPending | GET /quality-inspections?status=pending 결과 개수 | INSPECTION_REGISTER VIEW |

**상단 바** (Shell.tsx:251-265)
- **제목 영역**
  - 작은 줄: `"{area} · {MM-DD (요일)} {HH:mm}{ · 화면 부제}"`. 시계는 30초마다 갱신합니다(28-35, 253).
  - 큰 글씨: 제목. 화면이 `useShellTitle`로 덮어쓸 수 있습니다.
  - 브라우저 탭 제목: `"{title} · FantaSteel ERP"`(230)
- **통합 검색** (133-175)
  - placeholder `수주번호·LOT번호 검색`, aria `통합 검색`
  - 2글자 이상이면 250ms 기다렸다 `GET /search?q=`를 부릅니다(shellData.ts:96-120).
  - 결과 한 줄 = `[종류 태그] 번호`. Enter를 누르면 첫 결과로 이동합니다.
  - 결과가 없을 때: `일치하는 번호가 없어요` / 찾는 동안: `찾는 중…`
  - 종류 이름 예비값(shellData.ts:99-101): 수주 / LOT / 생산계획 / 구매요청 / 출하요청 / 밀시트
- **AI 어시스턴트 버튼** (258-260)
  - 보이는 글자: `AI` 마크 + `AI 어시스턴트`. 준비 중 표시는 aria `(준비 중, P2)`에만 있습니다.
  - 누르면 패널을 열고 닫습니다. 화면을 옮겨도 열린 상태가 유지됩니다(209-224).
- **알림 벨** (56-90)
  - 아이콘에 개수를 표시합니다.
  - 드롭다운 머리: `알림` + `안 읽음 {n}건`
  - 최근 8건(제목·본문·상대 시각, 안 읽은 것은 강조). 열 때만 `GET /notifications?limit=8`을 부릅니다.
  - 항목을 누르면 `/tasks?tab=notifications&notification={id}`로 갑니다. 이때 읽음 처리는 하지 않습니다.
  - 하단 `업무·알림에서 전체 보기`, 비었을 때 `새 알림이 없어요`
- **메신저 아이콘** (93-130)
  - 드롭다운 머리: `메신저` + `안 읽음 {n}건`
  - 최근 방 8개: 이름, 마지막 메시지(또는 `아직 대화가 없어요`, 파일이면 `파일 · …`), 상대 시각, 방별 안 읽음 수
  - 항목을 누르면 `/messenger?room={id}`, 하단 `메신저 열기`, 비었을 때 `참여 중인 대화가 없어요`
- **사용자 메뉴** (177-207)
  - 버튼: `{이름}` / `{부서} · {역할}`
  - 펼치면: `{이름} {직급}`, `사원번호 {no} · {부서}{ · 부서장}`
  - `로그아웃`을 누르면 POST /auth/logout → 소켓 끊기 → 캐시 비우기 → /login 이동

**실시간 토스트** (shellData.ts:137-153)
- `notification` 이벤트: 알림 조회를 다시 부르고 제목을 토스트로 띄웁니다. 단 MENTION·WORK_ROOM_MESSAGE 유형은 토스트를 띄우지 않습니다.
- `message` 이벤트: 남이 보낸 메시지이고 지금 열어 둔 방이 아니면 `"{보낸 사람}{님이 멘션했어요}: {내용 40자}"` 토스트를 띄웁니다.

**범위 안 제목 표** (titles.ts)

| 경로 | 제목 | 작은 줄 영역명 |
|---|---|---|
| /dashboard | 대시보드 | 현황 |
| /tasks | 업무·알림 | 협업 |
| /messenger | 메신저 | 협업 |
| /agent | AI Factory Agent | 준비 중 (P2) |
| /meetings | 회의록 | 준비 중 (P2) |
| /past-cases | 과거 사례 검색 | 준비 중 (EX) |
| /action-drafts | 구매요청 초안 | 메신저 → ERP |
| /business-events | 작업 로그 · Decision Replay | 추적 |

---

## A-2. 메신저 `/messenger[?room=<id>]` (MessengerPage.tsx 외)

**들어오는 길**
- 레일 `메신저`, 상단 메신저 드롭다운, 알림 linkPath
- 범위 밖 화면: 영업의 `업무방` 버튼(salesUi.tsx:180-190, `GET /chat-rooms/work-room?salesOrderId=`), 구매 쪽 `원본 메시지` 링크

**제목**
- `메신저`. 부제는 열린 방 이름, 방을 고르지 않았으면 `대화방 {n}개 · 안 읽음 {n}`(485)

**배치**
- 방 목록 | 대화 | 방 정보 세 칸입니다.
- 방 정보 칸은 토글로 열고 닫으며, 화면 폭 1180px 미만에서는 숨깁니다(MessengerPage.css:27).

### (1) 방 목록 (49-127)
- **머리**: `대화방`, `{n}개 · 안 읽음 {n}`, `새 대화` 버튼
- **검색**: placeholder `방 이름·수주번호·멤버 검색`. 방 이름·수주번호·고객사·마지막 메시지·멤버 이름에서 찾습니다(57).
- **필터 세그먼트** (61-64): `전체` / `안 읽음 {n}` / `1:1` / `그룹` / `업무방 {n}`
- **전체 보기 묶음**: `업무방 {n}` → `그룹 {n}` → `1:1 {n}` 순서. 묶음 안 순서는 서버가 준 그대로입니다(65-69).
- **방 한 줄**
  - 아이콘: 1:1은 상대 이름 첫 글자, 그룹은 #, 업무방은 수주 아이콘(ChatParts.tsx:36-46)
  - 이름 → (필터 중이면) 유형 태그 → 시각(오늘이면 HH:mm, 어제면 `어제`, 그 전은 MM-DD)
  - 마지막 줄 `"나: …"` 또는 `"{보낸 사람}: …"`, 안 읽음 배지(99+)
  - 업무방이면 한 줄 더: `{고객사} · 납기 MM-DD · {수주 상태} · 멤버 {n}`(110-117)
- **빈 상태** (123): `조건에 맞는 대화방이 없어요` / `참여 중인 대화방이 없어요 · [새 대화]로 시작해 보세요`
- 방을 고르지 않았을 때(502-507): `대화방을 골라 주세요` · `왼쪽 목록에서 방을 고르거나 새 대화를 시작해 보세요` · `새 대화`

### (2) 대화 영역
- **머리** (381-394)
  - 방 아이콘, 방 이름, 설명 줄(30-38)
    - 1:1: `1:1 · {부서} · {직급}`
    - 업무방: `수주 연결 업무방 · 멤버 {n}`
    - 그룹: `그룹 · {부서 최대 3개}{ 외} · 멤버 {n}`
  - 오른쪽: 업무방이면 태그 `수주 연결 업무방`, 1:1이 아니면 `멤버 초대` 버튼, 방 정보 토글 아이콘
- **업무방 고정 줄 OrderPin** (130-149)
  - `수주 {SO 번호 링크} · {고객사}`
  - `납기 YYYY-MM-DD (D-n)`
  - 수주 상태 배지
  - `수주 상세` 버튼
  - 품목 줄: `{행번호} {슬래브|코일} {규격코드} · {수량}{매|개} ({t}) · 출고 {n}`
- **메시지 피드** (396-444)
  - 맨 위: `이전 메시지 더 보기` / `불러오는 중…` 또는 `대화의 처음이에요`
  - 빈 피드: `아직 메시지가 없어요 · 첫 메시지를 보내 보세요`
  - 날짜 구분선: `오늘` / `어제` / `MM-DD (요일)`
  - 아래를 보고 있지 않을 때 새 메시지가 오면 `새 메시지 {n}건` 알약 버튼
- **시스템 메시지** (ChatParts.tsx:111-120): `SYSTEM · {내용(링크 포함)} · HH:mm`
- **사람 메시지** (ChatParts.tsx:135-186)
  - 아바타, 이름, `{부서} · {직급}{ · 나}`, 시각
  - 본문: @멘션 강조, 서버가 준 `links`를 링크로 바꿈
  - 파일 칩: 이름, `{크기} · {확장자}`, 내려받기
  - 이동 링크 최대 3개(73-90): `수주 상세 {번호} →` / `구매요청 보기` / `LOT 추적` / `화면 열기`
  - 이 메시지로 만든 초안이 있으면: 초안 상태 배지 + `구매요청 초안 보기 →`
  - 나를 멘션한 메시지는 배경을 강조합니다(163).
  - 마우스를 올리면 Message→ERP 바(144-159) 노출
    - 조건: messageType이 TEXT이고, 사용자에게 PURCHASE_REQUISITION_CREATE USE 권한이 있을 것
    - 버튼: `구매요청 초안 만들기`(만드는 동안 `초안 만드는 중…`). 처리가 안 끝난 초안이 이미 있으면 `초안 보기`
    - 옆에 `AI 자동 추출` + `준비 중` 표시. 툴팁: “AI 자동 추출은 포함되지 않아요. 초안의 값은 요청자가 직접 입력해요”
- **입력창** (ChatComposer.tsx)
  - textarea: 최대 4000자, 최대 6줄까지 자동으로 늘어남
    - placeholder `메시지 입력 · @ 로 멤버 멘션`, 파일을 붙였을 때 `파일과 같이 보낼 말을 적어 주세요 (선택)`
  - 멘션 팝업(120-144)
    - 맨 위에 비활성 항목 `@AI 호출 · AI 어시스턴트에게 묻기 · 준비 중 (P2)`
    - 멤버 후보 최대 8명(나 제외, 이름 부분 일치), 없으면 `일치하는 멤버가 없어요`
    - 화살표로 고르고 Enter/Tab으로 넣고 Esc로 닫습니다.
  - 아래 막대
    - 클립(툴팁 `파일 첨부 (20MB까지, 실행 파일 제외)`)
    - `@ 멘션`
    - `@AI 호출 준비 중 (P2)`(항상 비활성)
    - 안내 `Enter 보내기 · Shift+Enter 줄바꿈`
    - `보내기` / `보내는 중…`
  - 파일 칩에 `첨부 취소` 버튼이 있습니다.
  - 한글 조합 중 Enter는 보내지 않습니다(78).
- **읽음 처리** (293-347): 창에 포커스가 있고, 맨 아래를 보고 있고, 남이 보낸 새 메시지가 있을 때만 `PUT /chat-rooms/:id/read {lastReadMessageId}`를 부릅니다.

### (3) 방 정보 칸 RoomAside (152-240)
- **업무방**: `수주 요약` + 수주번호 링크
  - 항목: 고객사 / 납기(+D-n) / 상태 배지 / 품목 `{n}품목`
  - 품목별: `{행번호} {유형} {강종}` + 품목 상태 배지, 규격코드, `주문 {n}{단위} · {t} · 출고 {n}{단위}`
  - `수주 상세` 버튼
- **업무방이 아닐 때**: `방 정보` + 유형 태그, 항목 이름 / 개설일
- **`공유 파일 {n}`** + `불러온 대화 기준`
  - 최근 5개: 파일 칩 + `{보낸 사람} · MM-DD`
  - 없으면 `이 방에 공유된 파일이 없어요`
- **`멤버 {n}`** + `초대`(1:1 제외)
  - 멤버 줄: 첫 글자, 이름, 직급, ` · 나`, 부서 태그
  - `AI 어시스턴트 (@AI 호출) 준비 중 (P2)` 표시
  - 1:1이면 `1:1 대화에는 멤버를 추가할 수 없어요. 그룹 대화를 새로 만들어 주세요`
  - 그룹이면 `그룹 나가기`

### (4) 모달 (RoomModals.tsx)과 사람 고르기 (MemberPicker.tsx)

**새 대화** (9-58, 폭 560)
- 대화 종류 세그먼트: `1:1 대화` / `그룹 대화`. 업무방은 없습니다.
- `방 이름`: 그룹일 때만, 선택 입력, 50자
  - 힌트 `비워 두면 멤버 이름으로 보여요 (50자까지)`, placeholder `예: 출하 조율`
- 멤버 라벨: `대화 상대 (1명)` 또는 `멤버 (1명 이상)` + MemberPicker(1:1이면 한 명만 고르는 radio, 나는 목록에서 뺌)
- 안내 `업무방은 수주 1건에 1개씩 연결되는 방이라 여기서 만들지 않아요`(54)
- 하단 문구: 1:1이면 `같은 상대와의 1:1 대화가 이미 있으면 그 방이 열려요`, 그룹이면 `{n}명 선택 · 나는 자동으로 들어가요`
- 검증: 오류 문구는 없고 버튼만 막습니다. 1:1은 정확히 1명, 그룹은 1명 이상.
- **수주 연결 입력 칸 없음**: `CreateChatRoomBody.salesOrderId`는 타입에만 있고 화면에서 쓰지 않습니다(messenger.ts:97).

**멤버 초대** (60-88)
- 제목 `멤버 초대 · {방}`
- MemberPicker: 기존 멤버는 체크된 채 잠기고 `참여 중`으로 표시
- 하단 `새 멤버도 이전 대화를 볼 수 있어요`, 버튼 `{n}명 초대`

**그룹 대화 나가기** (90-109, 폭 420)
- 본문: “{방}에서 나가면 이 방의 대화를 더 볼 수 없어요. 다시 들어오려면 멤버에게 초대를 받아야 해요.”
- 버튼 `나가기`

**MemberPicker**
- 검색: `이름·사원번호·부서 검색`
- 고른 사람은 칩으로 보이고, 누르면 빠집니다.
- 조직도 보기: 부서 접기/펼치기, 부서 전체 선택 체크박스(여러 명 고를 때만, 일부만 고르면 중간 상태), `{n}명 · {k}명 선택`, 사람 줄에 `부서장` 태그
- 검색 결과 줄: `{이름} {직급} · {부서} · {사원번호}`
- 빈 상태: `일치하는 사원이 없어요` / `등록된 부서가 없어요`

### (5) 메신저 버튼 표

| 버튼 | 위치 | 누를 수 있는 조건 | 동작 / API |
|---|---|---|---|
| 새 대화 | 목록 머리(76), 빈 화면(506) | 항상 | 새 대화 모달 열기 |
| 필터 세그먼트 | 82-86 | 항상 | 화면 안에서만 거름 |
| 방 한 줄 | 95 | 항상 | `/messenger?room=id`로 이동 |
| 멤버 초대 / 초대 | 389 / 219 | 1:1이 아닐 때 | 초대 모달 열기 |
| 방 정보 토글 | 390 | 항상 | 오른쪽 칸 열고 닫기 |
| 수주 상세 · 수주번호 링크 | 136, 139, 161, 185 | 업무방 | `so.linkPath`로 이동 |
| 이전 메시지 더 보기 | 401-407 | 더 오래된 메시지가 있을 때(불러오는 중엔 막힘). 위로 60px 안까지 스크롤하면 자동으로 불러옴 | GET /chat-rooms/:id/messages?beforeId=&limit=50 |
| 새 메시지 n건 | 439 | 아래를 보고 있지 않을 때 새 메시지 도착 | 맨 아래로 이동 + 읽음 처리 |
| 구매요청 초안 만들기 | ChatParts 150 | TEXT 메시지 + PURCHASE_REQUISITION_CREATE USE + 처리 안 끝난 초안 없음 | POST /messages/:id/action-drafts `{actionType:'PURCHASE_REQUISITION_CREATE'}` → `/action-drafts/{id}`로 이동, `action-drafts` 다시 조회 |
| 초안 보기 / 구매요청 초안 보기 → | 148 / 179 | 해당 초안 있음 | `/action-drafts/{id}`로 이동 |
| 파일 내려받기 | ChatParts 104 | 파일 있음 | `<a href=/api/v1/messages/:id/file?access_token=…>` |
| 클립 / 첨부 취소 | Composer 174 / 152 | 보내는 중이 아닐 때 | 파일 1개 고르기 / 빼기 |
| @ 멘션 | 177 | 항상 | `@`를 넣고 후보 팝업 열기 |
| @AI 호출 | 178 | 항상 막힘(P2) | 없음 |
| 보내기 (Enter) | 182 | 보내는 중이 아니고, 파일이나 글이 있을 때 | 글: POST /chat-rooms/:id/messages `{content, mentionEmployeeIds?}`<br>파일: POST /chat-rooms/:id/files (multipart: file, content?) |
| 그룹 나가기 | 235 | 그룹 방 | 나가기 모달 열기 |
| 대화 시작 | 모달 38 | 위 검증 통과 + 처리 중 아님 | POST /chat-rooms `{chatRoomType, memberIds, chatRoomName?}` → 그 방으로 이동 |
| {n}명 초대 | 79 | 1명 이상 | POST /chat-rooms/:id/members `{memberIds}` → 토스트 `멤버를 초대했어요` |
| 나가기 | 100 | 처리 중 아님 | DELETE /chat-rooms/:id/members/me → 토스트 `대화방에서 나갔어요`, `/messenger`로 이동 |

---

## A-3. 업무·알림 `/tasks?tab=tasks|notifications[&notification=<id>]` (TaskNotificationPage.tsx)

**들어오는 길**
- 레일 `업무·알림`(배지 = 안 읽은 알림 수), 상단 벨 드롭다운
- 주소에 `notification`만 있고 `tab`이 없으면 알림 탭으로 엽니다(237).

**제목**
- `업무·알림`. 부제는 `안 읽음 {n} · 오늘 마감 {n}{ · 마감 지남 n}`이며 내 업무 기준입니다(248).

**탭** (259-266)
- `업무 {내가 담당한 미완료 업무 수}` / `알림 {안 읽음 수}`
- 업무 탭으로 바꾸면 주소의 `notification`을 지웁니다.

### 업무 탭 (TaskBoard 72-117, TaskCard 35-70)
- **범위 세그먼트** (22): `내 업무`(mine) / `내가 만든 업무`(created) / `전체`(all)
  - 여기서 `all`은 “내가 담당 ∪ 내가 만든 것”입니다(tasks.ts:22).
- **배지**: `마감 지남 {n}`, `오늘 마감 {n}`, 문구 `정렬: 마감일 빠른 순`. 화면은 정렬하지 않고 서버 순서를 그대로 씁니다.
- `업무 추가` 버튼
- **칸반 3열**: `할 일`(TODO) / `진행 중`(IN_PROGRESS) / `완료`(DONE), 열마다 개수
  - 빈 열: `할 일이 없어요` / `진행 중인 업무가 없어요` / `완료한 업무가 없어요`
- **카드**
  - 제목(완료면 취소선), 수정 아이콘, 설명(3줄까지)
  - `담당 {이름}{ (나)}`, 담당과 만든 사람이 다르면 `· 요청 {이름}{ (나)}`
  - 오른쪽 날짜 문구
    - 완료: `완료 MM-DD HH:mm`
    - 마감 지남: `MM-DD 마감 지남 (D+n)`(카드 배경 빨강, 42)
    - 오늘 마감: `오늘 마감`
    - 그 외: `마감 MM-DD (D-n)`
    - 마감일 없음: `마감 없음`
  - 버튼(62-66). 모두 POST /tasks/:id/status `{taskStatus}`이며 처리 중엔 막힘
    - TODO일 때 `시작`(→IN_PROGRESS)
    - IN_PROGRESS일 때 `할 일로`(→TODO)
    - 완료가 아니면 `완료`(→DONE)
    - 완료면 `다시 열기`(→IN_PROGRESS)
    - linkPath가 있으면 `화면 열기 →`

**업무 추가·수정 모달** (TaskFormModal.tsx)

| 항목 | 입력 형태 | 검증과 안내 |
|---|---|---|
| 제목* | input, 200자, 자동 포커스, placeholder `예: 원료 입고 일정 확인` | 비어 있으면 저장을 누른 뒤 `제목을 입력해 주세요` |
| 설명 | textarea 3줄, 2000자, placeholder `필요한 내용을 적어 주세요` | 없음 |
| 담당자* | select, 부서별 묶음, 표시 `{이름} {직급}{ (나)}`, 기본값 나 | 힌트 `조직 정보의 재직 중인 사원`. 사원 목록을 불러오는 동안 막힘 |
| 마감일 | DateInput(직접 입력 + 달력) | 힌트 `비워 두면 마감 없음` |
| 연결 화면 | input, placeholder `/…` | 힌트 `업무에서 바로 열 화면 경로 (선택). 예: /goods-receipts, /sales-orders/12`<br>오류 `"/"로 시작하는 화면 경로만 넣을 수 있어요 (예: /goods-receipts)` |

- 하단 문구: 담당자가 나면 `나에게 맡기는 업무는 알림이 없어요`, 아니면 `담당자에게 업무 배정 알림이 가요`(70)
- 버튼: `취소`, `추가`/`저장`(처리 중 `저장하는 중…`)
- 추가는 POST /tasks, 수정은 PATCH /tasks/:id에 바뀐 항목만 보냅니다. 비운 항목은 null로 보냅니다(49-60).
- 토스트: `업무를 추가했어요` / `업무를 고쳤어요`
- 삭제 기능과 상태 입력 칸은 없습니다.

### 알림 탭 (NotificationList 120-230)
- **카드 머리**: `알림함`, 배지 `안 읽음 {n}`, 체크박스 `안 읽은 것만`
- **`모두 읽음`**: 안 읽음이 0이거나 처리 중이면 막힘
  - POST /notifications/read-all
  - 토스트 `알림 {n}건을 읽음 처리했어요` / `안 읽은 알림이 없어요`
- **목록**: 날짜 구분선, 20건씩 cursor로 불러옴(GET /notifications?unreadOnly&limit=20&cursor)
- **알림 한 줄**
  - 유형 배지, `departmentId`가 있으면 `부서 알림` 태그(200)
  - 제목(안 읽음은 굵게), 시각 HH:mm, 안 읽음 점, 본문
  - 아래 줄: `연결된 화면 열기 →` 또는 `연결된 화면이 없는 알림이에요` / `누르면 읽음으로 바뀌어요`, 읽었으면 `읽음 MM-DD HH:mm`
  - 누르면(Enter/Space 포함): 안 읽은 것이면 POST /notifications/:id/read, 그다음 linkPath로 이동(149-152)
- **`?notification=` 처리**: 최대 5페이지까지 더 불러와 찾고, 찾으면 그 위치로 스크롤해 강조합니다. 못 찾으면 안내 `고른 알림을 최근 목록에서 찾지 못했어요. 아래에서 더 불러와 찾아 보세요`(133-147, 174-176)
- **목록 끝**: `이전 알림 더 보기` / `마지막 알림이에요`
- **빈 상태**: `안 읽은 알림이 없어요` / `받은 알림이 없어요`

---

## A-4. 대시보드 `/dashboard[?edit=1]` (DashboardPage.tsx 외)

**들어오는 길**: 레일 맨 위 로고와 `대시보드`. 제목 `대시보드`(현황).

**상단 줄** (108-121)
- 인사: `{이름}님, 안녕하세요`
- `{부서} · {역할} · YYYY-MM-DD (요일)`
- 바로가기 버튼: 권한(USE)이 있는 것 중 앞에서 3개(19-29, 첫 번째만 primary)
  - 수주 등록 · 출하요청 등록 · MRP · 입고 확정 · 생산계획 · 공정 실적 · 검사 입력 · 출고 확정
- `위젯 편집` → 주소에 `?edit=1`

**편집 모드** (123-145)
- 안내 띠: `위젯 편집 중 · 카드 머리를 끌어 옮기고, 모서리를 끌어 크기를 바꾸고, ×로 제외해요`
- 바뀐 내용이 있으면 배지 `저장 안 된 변경 있음`
- 버튼
  - `위젯 추가`: 추가 패널을 닫았을 때만 보임
  - `기본 배치로`: 화면에서 기본 배치를 다시 만듦. 저장 중엔 막힘
  - `취소`: 바꾼 내용을 버리고 편집을 끝냄
  - `저장`: 저장 중이거나, 바뀐 것이 없고 서버 배치가 기본 배치가 아니면 막힘(툴팁 `바뀐 내용이 없어요`). PUT /dashboard/layout → 토스트 `위젯 배치를 저장했어요`
- 저장하지 않은 변경이 있으면 창을 닫거나 새로 고칠 때 브라우저가 물어봅니다(85-90).

**격자** (DashboardGrid.tsx, react-grid-layout)
- 12칸, 한 줄 높이 60px, 간격 16px
- 편집 모드에서만
  - 카드 머리를 끌어 옮깁니다.
  - 오른쪽 아래 모서리·오른쪽 변·아래 변(se·e·s)으로 크기를 바꿉니다.
  - 빈 줄은 위로 당겨 정리합니다.
- 위젯별 최소 크기가 있습니다. 단 저장된 크기가 최소보다 작으면 저장값을 그대로 둡니다(13).
- 편집 중에는 카드 안 링크가 막힙니다(DashboardPage.css:21).
- shared에 없는 위젯 코드는 그리지 않습니다(35).

**빈 화면**
- `표시할 위젯이 없어요`
- 편집 중이면 `오른쪽 "위젯 추가"에서 위젯을 골라 주세요`, 보기 모드면 `위젯 추가` 버튼

**위젯 카드** (WidgetCard.tsx)
- 머리: (편집 중) 끌기 아이콘 · (P2) `AI` 마크 · 제목 · (P2) `준비 중 (P2)` · 보조 문구
- 머리 오른쪽: 백그라운드 조회 중 아이콘, 바로가기 링크(보기 모드이고 P2가 아닐 때), 편집 중이면 `×`(aria `{제목} 위젯 제외`)
- 오류
  - 403이면 `이 위젯을 볼 권한이 없어요`
  - 그 밖은 서버 메시지 또는 `불러오지 못했어요` + `다시 시도`
- 갱신
  - 위젯마다 따로 GET /dashboard/widgets/{code}를 부릅니다.
  - P2가 아니면 30초마다 다시 부릅니다.
  - 소켓 `changed`가 어떤 주제로든 오면 1초 기다렸다 모든 위젯을 다시 부릅니다(DashboardPage.tsx:73-79).

**위젯 추가 패널** (WidgetAddPanel.tsx)
- 머리: `위젯 추가`, `14개 중 {n}개 표시`, 닫기
- 아직 놓지 않은 위젯 목록: 아이콘, 이름, (P2면 `준비 중 (P2)`), 설명, `기본 크기 w × h칸`, `추가`
  - `추가`를 누르면 맨 아래 왼쪽에 기본 크기로 놓습니다.
  - P2 위젯도 추가할 수 있습니다.
- 다 놓았으면 `모든 위젯이 표시 중이에요`
- 하단 안내: `[추가]를 누르면 맨 아래에 기본 크기로 놓여요. 카드 머리를 끌어 옮기고 모서리를 끌어 크기를 바꾸세요`

**위젯 14개** (이름·기본·크기는 shared index.ts:318-333, 설명·최소 크기·바로가기는 widgetCatalog.ts:25-40)

| 코드 | 이름 | 구분 | 기본 크기 / 최소 | 카드 바로가기 | 머리 보조 문구 | 본문 |
|---|---|---|---|---|---|---|
| PROCESS_FLOW | 공정 흐름 현황 | 기본 | 12×3 / 4×2 | 없음 | `오늘 출고 {n}건 · HH:mm 기준` | 서버가 준 단계(라벨·건수·단위)를 › 로 이은 흐름 상자. linkPath가 있으면 링크. 빈 상태 `표시할 공정 단계가 없어요` |
| ORDER_FULFILLMENT | 수주 충족 현황 | 기본 | 6×5 / 4×3 | 수주 목록 | `{전체}건 중 {n}건 · 납기 빠른 순` | 표 열: **수주번호·고객사·품목·주문·출하·예약·생산 중·진행률·납기**. 수주별로 셀 병합. 진행률 막대는 출하/예약/생산 중 구간 + %. 납기 `MM-DD (D-n)`, 위험이면 경고 아이콘 + 빨간 행. 하단 범례와 `진행률 = {서버 정의}`. 빈 상태 `진행 중인 수주가 없어요` / `품목 없음` |
| AGENT_RISK | Agent 위험 감지 | 기본 · P2 | 6×5 / 3×3 | 없음 | 없음 | 흐린 예시(아래 A-5 참고) |
| RECENT_EVENTS | 최근 작업 로그 | 기본 | 6×5 / 3×2 | 작업 로그 | `최근 {n}건` | 한 줄: 상대 시각 · 주체(서버 actorLabel) · 이벤트명(서버) · AI 경유면 `AI` 칩 · 요약(링크). 빈 상태 `최근 작업 로그가 없어요` |
| PRODUCT_STOCK | 제품 재고 | 기본 | 6×5 / 3×3 | 재고 | `합격 · 매수` | 유형별 막대(예약/가용) + `가용 n / 재고 n매·개`. 표 열: **규격·재고·예약·가용**. 하단 서버 note. 빈 상태 `재고가 있는 규격이 없어요` |
| PROCESS_YIELD | 공정별 수율 | 기본 | 6×4 / 3×3 | 없음 | `완료 실적 기준` | 공정별 실적 수율 막대(계획보다 낮으면 주황) + 계획 수율 눈금 + %. 보조 줄 `실적 n건 · 투입→산출 · 계획 수율 · 계획 대비 산출`. 빈 상태 `공정 실적이 없어요` / `완료된 공정 실적이 아직 없어요` |
| RAW_MATERIAL_BALANCE | 원료 잔량 대비 소요 | 추가 후보 | 6×4 / 4×3 | MRP | `{MRP번호} · MM-DD HH:mm` 또는 `MRP 실행 기록 없음` | 표 열: **원료·잔량·입고 예정·총소요 (MRP)·순소요·잔량 / 총소요**. 순소요가 0보다 크면 `부족 {t}` 빨간 행 |
| REJECT_RATE | 강종별 불합격률 | 추가 후보 | 6×4 / 3×3 | 없음 | `최근 {days}일` | 강종별 막대 + `% f/i건` + 공정별 `f/i`. 안내 `막대 끝 = n% · 불합격 / 판정된 검사 수` |
| DELIVERY_RISK | 납기 위험 수주 | 추가 후보 | 6×4 / 4×2 | 수주 목록 | `{total}건 중 n건 · 납기 {d}일 이내` | 표 열: **수주번호(#행번호)·고객사·품목·출하 / 주문·남은 수량·납기**. 납기 지남은 빨강. 빈 상태 `납기 위험 수주가 없어요` |
| PURCHASE_PROGRESS | 구매 진행 | 추가 후보 | 6×4 / 3×3 | 발주 | `미입고 발주 {n}건` | 구매요청 상태별 건수(서버 라벨) + 비율 막대. `미입고 발주 n건 · 남은 입고 t`. 발주 목록(번호·공급업체·남은 t·`납기 MM-DD`/`납기 없음`) |
| SHIPMENT_RESULT | 출하 실적 | 추가 후보 | 6×4 / 3×3 | 없음 | `최근 {days}일` | `출고 LOT n개` · `출고 중량` + 하루 단위 누적 막대(슬래브(매)/코일(개)) |
| SURPLUS_AGE | 여재 보유 기간 | 추가 후보 | 6×4 / 3×3 | 없음 | `{n}매 중 오래된 n매` 또는 `오래된 순` | 여재 매수·중량·최장 보유·평균 보유. LOT 목록(LOT·강종·보유 막대·n일) |
| PRODUCTION_VOLUME | 생산량 | 추가 후보 | 6×4 / 3×3 | 없음 | `최근 {days}일` | 슬래브 매·코일 개 + 하루 단위 막대 |
| AI_USAGE | AI 활용 현황 | 추가 후보 · P2 | 6×4 / 3×2 | 없음 | 없음 | 흐린 자리 표시: `AI 어시스턴트 질문 —건`, `초안 작성 —건`, `Agent 감지 —건`, `AI 기능(2등급)이 추가되면 사용 현황이 여기에 보여요` |

**기본 배치** (widgetCatalog.ts:46-62)
- 1줄: PROCESS_FLOW (y0, 12칸 전체)
- 2줄: ORDER_FULFILLMENT | AGENT_RISK (y3)
- 3줄: RECENT_EVENTS | PRODUCT_STOCK (y8)
- 4줄: PROCESS_YIELD (y13)

**P2 위젯 표시 방식**
- 서버는 `{available:false, grade:'P2'}`만 줍니다(dashboard.ts:13).
- 카드에 `hl-ai-card dsh-card--soon` 클래스, 머리에 `AI` 마크와 `준비 중 (P2)`를 붙입니다.
- 본문은 `.dsh-soon`: 흐림(opacity .55), 클릭 불가, 화면 낭독기에서 숨김(DashboardPage.css:31-32).
- 30초 주기 갱신을 하지 않습니다.
- 편집 모드에서는 일반 위젯처럼 옮기고, 크기를 바꾸고, 빼고, 추가할 수 있습니다.

---

## A-5. 준비 중 화면

**공통 표시 방식** (components/ui.tsx)

| 부품 | 위치 | 표시 |
|---|---|---|
| `ComingSoon` | 102-104 | `준비 중 (P2)` / `준비 중 (EX)` / `준비 중`(grade AI) |
| `ComingSoonArea` | 107-117 | 안내 띠: `준비 중 ({grade})` + “**{title}**은(는) {2등급(AI) 기능 / 추가 기능}이라 지금은 화면만 볼 수 있어요. 1등급 기능이 끝난 뒤 하나씩 추가돼요.”<br>본문은 흐리고 회색조에 클릭 불가, 화면 낭독기에서 숨김(app.css:64) |
| `SoonButton` | 120-126 | 항상 비활성 버튼, 툴팁 `준비 중 (P2/EX)`, 글자 뒤에 `준비 중` 배지 |

- 세 화면 모두 `예시 화면` 배지와 “아래 내용은 화면 구성을 보여 주는 예시예요. 실제 데이터가 아니에요.”를 표시합니다. 사례 화면만 끝이 “실제 사례가 아니에요.”입니다.
- API 호출은 없습니다.

### AI Factory Agent `/agent` (AgentPage.tsx, P2)
- **들어오는 길**: 레일 `Agent`(부서장에게만 보임, nav.ts:68)
- **누를 수 있는 것**: 없음. 본문 전체가 클릭 불가 영역이고, 버튼도 모두 비활성입니다.
- **왼쪽 `감지 목록`**
  - 머리: `감지 5건` `예시`, 필터 아이콘(span)
  - 칩: `전체 5`, `원료 1`, `합격 1`, `납기 1`, `여재 1`, `품질 1`
  - 감지 항목 5개(13-19). 형식 `[심각도] ①~⑤ 유형 / 제목 / 후보 n · 안내`
    - ① 원료 부족(높음) — 승인 대기 1 · 구매요청 초안
    - ② 합격 매수 부족(높음) — 재생산 계획 초안
    - ③ 납기 위험(높음) — 담당자 알림
    - ④ 여재 장기 보유(참고) — 대기 수주 배정 추천
    - ⑤ 불합격률 상승(주의) — 품질 부서 알림
  - `최근 24시간 해소`: `해소` 배지, 석회석 부족 예상 → 구매요청 실행됨
  - `감지 종류 · 스케줄 감지와 이벤트 감지`: 규칙 5개(21-27)
  - 버튼: `감지 기준 설정`(비활성), `지금 감지 실행`(SoonButton)
- **오른쪽 상세**
  - 경로 표시 `대시보드 › AI Factory Agent › ① 원료 부족`
  - 제목 `① 원료 부족 · 철광석 (RM-IO)` + `심각도 높음`
  - 버튼: `작업 로그`(비활성), `사례 검색`(SoonButton EX)
  - AI 안내 줄: “AI는 상황을 설명하고 후보를 제안할 뿐, 실행은 부서장 개별 승인 후에만 돼요”(127)
  - `상황 설명` 카드(`AI가 작성 · 데이터 변경 없음`)
    - 문장, 지표 4개(소요량 3,400 t / 원료 잔량 1,600 t / 입고예정 600 t / 부족량 1,200 t)
    - 근거: MRP 결과 · 원료 재고
  - `대응 후보 1 · 구매요청 초안` 카드(배지 `AI_GENERATED`)
    - 항목: 원료 / 수량 / 희망 입고 / **승인권자 `구매부 부서장`**(173)
    - 출처 줄과 안내 “같은 대상의 미처리 초안이 있으면 새로 만들지 않아요.”
    - `승인 후 흐름`: 부서장 개별 승인 → 구매요청 생성 (SYSTEM) → 작업 로그 기록 (승인 · 실행)
    - `진행 단계`: AI_GENERATED → WAITING_APPROVAL → APPROVED → EXECUTED(영문 코드 그대로)
    - 버튼: `승인`·`반려`(SoonButton), `구매요청 보기`(비활성)
    - 잠금 안내 “AI는 데이터를 바꾸지 않아요 · 부서장 승인 후 SYSTEM이 반영”
  - 점선 상자: “대응 후보가 없는 유형은 이렇게 보여요 (예: ⑤ 불합격률 상승)” / “상황 설명만 제공하고 품질 부서에 알림을 보내요…”
  - `감지 이력` 타임라인 3건(주체 `SYSTEM`/`AI`, 이벤트명 `Agent 위험 감지`, `Action Draft 생성`, `상황 설명`)

### Voice2ERP 회의록 `/meetings` (MeetingPage.tsx, P2)
- **누를 수 있는 것**: 위쪽 탭 3개(`목록` / `새 회의` / `정리 결과`)뿐입니다. 준비 중 영역 밖에 있고 화면 안 상태만 바꿉니다(595-603).
- 탭 옆 안내 `Voice2ERP 회의록 · 화면 3개를 탭으로 볼 수 있어요`. 그 아래는 모두 클릭 불가입니다.

**목록 탭**
- 왼쪽 머리
  - `회의 4건` `최근 7일`, `새 회의`(Soon)
  - 검색 `제목·참석자·수주번호`(비활성)
  - 상태 세그먼트 `전체 / 확인 대기 1 / 정리 중 1 / 완료 2`, 체크박스 `내가 참석한 회의`, `7일`
- 왼쪽 목록
  - 날짜별로 묶음, 회의 상태 배지 `확인 대기` / `확인 완료` / `AI 정리 중`
  - `Voice2ERP 정리 완료` + `할 일 3 · 구매 초안 1` 같은 요약
  - `예정` 묶음(다음 회의 10-07)
- 오른쪽 상세
  - 제목 `주간 생산회의` + `정리 완료` + `확인 대기`
  - 버튼 `작업 로그`(비활성), `결과 확인하고 등록 →`(Soon)
  - 정보 칸: 일시 / 입력 방식 / 작성 / 연결(수주) / 참석자 5명
  - `Voice2ERP 정리 미리보기` 카드(`AI_GENERATED`)
    - 요약, 결정사항 3, `할 일 3 · 등록 전` 표(**담당·할 일·마감**)
    - `구매 관련 1 … 구매요청 초안으로 보낼 수 있어요`, `다음 회의`, 근거
  - `전체 텍스트 미리보기`(발언 6개 + `… 이후 발언 2개`)

**새 회의 탭**
- 제목 `주간 생산회의 · 파일로 기록`, 버튼 `회의 목록`(비활성), `임시 저장`(Soon)
- 왼쪽 카드
  - 입력 방식 탭: `녹음` / `음성 파일 업로드` / `텍스트 붙여넣기` + `입력 방식은 하나만 선택돼요`
  - 끌어 놓기 칸: `텍스트(.txt) · 음성(m4a · mp3 · wav) · 최대 200 MB`, `파일 선택`(Soon)
  - 선택한 파일 예시
  - 하단 `취소`·`AI 정리 시작`(Soon)
- 오른쪽 `회의 정보` 입력 칸(모두 읽기 전용·비활성)
  - 제목, 일시, 참석자 + `+`, 연결(수주 + `연결 추가`), 안건
  - 체크박스 `정리가 끝나면 참석자에게 알림`
  - AI 안내 `Voice2ERP: 전체 텍스트 → 요약·결정사항·할 일 초안 · 확인 후 업무 등록 / AI는 등록하지 않아요`

**정리 결과 탭**
- 왼쪽 `전체 텍스트`(발언 8개 · 42분, 검색 비활성, 4번째 발언에 `구매 관련 항목 1`)
- 머리: `Voice2ERP 정리` + `AI_GENERATED` + `초안 · 확인 전 …`
- 요약 / 결정사항(각각 `원문 hh:mm`)
- `할 일 3` 카드(`담당·마감 수정 가능 · 체크한 항목만 업무로 등록`)
  - 표 열: **등록(체크박스)·담당(select)·할 일(+원문 시각)·마감(MM-DD 입력)**
  - `다음 회의` 줄, 근거
- `구매 관련 항목 1` 카드(`AI_GENERATED`)
  - 항목: 원료 / 수량 / 희망 입고 / 요청자 `서구매`
  - 원문 인용과 `원문 보기`, 수치 `MRP 부족 1,200t` / `요청 후 여유 0t`
  - 안내 `보내면 요청자가 구매요청 초안을 확인·수정 후 확정해요`, 진행 단계(영문 코드)
  - `구매요청 초안으로 보내기`(Soon)
- 하단 줄
  - `AI 정리는 초안이에요 · 확인 전엔 업무가 등록되지 않아요`
  - select `대화방 공유 안 함`(비활성)
  - `다시 정리`(Soon), `확인하고 업무 등록 (3)`(Soon)

### 과거 사례 검색 `/past-cases` (PastCasePage.tsx, EX)
- **들어오는 길**: 레일 `사례 검색`
- **누를 수 있는 것**: 없음
- 왼쪽
  - 검색창(기본값 `불합격 원인`, 비활성)
  - 칩 `기간 90일 ▾` `구분 전체 ▾` `강종 전체 ▾`
  - `사례 검색 결과 5건 · 최신순`
  - 목록: 일시·LOT·구분 배지(`품질` 파랑 / `설비` 주황), `CASE-000n · 제목`
  - 하단 `저장한 검색` 칩 4개, `작업 로그 전체 보기`(비활성)
- 오른쪽 상세
  - 경로 표시 `대시보드 › 과거 사례 검색 › 사례 상세`
  - `CASE-0005 · SM355 히트 성분 불합격` + `불합격 · 보류`
  - 버튼 `LOT 추적`, `원본 이벤트`(비활성)
  - `AI 요약 · 검색 결과 전체`(`AI 요약은 참고용 · 판단은 원본 이벤트로 확인`) + `근거 사례`
  - `사례 타임라인` 5건(주체 USER / AI) + `대응 경로`(불합격 판정 → 처리 상태 지정 → 원인 · 조치 기록 → 사례 등록)
  - `이 사례의 판단`
    - 항목: 구분 / 강종·품목 / 관련 LOT / 관련 설비 / 발생일 / 처리 상태(`보류`)
    - `현상 · 원인 · 조치`, `{LOT} 작업 로그`(비활성)
    - `같은 종류의 다른 사례`
    - `비슷한 사례 찾기`(SoonButton EX)

### AI 어시스턴트 패널 (AiPanel.tsx, P2)
- **여는 곳**: 상단 바 버튼뿐. 모든 화면 오른쪽 위에 겹쳐 뜹니다(`hl-ai--over`).
- **머리**: `AI` 마크 + `AI 어시스턴트` + `준비 중 (P2)` + 닫기
- **안내 띠**: “AI 어시스턴트는 2등급(P2) 기능이라 아직 답하지 않아요. 1등급 기능이 끝난 뒤 추가돼요.”
- **흐린 영역**
  - 설명: “용어·절차를 설명하고, 내 권한({역할}) 범위의 데이터를 조회해 출처와 함께 답해요. AI는 조회와 초안만 만들고, 실행은 사람이 확정해요.”
  - `추천 질문`: 역할별 3개(7-14)
  - `처음 쓰는 분께` 3개
- **입력**: placeholder `AI에게 묻기 — 준비 중 (P2)`, 막힘. 보내기도 막힘.
- **하단**: `AI는 조회와 초안만 만들어요 · 반영은 사람이 확정 · 내 권한({역할}) 범위`
- **누를 수 있는 것**: 닫기 버튼뿐
- 패널을 화면 전체로 크게 펼치는 기능은 없습니다.

---

## A-6. 상태 배지: 코드 → 한글 → 색

| 그룹 | 정의 위치 | 값 → 표시 |
|---|---|---|
| TASK_STATUS | shared:183-185, 색 TaskNotificationPage:21 | TODO `할 일`(wait) · IN_PROGRESS `진행 중`(run) · DONE `완료`(ok) |
| NOTIFICATION_TYPE | shared:214-222, 색 TaskNotificationPage:23-26 | MENTION `멘션`(run) · WORK_ROOM_MESSAGE `업무방`(run) · APPROVAL_REQUEST `승인 요청`(wait) · APPROVAL_RESULT `승인 결과`(ok)<br>TASK `업무` · PRODUCTION `생산` · QUALITY `품질` · SHIPMENT `출하` · PURCHASE `구매` · SALES `영업` · SYSTEM `시스템`(모두 neutral)<br>모르는 값이면 코드를 그대로 표시(199) |
| CHAT_ROOM_TYPE | shared:210 | DIRECT `1:1` · GROUP `그룹` · WORK `업무방` |
| DRAFT_STATUS | shared:22-24, 색 ChatParts:14 | AI_GENERATED `생성` · WAITING_APPROVAL `확인 대기` · APPROVED `확정` · EXECUTED `ERP 반영` · REJECTED `반려` |
| 수주 상태 | shared:117-123, 색 ChatParts:11-13 | REGISTERED `접수` · IN_PROGRESS `진행 중` · PARTIALLY_SHIPPED `부분출하` · SHIPPED `출하완료` · CANCELLED `취소` |
| 구매요청 상태(구매 진행 위젯) | 라벨은 서버, 색 PurchaseProgressWidget:8-10 | DRAFT · WAITING_APPROVAL · APPROVED · REJECTED · ORDERED |
| 작업 로그 주체 | RecentEventsWidget:13-17 | SYSTEM이면 시스템 모양, 그 밖은 사용자 모양. 라벨은 서버 actorLabel. AI 경유면 `AI` 칩 |
| 예시 화면 전용 | Agent / Meeting / PastCase | Agent 심각도 `심각도 높음`/`주의`/`참고`, `해소`<br>회의 `확인 대기`/`확인 완료`/`AI 정리 중`/`정리 완료`<br>사례 `품질`/`설비`, 처리 상태 `보류` |

---

# B. API 의존 목록 (나중에 mock 데이터 계층을 만들 때 기준)

## B-1. 공통 규칙
- 기본 경로는 `/api/v1`입니다(client.ts:15).
- 응답은 항상 봉투 형식입니다: 성공 `{success:true,data}`, 실패 `{success:false,error:{code,message}}`(client.ts:44-51).
- 헤더 `Authorization: Bearer {token}`을 붙입니다(27-29). 401이 오면 세션을 지웁니다(49).
- 변경 요청 공통 동작(`useAction`, useApi.ts)
  - 실패: 서버 메시지를 토스트로 띄웁니다.
  - 성공: 지정한 주제의 조회를 다시 부르고 안내 토스트를 띄웁니다.
- 톤·비율 값은 문자열입니다(예: `"0.4000"`).

## B-2. 함수 목록

**메신저 messengerApi** (messenger.ts:104-121)

| 함수 | 메서드와 경로 | 요청 | 응답 |
|---|---|---|---|
| rooms | GET /chat-rooms | 없음 | ChatRoomView[] |
| room | GET /chat-rooms/:id | 없음 | ChatRoomView |
| createRoom | POST /chat-rooms | `{chatRoomType, memberIds?, chatRoomName?, salesOrderId?}` | ChatRoomView |
| invite | POST /chat-rooms/:id/members | `{memberIds}` | ChatRoomView |
| leave | DELETE /chat-rooms/:id/members/me | 없음 | `{chatRoomId, left:true}` |
| messages | GET /chat-rooms/:id/messages | 쿼리 `?beforeId&limit=50` | `{items, hasMore}` |
| send | POST /chat-rooms/:id/messages | `{content, mentionEmployeeIds?}` | MessageView |
| sendFile | POST /chat-rooms/:id/files | multipart `file`, `content?` | MessageView |
| markRead | PUT /chat-rooms/:id/read | `{lastReadMessageId}` 또는 `{}` | ReadStateView |
| unreadCount | GET /chat-rooms/unread-count | 없음 | `{totalUnreadCount}` |
| (파일 링크) | GET /messages/:id/file?access_token= | 없음 | 파일 (ChatParts.tsx:104) |

**Message→ERP messageActionApi** (messenger.ts:136-142)

| 함수 | 메서드와 경로 | 요청 | 응답 |
|---|---|---|---|
| createDraft | POST /messages/:messageId/action-drafts | `{actionType}` | ActionDraftBrief. 같은 메시지에 처리 안 끝난 초안이 있으면 그것을 돌려줌 |
| drafts | GET /action-drafts | 없음 | ActionDraftBrief[] |

**알림 notificationApi** (notifications.ts:30-35)

| 함수 | 메서드와 경로 | 요청 | 응답 |
|---|---|---|---|
| list | GET /notifications | 쿼리 `?unreadOnly=true(있을 때만)&limit&cursor` | `{items(최신순), nextCursor}` |
| unreadCount | GET /notifications/unread-count | 없음 | `{count}` |
| read | POST /notifications/:id/read | 없음 | NotificationItem |
| readAll | POST /notifications/read-all | 없음 | `{updated}` |

**업무 taskApi** (tasks.ts:42-47)

| 함수 | 메서드와 경로 | 요청 | 응답 |
|---|---|---|---|
| list | GET /tasks | 쿼리 `?scope&status` | TaskView[] |
| create | POST /tasks | CreateTaskBody | TaskView |
| update | PATCH /tasks/:id | UpdateTaskBody | TaskView |
| setStatus | POST /tasks/:id/status | `{taskStatus}` | TaskView |

**대시보드·검색 dashboardApi** (dashboard.ts:129-134)

| 함수 | 메서드와 경로 | 요청 | 응답 |
|---|---|---|---|
| layout | GET /dashboard/layout | 없음 | `{placements, isDefault}` |
| saveLayout | PUT /dashboard/layout | `{placements}` | `{placements, isDefault}` |
| widget | GET /dashboard/widgets/:widgetCode | 없음 | WidgetData |
| search | GET /search | 쿼리 `?q=` | SearchResult[] |

**조직 정보 directoryApi** (directory.ts)

| 함수 | 메서드와 경로 | 응답 |
|---|---|---|
| employees | GET /employees/directory | DirectoryEmployee[] |
| tree | GET /departments/tree | DirectoryTreeNode[] |

**셸이 부르는 다른 영역 API**
- GET /approvals
- GET /shipment-requests?status=REQUESTED / ALLOCATED
- GET /production-plans?status=PLANNED
- GET /quality-inspections?status=pending
- POST /auth/logout

## B-3. 요청·응답 타입 필드
- **ChatRoomMemberView**: employeeId, employeeNo, employeeName, jobGrade, departmentId, departmentName, lastReadMessageId|null
- **SalesOrderSummaryItem**: salesOrderItemId, lineNo, specCode, itemType, steelGradeCode, thicknessMm, widthMm, lengthMm, orderedQty, shippedQty, weightTon, salesOrderItemStatus
- **SalesOrderSummaryView**: salesOrderId, salesOrderNo, customerName, dueDate, salesOrderStatus, linkPath, items[]
- **LastMessageView**: id, senderId|null, senderName|null, messageType, preview, createdAt
- **ChatRoomView**: id, chatRoomType, chatRoomName|null, displayName(1:1이면 상대 이름), salesOrderId|null, salesOrder|null, members[], memberCount, lastMessage|null, unreadCount, myLastReadMessageId|null, createdAt
- **MessageFile**: fileName, fileSize, mimeType, downloadPath
  - 화면은 downloadPath를 쓰지 않고 `/messages/{id}/file`을 직접 만듭니다.
- **MessageLink**: label, linkPath
- **MessageView**: id, chatRoomId, senderId|null(null이면 시스템), senderName|null, messageType, content, mentionEmployeeIds[], file|null, links[], createdAt
- **ReadStateView**: chatRoomId, lastReadMessageId|null, unreadCount, totalUnreadCount
- **ActionDraftBrief**: id, actionType, draftStatus, requesterId, messageId|null
- **NotificationItem**: id, notificationType, title, body|null, linkPath|null, departmentId|null, isRead, readAt|null, createdAt
- **NotificationEvent**(소켓): notificationType, title, body|null, linkPath|null
- **TaskView**: id, title, description|null, assigneeId, assigneeName, creatorId, creatorName, dueDate|null(YYYY-MM-DD), taskStatus, linkPath|null, completedAt|null, createdAt, updatedAt
- **CreateTaskBody**: title, description?, assigneeId, dueDate?, linkPath?
- **UpdateTaskBody**: 생략하면 변경 없음, null이면 비움
- **DirectoryEmployee**: id, employeeNo, employeeName, departmentId, departmentName, jobGrade, roleCode, isDepartmentHead
- **DirectoryTreeNode**: id, departmentCode, departmentName, sortOrder, head{id,employeeName,jobGrade}|null, members[{id,employeeName,jobGrade,roleCode,isHead}], children[]
- **WidgetPlacement**: widgetCode, x, y, w, h
- **SearchResult**: kind(6종), kindLabel, label, linkPath

## B-4. 위젯 응답 (dashboard.ts:11-124)
- **공통 머리**: `{widgetCode, available:true, generatedAt}`
- **P2**: `{widgetCode:'AGENT_RISK'|'AI_USAGE', available:false, grade:'P2'}`

| 위젯 | 필드 |
|---|---|
| PROCESS_FLOW | stages[{key,label,count,unit,linkPath}], issuedToday{date,goodsIssueCount,lotCount} |
| ORDER_FULFILLMENT | deliveryRiskDays, definitions{progressRate,reservedQty,inProductionQty,note}, totalOpenSalesOrders<br>salesOrders[{salesOrderId, salesOrderNo, customerName, dueDate, daysToDue, isDeliveryRisk, orderedQty, orderedTon, reservedQty, inProductionQty, shippedQty, progressRate, linkPath, items[…]}]<br>items[{salesOrderItemId, lineNo, specCode, orderedQty, orderedTon, reservedQty, inProductionQty, shippedQty, remainingQty, progressRate, isDeliveryRisk}] |
| RECENT_EVENTS | items[{id, occurredAt, eventType, eventTypeLabel, actorType(USER/SYSTEM), actorLabel, summary, targetType, targetNo, salesOrderId, isAiAssisted, linkPath}] |
| PRODUCT_STOCK | note<br>items[{productSpecId, specCode, itemType, itemTypeLabel, unit(매/개), steelGradeCode, theoreticalWeightTon, on/reserved/availableQty, on/reserved/availableTon}]<br>totals[{itemType, itemTypeLabel, 위와 같은 수량·톤}] |
| PROCESS_YIELD | definitions{plannedYieldRate, actualYieldRate, qtyAttainmentRate}<br>processes[{processCode(IRONMAKING/STEELMAKING/CASTING/HOT_ROLLING), processLabel, resultCount, inputTon, outputTon, plannedQty, outputQty, lossQty, 비율 3개}] |
| RAW_MATERIAL_BALANCE | mrpRun{mrpRunId, mrpRunNo, createdAt}|null<br>items[{rawMaterialId, materialCode, materialName, rawMaterialType, rawMaterialTypeLabel, onHandTon, scheduledReceiptTon, grossRequiredTon|null, netRequiredTon|null}] |
| REJECT_RATE | days, from, to, definitions{rejectRate, note}<br>grades[{steelGradeId, steelGradeCode, inspectedCount, failedCount, rejectRate, byProcess[{processCode(STEELMAKING/CASTING/HOT_ROLLING), processLabel, inspectedCount, failedCount, rejectRate}]}] |
| DELIVERY_RISK | deliveryRiskDays, rule, total<br>items[{salesOrderId, salesOrderNo, salesOrderItemId, lineNo, customerName, specCode, orderedQty, shippedQty, remainingQty, remainingTon, dueDate, daysToDue, isOverdue, linkPath}] |
| PURCHASE_PROGRESS | requisitionsByStatus[{status(DRAFT/WAITING_APPROVAL/APPROVED/REJECTED/ORDERED), label, count}]<br>openPurchaseOrders{count, outstandingTon, purchaseOrders[{purchaseOrderId, purchaseOrderNo, supplierName, dueDate, outstandingTon, lineCount}]} |
| SHIPMENT_RESULT | days, series[{date, issuedQty, slabQty, coilQty, issuedTon}], totalQty, totalTon |
| SURPLUS_AGE | definition, summary{count, totalTon, maxAgeDays, avgAgeDays}<br>items[{lotId, lotNo, specCode, steelGradeCode, weightTon, producedAt, ageDays, linkPath}] |
| PRODUCTION_VOLUME | days, definition, series[{date, slabQty, coilQty}], totalSlabQty, totalCoilQty |

## B-5. 실시간 이벤트와 조회 키
- **소켓 연결**: `io({path:'/ws', auth:{token}, transports:['websocket','polling']})`(realtime.ts:11). 로그인 후 App의 Protected가 엽니다.
- **소켓 이벤트**

| 이벤트 | 내용 | 화면 반응 |
|---|---|---|
| `changed` | `{topics:string[]}` | 그 주제로 시작하는 조회를 다시 부름(12). 대시보드는 모든 위젯을 다시 부름(1초 지연). 화면이 기대하는 주제: `chat-rooms`(방 생성·초대·나가기), `tasks`, `notifications`, 그 밖 업무 주제 |
| `message` | MessageView | 방 목록과 배지 반영, 토스트(shellData:146). 열린 대화에 덧붙임(MessengerPage:482). 보낸 사람 본인도 받음 |
| `chat-read` | ReadStateView | 읽음 상태 반영 |
| `notification` | NotificationEvent | 알림 조회 다시 부르기 + 토스트 |
| `notification-read` | 내용 안 씀 | 알림 조회 다시 부르기 |
| (재연결) | | 모든 조회를 다시 부름(17) |

- **조회 키**
  - 메신저: `['chat-rooms','list']`, `['chat-rooms','unread-count']`, `['chat-rooms',id,'detail']`, `['chat-rooms',id,'messages']`, `['action-drafts','list']`
  - 알림·업무: `['notifications','unread-count'|'recent']`, `['notifications','list',{unreadOnly}]`, `['tasks','list',scope]`
  - 조직: `['employees','directory']`, `['departments','tree']`
  - 대시보드·검색: `['dashboard','layout']`, `['dashboard','widget',code]`, `['search',q]`
- **변경 뒤 다시 부르는 주제**
  - 업무: `tasks`
  - 알림: `notifications`
  - 방 생성·초대: `chat-rooms`
  - 초안: `action-drafts`

## B-6. 서버 순서·규칙에 기대는 부분 (mock이 흉내 내야 하는 것)
- **방 목록**: 최근 대화 순(MessengerPage.tsx:65)
- **메시지 페이지**: 한 페이지 안은 id 오름차순(`items[0]`을 다음 `beforeId`로 씀, 257). 첫 페이지가 가장 최신.
- **알림**: 최신순 + nextCursor
- **업무**: 마감일 빠른 순(화면은 문구만 표시)
- **위젯 정렬**: 수주 충족 = 납기 빠른 순, 여재 = 오래된 순, 작업 로그 = 최신순
- **서버가 하는 일**
  - 멘션 대상 찾기: `mentionEmployeeIds`를 안 보내면 서버가 내용에서 `@이름`을 찾음(ChatComposer.tsx:12,72)
  - 같은 상대와의 1:1 방 재사용(RoomModals.tsx:35)
  - 같은 메시지의 처리 안 끝난 초안 재사용(messenger.ts:137)
  - 담당자가 내가 아니면 업무 알림 발송(TaskFormModal.tsx:70)
  - 저장된 배치가 없으면 기본 배치 + `isDefault:true`
  - P2 위젯은 unavailable 형태로 응답

---

# C. 문서 대비 차이

## C-1. 요구사항 반영 여부

| REQ | 판정 | 근거 |
|---|---|---|
| NTF-001 업무 담당자·마감일 | 반영 | 담당자 select·마감일 DateInput(TaskFormModal.tsx:84-101). 카드에 담당·마감 표시(49-59) |
| NTF-002 개인·부서 알림 | 화면 쪽만 반영 | 알림함·읽음·`부서 알림` 태그(TaskNotificationPage.tsx:156-229, 200). 발송은 서버라 화면에서 확인 불가. 부서를 지정해 보내는 화면은 없음 |
| MSG-001 1:1·그룹·업무방 / 수주 정보 / 조직 정보로 멤버 선택 | 반영 | 1:1·그룹 생성(RoomModals.tsx), 업무방 표시와 상단 수주 정보(OrderPin 130-149, RoomAside 157-186), MemberPicker 조직도·검색. 메신저에서는 업무방을 만들 수 없음(RoomModals.tsx:54) — 영업 화면 버튼(GET /chat-rooms/work-room)으로만 열림 |
| MSG-002 실시간 | 반영 | 소켓 `message`(MessengerPage.tsx:482, shellData.ts:146) |
| MSG-003 첨부·다운로드 | 반영 | ChatComposer.tsx:174-197, messenger.ts:112-117, ChatParts.tsx:104. 한 번에 파일 1개 |
| MSG-004 안 읽은 수 | 반영 | 방 목록 배지(106), 합계(75), 레일·상단 배지, 읽음 처리(293-310) |
| MSG-005 멘션·업무방 알림 | 화면 쪽만 반영 | MENTION·WORK_ROOM_MESSAGE 배지와 토스트(TaskNotificationPage.tsx:24, shellData.ts:140,151). 발송 로직은 확인 불가 |
| MSG-006 ERP 화면 이동 | 반영 | 메시지 링크와 이동 링크(ChatParts.tsx:51-90), `수주 상세`(MessengerPage.tsx:136,139,185) |
| ACT-001 메시지에서 구매요청 초안 만들기 | 부분 반영 | 진입 버튼과 원본 메시지 연결은 있음(ChatParts.tsx:144-154, MessengerPage.tsx:429). **원료·수량(톤)·희망 입고일·요청자 추출은 없음**: `AI 자동 추출 · 준비 중`(ChatParts.tsx:155-158). 이 요구사항은 P1 |
| ORG-004 멤버 선택·부서 알림 | 멤버·담당자 선택은 반영, 부서 알림은 표시만 | MemberPicker(/departments/tree, /employees/directory), TaskFormModal 담당자. 부서 알림은 태그만 |
| DSH-001 기본 위젯 6개 | 반영 | 이름이 요구사항과 정확히 같음(shared:319-324). Agent 위험 감지는 P2 자리 표시 |
| DSH-002 추가·제외, 후보 8개 | 반영 | 후보 8개 이름이 같음(shared:325-332). 추가 패널·`×`·저장(PUT /dashboard/layout). AI 활용 현황은 P2 자리 표시 |
| AST-001 AI 패널 (P2, 화면만) | 부분 반영 | 오른쪽 패널은 있음(Shell.tsx:268). “크게 펼치면 대화 기록 전체 화면”은 없음 |
| AST-008 역할별 추천 질문 (P2, 화면만) | 반영 | 6개 역할별 질문(AiPanel.tsx:7-14), 신입용 `처음 쓰는 분께`(39-42). 모두 비활성 |
| (참고) AST-002 @AI (P2, 화면만) | 반영 | ChatComposer.tsx:122-126,178-180, MessengerPage.tsx:228-232. 모두 비활성 |
| AGT-001 감지 트리거 (P2, 화면만) | 반영 | 5개 유형과 스케줄·이벤트 구분(AgentPage.tsx:21-27) |
| AGT-002 원료 부족 → 구매요청 초안 | 반영 | 14, 161-217 |
| AGT-003 합격 매수 부족 → 재생산 초안 | 반영 | 15 |
| AGT-004 납기·여재·불합격률 대응 | 반영 | 16-18, 24(기준일 3일 규칙 문구) |
| AGT-005 같은 대상 중복 초안 방지 | 반영 | 182 |
| AGT-006 AI는 설명만, 담당 부서원이 개별 확정 | **불일치** | C-5 참고(127, 173, 189, 214) |
| VOC-001~004 (P2, 화면만) | 반영 | 입력 방식 탭(295-300), 목록·상세(91-266), 요약·결정사항·할 일(206-231, 454-529), `확인하고 업무 등록`·`구매요청 초안으로 보내기`(583, 565) |
| CASE-001 사례 데이터 (EX) | 반영 | 구분·제목·현상·원인·조치·관련 설비 텍스트·LOT·발생일(PastCasePage.tsx:85, 167-179) |
| CASE-002 사례 등록 | 부분 반영 | 흐름은 타임라인·대응 경로로만 보여 줌(23, 26). `[사례로 등록]` 버튼은 품질 관리 화면 몫이라 이 화면에는 없음 |
| CASE-003 사례 검색·AI 요약 | 반영 | 41, 98-122 |
| CASE-004 호출 위치 | **불일치** | 별도 화면과 레일 메뉴(nav.ts:78)로 들어오고, `비슷한 사례 찾기`가 사례 상세 안에 있음(196). AI 패널 추천 질문 `비슷한 사례 찾아줘`(AiPanel.tsx:11)만 문서와 맞음 |
| CASE-005 시드 데이터 | 해당 없음 | 예시 데이터만 있음(`예시 화면` 표기) |

## C-2. 용어 사전 위반·한글명 차이
- **요청하신 금지어 10개는 0건입니다.** 대상 파일 전체를 검색한 결과: `수주별 채팅방`, `@ERP`, `ERP Assistant`, `챗봇`, `AI` 없이 쓴 `Factory Agent`, `대응안`, `회의 → 업무`, `품질 사례 DB`, `Company Memory`, `팀`
- 금지어 사용
  - **`공정 실적`**: TRM-047 작업 실적의 금지어(생산 실적, 공정 실적)입니다.
    - nav.ts:38, titles.ts:18, DashboardPage.tsx:25, ProcessYieldWidget.tsx:9, 44
    - 참고로 공통 코드 정의서의 권한 표시명도 `공정 실적(…)`이라 문서끼리 어긋납니다.
  - **`주문`**: TRM-038 수주의 금지어(주문·오더)이고, TRM-039 수주 품목의 금지어는 `주문 품목`입니다.
    - MessengerPage.tsx:181 `주문 {n}`, DeliveryRiskWidget.tsx:17 `출하 / 주문`, OrderFulfillmentWidget.tsx:45 `주문`
    - 참고로 업무 프로세스 정의서 4.1·4.5는 `주문 매수`·`주문 수량`을 써서 문서끼리 어긋납니다.
- 한글명과 다름
  - `메신저 → ERP`(titles.ts:14) — 한글명은 `Message → ERP`(TRM-092)
  - 레일 `Agent`(nav.ts:68) — 한글명은 `AI Factory Agent`(TRM-104)
  - 레일 `사례 검색`(nav.ts:78) — 한글명은 `과거 사례`(TRM-108). 화면 제목은 `과거 사례 검색`
  - `입고 예정`(띄어씀): RawMaterialBalanceWidget.tsx:15, widgetCatalog.ts:32, AiPanel.tsx:9 — 한글명은 `입고예정`(TRM-051). AgentPage는 `입고예정`으로 맞게 씀
  - 작업 로그 위젯의 `AI` 칩(RecentEventsWidget.tsx:17) — REQ-AST-010·TRM-103은 `AI 경유`로 표시하라고 함
  - `작업 로그 · Decision Replay`(titles.ts:25) — 한글명 `이력 재현` 대신 영문명을 노출
  - 업무 상태 `할 일`/`진행 중`(shared:185) — 공통 코드 표시명은 `진행`
  - 알림 유형 `업무방`(shared:220, 알림함 배지 TaskNotificationPage:199) — 공통 코드 표시명은 `업무방 메시지`
  - `업무 배정 알림`(TaskFormModal.tsx:70) — 공통 코드 🟡 TASK_ASSIGNED 표시명은 `업무 지정`
  - `구매 초안`(MeetingPage.tsx:51) — 다른 곳은 `구매요청 초안`
  - `1:1 대화`·`그룹 대화`(RoomModals.tsx:43-44, 94) — 표시명은 `1:1`·`그룹`(경미)
  - `사용자` 메뉴(nav.ts:55, titles.ts:29) — 엔티티 한글명은 `사원`(TRM-032). 금지어는 아니고 기획안도 `사용자`를 씀
- 코드 원문을 화면에 그대로 노출 (공통 코드 정의서: “한글 표시명은 화면에 그대로 나가는 문구”)
  - ACTOR_TYPE `SYSTEM`/`USER`: ChatParts.tsx:116 `SYSTEM · `, AgentPage.tsx:39-40, 191, 214, PastCasePage.tsx:19-22. 표시명은 `시스템`/`사용자`
  - DRAFT_STATUS 영문 코드: AgentPage.tsx:36, 165, 198-205, MeetingPage.tsx:203, 444, 536, 561

## C-3. 공통 코드 정의서와 다른 코드 값·라벨

**TASK_STATUS**
- 문서(확정): `OPEN 진행 / DONE 완료`. 업무 프로세스 정의서 10장도 `OPEN → DONE`
- 코드: `TODO 할 일 / IN_PROGRESS 진행 중 / DONE 완료`(shared:183-185)
- 쓰는 곳
  - api/tasks.ts:2, 15, 43, 46
  - TaskNotificationPage.tsx:6, 20, 21, 31, 32, 39, 40, 62-65, 98, 100, 102, 107, 245

**NOTIFICATION_TYPE**
- 문서 확정 값: `MENTION 멘션`, `WORK_ROOM_MESSAGE 업무방 메시지`
- 문서 🟡 제안 값: `TASK_ASSIGNED 업무 지정`, `APPROVAL_REQUESTED 승인 요청`, `APPROVAL_RESULT 승인 결과`
- 코드(shared:214-222)와의 차이
  - WORK_ROOM_MESSAGE 라벨이 `업무방`
  - `APPROVAL_REQUEST`(문서는 끝이 -ED)
  - `TASK 업무`(문서는 TASK_ASSIGNED 업무 지정)
  - 문서에 없는 7개: `PRODUCTION`, `QUALITY`, `SHIPMENT`, `PURCHASE`, `SALES`, `SYSTEM`(그리고 TASK)
- 쓰는 곳: notifications.ts:2, 7, 28, TaskNotificationPage.tsx:6, 23-26, 199, shellData.ts:140

**CHAT_ROOM_TYPE**
- 값과 라벨 모두 일치합니다(shared:208-210).
- 쓰는 곳: MessengerPage.tsx:21, 22, 31, 35, 44, 55, 60, 63, 68, 101, 154, 191, 233, 234, 388, 389, RoomModals.tsx:10, 26, ChatParts.tsx:38-39, messenger.ts:53, 94

**MESSAGE_TYPE**
- 문서: 공통 코드로 만들지 않고 첨부 유무로 판단합니다(4장). SYSTEM 유형 자체가 문서에 없습니다.
- 코드: `TEXT/FILE/SYSTEM` 상수로 정의(shared:211-212)
- 쓰는 곳: messenger.ts:3, 46, 76, MessengerPage.tsx:43, 44, 267, 419, ChatParts.tsx:140, 144, chatCache.ts:61, shellData.ts:88

**CASE_CATEGORY 🟡** (QUALITY 품질 / EQUIPMENT 설비)
- 코드 상수는 없고 한글 문자열 `'품질' | '설비'`만 씁니다(PastCasePage.tsx:8, 45, 56, 168). 라벨은 문서와 같습니다.

**WIDGET 코드**
- 공통 코드 정의서에 그룹 자체가 없습니다. 코드 컨벤션 4장 [강제] “새 코드는 공통코드 정의서에 먼저 추가” 위반입니다.
- 정의: shared:309-334
- 쓰는 곳: dashboard.ts:2, 11-118, 132, 139, widgetCatalog.ts:25-40, WidgetBody.tsx, WidgetCard.tsx, DashboardGrid.tsx, WidgetAddPanel.tsx, DashboardPage.tsx:6, 100-101

**범위 안 파일에서 보이는 그 밖의 차이**
- **PERMISSION 이름**(사용: DashboardPage.tsx:20-27, nav.ts:23-57, shellData.ts:48). 왼쪽이 코드, 오른쪽이 문서입니다.
  - ORDER_CREATE ↔ SALES_ORDER_CREATE
  - SHIPMENT_REQUEST ↔ SHIPMENT_REQUEST_MANAGE
  - PO_CONFIRM ↔ PURCHASE_ORDER_CONFIRM
  - RECEIPT_CONFIRM ↔ GOODS_RECEIPT_CONFIRM
  - PLAN_CONFIRM ↔ PRODUCTION_PLAN_CONFIRM
  - RESULT_CONFIRM ↔ PRODUCTION_RESULT_CONFIRM
  - ROLLING_ALLOCATE ↔ HOT_ROLLING_ALLOCATE
  - MILLSHEET_READ ↔ MILL_SHEET_READ
  - 문서의 INSPECTION_STANDARD_MANAGE는 코드에 없음
- **수주 상태**(ChatParts.tsx:11-13, MessengerPage.tsx:114, 138, 169, 178, messenger.ts:29, 37)
  - 코드: `REGISTERED 접수`, `IN_PROGRESS 진행 중`
  - 문서 SALES_ORDER_ITEM_STATUS: `OPEN 진행중`
- **공정 코드**(dashboard.ts:54, 75)
  - 코드: 값 `CASTING`, 그룹 이름 PROCESS_CODE
  - 문서: 값 `CONTINUOUS_CASTING`, 그룹 이름 PROCESS_TYPE
- **구매요청 상태**: `DRAFT`가 있음(dashboard.ts:91, PurchaseProgressWidget.tsx:8-10). 문서는 값 4개이고 “임시 저장 없음”
- **ROLE**: 그룹 이름이 `ROLE_CODE`(문서는 `ROLE`). 값과 라벨은 같음
- **ACTION_TYPE**: 보내는 값은 문서와 같음(MessengerPage.tsx:429). shared 라벨 `구매요청`은 문서 `구매요청 생성`과 다르지만 범위 안 화면에는 표시되지 않음
- **ACTOR_TYPE**: 예시 화면에 `AI` 주체가 나옴(AgentPage.tsx:41, PastCasePage.tsx:23). 문서 값은 USER/SYSTEM뿐
- **BUSINESS_EVENT_TYPE 라벨**(예시 화면)
  - `Action Draft 생성`(AgentPage:40) — 문서 DRAFT_CREATED는 `초안 생성`
  - `검사 결과 등록`(PastCase:19) — 문서는 `검사 등록·판정`
  - `상황 설명`, `원인 기록`, `조치 기록` — 문서에 없음
  - `Agent 위험 감지`, `과거 사례 등록`, `불합격 처리 상태 지정` — 문서 🟡/확정 값과 일치
- **SearchKind 6종**(dashboard.ts:126)과 그 한글 라벨(shellData.ts:99-101): 문서에 없음
- **업무 번호·LOT 형식**(예시 데이터, 업무 프로세스 정의서 9.1·9.2와 다름)
  - 수주 `SO-20260930-0001` — 문서 SO-YYMM-NNN
  - 생산계획 `PP-20260930-0001` — 문서 PP-YYMM-NNNN
  - 히트 `HT-2-…`, `HT-1-…` — 문서 HT-{전로코드 예 BOF1}-YYMMDD-NNN
  - 코일 `C2-…` — 문서 `C`+슬래브번호에서 `HT-`를 뺀 형태(CBOF1-…)
  - 원료 `RM-IO` — 문서 원료 코드는 영문 3자+숫자 2자리(ORE01)
  - 강종 `SM355` 단독 — 문서는 SM355A~D(REQ-MST-002)
  - 예: AgentPage.tsx:15-17, 115, 139, 170, MeetingPage.tsx:26, 41, 540, PastCasePage.tsx:9-13, 85, 169

## C-4. 지정 문서에 없는 화면 요소 (새로 만든 기능)
- **셸**
  - 통합 검색과 GET /search(Shell.tsx:133-175)
  - 상단 시계(28-35, 253)
  - 알림·메신저 드롭다운(56-130)
  - 실시간 토스트(shellData.ts:137-152)
  - 레일 배지 5종(출하 대기·출고 대기·확정할 생산계획·승인함·검사 대기, shellData.ts:58-71)
  - `승인함` 메뉴 이름
  - AI 패널 열린 상태 유지(Shell.tsx:209-224)
  - 역할별 레일 구성은 “역할별 메뉴” 문서를 지시상 열지 않아 대조하지 못했습니다.
- **대시보드**
  - 인사·날짜 줄, 권한별 바로가기 3개(19-29, 110-117)
  - 12칸 격자에서 끌어 옮기기·크기 조절·자동 정리, 위젯 크기 저장(x·y·w·h). 문서는 추가·제외만 요구합니다.
  - `기본 배치로`, 편집 모드 주소 `?edit=1`, 저장 안 된 변경 경고
  - 카드 바로가기 링크
  - 30초 주기 갱신과 실시간 갱신
  - 추가 패널의 설명·기본 크기 표시
  - 위젯별 세부 지표와 열 구성 전반. 문서는 위젯 이름만 정합니다.
  - AI 활용 현황 지표 이름 3개(AiUsageWidget.tsx:6-8)
  - Agent 위젯 예시의 `완료 예상`(AgentRiskWidget.tsx:16)
- **업무·알림**
  - IN_PROGRESS 상태와 `시작`·`할 일로`·`다시 열기`(62-65)
  - 업무 `설명`·`연결 화면` 칸과 `화면 열기`
  - 범위 필터(`전체` = 담당 ∪ 만든 것)
  - 마감 지남·오늘 마감 집계와 강조, 칸반 보드, `요청` 표기
  - 알림 유형 7종 추가
  - `모두 읽음`, `안 읽은 것만`, 읽은 시각
  - `?notification=` 포커스와 자동 추가 조회
- **메신저**
  - 방 검색·필터·유형별 묶음
  - SYSTEM 메시지
  - `멤버 초대`, `그룹 나가기`
  - 1:1 방 재사용, 그룹 방 이름
  - `공유 파일` 목록
  - `새 메시지 n건`, 무한 스크롤
  - @ 멘션 자동완성
  - 4000자 제한, 20MB·실행 파일 제외 안내. 문서는 “형식·용량 제한은 구현 단계”라고만 함
  - 메시지별 초안 상태 배지와 `초안 보기`
  - 수주 요약의 품목별 상태·출고 수량
- **Agent(예시)**
  - 심각도 3단계, 분류 칩, `최근 24시간 해소`
  - `감지 기준 설정`, `지금 감지 실행`
  - 지표 4개와 근거, `승인 후 흐름`, `감지 이력`
- **회의록(예시)**
  - 텍스트 입력(.txt, 붙여넣기), 200MB 제한, `임시 저장`
  - 수주 연결과 `연결 추가`, `안건`, `정리가 끝나면 참석자에게 알림`
  - `다음 회의` 추출, `예정` 회의 목록
  - 목록 필터(상태·내가 참석·7일), 회의 상태 4종
  - `원문 hh:mm` 링크, `MRP 부족 / 요청 후 여유` 수치
  - `대화방 공유` select, `다시 정리`
- **과거 사례(예시)**
  - 별도 화면과 레일 메뉴
  - `저장한 검색`, 기간·구분·강종 필터 칩
  - `CASE-000n` 번호(코드 주석에 “형식 미정”이라고 적혀 있음)
  - `원본 이벤트`·`LOT 추적` 버튼, `같은 종류의 다른 사례`, `대응 경로` 단계
  - `처리 상태`·`강종·품목` 항목

## C-5. 업무 규칙 불일치

**BP-MSG-01 / BP-ACT-01**
- 업무 상태 흐름: 문서는 `OPEN → DONE`(10장)인데, 화면은 3단계이고 되돌리기(`할 일로`, `다시 열기`)도 있습니다(TaskNotificationPage.tsx:62-65).
- 정상 흐름에 필요한 화면 요소(방 생성 → 메시지·첨부 → 읽음 → 멘션 알림 → ERP 이동)는 모두 있습니다.
- 알림 토스트는 MENTION·WORK_ROOM_MESSAGE 유형에서 끄고, 대신 `message` 이벤트로 열린 방이 아닌 모든 새 메시지에 토스트를 띄웁니다(shellData.ts:139-152).
- Message → ERP
  - 문서는 “AI가 추출 스키마로 추출”하는 P1 기능입니다. 화면에는 추출이 없고 `준비 중`으로 표시합니다(ChatParts.tsx:155-158). 업무 프로세스 정의서 15장은 “P1이므로 P2 AI 일정으로 미루지 않는다”고 합니다.
  - 문서는 출발점을 “업무방 메시지”로 적었습니다(3장 그림, BP-ACT-01). 화면은 방 유형과 관계없이 TEXT 메시지면 버튼을 보여 줍니다(ChatParts.tsx:144).
  - 버튼 노출 조건에 메시지 작성자 확인이 없습니다. 문서의 “요청자 = 메시지 작성자” 규칙(구현 제안)이 지켜지는지는 서버 몫이라 화면만으로는 판단할 수 없습니다.

**BP-DSH-01**
- “P2 미구현 시 Agent 영역 비활성”은 지켜집니다(WidgetCard.tsx:25-35, DashboardPage.css:31-32).
- 권한이 없을 때 위젯별 안내가 있습니다(WidgetCard.tsx:53).
- 추가·제외 저장이 있습니다.
- 다만 비활성 Agent 위젯의 예시 문구 “대응 후보는 부서장이 승인한 뒤 실행돼요”와 비활성 버튼 `대응 후보 승인`(AgentRiskWidget.tsx:18-20)은 REQ-AGT-006과 다릅니다(아래 항목).

**BP-AGT-01 / REQ-AGT-006**
- 문서 규칙
  - 대응 후보는 담당 부서원이 후보별로 확정하고, 확정한 사람이 요청자가 됩니다.
  - 결과가 구매요청이면 요청자 소속 부서장이 최종 승인합니다.
  - AI는 설명만 하고, 대응 후보는 규칙이 만듭니다.
- 화면 표기
  - “AI는 상황을 설명하고 **후보를 제안**할 뿐, 실행은 **부서장 개별 승인** 후에만”(AgentPage.tsx:127)
  - `승인권자 구매부 부서장`(173), 흐름 첫 단계 `부서장 개별 승인`(189), `부서장 승인 후 SYSTEM이 반영`(214), 버튼 `승인`·`반려`(209-210)
- Agent 메뉴가 부서장에게만 보입니다(nav.ts:65-70). 문서의 확정 주체는 담당 부서원입니다.
- `구매요청 생성 (SYSTEM)`(191): BP-LOG-01과 ACTOR_TYPE 정의는 “사람이 확정한 실행은 USER”입니다.
- 감지 이력에 주체 `AI`가 있습니다(41).

**BP-VOC-01**
- 흐름은 화면 3개에 모두 표현돼 있습니다.
- 회의 정리 결과 전체에 `AI_GENERATED` 배지를 붙였습니다(MeetingPage.tsx:203, 444). 이 값은 Action Draft 상태(TRM-094)인데, 문서상 Action Draft가 되는 것은 구매 항목뿐입니다.
- 입력은 REQ-VOC-001이 “회의 음성”이라고 했는데 텍스트 입력도 있습니다(298, 307).
- 문서에 없는 항목은 C-4에 정리했습니다.

**BP-AST-01**
- 패널, @AI, 역할별 추천 질문은 있습니다.
- 크게 펼치기(AST-001), 보고 있는 화면 정보 전달(AST-007) 표현은 없습니다.
- 패널은 상단 버튼으로만 열립니다. `비슷한 사례 찾기 → AI 패널 열기·질문 자동 입력`(CASE-004) 연결은 없습니다.

**BP-CASE-01**
- 호출 위치가 문서와 다릅니다(C-1 CASE-004 참고).
- 등록 이벤트 주체가 `AI`입니다(PastCasePage.tsx:23). 문서는 AI 초안을 품질 담당이 확인·저장하는 흐름이라 USER이고, ACTOR_TYPE에 AI 값은 없습니다.
- `원인 기록`·`조치 기록` 이벤트(21-22)는 REQ-LOG-002 목록에 없습니다.
- 예시 데이터끼리도 어긋납니다: 품질 사례 상세의 `같은 종류의 다른 사례`에 설비 사례 2건이 나옵니다(186-193).

**기획안 대시보드 위젯 목록** (공정 흐름·수주 충족·Agent 감지·작업 로그·재고·수율)
- 기본 위젯 6개와 일치합니다.
- 다만 수주 충족 위젯에는 TRM-042와 REQ-SO-004의 `검사합격` 매수 열이 없습니다(OrderFulfillmentWidget.tsx:42-50).

## C-6. 코드 컨벤션 위반·관찰

**프레임워크**
- 컨벤션은 Next.js App Router를 확정했습니다(0·1·9장).
- 실제는 Vite + react-router입니다(App.tsx:1-2, 69-116, package.json). 폴더는 `src/pages`이고 `'use client'`도 없습니다.

**스타일 (9장 [강제] Tailwind)**
- client/package.json에 Tailwind가 없습니다.
- 별도 CSS 파일 7개를 씁니다: MessengerPage.css, TaskNotificationPage.css, collab.css, DashboardPage.css, AgentPage.css, MeetingPage.css, PastCasePage.css. 여기에 react-grid-layout CSS(DashboardGrid.tsx:4)와 전역 `hl-*` 클래스가 더해집니다.
- 대상 파일의 인라인 `style={…}`은 438곳입니다.
  - MeetingPage 114, AgentPage 48, MessengerPage 44, PastCasePage 41, TaskNotificationPage 28, OrderFulfillmentWidget 28, Shell 18, AiPanel 12, ProductStockWidget 11, PurchaseProgressWidget 10, 나머지 1~9곳
- 색상 hex 값을 직접 적은 곳이 많습니다. 예: MessengerPage.tsx:390, ChatParts.tsx:40, 114, TaskNotificationPage.tsx:42, OrderFulfillmentWidget.tsx:8, ProcessYieldWidget.tsx:23, PurchaseProgressWidget.tsx:8-10

**API 호출 (9장 [강제])**
- 컴포넌트에서 fetch를 직접 부르는 곳은 0건입니다.
- 다만 커스텀 훅으로 감싸지 않고 컴포넌트 안에서 `useQuery`·`useMutation`을 바로 부릅니다: MessengerPage.tsx:252, 271, 295, 474, 477, TaskNotificationPage.tsx:74, 123, 242, 243, WidgetCard.tsx:18, DashboardPage.tsx:34
- 파일 내려받기는 api 함수를 거치지 않고 `<a href>`로 직접 엽니다(ChatParts.tsx:104).

**인증 토큰 (9장 [강제] “프론트 코드에서 토큰을 다루지 않음, httpOnly 쿠키 + credentials:'include'”)**
- 소켓에 토큰을 `auth`로 넘깁니다(realtime.ts:9-11). 6장 [강제] “handshake 때 쿠키 토큰 검증”과도 다릅니다.
- 파일 URL 쿼리에 `access_token`을 붙입니다(ChatParts.tsx:104 → client.ts:67-70).
- 토큰을 sessionStorage에 저장하고 Bearer 헤더로 보냅니다(stores/auth.ts:5-27, client.ts:27-29).

**지켜진 항목**
- 서버 데이터를 전역 스토어에 복사하지 않습니다. 메신저는 Query 캐시를 씁니다(chatCache.ts).
- 상대 경로 `../` import 0건, `@/` 별칭 사용
- named export 사용
- `console.*` 0건, `any` 0건, TODO 0건

**이름 짓기 (2장)**
- 컴포넌트 파일 PascalCase 규칙 위반: `features/dashboard/parts.tsx`(Clip, DailyBars 컴포넌트를 내보냄)
- 훅이 `use*` 이름이 아닌 파일에 있음
  - shell/shellData.ts: useNavBadges, useRecentNotifications, useRecentChatRooms, useGlobalSearch, useShellLive
  - shell/shellTitle.tsx: useShellTitle
  - api/directory.ts: useDirectoryEmployees, useDirectoryTree
- 함수 이름이 동사로 시작하지 않음
  - MessengerPage.tsx:23, 24, 30, 40: itemTypeName, itemUnit, roomCaption, lastLine
  - ChatParts.tsx:21, 28, 48, 92: dayLabel, smartTime, esc, fileExt
  - ChatComposer.tsx:13 mentionedIds, TaskFormModal.tsx:10 linkError, MemberPicker.tsx:20 memberIdsUnder
  - parts.tsx:5, 11, 16, 28: rateNum, rateText, pctW, dueLabel
  - widgetCatalog.ts:43 widgetDef, WidgetBody.tsx:45 widgetMeta, nav.ts:62 navFor, titles.ts:37 titleFor, shellData.ts:123 clip
- 모듈 상수가 UPPER_SNAKE가 아님: `small`, `blk`(MeetingPage.tsx:59-60)
- `order` 단독 사용 금지 [강제] 위반: `OrderPin`(MessengerPage.tsx:130), `OrderFulfillmentOrder`(dashboard.ts:25). `OrderFulfillment` 자체는 TRM-042 영문명에서 온 이름입니다.
- Boolean 접두사 [권장] 위반: `available`(dashboard.ts:11, 13), `left: true`(messenger.ts:109)
- 회의록 변수명은 용어 사전상 `meetingMinutes`(TRM-099)인데 식별자는 `Meeting`/`MEETINGS`입니다.

**참고: 4장 공통코드 [강제]**
- 한글 표시명이나 코드를 클라이언트에서 따로 정의합니다.
  - `SEARCH_KIND_LABEL`(shellData.ts:99-101)
  - `UNIT`(ProductStockWidget.tsx:8, shared `ITEM_QTY_UNIT`과 중복)
  - 리터럴 유니온 중복(dashboard.ts:48, 54, 75, 91, 126)
- 공통 코드 정의서에 없는 그룹을 씁니다: WIDGET, MESSAGE_TYPE, SearchKind

**참고: 5장 API 경로 [강제] “상태 변경은 POST /:id/동작”**
- `PUT /chat-rooms/:id/read`(messenger.ts:119)
- 동사가 아닌 명사 경로 `POST /tasks/:id/status`(tasks.ts:46)
- 단수 경로 `/dashboard/layout`

---

# 부록. 읽은 지정 파일과 줄 수 (`wc -l`, 모두 처음부터 끝까지 읽음)

| 파일 | 줄 수 |
|---|---|
| pages/collab/MessengerPage.tsx | 522 |
| pages/collab/MessengerPage.css | 27 |
| pages/collab/TaskNotificationPage.tsx | 275 |
| pages/collab/TaskNotificationPage.css | 13 |
| features/collab/ChatComposer.tsx | 200 |
| features/collab/ChatParts.tsx | 186 |
| features/collab/MemberPicker.tsx | 134 |
| features/collab/RoomModals.tsx | 109 |
| features/collab/TaskFormModal.tsx | 108 |
| features/collab/chatCache.ts | 89 |
| features/collab/collab.css | 9 |
| pages/dashboard/DashboardPage.tsx | 164 |
| pages/dashboard/DashboardPage.css | 89 |
| features/dashboard/DashboardGrid.tsx | 63 |
| features/dashboard/WidgetAddPanel.tsx | 42 |
| features/dashboard/WidgetBody.tsx | 63 |
| features/dashboard/WidgetCard.tsx | 62 |
| features/dashboard/parts.tsx | 64 |
| features/dashboard/widgetCatalog.ts | 80 |
| widgets/AgentRiskWidget.tsx | 24 |
| widgets/AiUsageWidget.tsx | 14 |
| widgets/DeliveryRiskWidget.tsx | 43 |
| widgets/OrderFulfillmentWidget.tsx | 105 |
| widgets/ProcessFlowWidget.tsx | 32 |
| widgets/ProcessYieldWidget.tsx | 47 |
| widgets/ProductStockWidget.tsx | 61 |
| widgets/ProductionVolumeWidget.tsx | 24 |
| widgets/PurchaseProgressWidget.tsx | 45 |
| widgets/RawMaterialBalanceWidget.tsx | 54 |
| widgets/RecentEventsWidget.tsx | 28 |
| widgets/RejectRateWidget.tsx | 37 |
| widgets/ShipmentResultWidget.tsx | 28 |
| widgets/SurplusAgeWidget.tsx | 32 |
| pages/soon/AgentPage.tsx | 257 |
| pages/soon/AgentPage.css | 6 |
| pages/soon/MeetingPage.tsx | 610 |
| pages/soon/MeetingPage.css | 8 |
| pages/soon/PastCasePage.tsx | 206 |
| pages/soon/PastCasePage.css | 6 |
| shell/AiPanel.tsx | 59 |
| shell/Shell.tsx | 273 |
| shell/shellData.ts | 154 |
| shell/nav.ts | 103 |
| shell/titles.ts | 40 |
| api/messenger.ts | 142 |
| api/notifications.ts | 35 |
| api/tasks.ts | 47 |
| api/dashboard.ts | 140 |
| api/realtime.ts | 30 |
| **합계 49개** | **4,989** |

업무 프로세스 정의서 process.md는 1~1530행을 6번에 나눠 모두 읽었습니다(`wc -l`로는 1,529).