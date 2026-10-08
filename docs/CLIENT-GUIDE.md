# 화면 작업 안내 (v2 client)

v2 화면(`client/`)은 **서버·DB 없이 브라우저 안의 가짜 DB(mock)만으로 동작하는 화면 전용 클라이언트**다. Next.js(App Router) + TypeScript(strict) + Tailwind + TanStack Query + Zustand로 만들었고, B안 디자인(어두운 아이콘 레일 + 목록|상세)을 쓴다. 이 문서는 화면을 고치거나 더하는 사람(에이전트)이 같은 규칙으로 작업하기 위한 안내다. `server/`와 `shared/`, DB는 이번 화면 재작업에서 건드리지 않았고, 새 화면은 그쪽을 부르지 않는다.

## 1. 기준 (우선순위 순)

1. 6개 설계 문서 — `docs/notion/01`~`06` (기획안, 요구사항 정의서, 용어 사전, 업무 프로세스 정의서, 코드 컨벤션, 공통 코드 정의서). 검사 기준 숫자만 `docs/notion/07-KS-규격-정리.md`와 `docs/rework/ks-values.md`.
2. `docs/rework/erd-final.txt` — 화면이 보이고 받는 필드와 mock 행 이름(컬럼 이름의 camelCase)을 정할 때만.
3. `SPEC.md`, `docs/rework/PLAN.md` — 범위와 결정. PLAN 4장 = 정확한 공통 코드, 5장 = 승인된 처리, 6장 = 문서끼리 어긋날 때의 기본값, 7장 = 화면별 변경.
4. `docs/rework/areas/` — 영역별 노트(색인: [areas/README.md](rework/areas/README.md)). 화면·api 함수·요구사항 대응·가정값이 있다.
5. 문서에 없는 값은 **가정값**이다. 임의로 넣지 말고 `docs/rework/seed-assumptions.md`에 행을 더해 근거를 남긴다.

용어는 용어 사전을 따르고 금지어(동의어)를 쓰지 않는다. 문서끼리 어긋날 때 기본값은 PLAN 6장: '작업 실적', '수주', '수주 매수', 'LOT 관계', '출하요청 번호', '공급업체', '채팅방', '입고예정'. 문구는 해요체.

## 2. 실행과 명령

저장소 맨 위에서 실행한다 (Node.js 22.18 이상).

```bash
npm install
npm run dev -w @fantasteel/client     # http://localhost:5173
```

```bash
npm run typecheck -w @fantasteel/client   # 타입 검사, 오류 0
npm run test -w @fantasteel/client        # Vitest
npm run build -w @fantasteel/client       # next build
npm run start -w @fantasteel/client       # 빌드 결과 실행 (5173)
```

- 포트는 `client/package.json`의 `dev`·`start` 스크립트(`-p 5173`)가 정한다. 루트 `package.json`의 스크립트는 바꾸지 않는다.
- 처음 열면 **계정 선택** 화면(`/login`)이 나온다. 사원 계정을 누르면 그 사원으로 들어간다. 가짜 DB 모드의 사원번호·비밀번호 로그인은 **일부러 미뤘다**(SPEC 5장 결정 1). 서버 모드는 사원번호·비밀번호 로그인이다(아래 서버 연결). 계정은 탭마다 `sessionStorage`(`fantasteel.session.employee-id`·`employee-no`)에 둔다. 계정은 상단 사용자 메뉴에서 바꾼다.
- 사용자 메뉴의 **'시드로 초기화'**는 이 브라우저의 가짜 데이터를 시드 상태로 되돌린다(다른 탭에도 알려진다).
- 데이터는 `localStorage`(`fantasteel.mock-db.v6`)에 저장되고 다른 탭과 `BroadcastChannel`로 맞춘다. 서버가 없어 다른 PC와는 공유되지 않는다.

### 서버 연결 (영업·출하·품질·생산·구매·LOT·재고·작업 로그·조직 관리·업무·알림·메신저 화면, 선택)

