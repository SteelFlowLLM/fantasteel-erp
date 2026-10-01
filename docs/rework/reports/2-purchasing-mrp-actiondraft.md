# 구매(MRP·구매요청·승인함·발주·입고) + Message → ERP 화면 감사

읽기만 했고 파일은 하나도 바꾸지 않았습니다.

## 0. 읽은 범위

대상 15개 파일을 모두 처음부터 끝까지 읽었습니다.

| 파일 (client/src/…) | 줄 수 |
|---|---|
| pages/purchasing/MrpPage.tsx | 390 |
| pages/purchasing/PurchaseRequisitionListPage.tsx | 171 |
| pages/purchasing/PurchaseRequisitionDetailPage.tsx | 50 |
| pages/purchasing/ApprovalPage.tsx | 139 |
| pages/purchasing/PurchaseOrderPage.tsx | 390 |
| pages/purchasing/GoodsReceiptPage.tsx | 384 |
| pages/purchasing/ActionDraftPage.tsx | 377 |
| features/purchasing/RequisitionPanel.tsx | 290 |
| features/purchasing/RequisitionFormModal.tsx | 168 |
| features/purchasing/common.tsx | 154 |
| api/purchasing.ts | 242 |
| api/mrp.ts | 84 |
| api/actionDrafts.ts | 59 |
| api/lookups.ts | 34 |
| api/directory.ts | 51 |
| **합계** | **2,983** |

**보조로 읽은 파일**
- 전체: `shared/src/codes/index.ts`(334), `shell/nav.ts`(103), `shell/titles.ts`(40), `stores/auth.ts`, `hooks/useApi.ts`, `api/client.ts`
- 부분: `App.tsx` 라우트 부분(60–116), 메신저 진입부(`features/collab/ChatParts.tsx` 122–185, `pages/collab/MessengerPage.tsx` 265–292·420–432, `api/messenger.ts` 120–145)
- 해당 함수만: `lib/format.ts`, `components/ui.tsx`, `stores/toast.ts`
- `SPEC.md`(78줄): CLAUDE.md 지시 때문에 맥락 확인용으로만 읽었습니다. 갭 판정 기준으로는 쓰지 않았습니다.

**문서**
- Notion 5개(요구사항 정의서, 용어 사전, 공통 코드 정의서, 프로젝트 기획안, 코드 컨벤션)는 모두 전체가 반환됐고 잘림이 없었습니다.
- 업무 프로세스 정의서 `process.md`는 1–1530줄을 5번에 나눠 끝까지 읽었습니다.

**열지 않은 것**
- `server/`, prisma, `docs/api`, `docs/names`, `SERVER-GUIDE`
- 그 밖의 Notion 페이지. 공통 코드 정의서 안에 있는 역할별 기본 권한 링크도 열지 않았습니다.

---

## A. 화면 인벤토리

### A-0. 공통 사항

**라우트와 권한 판단**
- 라우트 단위 권한 가드가 없습니다(`App.tsx:87-93`). 메뉴는 `nav.ts`에서 VIEW 이상 권한이 없으면 숨기고, 화면 안에서는 `canUse`/`canView`로 판단하며, 최종 판단은 서버가 합니다.
- `canUse` = USE 권한, `canView` = USE 또는 VIEW, `isDepartmentHead` = `headDepartmentIds.length > 0` (`stores/auth.ts:48-55`).

**톤 표시와 입력**
- 표시: `fmtTon`으로 "1,234.500 t" 형식(소수 3자리 고정, `lib/format.ts:58-63`). KPI는 `fmtNum(v,3)` 뒤에 t를 붙입니다.
- 입력 규칙: `inputMode=decimal`, 접미사 `t`, 정규식 `^\d+(\.\d{1,3})?$`, 0보다 커야 함(`common.tsx:20-29`).
- 입력 오류 문구:
  - '톤을 입력해 주세요'
  - '숫자로, 소수 3자리까지 입력해 주세요'
  - '0보다 커야 해요'
  - '{max} t 이하로 입력해 주세요'
- 입력 칸 초기값은 `tonInput`으로 끝자리 0을 지웁니다("150.000" → "150").

**로딩·오류·토스트**
- 조회 상태(`QueryBoundary`, `components/ui.tsx:32-69`):
  - 로딩: '불러오는 중…'
  - 오류: '불러오지 못했어요' + 서버 메시지 + 코드 + [다시 시도]
  - 403: '이 화면을 볼 권한이 없어요'
- 변경 실패 토스트: `{message} ({code})` (`stores/toast.ts:21`).
- 변경 성공 시 `useAction`이 성공 토스트를 띄우고 관련 주제 쿼리를 무효화합니다.

**상태 배지 (`common.tsx:37-60`, 라벨은 shared)**

| 대상 | 코드값 → 표시 라벨(톤) |
|---|---|
| 구매요청 | DRAFT '작성 중'(neutral) / WAITING_APPROVAL '승인 대기'(wait) / APPROVED '승인'(run) / REJECTED '반려'(danger) / ORDERED '발주 완료'(ok) |
| 발주 | CONFIRMED '발주 확정'(run) / PARTIALLY_RECEIVED '부분 입고'(wait) / RECEIVED '입고 완료'(ok) |
| 입고 | DRAFT '입고 초안'(wait) / CONFIRMED '입고 확정'(ok) |
| 초안 | AI_GENERATED '생성'(ai) / WAITING_APPROVAL '확인 대기'(wait) / APPROVED '확정'(run) / EXECUTED 'ERP 반영'(ok) / REJECTED '반려'(danger) |
| 출처 태그 | DIRECT '직접' / MRP 'MRP' / MESSAGE '메신저' |
| MRP 근거 생산계획 | PLANNED '계획' / CONFIRMED '편성 확정' / IN_PROGRESS '생산 중' / COMPLETED '완료' / CANCELLED '취소' |

**진행 단계 표시**
- 구매요청 진행 단계: 작성 중 → 승인 대기 → 승인 → 발주 완료 → 반려. 반려되면 '작성 중' 단계와 반려를 함께 강조합니다(`common.tsx:77-94`).
- 초안 흐름: 생성 → 확인 대기 → 확정 → ERP 반영 → 반려(`common.tsx:96-112`).

**"준비 중" 표시**
- MRP: [구매요청 자동 초안 준비 중 (P2)] (`MrpPage.tsx:164`)
- 승인함: 'Agent 대응 후보 준비 중 (P2)' (`ApprovalPage.tsx:73, 91-92`)
- 초안 화면: 'AI 자동 추출 준비 중'. 등급 표기가 없습니다(`ActionDraftPage.tsx:217-218`, 메신저 쪽은 `ChatParts.tsx:154-157`).
- 부서장 메뉴: 'Agent (P2)' (`nav.ts:68`)

### A-1. MRP 결과 — `/mrp` (MrpPage.tsx)

**제목과 진입**
- 상단 제목: 'MRP 결과' / '구매' (`titles.ts:11`).
- 메뉴: 구매 역할의 'MRP'(PURCHASE_REQUISITION_CREATE, `nav.ts:30`). 생산·관리자 메뉴에는 없습니다.

**왼쪽: 'MRP 실행 이력'**
- 헤더: 'MRP 실행 이력' + 건수, 안내 '최근 50건까지 보여요. 실행을 고르면 그때의 계산 결과를 볼 수 있어요.' (:45-48)
- 항목 내용 (:53-86)
  - 'M/D(요일) HH:mm'
  - 배지 최신/지난 실행
  - mrpRunNo · 실행자
  - '히트 N · X t · 용선 Y t'
  - '순소요 N종' + '합계 X t' 또는 '순소요 없음'
- 동작: 클릭하면 `?run=`이 바뀝니다. 최신 실행을 고르면 파라미터를 지웁니다.
- 상태 문구
  - 오류: '실행 이력을 불러오지 못했어요' (:52)
  - 빈 상태: '아직 실행 기록이 없어요 · MRP 실행으로 계산해 보세요' (:87)
- 하단 '계산 방법' (:89-97)
  - '진행 중인 생산계획 전체의 남은 히트로 계산해요. 편성 전 계획은 예상 히트로 넣어요.'
  - '총소요 − 원료 LOT 잔량 − 입고예정 = 순소요'
  - '합금철 = 히트 톤 × kg/t ÷ 1,000'
  - 'MRP는 구매요청을 만들지 않아요. 구매요청은 담당자가 등록하고 부서장이 승인해요.'

**오른쪽: 실행 결과**
- 상태 문구
  - 로딩: 'MRP 결과를 불러오는 중…'
  - 실행 기록 없음: '아직 MRP를 실행한 적이 없어요' / 'MRP 실행을 누르면 진행 중인 생산계획의 원료 소요를 계산해요' + [MRP 실행] (:100-113)
- 헤더 (:150-160)
  - 경로: 'MRP 결과 > {mrpRunNo}'
  - 제목: 'MRP 실행 {M/D HH:mm}'
  - 배지: 최신/지난 실행, '순소요 N종'(danger) 또는 '순소요 없음'(ok)
- 버튼

| 버튼 | 표시·활성 조건 | 동작 |
|---|---|---|
| [최신 결과 보기] | 지난 실행을 볼 때만 | 최신으로 이동 |
| [구매요청 자동 초안 준비 중 (P2)] | 항상 비활성 | 없음 |
| [구매요청 목록] | canView(PURCHASE_REQUISITION_CREATE, PO_CONFIRM) | `/purchase-requisitions` |
| [MRP 실행] / '계산 중…' | canUse(PURCHASE_REQUISITION_CREATE **또는 PLAN_CONFIRM**). 권한 없으면 자물쇠 + '권한이 필요해요' | `POST /mrp-runs`, 토스트 '{mrpRunNo} 계산을 끝냈어요', mrp-runs 무효화 (:18, 28-37) |

