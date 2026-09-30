# 화면 작업 안내 (v2 client)

v2 화면은 **v1의 B안 디자인**(어두운 아이콘 레일 + 목록|상세)을 그대로 쓰되, 데이터는 v2 서버(NestJS REST API)에서 가져온다. 셸·공용 부품·API 클라이언트는 이미 있다. 이 문서는 화면을 나눠 만드는 사람(에이전트)이 같은 규칙으로 작업하기 위한 안내다.

## 1. 기준

1. `v2/SPEC.md` — 범위·결정. 특히 3번(P1만 기능, P2는 디자인만 + "준비 중 (P2)"), 5번(화면 개선), 8·9번.
2. `v2/docs/notion/` — 업무 규칙·용어 (`02-요구사항-정의서.md`, `04-업무-프로세스-정의서.md`, `03-용어-사전.md`).
3. `v2/docs/api/<모듈>.md` — **서버가 실제로 주는 요청·응답 모양. 화면은 이것만 보고 붙인다.** 문서와 실제가 다르면 실제 서버를 기준으로 하고 보고서에 적는다.
4. 디자인 참고: `v1/web/src/screens/B/sNN.tsx`(+ `sNN.css`) — B안 화면의 마크업·클래스·문구. **모양(구조·className·인라인 스타일·해요체 문구)은 최대한 그대로 가져온다.** 데이터 연결 코드(v1의 `useDb`, `shared/domain` 등)는 가져오지 않는다. `v1/`은 수정 금지.

- 용어는 용어 사전을 따른다: 팀장 → **부서장**, 거래처 → 고객사, 원자재 → 원료, 강종은 SS275·SM355·SPHC, AI 이름은 "AI 어시스턴트". v1 문구에 옛 용어가 있으면 고친다.
- v1에 있던 "시뮬레이션 시계·자동 조업·시안 전환"은 없다. 시간은 실제 시간이다.
- SPEC·문서·API에 없는 기능이나 숫자를 만들어 내지 않는다. 화면의 모든 숫자·상태는 서버 응답에서 온다.

## 2. 폴더와 명령

```
client/src/
  api/          client.ts(api.get/post…, ApiError, fileUrl, newIdempotencyKey), queryClient.ts, realtime.ts, auth.ts, <영역>.ts
  components/   ui.tsx (Badge, Icon, Spinner, EmptyNote, StateView, QueryBoundary, Modal, Field, ComingSoon, ComingSoonArea, SoonButton, Progress, Avatar), DateInput.tsx
  hooks/        useApi.ts(useAction), useRealtime.ts(useRealtimeEvent)
  lib/format.ts fmtDate, fmtMD, fmtHM, fmtMDHM, fmtDateTime, relTime, dLabel, todayStr, fmtTon, fmtInt, fmtNum, fmtPct, fmtDims, fmtBytes
  stores/       auth.ts(useMe, canUse, canView, isDepartmentHead), toast.ts(toast.ok/info/error/apiError)
  shell/        Shell.tsx, nav.ts, titles.ts, shellTitle.tsx(useShellTitle), shellData.ts
  pages/<영역>/  XxxPage.tsx   ← 화면. 이미 자리 표시용 파일이 있고 App.tsx에 경로가 연결돼 있다
  features/<영역>/  화면이 나눠 쓰는 부품·훅
  styles/       hl-vars.css, bundle.css(B안 디자인), app.css(v2 보정)
```

```bash
cd v2/client && npx tsc --noEmit -p tsconfig.json     # 타입 검사 (내 파일에 오류 0)
```
- 개발 서버(`vite`)·브라우저는 띄우지 않는다 (다른 사람이 쓰고 있다). 서버 응답은 curl로 직접 확인한다: `http://localhost:8787/api/v1` (로그인 `POST /auth/login {employeeNo, password:"heatline"}`). **8787 서버의 데이터는 모두가 같이 쓰므로 조회(GET)만 한다.** 변경 API를 시험해야 하면 보고서에 "확인 못 함"으로 적는다.

### 건드리면 안 되는 것
- `src/App.tsx`, `src/main.tsx`, `src/shell/`, `src/components/`, `src/hooks/`, `src/lib/`, `src/stores/`, `src/api/client.ts`·`queryClient.ts`·`realtime.ts`·`auth.ts`, `src/styles/bundle.css`·`hl-vars.css`·`app.css`, `shared/`, `server/`, 다른 사람의 `pages/`·`features/`·`api/` 파일.
- 공용 부품이 부족하면 고치지 말고 자기 `features/<영역>/` 안에 만들고 보고서에 적는다. 새 경로가 필요하면 보고서에 적는다.
- 패키지 추가 금지.
- 화면 전용 CSS가 필요하면 `pages/<영역>/<Page>.css`를 만들어 그 화면에서 import 한다 (v1의 `sNN.css`를 옮길 때도 같다). 클래스 이름이 다른 화면과 겹치지 않게 화면 접두사를 붙인다.

## 3. 코드 규칙 (코드 컨벤션 9장)

- 함수형 컴포넌트 + **named export** (`export function SalesOrderListPage()`), 파일명 PascalCase. `@/` alias 사용, `../../` 금지.
- API 호출은 `src/api/<영역>.ts`의 함수 + 커스텀 훅으로만. 컴포넌트에서 `fetch` 직접 호출 금지.
  ```ts
  // src/api/salesOrders.ts
  export interface SalesOrderRow { … }                        // docs/api의 응답 모양 그대로
  export const salesOrderApi = {
    list: (q: ListQuery) => api.get<SalesOrderRow[]>('/sales-orders', q),
    create: (dto: CreateDto) => api.post<SalesOrder>('/sales-orders', dto, { 'Idempotency-Key': newIdempotencyKey() }),
  };
  // 화면
  const list = useQuery({ queryKey: ['sales-orders', 'list', filters], queryFn: () => salesOrderApi.list(filters) });
  const create = useAction(salesOrderApi.create, { success: '수주를 등록했어요', invalidate: ['sales-orders', 'inventories'], onSuccess: (o) => navigate(`/sales-orders/${o.id}`) });
  ```