수주·출하요청·출하 배정 화면, 대시보드의 영업 위젯 3개(공정 흐름 현황·수주 충족 현황·제품 재고), 생산 화면 3개(생산계획·작업 실적·열연 투입), 구매 화면 5개(구매요청·승인함·발주·입고·MRP)와 대시보드 구매 위젯 2개(원료 잔량 대비 소요·구매 진행), 출고 확정·밀시트·LOT 추적·재고·작업 로그 화면, 대시보드 최근 작업 로그 위젯, 조직 관리 화면 2개(사원·부서·직급·권한)와 조직도, 업무·알림 화면(업무 탭·알림함)과 상단 알림·레일 알림 배지, 메신저 화면·업무방과 상단 메신저·레일 메신저 배지는 실제 서버(`server/`)로 바꿔 볼 수 있다. 기본은 가짜 DB이고, 다른 화면은 서버 모드에서도 가짜 DB를 쓴다.

1. `client/.env.example`을 `client/.env.local`로 복사하고 `NEXT_PUBLIC_DATA_SOURCE=server`로 바꾼다.
2. `npm run dev`로 DB·서버·화면을 띄운다(이미 떠 있으면 화면 서버만 다시 띄운다).
3. 서버 모드의 로그인 화면은 사원번호·비밀번호 입력이다(REQ-AUTH-001, 2026-10-07 결정). 시드 계정은 `docs/backend/seed.md`(비밀번호 `fantasteel`). 로그인 사원의 정보·권한은 `GET /auth/me`, 부서·직급 이름은 `GET /departments`에서 읽는다(`api/server/session.ts`). 사용자 메뉴의 '로그아웃'은 `POST /auth/logout`.