- 정보 줄: '{일시} ({상대시간}) · 실행 {이름 (사번)}' · '잔량·입고예정은 실행 시점 값이에요. 진행 중인 구매요청·발주는 지금 기준으로 다시 확인해요' (:169-174)
- KPI 4개 (:176-208)

| KPI | 큰 숫자 | 보조 문구 |
|---|---|---|
| 남은 히트 | N 히트 | '생산계획 N건 · 편성 전 N건 예상 포함' |
| 히트 톤 | X t | '합금철 소요의 기준' |
| 만들어야 할 용선 | X t | '필요 용선 X (÷ 제강 수율) − 용선 잔량 Y' |
| 원료·합금철 소요 | N종 + '순소요 N종' | 원료별 순소요 목록 또는 '모든 원료가 잔량·입고예정으로 충분해요' |

**카드 '원료·합금철 소요량'** (세그먼트 [전체 | 순소요만])
- 표 헤더: 원료코드 | 원료명 | 총소요 | 원료 LOT 잔량 | 입고예정 | 순소요 | 필요일 | 기여 계획 | 진행 중인 요청·발주 · 조치 (:225-233)
- '진행 중인 요청·발주 · 조치' 칸에 보이는 것 (:254-283)
  - 진행 중 구매요청: 번호 링크 + 상태 배지 + 미발주 톤
  - 진행 중 발주: '입고예정' + 발주번호 링크(`/purchase-orders?po=`) + '{미입고} · 납기 MM-DD'
  - 순소요가 요청·발주로 모두 덮였으면: 배지 '요청·발주로 덮였어요'
  - 아니면: [구매요청 만들기] (canUse PURCHASE_REQUISITION_CREATE)
- 빈 상태: '이번 실행에서 순소요가 있는 원료가 없어요' / '계산된 원료가 없어요'
- 하단: '… (0보다 작으면 0) · … · 잔량·입고예정은 계획마다가 아니라 합계에서 한 번만 빼요' + '아직 요청하지 않은 순소요 N종' (:293-298)

**카드 '근거 생산계획'** (+[생산계획 >])
- 헤더: 계획번호 | 강종 · 규격 | 수주 | 납기 | 남은 히트 | 히트 톤 | 필요 용선
- PLANNED 계획은 '편성 전 · 예상', 수주가 없으면 '연결 없음', 맨 아래 합계 행.
- 빈 상태: '남은 히트가 있는 생산계획이 없었어요' (:302-342)

**카드 '{원료명} 계획별 소요'**
- 헤더: 계획번호 | 수주 | 납기 | 히트 | 소요
- 키·값: 총소요 / 잔량 · 입고예정 / 순소요 / 진행 중 구매요청 / 실행 뒤 발주 / 새로 요청할 양 (:343-384)

**[구매요청 만들기]가 여는 등록 모달** (sourceType='MRP', :137-145, 387)
- 품목: [그 원료, 아직 요청 안 된 양(uncoveredTon)]
- 희망 입고일: 필요일이 오늘 이후면 필요일, 지났으면 빈칸
- 요청 사유: '{mrpRunNo} {원료} 순소요 {t} · 필요일 {날짜}'

### A-2. 구매요청 목록 — `/purchase-requisitions` (PurchaseRequisitionListPage.tsx)

**제목과 진입**
- 상단 제목: '구매요청' (`titles.ts:13`).
- 메뉴: 구매·생산 역할의 '구매요청'(PURCHASE_REQUISITION_CREATE). `/purchase-requisitions/`와 `/action-drafts/` 주소에서도 이 메뉴가 강조됩니다(`nav.ts:31, 40`).

**왼쪽 목록**
- 헤더: '구매요청' + 'n / 전체' + [구매요청 등록] (:53-58)
  - 활성 조건: canUse PURCHASE_REQUISITION_CREATE
  - 툴팁: '원료·톤·희망 입고일을 입력해 등록해요' / '권한이 필요해요'
- 검색: '요청번호·원료·요청자 검색' (화면 안에서만 거름)
- 상태 칩: 전체 | 작성 중 | 승인 대기 | 승인 | 발주 완료 | 반려 (:15, 64-69)
- 체크박스 '내 요청만 보기' → `?mine=true`
- '확인 대기 초안 · N' 구역 (:76-95)
  - 대상: 내가 요청자인 WAITING_APPROVAL 초안
  - 각 줄: '{actionTypeLabel} 초안', 방 이름 또는 '원본 메시지 없음', 상대 시간, “메시지 내용”
  - 상태 문구: '{필드명들} 입력 필요' 또는 '값을 확인하고 확정해 주세요'
  - 안내: '메신저 메시지에서 만든 초안이에요. 내가 확정해야 구매요청이 생겨요.'
  - 클릭 → `/action-drafts/:id`
- 요청 항목 (:97-124)
  - 요청번호, 상태 배지
  - '원료 X t 외 N종', '희망 MM-DD'
  - 요청자, '· 합계 X t', 출처 태그
  - 상태별 줄 문구

| 상태 | 문구 |
|---|---|
| DRAFT | '제출 전' |
| 승인 대기 | '승인권자 {이름} · 승인 대기' |
| 승인 | '승인 {이름} {MM-DD} · 발주 대기' |
| 반려 | '반려 · {이름} · 수정 필요' |
| 발주 완료 | '승인 {이름} · 발주 완료' |

  - 동작: 클릭하면 `?pr=` 선택, 더블클릭하면 상세 화면
- 빈 상태: '조건에 맞는 구매요청이 없어요' / '내가 등록한 구매요청이 없어요' / '등록된 구매요청이 없어요'
- 하단 '출처별' 막대: 직접/MRP/메신저 건수, 누르면 그 출처만 거릅니다. 색상은 하드코딩(:127-141).

**오른쪽**
- 선택한 요청이 없을 때: '조건에 맞는 구매요청이 없어요' 또는 '구매요청이 없어요' + 'MRP 결과의 순소요를 보고 등록하거나, 메신저 메시지에서 초안을 만들 수 있어요' + [MRP 결과 보기] (:148-153)
- 선택했을 때: RequisitionPanel(경로 '구매요청 > 번호', [상세 열기 >])
- 등록 모달: 출처 DIRECT (:168)

### A-3. 구매요청 상세 — `/purchase-requisitions/:id` (PurchaseRequisitionDetailPage.tsx)

- 상단 제목: '구매요청 상세'. 불러온 뒤에는 '구매요청 · {번호}' + 요청자 이름(:15).
- 잘못된 id: '구매요청을 찾을 수 없어요' + [구매요청 목록]
- 경로 표시 (:34)
  - 목록 조회 권한(PURCHASE_REQUISITION_CREATE·PO_CONFIRM VIEW)이 있으면 '구매요청' 링크
  - 없고 부서장이면 '승인함' 링크
  - 둘 다 아니면 링크 없는 텍스트
- 헤더 버튼: [승인함](승인권자가 나일 때), [목록](목록 권한이 있을 때) (:41-42)
- 본문: RequisitionPanel

### A-4. RequisitionPanel (목록 미리보기·상세·승인함이 같이 씀)

**헤더**
- 번호, '원료명' 또는 '원료 N종' + 합계 톤, 상태 배지
- [원본 메시지]: 메신저에서 온 요청일 때
- [발주 만들기] → `/purchase-orders?pr=` (:69-75)
  - 표시 조건: APPROVED이고 아직 발주 안 된 양이 남았을 때
  - canUse PO_CONFIRM이 없으면 비활성 + '권한이 필요해요'

**'진행 단계'** (:49-54)

| 상태 | 설명 문구 |
|---|---|
| DRAFT | '…작성 중 · 제출하면 부서장 승인으로 넘어가요' |
| 승인 대기 | '{승인권자} 승인 대기 · 승인되면 구매 담당이 발주해요' |
| 승인 | '… 승인 {일시} · 발주 대기' |
| 발주 완료 | '발주 완료 · {발주번호들}' |
| 반려 | '… 반려 {일시} · 요청자가 고친 뒤 다시 제출할 수 있어요' |

**배너**
- 제출 실패: PUR-001이면 '승인권자가 없어 제출하지 못했어요', 그 외 '제출하지 못했어요' + 서버 메시지
- 반려: '반려 사유 · {사유 또는 '사유가 기록되지 않았어요'}' (:89-106)

**카드 '요청 내용'** (메타 '{출처} · {일시} 등록')
- 표: # | 원료 | 요청 | 발주 누계 | 미발주 + 합계
- 키·값 (:136-158)
  - 희망 입고일
  - 요청자: '이름 직급 · 부서'
  - 승인권자: '… 부서장' 또는 '제출하면 소속 부서의 부서장으로 정해져요'
  - 요청 사유
  - 승인 경로: '{요청자} 제출 > {승인권자} 승인 > 구매 발주'

**카드 '원본 메시지' 또는 '출처'** (:163-198)
- 메신저 출처
  - 원본 메시지 상자: '{방} · {보낸 사람 (부서)} · 일시', “내용”, [원본 메시지로 이동], [초안 보기]
  - 'Message → ERP 초안 {초안 상태} 요청자 확정 {일시}'
  - 원본이 없으면 '…원본 메시지를 불러올 수 없어요'
- MRP 출처: 'MRP 결과의 순소요를 보고 등록한 요청이에요 · MRP 결과'
- 직접 등록: '요청자가 직접 등록한 요청이에요'

**카드 '연결 발주'**
- 표시 조건: canView(PO_CONFIRM, RECEIPT_CONFIRM, PURCHASE_REQUISITION_CREATE)
- 표: 발주번호 | 원료 | 공급업체 | 발주 | 입고 | 납기 | 상태
- 빈 상태: '아직 발주하지 않았어요. 구매 담당이 발주 화면에서 발주해요' / '승인된 뒤에 발주할 수 있어요' (:200-234)