- **쿼리 키의 첫 요소는 서버 실시간 주제 이름**(= API 복수 명사: `sales-orders`, `inventories`, `lots`, `allocations`, `production-plans`, `production-results`, `mrp-runs`, `purchase-requisitions`, `purchase-orders`, `goods-receipts`, `quality-inspections`, `shipment-requests`, `goods-issues`, `mill-sheets`, `business-events`, `tasks`, `notifications`, `chat-rooms`, `action-drafts`, `employees`, `departments`, `master-data`, `dashboard`). 서버가 데이터가 바뀌면 주제를 보내고, 그 주제로 시작하는 조회가 자동으로 다시 불린다 (다른 창에서 한 변경도 바로 보인다). 여러 주제에 걸친 조회는 가장 관련 큰 주제를 쓰고 `useAction`의 `invalidate`로 보완한다.
- 서버 데이터를 전역 스토어에 복사하지 않는다. 화면 상태(선택·필터·폼)는 `useState`, 주소에 남길 것은 `useSearchParams`.
- 로딩·오류는 `<QueryBoundary query={q}>{(data) => …}</QueryBoundary>` 또는 `StateView`. 빈 목록은 같은 자리에 `<EmptyNote>`. 403은 `QueryBoundary`가 "권한 없음" 상태로 보여준다.
- 변경은 `useAction` (실패하면 서버 메시지를 토스트로 띄운다). 버튼은 `pending` 동안 비활성.
- 권한: `const me = useMe()`. 변경 버튼은 `canUse(me, 'ORDER_CREATE')`가 아니면 `disabled` + `title="권한이 필요해요"` (디자인의 `hl-lockhint`가 있으면 그것). 부서장 여부는 `isDepartmentHead(me)`; 승인은 서버가 승인권자를 확인한다.
- 수량 입력은 정수만 (`inputMode="numeric"`, 1 이상). 톤은 서버가 준 문자열을 `fmtTon`으로 표시만 한다 — 화면에서 다시 계산해 저장하지 않는다. 입력 중 미리보기 톤은 `calcWeightTon`(shared)으로 계산해 "계산값"임을 표시한다. 단위: 슬래브 매, 코일 개 (`ITEM_QTY_UNIT`).
- 상태 표시는 shared의 라벨 상수(`SALES_ORDER_STATUS_LABEL` 등) + `Badge`. 상태 문자열을 화면에 직접 쓰지 않는다.
- 날짜 입력은 전부 `DateInput` (숫자 직접 입력 + 달력 팝업, SPEC 5-2). 값은 `YYYY-MM-DD`.
- 상단 바 제목을 바꾸려면 `useShellTitle('SO-20260930-0001', '한빛중공업')`.
- 화면 사이 이동 경로는 `docs/SERVER-GUIDE.md` 8장과 `src/App.tsx`. 수주번호·LOT번호는 링크(`className="hl-link-id"`)로: 수주 → `/sales-orders/:id`, LOT → `/lots/trace?lot=<lotNo>`.
- 화면 루트는 셸의 `.hl-body` 안에 들어간다: 보통 `<main className="hl-main">…</main>`, 목록|상세 구조면 `<section className="hl-master">…</section><main className="hl-main">…</main>` (v1 B안 화면과 같다). 창 크기가 달라질 수 있으니 고정 폭(1440) 가정은 빼고 표·카드가 늘어나게 한다 (`minWidth: 0`, 스크롤).
- 접근성: 버튼은 `<button type="button">`, 아이콘만 있는 버튼은 `aria-label`, 입력은 `label` 연결, 오류 문구는 입력 가까이에.
- 문구는 v1 디자인처럼 해요체. 오류 메시지는 서버 메시지를 그대로 보여준다.

## 4. P2·EX 처리 (SPEC 3번)

- P2(AI Factory Agent, Voice2ERP 회의록, AI 어시스턴트·@AI, Message → ERP 확장 유형, Agent 승인)와 EX(과거 사례)는 **디자인(버튼·화면)은 남기고 기능은 뺀다.**
  - 버튼: `<SoonButton>비슷한 사례 찾기</SoonButton>` / 작은 표시 `<ComingSoon grade="P2" />`
  - 화면·영역: `<ComingSoonArea grade="P2" title="AI Factory Agent">…v1 디자인 마크업(고정 예시 내용)…</ComingSoonArea>`
- 예시 내용에 v1의 옛 용어·강종이 있으면 고친다. 실제 데이터처럼 오해할 숫자는 "예시"임을 알 수 있게 한다.
- Message → ERP의 AI 자동 추출은 없다: 초안 값은 요청자가 직접 입력한다. 추출 자리에는 `<ComingSoon grade="AI" />`.

## 5. 끝낼 때

1. `npx tsc --noEmit -p tsconfig.json`에서 내 파일 오류 0 (남의 파일 오류는 보고만).
2. 내 화면이 쓰는 GET API를 curl로 불러 응답 모양이 내 타입과 맞는지 확인.
3. v1 B안 화면과 나란히 다시 읽고, 보이던 것이 빠지지 않았는지·P2가 "준비 중"으로 남았는지 확인.
4. 보고서: 화면별로 무엇이 실제 데이터인지 / 연결한 동작 / 준비 중으로 남긴 것 / 확인 못 한 것(변경 API 등) / API 문서와 달랐던 점 / 공용 코드에 필요한 것.