- 연결 방식: `api/salesOrders.ts`·`api/shipmentRequests.ts`·`api/dashboard.ts`가 출처에 따라 가짜 DB 또는 `api/server/*.ts`를 부른다. 화면 컴포넌트는 그대로다.
- 고객사·규격 id는 화면에서 계속 가짜 DB id를 쓰고, 서버와 주고받을 때 코드(고객사 코드·규격 코드)와 이름으로 바꾼다(`api/server/masterIds.ts`). 사원·부서 id는 로그인 사원(`useMe()`)과 같이 서버 id다. 화면 첫 코일 규격(2.3×1200×1,065,000)은 서버 시드(2.5×1200×980,000)에 없어 서버 모드에서 고를 수 없다.
- 서버에 아직 없는 기능(수주 상세의 생산 연결, 취소 창의 구매 진행 영향, 재생산 계획)은 서버 모드에서 비어 있거나 "서버와 연결되지 않았어요" 오류다.
- 서버 데이터는 '시드로 초기화'로 되돌아가지 않는다. 서버 DB는 `npm run db:reset`. 생산 화면에 볼 데이터가 필요하면 그 뒤 `npm run seed:demo -w @fantasteel/server`(docs/backend/seed.md).
- 생산 화면: `api/production.ts`·`api/productionResults.ts`·`api/rolling.ts`가 `api/server/production.ts`를 부른다. 생산계획·LOT·실적·배정 id는 서버 id다. 검사 입력도 서버 모드면 같은 LOT id를 써서 생산 화면의 검사 링크가 맞는다. 가짜 DB에만 있는 값(여재 표시 시각, 배정 확정자)은 비어 있다.
- 구매 화면: `api/purchasing.ts`·`api/approvals.ts`·`api/goodsReceipts.ts`·`api/mrp.ts`가 `api/server/purchaseRequisitions.ts`·`purchaseOrders.ts`·`mrp.ts`를 부른다. 구매요청·발주·입고·생산계획·사원·부서 id는 서버 id, 원료 id는 화면 id다. 상세의 승인 가능 여부·요청자 직급·부서장 이름과 등록 창의 요청자·부서·부서장은 로그인 사원과 조직도로 판단한다. 반려 일시·발주자·입고 확정자는 서버가 작업 로그에서 읽어 준다. Message → ERP 원본 초안은 서버 조회가 없어 비어 있다. MRP 결과를 보려면 생산계획이 있어야 해서 `seed:demo`가 필요하다.
- 출고 확정 화면: `api/goodsIssues.ts`가 `api/server/goodsIssues.ts`를 부른다. 출하요청·LOT id는 서버 id다. 서버에 출고 전 확인 API가 없어 "출고 전 확인"은 출하요청·수주·LOT 상세로 화면에서 계산해 보이고, 확정할 때 서버가 다시 확인한다. 품질 사원은 수주 조회 권한이 없어 수주 매수·출하 매수가 비어 있다. 요청자는 ERD에 컬럼이 없어 비어 있다.
- 밀시트 화면: `api/millSheets.ts`가 `api/server/millSheets.ts`를 부른다. 서버 스냅샷만으로 그리고, 수주 줄 번호는 스냅샷에 없어 수주 상세의 품목 순서로 매긴다(수주 조회 권한이 없는 품질은 밀시트 안 순서). 'PDF 생성'은 브라우저에서 내려받은 뒤 서버도 같은 스냅샷으로 PDF를 만들어 저장한다(`POST mill-sheets/:id/pdf`).
- LOT 추적 화면: `api/lotTrace.ts`가 `api/server/lotTrace.ts`를 부른다. 화면 주소의 LOT 번호로 서버 LOT id를 찾아 추적하므로 생산·검사·출고 화면의 LOT 링크가 맞는다. 출하요청 번호로 시작하는 추적은 그 출하요청의 배정 LOT마다 역추적해 합친다(출하요청 조회 권한이 없는 구매·생산은 권한 없음). LOT 번호 검색은 앞부분 일치다. 서버 응답에 없는 값(공급업체, LOT의 생산계획, 배정 확정 시각·수주, 소진·출고·여재 시각)은 비어 있다.
- 재고 화면: `api/inventories.ts`가 `api/server/inventories.ts`를 부른다. 서버 재고의 `onHandQty`는 합격 재고라 화면의 합격 매수로 보이고, 재고 매수는 재고 상태 LOT 수로 센다(판정 대기에 상위 히트만 불합격인 LOT도 섞인다). LOT 목록은 제품·히트 LOT 상세로 히트·배정·처리 상태를 채운다. 원료 입고일·입고 번호(입고 조회 권한)와 입고예정(발주 조회 권한)은 권한이 있을 때만 보인다. 여재는 서버가 계산하지 않아 여재 탭이 비어 있다.
- 작업 로그: `api/businessEvents.ts`(작업 로그 화면), 수주 상세 이력(`api/salesOrders.ts`), 검사·불합격 LOT 이력(`api/server/inspections.ts`·`dispositions.ts`), 대시보드 최근 작업 로그(`api/dashboard.ts`)가 `api/server/businessEvents.ts`로 `GET /business-events`를 부른다. 대상 번호는 기록 데이터(변경 후·전)의 번호로 보이고, 주체의 부서·직급과 원본 메시지 링크는 서버 응답에 없어 비어 있다.
- 조직 관리 화면: `api/directory.ts`(관리 화면용 조회)·`api/adminEmployees.ts`·`api/adminOrganization.ts`가 `api/server/organization.ts`를 부른다. 사원·부서·직급·역할 id는 서버 id다. ERD·API 명세에 없는 기능(부서 정렬 순서·삭제, 직급 코드·수정·삭제, 최근 접속)은 서버 모드에서 숨기고, 사원 등록은 비밀번호를 받는다. 메신저·업무방의 멤버 선택은 서버 조직도(`GET /departments`)를 쓴다(`directoryApi.getOrgChart`). 사원 목록(`GET /employees`)은 관리자 전용이라 `directoryApi.listEmployees`는 서버 모드에서도 가짜 DB다.
- 업무·알림: `api/tasks.ts`·`api/notifications.ts`가 `api/server/tasks.ts`·`notifications.ts`를 부른다. 업무 목록은 내 담당 업무만이고(서버 `GET /tasks`), 업무 추가의 담당자는 조직도(`GET /departments`)에서 고른다. 서버 모드에서는 범위 선택(내가 만든 업무·전체), 요청자, 수정, 연결 화면을 숨기고 마감일이 필수다(`task`에 등록자·연결 화면 칸이 없고 수정 API가 없다). 알림은 내용 한 줄이라 제목 자리에 보이고 부서 표시가 없다. 읽음·모두 읽음은 서버 임시 API(`POST notifications/:id/read`·`read-all`)를 쓴다. 알림은 서버가 본 거래 안에서 보낸다(업무 지정, 구매요청 승인 요청·결과). 멘션·업무방 메시지 알림은 서버가 메시지와 함께 만든다.
- 로그인 쿠키는 브라우저의 모든 탭이 함께 쓴다. 그래서 한 브라우저에서는 한 계정만 쓴다(승인 시연은 시크릿 창이나 다른 브라우저로). 이미 로그인된 브라우저에서 새 탭을 열면 그 사원으로 바로 들어간다. 다른 탭에서 다른 계정으로 로그인하거나 로그아웃하면, 또는 쿠키가 만료(401)되면 안내하고 로그인 화면으로 보낸다(`api/http.ts`의 `onServerSessionLost`).
- 메신저: `api/messenger.ts`와 수주 화면의 업무방(`api/salesOrders.ts`의 `workRoom`·`openWorkRoom`)이 `api/server/messenger.ts`를 부른다. 채팅방·메시지·사원 id는 서버 id다(`useMe().employeeId`). 실시간은 셸이 소켓(`hooks/useMessengerSocket.ts`, namespace `/messenger`, 로그인 쿠키로 인증)에 붙어 `message:new`·`room:read`·`room:updated`를 받으면 메신저 조회를 다시 부르고, 연결이 끊겼다 다시 붙으면 놓친 메시지를 읽으려고 메신저 조회를 모두 다시 부른다. 본문의 @이름·@부서는 방 멤버 사원 id로 바꿔 서버에 보낸다(부서 멘션 = 그 부서의 방 멤버). 첨부는 10MB까지, 실행 파일은 막힌다. 서버에 없는 값(방 만든 사람, 첨부 크기·형식)은 비어 있다. 시스템 메시지(업무방 열림·초대·이름 변경·수주 진행 알림)는 서버가 만들어 가운데 회색 줄로 보인다. 본문 업무 번호 링크는 서버가 실제로 있는 문서만 준다(`erpLinks`). 멤버 초대(`POST /chat-rooms/:id/members`)와 그룹방 이름 바꾸기(`PATCH /chat-rooms/:id`, 방 정보 칸의 [이름 바꾸기])는 두 모드 모두 된다. 업무방은 내가 멤버인 방만 수주 화면에서 찾는다(수주 화면의 '업무방' 버튼은 서버 모드에서 늘 '업무방 열기'로 보이고, 열면 있는 방을 돌려준다).
- 편의(두 모드 공통): 메시지 옆에 아직 안 읽은 멤버 수(보낸 사람 제외)를 보이고, 방 정보 칸에 대화 검색(본문, 대소문자 무시, 최신순)과 파일 모아보기(첨부만, 최신순)가 있다. 서버 모드는 다른 멤버가 읽으면 소켓 `member:read`로 수가 바로 줄어든다. 검색 결과를 누르거나 알림(`/messenger?room=&message=`)으로 들어오면 그 메시지까지 이전 메시지를 더 불러와 가운데로 스크롤하고 잠깐 강조한 뒤 주소에서 `message`를 지운다(`MessengerScreen`·`Conversation`).
- 그림 첨부 미리보기(두 모드 공통): png·jpg·jpeg·gif·webp·bmp는 말풍선에 작은 그림으로 보이고 누르면 크게 본다(`features/messenger/lib/attachment.ts`). ERD에 형식 컬럼이 없어 확장자로 판단하고, 서버는 늘 octet-stream으로 보내서 화면이 확장자로 형식을 붙인다. SVG는 스크립트가 들어갈 수 있어 미리보지 않는다.
- 업무방 멤버 추천(두 모드 공통): 업무방 열기 창 위에 담당 영업과 생산부·물류부 부서장을 추천으로 보이고 [추천 N명 더하기]로 한 번에 고른다(`features/sales/lib/workRoomSuggest.ts`). 미리 고르지는 않는다. 부서는 시드 부서 코드(PRD·LOG, 가정값)로 찾는다.
- 접속 상태·입력 중(서버 모드만): 1:1 목록·방 머리·멤버 아바타에 접속 점(초록 = 접속 중), 1:1 머리에 '접속 중/접속 안 함', 입력창 위에 'OO님이 입력 중…'. 소켓으로만 오는 잠깐의 상태라 `stores/useMessengerLiveStore.ts`에 두고, 소켓이 끊기면 접속 표시를 숨긴다(알 수 없음). 가짜 DB 모드에서는 표시하지 않는다.
- 수정·삭제·답글(두 모드 공통): 말풍선 메뉴에 답장(모든 일반 메시지)·수정·삭제(내 메시지)가 기본으로 있다(`features/messenger/components/MessageEditActions.tsx`, 메뉴 등록부 맨 앞). 답장은 입력창 위에 원본 줄이 생기고, 답글 말풍선 위 원본을 누르면 그 메시지로 이동한다. 고친 메시지는 '수정됨', 지운 메시지는 '삭제된 메시지예요'로 남는다. 고른 메시지는 `stores/useMessageComposeStore.ts`에 둔다.
- 이모지 반응(두 모드 공통): 메시지 메뉴 맨 위 이모지 줄(`ReactionAction`)에서 고르고, 말풍선 아래 반응 칩을 눌러도 더하거나 뺀다. 칩에 마우스를 올리면 누른 사람이 보인다. 가짜 DB는 반응을 메시지 행(`MessageRow.reactions`)에 둔다(새 표를 만들면 저장된 가짜 DB가 지워져서).
- 방 설정(두 모드 공통): 대화 머리의 핀 버튼 = 목록 위 고정(목록 맨 위 '고정' 묶음), 종 버튼 = 알림 끄기, 나가기 버튼 = 방 나가기(1:1 제외, 확인 창 뒤 목록으로 돌아감)(`RoomSettings.tsx`). 알림을 끈 방은 목록에 흐린 종 표시, 안 읽은 수 배지가 회색이고 레일·상단 메신저 배지 합계에서 빠진다(멘션 알림은 받는다). 가짜 DB는 `ChatRoomMemberRow.muted`·`pinnedAt`(선택 값)에 둔다.
- 공지(두 모드 공통): 메시지 메뉴 [공지로 고정] → 대화 위 노란 공지 줄(`PinnedNotice.tsx`). 줄을 누르면 그 메시지로 이동, [x]로 내린다.
- 메시지 보내기(두 모드 공통): 누르면 입력창을 비우고 대화에 '보내는 중' 말풍선을 바로 띄운다(`stores/useOutboxStore.ts`, `hooks/useMessenger.ts`의 `useMessageOutbox`). 저장되면 조회를 다시 읽고 말풍선을 지우며, 실패하면 이유와 [다시 보내기]·[삭제]가 있는 '전송 실패' 말풍선으로 남는다. 보관함은 브라우저 메모리라 새로고침하면 사라진다. 메시지마다 보내기 id(`clientMessageId`, UUID)를 붙여 서버 모드에서 다시 보내도 두 번 저장되지 않는다.
- 아직 가짜 DB만 쓰는 화면(Message → ERP 초안 등)은 로그인 사원의 사원번호로 가짜 DB 사원을 찾아 쓴다(`api/actor.ts`, 화면은 `useMockEmployeeId()`). 서버에서 새로 등록한 사원은 가짜 DB에 없어 이 화면들을 쓸 수 없다.