**동작 영역** (:238-285)
- 요청자이고 상태가 DRAFT·REJECTED일 때
  - [수정]: 등록·수정 모달을 엽니다.
  - [제출 → 부서장 승인 요청] 또는 [다시 제출]: `POST /purchase-requisitions/:id/submit`, 토스트 '제출했어요. {승인권자|부서장} 승인을 기다려요'
  - 두 버튼 모두 canUse PURCHASE_REQUISITION_CREATE가 필요합니다.
- 승인권자가 나이고 상태가 승인 대기일 때
  - 안내 '승인권자(부서장)로 지정돼 있어요 · 요청자 {이름} 제출 {일시}'
  - [반려]를 누르면 사유 입력 칸이 열립니다.
    - 안내 문구: '반려 사유 (요청자에게 전달돼요)'
    - 1~500자 필수, 비어 있으면 '반려하려면 사유를 입력해 주세요'
    - [취소] / [반려 확정] → `POST /:id/reject {rejectReason}`, 토스트 '반려했어요. 요청자에게 사유가 전달돼요'
  - [승인] → `POST /:id/approve`, 토스트 '승인했어요. 구매 담당이 발주할 수 있어요'
  - 승인·반려에는 권한 코드 검사가 없습니다. 승인권자인지만 봅니다.
- 그 외 잠금 안내
  - '수정·제출은 요청자(…)만 할 수 있어요'
  - '승인·반려는 승인권자(…)만 할 수 있어요'
  - '승인된 구매요청만 발주할 수 있어요 · 구매 담당 발주 대기'
  - '발주까지 끝난 요청이에요'
- 무효화 대상: purchase-requisitions, purchase-orders, mrp-runs

### A-5. 구매요청 등록·수정 모달 (RequisitionFormModal.tsx)

- 제목: '구매요청 등록' / '구매요청 수정 · {번호}'
- 배너
  - 서버 오류: PUR-001이면 '승인권자가 없어 제출하지 못했어요', 그 외 '저장하지 못했어요'
  - MRP에서 열었을 때: 'MRP 결과의 순소요로 채웠어요. 수량과 희망 입고일을 확인한 뒤 저장해 주세요. 출처는 MRP로 기록돼요.'
- 원료 목록 상태: '원료 목록을 불러오는 중…' / '원료 목록을 불러오지 못했어요. {메시지}'

**입력 항목**

| 항목 | 입력 방식 | 검사·오류 | 힌트 |
|---|---|---|---|
| 원료 품목 · 수량(톤)* (행 반복) | 원료 선택('원료를 골라 주세요', '{원료명} · {코드}') + 톤(placeholder '0.000', t) + [x] + [품목 추가](원료 수까지) | '원료를 골라 주세요' / '같은 원료가 두 번 들어 있어요' / 톤 오류 | '기본 공급업체 {이름}' / '기본 공급업체가 지정되지 않았어요' |
| 희망 입고일* | DateInput, 오늘부터 | '희망 입고일을 입력해 주세요' / '오늘 이후 날짜로 입력해 주세요'(오늘은 허용) | '오늘 이후 날짜만 받아요' |
| 요청 사유 | textarea, '어디에 쓰는지, 왜 필요한지 적어 주세요 (선택)' | '500자까지 쓸 수 있어요' | 'n / 500자' |

**하단과 API** (:41-50, 67-101)
- 안내: '제출하면 소속 부서의 부서장에게 승인 요청이 가요'
- 버튼: [취소], [작성 중으로 저장] 또는 [저장], [제출] 또는 [저장하고 제출]
- 등록: `POST /purchase-requisitions`
  - 토스트: '{번호} 을(를) 제출했어요. {승인권자} 승인을 기다려요' 또는 '{번호} 을(를) 작성 중으로 저장했어요'
- 수정: `PATCH /purchase-requisitions/:id`, 제출까지 누르면 이어서 `POST /:id/submit`
  - 수정 쪽은 성공 토스트가 없습니다.
- 무효화 대상: purchase-requisitions, mrp-runs

### A-6. 승인함 — `/approvals` (ApprovalPage.tsx)

**제목과 진입**
- 상단 제목: '승인함' / '부서장'
- 메뉴: 역할과 상관없이 부서장(`headDepartmentIds`가 있는 사람)에게만 '승인함'(배지)과 'Agent(P2)'가 보입니다(`nav.ts:65-70`).

**왼쪽**
- 헤더: '승인 대기' + 전체 건수
- 칩
  - [구매요청 N]
  - [Agent 대응 후보 준비 중 (P2)]: 항상 비활성
  - [처리 완료]: 부서장이 아니면 비활성 (:66-76)
- 그룹 제목: '구매요청' / '처리 완료 (최근 30건)'
- 항목: 번호, 상태 배지, 품목 요약, 요청자, 출처 태그
  - 승인 대기: '{부서} · 제출 {M/D HH:mm}' + '희망 MM-DD'
  - 처리 완료: '반려 MM-DD' / '승인 MM-DD'
- 빈 상태·오류 (:82-88)
  - '승인 대기 구매요청이 없어요'
  - '처리 내역은 구매요청 조회 권한이 있어야 볼 수 있어요'
  - '처리 내역을 불러오지 못했어요'
  - '내가 승인·반려한 구매요청이 없어요'
- Agent 안내 (:91-92): 'AI Factory Agent가 만든 대응 후보(구매요청 초안·재생산 계획 등)를 부서장이 승인하는 기능은 준비 중이에요.'
- 하단 안내 (:98): '승인 요청은 요청자 소속 부서의 부서장에게 가요. 요청자가 부서장이면 상위 부서의 부서장에게 가요.'

**오른쪽**
- 부서장이 아니면: '승인할 항목이 없어요' + '…{이름}님은 부서장으로 지정돼 있지 않아요.' + [구매요청 목록]
- 선택한 항목이 없으면: '승인할 항목이 없어요'('{부서} 부서장으로 지정돼 있어요. 부서원이 구매요청을 제출하면 여기에 올라와요') 또는 '처리 내역이 없어요'
- 선택했을 때: RequisitionPanel(경로 '승인함 > 번호', [다음 {번호}], [요청서 보기])

**'처리 완료' 목록을 만드는 방법** (:25-35)
- 구매요청 전체 목록을 불러와 승인권자가 나이고 상태가 APPROVED/ORDERED/REJECTED인 것을 골라, 승인·반려 시각 최신순으로 30건만 보여 줍니다. 화면 안에서 계산합니다.

### A-7. 발주 — `/purchase-orders` (PurchaseOrderPage.tsx)

**제목과 진입**
- 상단 제목: '발주'
- 메뉴: 구매 역할(PO_CONFIRM)
- 주소 파라미터: `?po`, `?supplier`, `?pr`

**왼쪽**
- 헤더: '발주' + 건수 + [입고]
- 상태 칩: 전체 | 발주 확정 | 부분 입고 | 입고 완료
- '발주할 구매요청 (승인됨)' + 품목 수
  - 권한 없음: '발주 권한이 있어야 발주할 구매요청을 볼 수 있어요'
  - 오류: '발주할 구매요청을 불러오지 못했어요'
  - 공급업체 그룹 항목: 공급업체명 또는 '기본 공급업체 없음', '발주 대기 N', 원료명 목록, 미발주 합계
  - 빈 상태: '발주를 기다리는 승인 요청이 없어요'
- '발주 내역'
  - 항목: 번호, 상태 배지, 공급업체 · 원료명 또는 '원료 N종', '납기 MM-DD', '입고' 진행 막대 'X / Y t'
  - 빈 상태: '조건에 맞는 발주가 없어요' / '아직 발주가 없어요'
- 하단 안내: '승인된 구매요청만 발주할 수 있어요. 공급업체 1곳당 발주 1건에 여러 품목을 묶어요.'

**오른쪽 빈 상태**
- '발주할 품목이 남아 있지 않아요' 또는 '발주할 구매요청도, 발주 내역도 없어요'
- 안내 '…부서장 승인을 받으면 여기에 올라와요' + [구매요청 목록]

