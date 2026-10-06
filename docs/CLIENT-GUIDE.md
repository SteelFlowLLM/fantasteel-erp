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
- 처음 열면 **계정 선택** 화면(`/login`)이 나온다. 사원 계정을 누르면 그 사원으로 들어간다. 사원번호·비밀번호 로그인은 **일부러 미뤘다**(SPEC 5장 결정 1). 계정은 탭마다 `sessionStorage`(`fantasteel.session.employee-id`)에 둔다. 계정은 상단 사용자 메뉴에서 바꾼다.
- 사용자 메뉴의 **'시드로 초기화'**는 이 브라우저의 가짜 데이터를 시드 상태로 되돌린다(다른 탭에도 알려진다).
- 데이터는 `localStorage`(`fantasteel.mock-db.v6`)에 저장되고 다른 탭과 `BroadcastChannel`로 맞춘다. 서버가 없어 다른 PC와는 공유되지 않는다.

### 서버 연결 (영업 화면만, 선택)

수주·출하요청·출하 배정 화면과 대시보드의 영업 위젯 3개(공정 흐름 현황·수주 충족 현황·제품 재고)는 실제 서버(`server/`)로 바꿔 볼 수 있다. 기본은 가짜 DB이고, 다른 화면은 서버 모드에서도 가짜 DB를 쓴다.

1. `client/.env.example`을 `client/.env.local`로 복사하고 `NEXT_PUBLIC_DATA_SOURCE=server`로 바꾼다.
2. `npm run dev`로 DB·서버·화면을 띄운다(이미 떠 있으면 화면 서버만 다시 띄운다).
3. 계정 선택 화면은 그대로다. 서버 모드에서는 고른 사원의 사원번호와 시드 비밀번호(`NEXT_PUBLIC_DEV_LOGIN_PASSWORD`)로 화면 뒤에서 서버에 로그인한다(`api/http.ts`).

- 연결 방식: `api/salesOrders.ts`·`api/shipmentRequests.ts`·`api/dashboard.ts`가 출처에 따라 가짜 DB 또는 `api/server/*.ts`를 부른다. 화면 컴포넌트는 그대로다.
- 고객사·규격·사원 id는 화면에서 계속 가짜 DB id를 쓰고, 서버와 주고받을 때 코드(고객사 코드·규격 코드)와 이름으로 바꾼다(`api/server/masterIds.ts`). 화면 첫 코일 규격(2.3×1200×1,065,000)은 서버 시드(2.5×1200×980,000)에 없어 서버 모드에서 고를 수 없다.
- 서버에 아직 없는 기능(수주 상세의 생산 연결·이력, 취소 창의 구매 진행 영향, 업무방, 재생산 계획)은 서버 모드에서 비어 있거나 "서버와 연결되지 않았어요" 오류다.
- 서버 데이터는 '시드로 초기화'로 되돌아가지 않는다. 서버 DB는 `npm run db:reset`.
- 쿠키는 브라우저의 모든 탭이 함께 쓴다. 탭마다 다른 계정을 고르면 요청마다 다시 로그인한다.

## 3. 폴더 (`client/src/`)

```
app/            Next.js 경로. (main)/<주소>/page.tsx = 화면 진입점, login/page.tsx = 계정 선택
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