## 3. 폴더 (`client/src/`)

```
app/            Next.js 경로. (main)/<주소>/page.tsx = 화면 진입점, login/page.tsx = 계정 선택(서버 모드는 로그인)
features/<영역>/  화면과 영역 전용 부품·lib (sales, production, quality, purchasing, shipment, inventory, lotTrace,
                 businessEvents, tasks, messenger, dashboard, admin, masterData, inspectionStandards, actionDrafts,
                 millSheets, agent, meetings, pastCases, login, shell …)
features/shell/  셸: 레일(Rail.tsx), 상단 바, 화면 접근표(screens.ts), 경로 제목(routeTitles.ts), AI 패널
components/      공용 부품: Button, Input, Field, Modal, Table, Tabs, Badge, Banner, Card, Timeline, Toaster,
                 QueryBoundary, StateView(EmptyNote), ComingSoon(ComingSoonArea·SoonButton) …
api/             화면이 데이터를 읽고 쓰는 길. <영역>.ts 함수 + client.ts(mockQuery·mockMutation), actor.ts(requireActor),
                 errors.ts(ApiError), queryKeys.ts, queryClient.ts
hooks/           api 함수를 감싼 훅 (useQuery 래퍼, useAction, usePermission, useMockDataSync …)
codes/           공통 코드(공통 코드 정의서의 값·표시명), 9.3 오류 코드(errors.ts), 번호 채번 규칙(numbering.ts)
mock/            가짜 DB (4장)
lib/             순수 계산 함수 (weight, fifo, mrp, inspectionJudgment, decimal, seoulDate …)와 Vitest 테스트
stores/          Zustand: useSessionStore, useShellStore, useToastStore (화면·세션 상태만)
styles/          globals.css, icons.css
test/            Vitest 준비 (setup.ts, actors.ts, masterSeed.ts)
```