**발주 작성 (OrderForm, :134-278)**
- 헤더: 공급업체 + '발주 대기', '{공급업체코드} · 승인된 구매요청 품목 N건 · 미발주 X t'
- 배너: '…아래에서 고른 품목이 {공급업체} 앞 발주 1건으로 묶여요. 발주는 만들면 바로 확정되고 입고예정에 반영돼요.'
- 카드 '신규 발주 · {공급업체 | 공급업체 선택}' + 'n / m개 품목 선택'
- 표: [전체 선택] | 구매요청(링크 + #줄) | 원료 | 희망 입고일 | 요청 | 발주 누계 | 남은 수량 | 발주 톤
  - 발주 톤: 입력, 기본값과 최댓값 모두 남은 수량
  - `?pr=`로 들어오면 그 요청의 품목만 미리 선택됩니다.
- 공급업체*
  - 기본 공급업체가 있으면 읽기 전용 + '원료의 기본 공급업체예요'
  - 없으면 선택 칸('공급업체를 골라 주세요') + '이 원료들은 기본 공급업체가 지정되지 않았어요'
  - 고르지 않고 확정하면 빨간 테두리만 생기고 오류 문구는 없습니다.
- 납기*
  - DateInput, 오늘부터. 기본값은 가장 이른 희망 입고일(오늘 이후일 때만)
  - 오류: '납기를 입력해 주세요' / '오늘 이후 날짜로 입력해 주세요'
  - 힌트: '가장 이른 희망 입고일 {날짜}'
- 하단
  - '발주할 품목을 하나 이상 골라 주세요' 또는 '발주 톤은 남은 수량 이하로 나눠 발주할 수 있어요. 남은 수량은 다음 발주로 넘어가요'
  - 권한 없음: '발주 확정 권한이 필요해요'
- [발주 확정] (canUse PO_CONFIRM)
  - `POST /purchase-orders`
  - 토스트: '{발주번호} 발주를 확정했어요. 입고예정에 반영돼요'
  - 무효화: purchase-orders, purchase-requisitions, mrp-runs

**발주 상세 (OrderDetail, :280-390)**
- 헤더: 번호, 공급업체, 상태 배지, '{코드} · 발주 확정 {일시} · 납기 {날짜} · 품목 N개'
- [입고 처리] 또는 [입고 내역] → `/goods-receipts?po=` (canView RECEIPT_CONFIRM·PO_CONFIRM)
- KPI: 발주 / 입고 누계 X t · p% / 미입고 (입고예정)
- 카드 '발주 품목'
  - 표: # | 원료 | 발주 | 입고 | 미입고 | 진행 | 연결 구매요청 | (빈 헤더) + 합계
  - 빈 헤더 칸: [입고 등록] → `?po=&item=` 또는 '입고 완료'
- 카드 '입고 내역'('입고를 확정하면 원료 LOT이 만들어져요', [입고 화면 >])
  - 표: 입고번호 | 원료 | 입고일 | 수량 | 야드 | 원료 LOT | 상태
  - 원료 LOT: `/lots/trace?lot=` 링크 또는 '확정하면 만들어져요'
  - DRAFT 행은 흐리게 표시
  - 빈 상태: '아직 입고가 없어요'

### A-8. 입고 — `/goods-receipts` (GoodsReceiptPage.tsx)

**제목과 진입**
- 상단 제목: '입고'
- 메뉴: 구매 역할(RECEIPT_CONFIRM). 물류는 VIEW 권한이 있지만 메뉴에는 없습니다.
- 주소 파라미터: `?po`, `?item`

**왼쪽**
- 헤더: '입고 예정' + 건수 + [발주]
- 검색: '발주번호·원료·공급업체 검색'
- 칩: [예정 N] [전체 N]
- 발주 품목 단위 항목, 납기순 (:69-93)
  - '{발주번호} #{줄}', 상태 배지(미입고가 남았으면 발주 상태, 다 들어왔으면 '입고 완료')
  - 원료 · 공급업체
  - '납기 MM-DD'(지났으면 빨간색)
  - '미입고 X t' 진행률
  - '입고 초안 N건 · 확정 대기'
- 빈 상태: '입고 예정인 발주가 없어요' / '발주가 없어요'
- '최근 입고 확정' 5건: 입고번호 + 배지, 원료 · 공급업체, 입고일, LOT 링크, 톤
  - 빈 상태: '확정된 입고가 없어요'
- 하단 안내: '입고 확정 = 원료 LOT 생성. 입고 검사는 하지 않아요 (범위 제외).'

**오른쪽**
- 빈 상태: '입고할 발주가 없어요' / '발주를 확정하면 미입고량이 여기에 올라와요' + [발주 화면](canView PO_CONFIRM)
- 입고 작업(ReceiptWork, :141-384)
  - 헤더: [< 발주], 발주번호, '원료 · 공급업체', '납기 MM-DD', 발주 상태 배지, [LOT 추적]
  - KPI: 발주 / 입고 누계 (확정) / 이번 입고 / 미입고(+'입고 완료')
    - 이번 입고: 톤 입력, 기본값은 미입고량
    - 오류는 톤 오류 또는 서버 메시지, 힌트 '미입고량 이하 · 나눠서 입고할 수 있어요'

**카드 '입고 등록'**('초안으로 저장돼요')

| 항목 | 입력 방식 | 검사·오류 | 힌트 |
|---|---|---|---|
| 입고일* | DateInput, 기본 오늘 | '입고일을 입력해 주세요' / 미래 날짜면 '오늘 이전 날짜로 입력해 주세요' | '오늘 또는 지난 날짜' |
| 원료 야드 | 선택. 첫 옵션 '기본 야드 ({이름})' 또는 '원료의 기본 야드', 원료 야드 목록 | 없음 | '고르지 않으면 원료의 기본 야드로 들어가요' |
| 비고 | input '메모 (선택)' | '500자까지 쓸 수 있어요' | 없음 |

- 하단 안내: '입고 등록 → 입고 확정 순서예요. 재고·LOT은 확정할 때만 바뀌어요'
- [입고 등록] (canUse RECEIPT_CONFIRM이고 미입고가 남았을 때)
  - `POST /goods-receipts`
  - 토스트: '{입고번호} 입고 초안을 만들었어요. 입고 확정을 눌러야 재고에 반영돼요'

**오른쪽 카드**
- 방금 확정했을 때: '입고 확정 완료'
  - 입고번호, '원료 LOT 생성됨' + LOT 번호
  - '{원료} {초기톤} · {야드 또는 야드 미지정} · 잔량 X'
  - '발주 품목 입고 누계 X · 미입고 Y'
  - [LOT 추적에서 보기]
- 그 외: '원료 LOT'('확정 시 생성')
  - 번호 형식 미리보기 'RM-{원료코드}-YYMMDD-NNN'
  - '번호는 입고를 확정할 때 서버가 매겨요 · 입고 1건마다 LOT 1개'

**카드 '입고 내역'** [이 발주 품목 | 전체]
- 표: 입고번호 | 발주번호 | 원료(+비고) | 입고일 | 수량 | 야드 | 원료 LOT | 상태 | (동작 칸)
- 동작 칸
  - DRAFT 행: [입고 확정] (canUse RECEIPT_CONFIRM)
    - `POST /goods-receipts/:id/confirm`
    - 토스트: '입고를 확정했어요. 원료 LOT {번호} 이(가) 만들어졌어요'
  - 확정된 행: 확정 시각
- 확정 실패 배너: '입고를 확정하지 못했어요' + 서버 메시지
- 빈 상태·오류: '이 발주 품목의 입고가 아직 없어요' / '입고 내역이 없어요' / '입고 내역을 불러오지 못했어요'
- 하단: '초안을 여러 개 만들어 합계가 미입고량을 넘으면, 넘는 초안은 확정할 때 거부돼요…'
- 무효화 대상: goods-receipts, purchase-orders, mrp-runs, lots, inventories

### A-9. 구매요청 초안 (Message → ERP) — `/action-drafts/:id` (ActionDraftPage.tsx)

**제목과 진입**
- 상단 제목: '구매요청 초안' / 영역 '메신저 → ERP' (`titles.ts:14`). 불러온 뒤에는 '{actionTypeLabel} 초안' + 요청자.
- 전용 메뉴는 없습니다. 이 화면에서는 구매·생산의 '구매요청' 메뉴가 강조됩니다.
- 들어오는 길
  - 메신저: 텍스트 메시지 위에 [구매요청 초안 만들기] 또는 [초안 보기]
    - 표시 조건: 텍스트 메시지 + canUse PURCHASE_REQUISITION_CREATE (`ChatParts.tsx:144-157`)
    - 만들기: `POST /messages/:id/action-drafts {actionType:'PURCHASE_REQUISITION_CREATE'}` 후 이 화면으로 이동 (`MessengerPage.tsx:282-285, 429`)
  - 메신저 메시지 아래 '구매요청 초안 보기 →': 권한과 상관없이 보입니다.
  - 구매요청 목록의 '확인 대기 초안'
  - RequisitionPanel의 [초안 보기]
- 잘못된 id: '초안을 찾을 수 없어요'

**헤더**
- 경로: '메신저' 또는 '구매요청' > '{라벨} 초안'
- 'Message → ERP · {일시} 생성' + 초안 상태 배지
- 버튼: [구매요청 목록], [원본 메시지로 이동]

**흐름 카드**
- 초안 흐름 + '{요청자} 확정 > 구매요청 생성 > 부서장 승인 > 구매 발주'

**배너**

| 상황 | 문구 |
|---|---|
| ERP 반영됨 | '구매요청 {번호} 을(를) 만들었어요' + 구매요청 상태 배지 + '이제 부서장 승인을 기다려요. 초안 확정과 구매요청 승인은 따로예요.' + [구매요청 보기] |
| 반려됨 | '반려된 초안이에요 · {사유}' + '… · 구매요청은 만들어지지 않았어요' |
| 확정 후 구매요청 생성 실패 (APPROVED + 실행 결과 실패) | PUR-001이면 '승인권자가 없어 구매요청을 만들지 못했어요', 그 외 '확정했지만 구매요청을 만들지 못했어요' + '시도 N회 · 마지막 … · 원인을 고친 뒤 다시 실행할 수 있어요' |
| 확정 오류 | ACT-001이면 '아직 확정할 수 없어요', PUR-001이면 '승인권자가…', 그 외 '확정하지 못했어요' |

**초안 카드**
- 머리글: '값을 입력하고 확정해 주세요' 또는 '초안 내용' + '준비 중'(등급 표기 없음) + 'AI 자동 추출은 준비 중이에요. 값을 직접 입력해 주세요.'
- 표 헤더: 항목 | 값 | 기준

| 항목 | 값 | 기준 열 문구 |
|---|---|---|
| 원료 품목* | 선택('원료를 골라 주세요', '{원료명} · {코드}', '원료 #id (사용 중지)'). 읽기 전용이면 '입력되지 않았어요' | '기본 공급업체 {이름}' / '기본 공급업체 미지정' / '기준정보에 등록된 원료' |
| 수량(톤)* | 입력(placeholder '0.000', t) | '0보다 큰 톤 · 소수 3자리까지' |
| 희망 입고일* | DateInput, 오늘부터. 과거면 '오늘 이후 날짜로 입력해 주세요' | '오늘 이후 날짜' |
| 요청자 | 읽기 전용 '{이름 직급} · {부서}' | '메시지 작성자 · 바꿀 수 없어요' |
| 요청 사유 | textarea, 500자 | '500자 이하 · 선택' |

- 항목 이름은 서버가 준 `fieldLabels`를 먼저 씁니다.
- 빈 필수값 강조('{라벨}을(를) 골라/입력해 주세요')는 서버가 준 `unresolvedFields`를 쓰고, 확정을 눌러 ACT-001 응답을 받은 뒤에만 켭니다.

**동작**
- 요청자이고 상태가 WAITING_APPROVAL일 때
  - [반려]: '반려 사유 (필수)' 입력(1~500자) + [취소] + [반려 확정] → `POST /action-drafts/:id/reject`, 토스트 '초안을 반려했어요'
  - 저장 상태 문구: '저장하지 않은 수정이 있어요' / '마지막 저장 {일시}'
  - [저장] (바뀐 값이 있고 입력이 맞을 때) → `PATCH /action-drafts/:id {payload}`. 토스트는 없습니다.
  - [확정하고 구매요청 만들기] (입력이 맞고 canUse PURCHASE_REQUISITION_CREATE)
    - 바뀐 값이 있으면 PATCH부터 하고, 이어서 `POST /action-drafts/:id/confirm`
    - 토스트: '구매요청 {번호} 을(를) 만들었어요. 부서장 승인을 기다려요'
- 확정은 됐지만 구매요청 생성이 실패한 초안을 요청자가 볼 때
  - [반려] (위와 같음)
  - '확정된 값은 바꿀 수 없어요'
  - [구매요청 만들기 다시 실행] (canUse PURCHASE_REQUISITION_CREATE) → `POST /:id/confirm`
- 그 외 잠금 안내 (:328-334)
  - WAITING_APPROVAL·AI_GENERATED: '수정·확정·반려는 요청자(…)만 할 수 있어요…'
  - APPROVED: '…확정했어요 · 구매요청 생성 대기'
  - EXECUTED: '확정 … · ERP 반영 … · 더 고칠 수 없어요'
  - REJECTED: '반려된 초안이라 더 고칠 수 없어요'
- 무효화 대상: action-drafts, purchase-requisitions

**오른쪽 카드**
- '원본 메시지': 메시지 상자 또는 '원본 메시지를 불러올 수 없어요', 안내 '메시지를 보면서 왼쪽 값을 직접 입력해 주세요.'
- '확정하면'
  - [확정] '입력한 값으로 구매요청이 만들어져요 (출처: 메신저)'
  - [ERP 반영] 만들어진 구매요청 번호
  - [승인 대기] '요청자 소속 부서의 부서장이 승인해야 발주할 수 있어요'
  - '확정 뒤에는 초안을 고칠 수 없어요. 구매요청이 반려되면 구매요청 화면에서 고쳐 다시 제출해요.'

---

## B. API 의존성 (목업 데이터 계층용)

**공통 규칙**
- 기본 주소: `/api/v1`
- 성공 응답: `{success:true, data}` / 실패 응답: `{success:false, error:{code, message}}`
- 인증: `Authorization: Bearer`. 토큰은 sessionStorage에 있습니다.
- POST에 본문이 없으면 `{}`를 보냅니다.
- 톤 값은 모두 문자열(Decimal)입니다.
- 클라이언트에서만 쓰는 오류 코드: `NETWORK`, `COM-999` (`api/client.ts:40, 49`)

**공통 타입** (`api/purchasing.ts:5-14`)
- `EmployeeBrief {id, employeeNo, employeeName, jobGrade, department{id, departmentName}}`
- `RawMaterialBrief {id, materialCode, rawMaterialType: string, itemName}`
- `SupplierBrief {id, supplierCode, supplierName}`
- `YardBrief {id, yardCode, yardName}`

### B-1. api/purchasing.ts

| 함수 | 메서드·경로 | 요청 | 응답 | 쓰는 화면 |
|---|---|---|---|---|
| purchaseRequisitionApi.list | GET /purchase-requisitions?status&mine=true&toApprove=true | 화면은 mine만 사용 | PurchaseRequisitionListItem[] | 목록, 승인함 처리 완료 |
| .get | GET /purchase-requisitions/:id | | PurchaseRequisitionDetail | 목록, 상세, 승인함 |
| .create | POST /purchase-requisitions | {items:[{rawMaterialId, requiredTon}], desiredReceiptDate, requestReason?, sourceType?:'DIRECT'\|'MRP', submit?} | Detail | 등록·수정 모달 |
| .update | PATCH /purchase-requisitions/:id | {items?, desiredReceiptDate?, requestReason?} | Detail | 등록·수정 모달 |
| .submit | POST /purchase-requisitions/:id/submit | {} | Detail | 모달, RequisitionPanel |
| .approve | POST /purchase-requisitions/:id/approve | {} | Detail | RequisitionPanel |
| .reject | POST /purchase-requisitions/:id/reject | {rejectReason} | Detail | RequisitionPanel |
| approvalApi.mine | GET /approvals | | {purchaseRequisitions: ListItem[], counts{purchaseRequisition, total}} | 승인함, 셸 배지 |
| purchaseOrderApi.list | GET /purchase-orders?status&supplierId | 화면은 파라미터 없이 호출 | PurchaseOrderListItem[] | 발주, 입고 |
| .orderable | GET /purchase-orders/orderable | | OrderableGroup[] | 발주 |
| .get | GET /purchase-orders/:id | | PurchaseOrderDetail | 발주 |
| .create | POST /purchase-orders | {supplierId, dueDate, items:[{purchaseRequisitionItemId, orderedTon}]} | Detail | 발주 |
| goodsReceiptApi.list | GET /goods-receipts?status&purchaseOrderId | 파라미터 없이 호출 | GoodsReceiptView[] | 입고 |
| .create | POST /goods-receipts | {purchaseOrderItemId, receivedTon, receiptDate, yardId?, note?} | View | 입고 |
| .confirm | POST /goods-receipts/:id/confirm | {} | View | 입고 |
| purchasingLookupApi.get | GET /master-data/lookups | | {rawMaterials[{id, materialCode, name, rawMaterialType, defaultSupplierId\|null, yardId\|null}], suppliers: SupplierBrief[], yards[{id, yardCode, yardName, yardType}]} | 모달, 초안, 발주, 입고 |

**응답 타입 필드**
- `PurchaseRequisitionItemView`: `{id, lineNo, rawMaterial, requiredTon, orderedTon, unorderedTon}`
- `PurchaseRequisitionListItem`:
  - 식별·관계: `id, purchaseRequisitionNo, requesterId, departmentId, approverId|null`
  - 상태·내용: `purchaseRequisitionStatus, desiredReceiptDate|null, requestReason|null, rejectReason|null, sourceType, sourceDraftId|null`
  - 시각: `submittedAt, approvedAt, rejectedAt (모두 |null), createdAt, updatedAt`
  - 함께 오는 값: `requester, approver|null, department{id, departmentName}, totalRequiredTon, items[]`
- `PurchaseRequisitionDetail`: ListItem에 아래가 더해집니다.
  - `items[]`마다 `purchaseOrderItems[{id, purchaseOrderId, purchaseOrderNo, purchaseOrderStatus, supplier, dueDate|null, orderedTon, receivedTon}]`
  - `sourceDraft{id, actionType, draftStatus, confirmedAt, executedAt, message{id, content, createdAt, sender|null, chatRoom{id, chatRoomType, chatRoomName|null}}|null}|null`
- `PurchaseOrderItemView`: `{id, lineNo, rawMaterial, purchaseRequisitionItemId|null, orderedTon, receivedTon, outstandingTon}`
- `PurchaseOrderListItem`: `{id, purchaseOrderNo, supplierId, purchaseOrderStatus, dueDate|null, orderedEmployeeId|null, confirmedAt|null, createdAt, updatedAt, supplier, totalOrderedTon, totalReceivedTon, totalOutstandingTon, items[]}`
- `PurchaseOrderDetail`: items마다 아래가 더해집니다.
  - `purchaseRequisition{id, purchaseRequisitionNo, lineNo}|null`
  - `goodsReceipts[{id, goodsReceiptNo, goodsReceiptStatus, receivedTon, receiptDate, confirmedAt|null, yard|null, lot{id, lotNo, remainingTon}|null}]`
- `OrderableGroup`: `{supplier|null, items[{purchaseRequisitionItemId, purchaseRequisitionId, purchaseRequisitionNo, desiredReceiptDate|null, lineNo, rawMaterial, requiredTon, orderedTon, unorderedTon}], totalUnorderedTon}`
- `GoodsReceiptView`:
  - 기본: `id, goodsReceiptNo, purchaseOrderItemId, receivedTon, receiptDate, yardId|null, goodsReceiptStatus, note|null`
  - 확정·시각: `confirmedEmployeeId|null, confirmedAt|null, createdAt, updatedAt`
  - 함께 오는 값: `yard|null, lot{id, lotNo, initialTon, remainingTon}|null, rawMaterial`
  - 발주 정보: `purchaseOrder{id, purchaseOrderNo, purchaseOrderStatus, supplier}, purchaseOrderItem{id, lineNo, orderedTon, receivedTon, outstandingTon}`

### B-2. api/mrp.ts

**함수**
- `mrpApi.latest`: GET /mrp-runs/latest → `MrpRunDetail | null`
- `mrpApi.list`: GET /mrp-runs → `MrpRunListItem[]` (화면 안내상 최대 50건)
- `mrpApi.get`: GET /mrp-runs/:id → `MrpRunDetail`
- `mrpApi.run`: POST /mrp-runs → `MrpRunDetail`

**타입**
- `MrpRunListItem`: `{id, mrpRunNo, createdAt, runEmployee{id, employeeNo, employeeName}|null, heatCount, heatTon, hotMetalTon, shortageCount, totalNetRequiredTon}`
- `MrpRunDetail`: `{id, mrpRunNo, createdAt, runEmployee|null, heatCount, heatTon, requiredHotMetalTon|null, hotMetalRemainingTon|null, hotMetalTon, plans[], requirements[]}`
- `MrpPlanView`: `{productionPlanId, productionPlanNo, productionPlanStatus: string, steelGradeId, steelGradeCode, specCode, itemType:'SLAB'|'COIL', salesOrderId|null, salesOrderNo|null, dueDate|null, heatCount, heatTon, hotMetalTon}`
- `MrpRequirementView`: `{id, rawMaterial{id, materialCode, rawMaterialType, itemName}, requiredTon, remainingTon, scheduledReceiptTon, netRequiredTon, requiredDate|null, contributions[{productionPlanId, productionPlanNo, salesOrderNo|null, dueDate|null, heatCount, requiredTon}], coverage}`
- `coverage`:
  - `openRequisitionTon`
  - `openRequisitions[{purchaseRequisitionId, purchaseRequisitionNo, purchaseRequisitionStatus: string, unorderedTon}]`
  - `openPurchaseOrders[{purchaseOrderId, purchaseOrderNo, dueDate|null, outstandingTon}]`
  - `orderedAfterRunTon, uncoveredTon, isCovered`

### B-3. api/actionDrafts.ts (+ 메신저 진입 API)

**함수**
- `actionDraftApi.list`: GET /action-drafts?mine=true&status
- `actionDraftApi.get`: GET /action-drafts/:id
- `actionDraftApi.update`: PATCH /action-drafts/:id `{payload:{rawMaterialId?, requiredTon?, desiredReceiptDate?, requestReason?}}`
- `actionDraftApi.confirm`: POST /action-drafts/:id/confirm
- `actionDraftApi.reject`: POST /action-drafts/:id/reject `{rejectReason}`
- 모두 `ActionDraftView`를 돌려줍니다.

**`ActionDraftView` 필드**
- 기본: `id, actionType, actionTypeLabel, confirmer:'REQUESTER'`
- 값: `payload{rawMaterialId|null, requiredTon|null, desiredReceiptDate|null, requesterId, requestReason?|null}`
- 확정 검사용: `unresolvedFields: string[], fieldLabels: Record<string,string>`
- 상태·요청자: `draftStatus, requesterId, requester`
- 원본 메시지: `messageId|null, message{id, content, messageType, createdAt, sender|null, chatRoom{…}}|null`
- 실행 결과: `executionResult`
  - 성공: `{purchaseRequisitionId, purchaseRequisitionNo, attemptCount}`
  - 실패: `{errorCode|null, errorMessage, attemptCount, lastAttemptAt}`
  - 둘 다 아니면 null
- 만들어진 구매요청: `purchaseRequisition{id, purchaseRequisitionNo, purchaseRequisitionStatus}|null`
- 반려·시각: `rejectReason|null, confirmedAt, executedAt, rejectedAt, createdAt, updatedAt`

**메신저 쪽 (`api/messenger.ts:127-142`)**
- `messageActionApi.createDraft`: POST /messages/:messageId/action-drafts `{actionType}` → `{id, actionType, draftStatus, requesterId, messageId|null}`
- `messageActionApi.drafts`: GET /action-drafts

### B-4. 대상인데 구매 화면에서 쓰지 않는 파일

- `api/lookups.ts`의 `lookupApi.get`(GET /master-data/lookups): 구매 화면은 이 함수를 쓰지 않고 같은 주소의 `purchasingLookupApi`를 따로 씁니다.
  - 두 함수가 같은 쿼리 키 `['master-data','lookups']`를 씁니다(`common.tsx:153`, `features/sales/salesUi.tsx:168`). 정의가 중복입니다.
- `api/directory.ts`(GET /employees/directory, GET /departments/tree): 구매 화면에서 쓰지 않습니다. 메신저 멤버 선택과 업무 등록에서만 씁니다. 승인권자는 서버가 정한 `approver`로 받습니다.

**쿼리 키 접두어**: mrp-runs, purchase-requisitions, action-drafts, purchase-orders, goods-receipts, master-data

---

## C. 문서 대비 갭 분석

### C-1. 요구사항 충족 여부

| REQ | 판정 | 근거 |
|---|---|---|
| PUR-001 구매요청 등록 | 충족 (규칙 차이 있음) | MRP에서 미리 채워 등록(MrpPage.tsx:137-145), 직접 등록(목록 :55). 다만 '작성 중' 상태와 임시 저장이 추가돼 있습니다(C-3, C-5). |
| PUR-002 승인 | 충족 | 승인권자만 승인·반려할 수 있고(RequisitionPanel.tsx:26-29, 252-271), 승인된 요청만 발주 대상입니다(PurchaseOrderPage.tsx:65-81). |
| PUR-003 발주 | 충족 | 공급업체별로 묶어 발주 1건에 여러 품목(:2, 107, 189). |
| PUR-004 입고 | 부분 | 부분 입고, 확정 시 LOT 생성, 입고 검사 없음은 맞습니다. 하지만 초안 → 확정 2단계와 입고 상태값이 있습니다(C-5). |
| PUR-005 (P2) | 자리만 | 비활성 버튼(MrpPage.tsx:164). |
| PRD-005 MRP | 대부분 충족 (부분) | 식, 톤 소수 3자리, 잔량·입고예정 차감은 맞습니다. 다만 저장형 실행 모델, 기간 조회 없음, 용선 잔량 차감 추가가 있습니다(C-5). '여재 가용재고 포함'과 '다른 수주 입고예정 제외'는 화면만으로 확인할 수 없습니다. |
| AUTH-004 / ORG-004 | 충족 | 승인에 권한 코드를 쓰지 않고 승인권자인지만 봅니다. 승인함은 부서장 메뉴(nav.ts:65-70). 다만 문서상 TBD인 '상위 부서장' 규칙을 확정된 것처럼 안내합니다(ApprovalPage.tsx:98). |
| ACT-001 초안 추출 | 부분 | 원본 연결과 요청자(메시지 작성자)는 됩니다. 원료·수량·희망 입고일 추출은 없습니다('AI 자동 추출 준비 중', ActionDraftPage.tsx:2, 217-218). 문서상 P1입니다. SPEC.md 8장에는 'AI 호출·tool은 넣지 않는다'는 사용자 결정이 있습니다. |
| ACT-002 확인·확정 | 충족 | 수정 → 확정 → 구매요청 생성 → 부서장 승인(:114-122, 171-183). |
| ACT-003 초안 상태 | 충족 (확장 있음) | 상태값·라벨·흐름이 맞습니다. 다만 '확정했지만 생성 실패' 상태에서도 반려할 수 있고, AI_GENERATED 상태는 화면에서 작업 상태로 쓰이지 않습니다. |
| ACT-004 확장 구조 | 클라이언트로는 확인 불가 / 부분 | 화면이 구매요청 값 형태로 고정돼 있습니다(api/actionDrafts.ts:14-15). 바뀌는 것은 라벨뿐입니다. |
| ACT-005 (P2) | 없음 | 화면에 자리 표시도 없습니다. |
| LOT-003 (입고 시 원료 LOT 번호) | 충족 (표시) | 'RM-{원료코드}-YYMMDD-NNN' 미리보기(GoodsReceiptPage.tsx:314). 실제 번호는 서버가 매깁니다. |
| MST-007 기본 공급업체 | 충족 | 기본 공급업체 기준 그룹, '기본 공급업체 없음' 그룹, 모달·초안 힌트(PurchaseOrderPage.tsx:72, 244-255). |
| MST-008 기본 야드 | 부분 | 기본 야드를 미리 넣고, 안 고르면 기본 야드가 됩니다. 하지만 문서는 '자동 지정'인데 화면은 다른 야드를 고를 수 있습니다(GoodsReceiptPage.tsx:249-259). |

### C-2. 용어 사전 위반·차이

**사용 금지 동의어**
- 대상 파일 전체에서 '구매 요청'(띄어쓰기), 원자재, 공급사, 협력사, 팀장, 필요량, 실행 초안, 대화 → ERP, 거래처, 로트, 할당, 가용 재고, 출하 확정, 성적서를 검색했고 0건이었습니다.
- 영역 밖이지만 함께 발견: `nav.ts:38`과 `titles.ts:18`의 '공정 실적'은 TRM-047(작업 실적)의 사용 금지 동의어입니다.

**한글명과 다른 표기**
- '메신저 → ERP' (`titles.ts:14`): TRM-092는 'Message → ERP'
- '입고 예정' (`GoodsReceiptPage.tsx:51, 54, 60, 94`): TRM-051은 '입고예정'. 다른 화면은 '입고예정'으로 맞게 씁니다.
- '대화방' / '1:1 대화' (`common.tsx:121`): TRM-090은 '채팅방', CHAT_ROOM_TYPE 라벨은 '1:1'
- '입고 초안', '초안으로 저장돼요', '입고 초안 N건' (`GoodsReceiptPage.tsx:90, 158, 240, 321, 379`): 용어 사전 정리 메모에서 '초안'은 Action Draft를 가리키는 말로 정리됐습니다.
- '작성 중', '제출', '다시 제출', '제출 전', '작성 중으로 저장': 문서는 '등록'(REQ-PUR-001)과 '수정해 다시 요청'(10장), `/resubmit`를 씁니다.
- '요청 사유' (모달·패널·초안): BP-PUR-01 입력 이름은 '요청 근거'
- ACTION_TYPE 라벨이 '구매요청'이라 화면에 '구매요청 초안'으로 나옵니다. 공통 코드 정의서 라벨은 '구매요청 생성'입니다(C-3).

### C-3. 공통 코드 정의서와 다른 코드값·라벨

참고로 SPEC.md 9장 #6에 "공통코드 정의서 접근 불가라 업무 프로세스 정의서 10장 제안값을 썼다, 공유되면 shared를 고친다"는 임시 결정이 있습니다. 현재 문서(공통 코드 정의서와 10장)는 아래 값과 다릅니다.

**1) PURCHASE_REQUISITION_STATUS**
- 문서: WAITING_APPROVAL / APPROVED / REJECTED / ORDERED. 'DRAFT 없음, 임시 저장 없음'.
- shared에 `DRAFT: '작성 중'`이 있습니다(`shared/src/codes/index.ts:143-147`).
- DRAFT를 쓰는 곳
  - `PurchaseRequisitionListPage.tsx:15`(칩), `:116`('제출 전')
  - `RequisitionPanel.tsx:28, 50, 242, 275`
  - `common.tsx:37, 77-78, 87`
  - `RequisitionFormModal.tsx:22, 43, 96`
- 나머지 4개 값의 라벨은 문서와 같습니다.

**2) PURCHASE_ORDER_STATUS**
- 값과 라벨이 일치합니다(`index.ts:152-154`).

**3) 입고 상태**
- 문서에는 입고 상태값이 없습니다(10장 '입고: 상태값 없음', 공통 코드 정의서에 그룹 없음).
- shared의 `GOODS_RECEIPT_STATUS {DRAFT '입고 초안', CONFIRMED '입고 확정'}`(`index.ts:156-158`)을 쓰는 곳
  - `api/purchasing.ts:2, 152, 206, 226`
  - `common.tsx:39, 50-53`
  - `PurchaseOrderPage.tsx:373, 380`
  - `GoodsReceiptPage.tsx:46, 47, 100, 185, 360, 362`

**4) DRAFT_STATUS**
- 값과 라벨(생성/확인 대기/확정/ERP 반영/반려)이 일치합니다.

**5) ACTION_TYPE_LABEL**
- `index.ts:226`이 '구매요청'입니다. 문서는 '구매요청 생성'입니다.
- 화면은 서버가 준 `actionTypeLabel`에 ' 초안'을 붙여 보여 줍니다(`ActionDraftPage.tsx:23, 137, 140`, `PurchaseRequisitionListPage.tsx:83`). `titles.ts:14`은 '구매요청 초안'으로 하드코딩돼 있습니다.