## 4. 가짜 DB와 시드 (`client/src/mock/`)

| 파일·폴더 | 내용 |
|---|---|
| `schema.ts` | 테이블(행 타입)과 ERD 이름 |
| `store.ts`, `db.ts` | 저장(`localStorage`)·탭 동기화·`MOCK_DB_VERSION`(시드를 바꾸면 올린다), 이 탭의 DB 인스턴스와 `resetToSeed` |
| `seed.ts` | 조직·기준정보 시드 (부서·직급·역할·사원·권한·강종·품목·규격·라우팅·배합 원단위 …) |
| `seeds/` | 거래·협업 시드. `index.ts`의 `AREA_SEEDERS` 순서: `inspectionStandards` → `core`(수주·생산·구매·출하·밀시트, 14.1 시작 재고) → `collab`(업무·채팅방) → `dashboard`(8~9월 끝난 거래) |
| `services/` | **업무 규칙 서비스**(예약·FIFO 배정·히트 편성·실적·검사 판정·MRP·구매·출하·밀시트·초안 …). 영역 화면은 이 규칙을 다시 만들지 않고 부른다. API 문서는 `docs/rework/areas/core-domain.md` |
| `businessEvents.ts` | 작업 로그 기록기 (수정·삭제 함수 없음) |
| `sequence.ts`, `fileStorage.ts` | 업무 번호 순번 발급, 첨부 파일 저장소(파일 1개 512KB) |