**6) PERMISSION 코드**
- 문서는 PURCHASE_ORDER_CONFIRM / GOODS_RECEIPT_CONFIRM / PRODUCTION_PLAN_CONFIRM인데, 코드는 PO_CONFIRM / RECEIPT_CONFIRM / PLAN_CONFIRM입니다(`index.ts:67, 82-84`).
- 쓰는 곳
  - `nav.ts:32-33`
  - `MrpPage.tsx:18`(PLAN_CONFIRM), `:122-123`
  - `PurchaseRequisitionDetailPage.tsx:16`
  - `ApprovalPage.tsx:22`
  - `PurchaseOrderPage.tsx:23, 24, 282`
  - `GoodsReceiptPage.tsx:27, 132`
  - `RequisitionPanel.tsx:30, 31`
- PURCHASE_REQUISITION_CREATE는 일치합니다.

**7) REQUISITION_SOURCE_TYPE (DIRECT '직접' / MRP / MESSAGE '메신저')**
- 문서에 없는 코드 그룹입니다(`index.ts:148-150`).
- 쓰는 곳
  - `api/purchasing.ts:36-37, 86`
  - `common.tsx:58-60`
  - `PurchaseRequisitionListPage.tsx:5, 16-17, 24, 38, 41, 113, 127-141`
  - `ApprovalPage.tsx:53`
  - `RequisitionPanel.tsx:112, 165-196`
  - `RequisitionFormModal.tsx:21-25, 74, 114-119`
  - `MrpPage.tsx:387`
  - `ActionDraftPage.tsx:360`('출처: 메신저')

**8) PRODUCTION_PLAN_STATUS (MRP 화면 :320에 표시)**
- shared에 문서에 없는 `CONFIRMED '편성 확정'`이 있습니다.
- `IN_PROGRESS` 라벨이 '생산 중'인데 문서는 '진행중'입니다(`index.ts:133-137`).

**9) 그 밖의 코드**
- CHAT_ROOM_TYPE 라벨이 '1:1 대화'로 표시됩니다(`common.tsx:121`). 문서 라벨은 '1:1'입니다.
- 메시지 유형: 공통 코드 정의서 4장은 '첨부 유무로 판단, 코드 아님'인데, `ActionDraftView.message.messageType`(`api/actionDrafts.ts:26`)이 있고 메신저의 초안 버튼은 `messageType === 'TEXT'`로 판단합니다(`ChatParts.tsx:144`).

### C-4. 문서에 없는데 화면에 있는 것

**구매요청**
- 작성 중 상태, 임시 저장, '제출' 단계
- 출처 구분: 태그, '출처별' 막대 필터, 출처 카드
- 품목별 '발주 누계/미발주'와 줄 단위 분할 발주
- 기능
  - 승인함 '처리 완료(최근 30건)'와 [다음]
  - 목록의 '확인 대기 초안' 구역
  - '내 요청만 보기'
- 입력 검사 규칙
  - 희망 입고일·납기 ≥ 오늘
  - 같은 원료 중복 금지
  - 요청 사유·반려 사유·비고 500자 제한

**MRP**
- 실행 결과를 저장하는 이력 모델: 실행번호(mrpRunNo), 최근 50건, 최신/지난 실행
- 진행 중인 요청·발주 연결: 원료별 진행 요청·발주, 실행 뒤 발주, '새로 요청할 양', '요청·발주로 덮였어요'
- 기여 계획과 계획별 소요
- '만들어야 할 용선 = 필요 용선 − 용선 잔량'
- MRP 실행 권한에 PLAN_CONFIRM 포함

**입고**
- 초안 → 확정 2단계
- 비고(note)
- 야드 직접 선택
- 입고일 ≤ 오늘 규칙
- '초안 합계가 미입고량을 넘으면 확정 거부' 규칙

**초안**
- 확정과 별도인 [저장](PATCH)
- '확정했지만 생성 실패' 상태의 반려와 [다시 실행]
- 값 안에 `requestReason` (12.3 스키마는 rawMaterialId, requiredTon, desiredReceiptDate, requesterId만)

**승인함**
- 'Agent 대응 후보'를 부서장 승인함에 배치

**이름 (용어 사전·프로세스 11·12장에 없음)**

| 코드에서 쓰는 이름 | 문서상 이름·비고 |
|---|---|
| `sourceDraftId` / `sourceDraft` | 11장·13.4는 `action_draft_id` / `actionDraftId` |
| `outstandingTon`, `totalOutstandingTon` | TRM-051 입고예정 = `scheduledReceiptTon` |
| `rawMaterials[].yardId` | 11장은 `default_yard_id` |
| `orderedTon`, `unorderedTon`, `submittedAt`, `rejectReason`, `requestReason`, `note`, `orderedEmployeeId`, `confirmedEmployeeId`, `mrpRunNo`, `coverage`, `uncoveredTon`, `orderedAfterRunTon` | 해당 이름 없음 |

### C-5. 업무 규칙 불일치 (업무 프로세스 정의서 기준)

**BP-PRD-01 / 4.4 MRP 계산식**
- 일치: 순소요 = max(0, 총소요 − 원료 LOT 잔량 − 입고예정), 합금철 = 히트 톤 × kg/t ÷ 1,000, 필요 용선 = 히트 톤 ÷ 제강 수율, 공급량은 합계에서 한 번만 차감(MrpPage.tsx:93-94, 193, 295).
- 차이
  - 용선 잔량을 빼는 단계가 있습니다(:190-195, 370). 4.4는 '원료 소요 = 필요 용선 × 원단위'입니다.
  - MRP를 저장형 `POST /mrp-runs`로 실행합니다. 12.2는 `GET /mrp/requirements?from=&to=`(저장 없이 계산 조회)이고, 화면에 기간 입력이 없습니다.
  - BP-PRD-01 출력인 '예상 슬래브 여재'가 없습니다.
- 화면만으로 확인할 수 없는 것: '입고예정은 필요일까지 도착하는 발주 미입고량만'(4.4 구현 제안).

**BP-PUR-01 구매요청·승인·발주**
- 공통 코드 정의서의 '등록하면 바로 승인 대기, 임시 저장 없음'과 10장 'WAITING_APPROVAL → APPROVED → ORDERED'를 어깁니다. 화면에 DRAFT, '작성 중으로 저장', 별도 '제출'이 있습니다.
- 반려 후 재요청
  - 12.2 `POST /:id/resubmit` 대신 `PATCH /:id` + `POST /:id/submit`을 씁니다(`api/purchasing.ts:110-111`). 동작은 같습니다.
  - 반려 상태에서 '저장'만 하면 반려 상태로 남습니다.
- 입력 '관련 계획·수주'가 없습니다. MRP에서 열면 사유 문자열에 실행번호만 들어갑니다.
- 맞게 동작하는 것
  - 승인 전 발주 차단(승인된 것만 목록)
  - 승인량 초과 차단(발주 톤 ≤ 남은 수량, PurchaseOrderPage.tsx:156)
  - 공급업체 1곳당 1건
  - 요청-발주 배분량 보존
- 부서장 본인 요청·부재 시 경로는 문서상 TBD(2장, 16장)인데, ApprovalPage.tsx:98은 확정 규칙처럼 안내합니다.
- Agent 대응 후보는 REQ-AGT-006·ACT-003에 따라 담당 부서원이 확정합니다. 부서장 승인함에 '부서장이 승인하는 기능'으로 표시한 것은 문서와 다릅니다(ApprovalPage.tsx:73, 91-92).