- 시드는 서비스 함수를 그대로 불러 만들고, 날짜·난수 시드가 고정이라 매번 같은 결과가 나온다. 값 목록과 근거는 `docs/rework/seed-assumptions.md`.
- 시드를 바꾸는 법: 영역 시드 파일을 `mock/seeds/`에 두고 `seeds/index.ts`의 `AREA_SEEDERS`에 한 줄 등록한다(거래 시드 뒤에 실행해야 하면 뒤에). 바꾼 뒤 `MOCK_DB_VERSION`을 올린다.

## 5. 코드 규칙 (코드 컨벤션)

- TypeScript strict, `any` 금지, `console.*` 금지, `@/` alias(`../../` 금지). 함수형 컴포넌트는 named export(Next 경로 파일만 default export), 컴포넌트 파일은 PascalCase, 훅은 `use*.ts`. 변수명 `order`만 쓰지 않는다(`salesOrder`, `purchaseOrder`).
- 데이터 접근은 `api/*.ts` 함수 + 커스텀 훅(TanStack Query)으로만. 컴포넌트에서 mock DB를 직접 읽지 않는다. Zustand에는 서버 데이터를 복사하지 않는다.
- 라벨·코드·오류 메시지는 `@/codes`에서만 가져온다(화면에 영어 코드 원문을 쓰지 않는다). 업무 번호·LOT 번호는 `codes/numbering.ts`의 채번 함수로만 만든다.
- 모든 변경 함수(`api/`)는 맨 먼저 `requireActor`로 요청 사원의 USE 권한을 확인하고(없으면 COM-002), 9.3 오류 코드로 검증하고, `mockMutation` 안에서 mock DB를 바꾸며 작업 로그(BUSINESS_EVENT_TYPE, 주체 USER 또는 SYSTEM, 변경 전후, 사유 코드는 허용된 값만)를 같은 트랜잭션에서 남긴다. 화면에서도 권한이 없으면 버튼을 숨기거나 끈다.
- 변경 뒤 영향받는 모든 화면이 갱신되게 쿼리를 무효화한다(`api/queryKeys.ts`). 다른 탭은 `BroadcastChannel` 동기화(`hooks/useMockDataSync.ts`)가 갱신한다.
- 업무 계산은 순수 함수(`lib/` 또는 `features/<영역>/lib/`)로 두고 Vitest 테스트를 붙인다. api 함수는 mock DB 위에서 정상 흐름과 9.3 오류 경우를 시험한다(`*.test.ts`).
- 스타일은 Tailwind 유틸리티와 B안 토큰. 목록|상세 구조, 상태 배지 색, 빈·로딩·오류 상태(`StateView`, `QueryBoundary`)를 다른 화면과 같게 맞춘다.
- 날짜 입력은 `DateInput`, 수량은 정수, 톤은 문자열 소수 3자리(`lib/decimal.ts`).