**BP-PUR-02 부분 입고와 '입고 확정 = 등록'**
- 문서
  - '입고 확정(등록)'
  - 12.2 '`POST /goods-receipts` (등록이 곧 확정)'
  - 10장 '입고 확정 시 생성, 확정 후 수정 차단'
- 코드는 2단계입니다. 등록하면 DRAFT, `POST /:id/confirm`을 해야 LOT이 만들어집니다(GoodsReceiptPage.tsx:2, 157-168, 362-366).
- 문서는 '품목 기본 야드 자동 지정'인데 화면은 야드를 직접 고를 수 있습니다.
- 맞게 동작하는 것: 부분 입고, 0 이하 차단, 미입고량 초과는 서버가 PUR-003으로 거부하고 메시지 표시, LOT 형식, 입고 검사 없음.

**BP-ACT-01 Message → ERP**
- 문서 흐름은 'AI가 추출 스키마로 추출 → AI_GENERATED → WAITING_APPROVAL'인데, 추출 단계가 없습니다. 화면은 WAITING_APPROVAL일 때만 편집할 수 있고 AI_GENERATED면 잠급니다(:73, 328).
- 문서는 '업무방 메시지'인데, 메신저는 방 유형과 상관없이 텍스트 메시지면 초안 버튼을 보여 줍니다(ChatParts.tsx:144).
- 확정에 요청자 조건과 함께 PURCHASE_REQUISITION_CREATE USE 권한이 더 필요합니다(:72, 305). 그래서 이 권한이 없는 메시지 작성자는 확정할 수 없습니다.
- 확정했지만 생성에 실패한 상태(APPROVED)에서 반려할 수 있습니다(:311-317). 10장 상태 전이에 없는 전이입니다. 다만 실행 실패를 상태 추가 없이 실행 결과로 남기는 것은 10장 구현 제안과 일치합니다.
- 맞게 동작하는 것: 요청자 = 메시지 작성자, 미확정 필드(ACT-001)는 실행 안 함, 확정하면 구매요청이 승인 대기로 생성, 반려하면 REJECTED.

**9.1 번호 형식**
- 화면은 번호를 만들지 않고 서버 값을 보여 줍니다. 그래서 PR-/PO-/GR-YYMM-NNNN 형식은 클라이언트 코드로 확인할 수 없습니다.
- 하드코딩된 것은 LOT 미리보기 하나이고 형식이 맞습니다.
- MRP 실행번호(mrpRunNo)는 9.1에 없는 번호입니다.

**9.3 에러 코드**
- 처리하는 곳
  - PUR-001: RequisitionFormModal.tsx:109, RequisitionPanel.tsx:93, ActionDraftPage.tsx:197, 207
  - PUR-003: GoodsReceiptPage.tsx 주석 153, 175. 서버 메시지를 그대로 보여 줍니다.
  - ACT-001: ActionDraftPage.tsx:87, 207
- PUR-002는 흐름상 생기지 않아 화면에서 따로 처리하지 않습니다.
- 클라이언트 자체 코드 NETWORK·COM-999는 9.3에 없습니다.
- 참고: shared의 COM-003 문구 '입력값이 올바르지 않습니다'(index.ts:300)가 9.3의 '참조 대상이 없습니다'와 다릅니다.

### C-6. 코드 컨벤션 위반 (9장 중심)

**지켜진 것**
- 컴포넌트에서 fetch·axios 직접 호출 0건. 모든 호출은 `api/*.ts`의 `request()`를 거칩니다.
- `any` 0건, `console.log` 0건, `@/` 별칭 사용.
- 상태 변경은 `POST /:id/동작` 형식입니다.

**부분 위반**
- 조회는 화면 안에서 `useQuery`를 바로 씁니다. 리소스별 커스텀 훅은 `usePurchasingLookups` 하나뿐입니다.
  - 위치: MrpPage.tsx:21-23, PurchaseRequisitionListPage.tsx:30/32/46, PurchaseRequisitionDetailPage.tsx:14, ApprovalPage.tsx:24-29/41, PurchaseOrderPage.tsx:26-27/46, GoodsReceiptPage.tsx:29-30, ActionDraftPage.tsx:22
  - 9장은 'api/ 함수 + 커스텀 훅으로만'입니다. 변경 요청은 공용 훅 `useAction`을 씁니다.

**[강제] Tailwind**
- client에 Tailwind 의존성과 설정이 없습니다. 스타일은 `src/styles/*.css`의 `hl-*` 클래스와 인라인 style로 되어 있습니다.
- 파일별 인라인 style 수

| 파일 | 인라인 style 수 |
|---|---|
| MrpPage | 45 |
| PurchaseRequisitionListPage | 29 |
| PurchaseRequisitionDetailPage | 1 |
| ApprovalPage | 16 |
| PurchaseOrderPage | 59 |
| GoodsReceiptPage | 63 |
| ActionDraftPage | 55 |
| RequisitionPanel | 32 |
| RequisitionFormModal | 14 |
| common | 10 |

- 하드코딩 색상
  - PurchaseRequisitionListPage.tsx:17
  - MrpPage.tsx:198
  - ActionDraftPage.tsx:125
  - GoodsReceiptPage.tsx:219, 281-284, 292, 305-307
  - PurchaseOrderPage.tsx:192-194
- SPEC.md 9장 #12는 'B안 CSS 그대로(컨벤션 미정)'라고 적었지만, 현재 컨벤션 0장은 Tailwind를 확정으로 표시합니다.

**[강제] 프론트 구조와 인증 (공통 인프라, 이 영역 전체에 영향)**
- Vite + react-router(App.tsx)입니다. 컨벤션은 Next.js App Router입니다.
- 토큰을 sessionStorage에 두고 Bearer 헤더로 보냅니다(stores/auth.ts:4-36, api/client.ts:27-29). 파일 주소에는 `?access_token`을 붙입니다(:66-70). 컨벤션은 httpOnly 쿠키, `credentials:'include'`, '프론트에서 토큰 다루지 않음'입니다.

**[강제] 2장 이름 규칙**
- 'order' 단독 사용 금지 위반
  - `orders`: PurchaseOrderPage.tsx:27, GoodsReceiptPage.tsx:29
  - `canOrder`: PurchaseOrderPage.tsx:23, RequisitionPanel.tsx:30
  - `OrderForm`/`OrderDetail`: :134, 280
  - `OrderableGroup`/`OrderableItem`/`orderable`: api/purchasing.ts:167-193
- 단위 접미사를 엉뚱하게 씀: `draftTon`은 톤 값이 아니라 초안 배열입니다(GoodsReceiptPage.tsx:185, 321).
- 용어 사전에 없는 약어: `pr`, `Gr`, `Po` (구매요청·입고는 약어 '-', 발주만 PO).
- 용어 사전과 다른 이름은 C-4 이름 표를 보세요.

**그 밖의 이름·타입 관련**
- 컴포넌트가 들어 있는 파일인데 이름이 PascalCase가 아닙니다: `features/purchasing/common.tsx`.
- 함수가 동사로 시작하지 않습니다: `md`, `d10`, `pct`, `lotLink`, `groupKey`, `toForm`, `sameForm`, `patchOf`, `errOf`, `lineOf`, `roomLabel`, `personLabel`, `itemsSummary`, `tonError`, `tonInput`.
- Boolean에 `is`/`has` 접두어가 없습니다([권장]): `canRun`, `editable`, `valid`, `dirty`, `stuck`, `ro`, `open`, `pending`, `mine`, `head`, `touched`.
- 코드값 타입을 `string`으로 둔 곳: api/purchasing.ts:12, 63-64, api/mrp.ts:9, 33, 42, api/actionDrafts.ts:26, 32. 그래서 `as` 단언이 필요합니다(common.tsx:43-55, MrpPage.tsx:320, RequisitionFormModal.tsx:71).
- eslint 규칙을 끈 곳: ActionDraftPage.tsx:67 (`react-hooks/exhaustive-deps`).

**중복과 무효화 누락**
- 중복
  - `pct`: PurchaseOrderPage.tsx:17, GoodsReceiptPage.tsx:19
  - `REASON_MAX`: 3개 파일
  - lookups API: B-4 참고
- [권장] 무효화
  - 대체로 맞습니다.
  - 초안 확정이 mrp-runs를 무효화하지 않습니다. 확정하면 구매요청이 생겨 MRP 화면의 진행 요청 표시가 바뀌어야 합니다.
  - 입고가 purchase-requisitions를 무효화하지 않습니다. 구매요청 화면의 '연결 발주' 입고량이 바뀌어야 합니다.

### C-7. 기타 작은 관찰

- 날짜 오류 문구가 실제 규칙과 어긋납니다.
  - '오늘 이후 날짜로 입력해 주세요'인데 오늘은 허용됩니다.
  - '오늘 이전 날짜로 입력해 주세요'인데 오늘이 허용되고, 힌트는 '오늘 또는 지난 날짜'입니다.
- 발주 작성에서 공급업체를 안 고르면 빨간 테두리만 생기고 문구가 없습니다.
- 입고 목록에서 다 들어온 품목에 발주 상태 라벨 '입고 완료'를 품목 상태처럼 씁니다(GoodsReceiptPage.tsx:78).
- 생산 역할이 구매요청 메뉴와 PURCHASE_REQUISITION_CREATE USE를 가집니다(nav.ts:40, index.ts:102). 업무 프로세스 정의서 2장의 생산 권한 제안에는 이 권한이 없습니다. 역할별 권한 문서는 지시대로 열지 않아 그 문서와는 비교하지 못했습니다.