## 6. P2·EX 처리 (준비 중)

- P2(AI Factory Agent, Voice2ERP 회의록, AI 어시스턴트·@AI, Message → ERP 확장 유형, Agent 승인)와 EX(과거 사례)는 **디자인만** 두고 기능은 없다. AI·LLM 호출도 없다.
  - 버튼: `<SoonButton>` / 작은 표시: `<ComingSoon grade="P2" />` / 영역: `<ComingSoonArea grade="P2" title="…">예시 내용</ComingSoonArea>`. 모두 `components/ComingSoon.tsx`.
  - 예시 내용은 `features/agent/agentExample.ts`, `features/meetings/meetingExample.ts`, `features/pastCases/pastCaseExample.ts`의 고정 값이다. 실제 데이터로 오해할 수 있는 숫자는 예시임이 보이게 한다.
- 화면: `/agent`, `/meetings`, `/past-cases`, 상단 AI 어시스턴트 패널(`features/shell/AiPanel.tsx`).

## 7. 끝낼 때

1. `npm run typecheck -w @fantasteel/client` 오류 0, `npm run test -w @fantasteel/client` 전부 통과, `npm run build -w @fantasteel/client` 성공.
2. 새로 정한 값이 있으면 `docs/rework/seed-assumptions.md`와 해당 영역 노트(`docs/rework/areas/<영역>.md`)에 가정값으로 적는다.
3. 금지어와 코드 표시명을 다시 훑는다(용어 사전, 공통 코드 정의서).
