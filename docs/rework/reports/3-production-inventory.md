# 생산·재고 화면 감사 보고 (읽기 전용, 파일 수정·생성 없음)

## 0. 읽은 범위

**경로 약칭** (모두 `/Users/mjkim/Documents/GitHub/fantasteel-erp/` 아래 절대경로, 줄 수 = wc -l, 전부 EOF까지 읽음)

| 약칭 | 절대경로 | 줄 |
|---|---|---|
| PP | /Users/mjkim/Documents/GitHub/fantasteel-erp/client/src/pages/production/ProductionPlanPage.tsx | 466 |
| PR | /Users/mjkim/Documents/GitHub/fantasteel-erp/client/src/pages/production/ProductionResultPage.tsx | 311 |
| RA | /Users/mjkim/Documents/GitHub/fantasteel-erp/client/src/pages/production/RollingAllocationPage.tsx | 354 |
| CRM | /Users/mjkim/Documents/GitHub/fantasteel-erp/client/src/features/production/CompleteResultModal.tsx | 193 |
| HPC | /Users/mjkim/Documents/GitHub/fantasteel-erp/client/src/features/production/HeatPlanningCard.tsx | 261 |
| PM | /Users/mjkim/Documents/GitHub/fantasteel-erp/client/src/features/production/PlanModals.tsx | 284 |
| UI | /Users/mjkim/Documents/GitHub/fantasteel-erp/client/src/features/production/prodUi.tsx | 176 |
| PH | /Users/mjkim/Documents/GitHub/fantasteel-erp/client/src/features/production/productionHooks.ts | 52 |
| INV | /Users/mjkim/Documents/GitHub/fantasteel-erp/client/src/pages/inventory/InventoryPage.tsx | 288 |
| INVcss | /Users/mjkim/Documents/GitHub/fantasteel-erp/client/src/pages/inventory/InventoryPage.css | 5 |
| IH | /Users/mjkim/Documents/GitHub/fantasteel-erp/client/src/features/inventory/inventoryHooks.ts | 11 |
| APIP | /Users/mjkim/Documents/GitHub/fantasteel-erp/client/src/api/production.ts | 268 |
| APII | /Users/mjkim/Documents/GitHub/fantasteel-erp/client/src/api/inventories.ts | 92 |

합계 2,761줄. 라벨·라우트·권한을 확인하려고 다음도 끝까지 읽음: client/src/api/allocations.ts(APIA, 93), shared/src/codes/index.ts(CODES, 334), client/src/shell/nav.ts(NAV, 103), client/src/shell/titles.ts(TTL, 40), client/src/App.tsx(APP, 116), client/src/api/client.ts(CLI, 70), client/src/stores/auth.ts(AUTH, 55), client/src/components/ui.tsx(UIC, 149), client/src/hooks/useApi.ts(25), client/src/lib/format.ts(79), api/lookups.ts(34), api/queryClient.ts(18), stores/toast.ts(22). 부분 확인: features/sales/salesUi.tsx 40-44·163-169, shell/shellData.ts 55-70, client/package.json.

**남아 있는 파일**: `client/src/features/production/.omc/state/idle-notif-cooldown.json`, `.omc/state/sessions/e4606bc3-…/pre-tool-advisory-throttle.json`. oh-my-claudecode 도구의 상태 파일이고 `.gitignore:2`의 `.omc/` 규칙으로 무시됨. 앱 코드가 아님.

**문서**: 요구사항 정의서, 용어 사전, 공통 코드 정의서, 프로젝트 기획안, 코드 컨벤션. 5건 모두 응답 본문으로 받았음(파일로 저장된 것 없음, 잘린 것 없음). 코드 컨벤션은 2·4·9장을 중심으로 대조했고 0·5장도 일부 참조. process.md는 1–1530줄 전부 읽음. 다른 Notion 페이지, server/, prisma, docs/api, docs/names, SERVER-GUIDE는 열지 않음.

**SPEC.md (78줄)**: 프로젝트 CLAUDE.md가 의무로 정해서 읽었음. 비교 기준으로는 쓰지 않음. 아래 차이가 왜 생겼는지 설명해 주는 항목:
- 9장 #6(SPEC.md:64): 공통코드 정의서에 접근할 수 없어서 업무 프로세스 정의서 10장의 제안값을 썼다고 적혀 있음. 지금 문서와 코드값이 다른 근본 원인임.
- #12(:70): 스타일은 "컨벤션 미정"으로 보고 B안 CSS를 씀. 현재 컨벤션은 Tailwind로 확정되어 있음.
- #14(:72): 시뮬레이션에서 검사 자동 등록을 끌 수 있게 함.
- #17(:75): 재고 화면을 새로 추가함.

---

## A. 화면 인벤토리

### A-0. 라우트·메뉴·권한

| 라우트 | 기본 제목 | 레일 메뉴 | 메뉴가 보이는 조건 | 라우트 가드 |
|---|---|---|---|---|
| /production/plans | 생산계획 / 생산 (TTL:17) | 생산 역할만 '생산계획' + 배지 plansToConfirm (NAV:37) | PLAN_CONFIRM VIEW 이상 (NAV:63) | 없음 (APP:94) |
| /production/results | 공정 실적 / 생산 (TTL:18) | 생산 '공정 실적' (NAV:38) | RESULT_CONFIRM VIEW 이상 | 없음 (APP:95) |
| /production/rolling | 열연 투입 배정 / 생산 (TTL:19) | 생산 '열연 투입' (NAV:39) | ROLLING_ALLOCATE VIEW 이상 | 없음 (APP:96) |
| /inventories | 재고 / 재고·예약·배정 (TTL:10) | 6개 역할 모두 '재고' (NAV:26,34,41,46,52,58) | 조건 없음 | 없음 (APP:86) |

- **기본 권한**(CODES:99-110): 생산 역할만 PLAN_CONFIRM·RESULT_CONFIRM·ROLLING_ALLOCATE를 USE로 가짐. 영업·구매·품질은 PLAN_CONFIRM VIEW(품질은 RESULT_CONFIRM VIEW도), 관리자는 전부 VIEW.
- 이들 역할은 ROLE_MENU에 생산 메뉴가 없어서 레일에는 안 보임. 링크로 들어오면 화면은 보이고, 버튼은 USE 권한이 없으니 비활성(AUTH:48-50).
- **배지 plansToConfirm**: GET /production-plans?status=PLANNED의 건수. PLAN_CONFIRM USE일 때만 세고 60초마다 다시 조회(PH:43-52, shellData.ts:64).
- **화면 간 이동**: `?plan=<id>`로 계획을 지정(PH:24-40). 외부 링크는 /lots/trace?lot=, /quality/inspections(?lot=), /sales-orders/:id, /mrp, /purchase-requisitions, /business-events.

### A-1. 생산계획 `/production/plans` (PP)

**왼쪽 목록** (PP:44-85)
- 제목은 '생산계획'과 `{n}건`.
- 검색창(placeholder '계획·수주번호·고객사 검색')은 클라이언트에서 계획번호·수주번호·고객사·규격코드로 거름(PP:38-39,52).
- 상태 select: '상태 전체'와 계획/편성 확정/생산 중/완료/취소(PP:22,56-59).
- 칩 '조치 필요'(PP:62), 칩 전체/슬래브/코일(PP:65-69).
- 목록 한 줄(UI:100-149)에 나오는 것:
  - 계획번호, 유형 태그, '재생산' 배지, 상태 배지
  - 수주번호·고객사. 수주가 없으면 '수주 연결 없음 (여재)'
  - '부족 {n}{매|개}', 규격
  - '히트 n개' / '편성 전' / '히트 없음'
  - '납기 MM-DD · D-n'. D+이면서 미완료면 위험색
  - '조치 필요'
- 빈 상태: '조건에 맞는 생산계획이 없어요' / '생산계획이 없어요'(PP:77).
- 하단 안내(PP:83). ?plan이 없으면 첫 항목을 고름(PP:40). 고른 것이 없으면 '생산계획을 골라 주세요'(PP:88).

**상세 머리** (PP:129-159)
- 셸 제목 '생산계획 · {번호}', 부제 '{수주번호} · {고객사}'(PP:100).
- 경로: 생산계획 › 수주(없으면 '수주 연결 없음') › '히트 편성'(PLANNED일 때) 또는 '진행 현황'.

| 버튼 | 표시 조건 | 활성 조건 | 동작 |
|---|---|---|---|
| 수주 상세 | 수주가 있을 때 | 항상 | /sales-orders/:id (PP:146) |
| 작업 로그 | 항상 | 항상 | /business-events (PP:147) |
| 공정 실적 | PLANNED·CANCELLED가 아닐 때 | 항상 | /production/results?plan= (PP:148) |
| 열연 투입 | 코일 && CONFIRMED·IN_PROGRESS | 항상 | /production/rolling?plan= (PP:149) |
| 재생산 계획 | 수주 있음 && 품목이 CANCELLED 아님 && PLANNED 아님 | PLAN_CONFIRM | 재생산 모달 (PP:150-152) |
| 실적 시뮬레이션 실행 | CONFIRMED·IN_PROGRESS | RESULT_CONFIRM | 시뮬레이션 모달 (PP:153-157) |

비활성 툴팁은 모두 '권한이 필요해요'.

**배너**
- 재생산 필요(PP:161-171): additionalQty가 0보다 크면 '재생산 필요 — {수주} 품목 n에 아직 x{단위}가 모자라요 (미확보 … · 진행 계획 잔여 …)'와 '재생산 계획' 버튼이 나옴. 데이터는 GET reproduction-preview이고, PLANNED·품목 취소·수주 없음이면 호출하지 않음(PP:120-124).
- 취소: '{MM-DD HH:mm}에 취소된 계획이에요.'(PP:172-174).

**지표 카드** (PP:176-201). '(편성 전 -)'은 PLANNED일 때 '-'로 보인다는 뜻.
- 목표 규격(강종 두께×폭×길이)
- 슬래브 규격 (연주). 매핑이 없으면 '규격 매핑 없음'
- 목표 매수(shortageQty, 매/개)
- 여재 사용(매)
- 히트 수(개, 편성 전 -)
- 계획 슬래브(매, 편성 전 -)
- 예상 여재(매, 편성 전 -)
- 필요 투입량(t, 편성 전 -)
- 누적 계획수율: 서버 값을 백분율로만 바꿈, "0.9377" → "93.77%"(UI:23-27)

그 아래:
- 진행 단계 표시: '히트 편성 · n히트' → 제선 a/b → 제강 → 연주 → [열연]. 숫자는 서버 progress의 완료/전체(UI:87-97).
- 캡션: '목표중량 {shortageTon} (계산값 = 목표 매수 × 1매 이론중량 {t})'. 이어서 PLANNED면 '히트 수·필요 투입량은 편성을 확정하면 정해져요', 아니면 '편성 확정 {시각}'. 그 뒤에 '완료 {시각}', '실제 여재 n매'.

**히트 편성 카드 (HPC, PLANNED일 때만)**
- 머리: '히트 편성', 메타 '부족 n · t (계산값)', '계산 중…' 스피너, 버튼 '히트 편성 미리보기'(한 번 누른 뒤에는 '다시 계산')(HPC:73-80).
- 미리보기 전(HPC:84-93):
  - 슬래브 규격 매핑이 없으면 '이 규격에 대응하는 슬래브 규격(규격 매핑)이 없어요. 기준정보에서 매핑을 먼저 등록해 주세요.'
  - 안내 '…미리보기는 아무것도 저장하지 않아요.'
- 흐름 박스(HPC:99-107): 목표중량 → 필요 투입량('÷ 수율') → 히트 수('히트 용량 t') → 히트 톤('슬래브 n매') → 필요 용선('÷ 제강').
- 경고:
  - 계획 슬래브가 새로 생산할 매수보다 적으면 '…부족분은 재생산 계획으로 채워요'(HPC:109-114)
  - heatCount=0이면 '여재 슬래브만으로 채워서 새 히트를 만들지 않아요. 확정하면 열연 실적 행만 생겨요.'(HPC:115-117)
- 계산표 '항목 | 값 | 계산' 10행(HPC:26-41). 값은 모두 서버 HeatPreview 그대로이고 클라이언트 계산은 없음.
  - 새로 생산할 매수 = 부족 매수 − 여재 사용
  - 목표중량 = 매수 × 제품 1매 이론중량
  - 누적 계획수율 = 연주 × 열연
  - 필요 투입량 = 목표중량 ÷ 누적 계획수율
  - 히트 수 = ceil(필요 투입량 ÷ 히트 용량)
  - 히트 톤 = 히트 수 × 용량
  - 필요 용선 = 히트 톤 ÷ 제강 수율
  - 히트당 슬래브 매수 = floor(용량 × 연주 수율 ÷ 슬래브 1매 이론중량)
  - 계획 슬래브 매수 = 히트 수 × 히트당
  - 예상 여재 = max(0, 계획 슬래브 − 새로 생산할 매수)
- 공식 캡션(HPC:138).
- 코일 계획만 '여재 사용 매수' 입력이 있음(HPC:61-68,145-167):
  - 숫자 입력, 단위 매, 기본 '0', 쓸 수 있는 최대가 0이면 비활성
  - 검증 메시지 '0 이상의 정수로 입력해 주세요' / '최대 n매까지 쓸 수 있어요'
  - 값이 유효하면 자동으로 다시 미리보기
  - 안내 '지금 열연에 쓸 수 있는 여재 슬래브 a매 · 이 계획에 쓸 수 있는 최대 b매'
  - 여재 표(최대 12행): FIFO | 여재 슬래브 LOT | 히트 | 생산완료일 | 검사 | 편성 시('귀속 예정'/'여재로 남음')
- 원료(HPC:197-237):
  - '원료 총소요와 현재 재고', 배지 '원료 부족'/'재고 충분', 링크 'MRP에서 순소요 보기'
  - 표: 원료 | 총소요 | 현재 재고 | 부족
  - 부족하면 배너 '원료가 모자라요. 편성은 확정할 수 있지만, 원료를 확보하기 전에는 제선·제강 실적을 등록할 수 없어요.'와 MRP·구매요청 링크
- 하단(HPC:241-258):
  - 캡션 '확정하면 … 실적 행이 대기 상태로 만들어져요' / '편성을 확정하기 전까지는 계획을 취소할 수 있어요'
  - 권한 없으면 '생산계획 권한이 필요해요'
  - '계획 취소'(PLAN_CONFIRM)
  - '편성 확정': PLAN_CONFIRM && 미리보기 있음 && 입력이 바뀐 뒤 다시 계산하지 않은 상태 아님 && 계산·확정 중 아님 && (코일이면 여재 입력 오류 없음)일 때만 활성. POST /production-plans/:id/confirm {surplusUseQty}, 토스트 '히트 편성을 확정했어요 · 공정 실적 행이 만들어졌어요'(HPC:56)

**공정 진행 (PP:279-335)**
- 메타 '제선 → 제강 → 연주 → 열연'. 슬래브 계획은 열연 없음(UI:78).
- '계획 취소'는 PLANNED이거나, CONFIRMED이면서 모든 실적이 READY일 때 보임(PP:116). 툴팁 '작업을 시작하기 전에만 취소할 수 있어요'.
- '실적 등록' 링크는 항상 보임.
- 공정별 칸반 카드:
  - '히트 n', SYSTEM 배지, 실적 상태 배지
  - 한 줄 요약(PP:271-276): '용선 t · 고로 X' / '필요 용선 t' / '히트 t · 전로 X' / '슬래브 a/b매 · 손실 n' / '코일 n개' / '남은 압연 n개'
  - 첫 LOT과 '외 n', '…완료/시작' 시각 또는 '시작 전'
- 빈 상태: '실적 행이 없어요', '취소된 계획이라 실적이 없어요', '등록된 실적 행이 없어요'.

**생산 LOT (PP:337-404)**
- 칩 용선/히트/슬래브/코일과 개수.
- 표 열: LOT | 히트(슬래브·코일만) | 이론중량 또는 '출선량 · 잔량'(용선) 또는 '히트 톤'(히트) | 검사 | 상태 | 생산완료(날짜+시각).
- 검사 전이면 /quality/inspections?lot= 링크.
- 상태는 UI:51-57 규칙으로 표시.
- 불합격 행 강조. 40행이 넘으면 '모두 보기'/'접기'. 빈 상태 '아직 만든 {유형} LOT이 없어요'.

**오른쪽 카드**
- '연결된 수주 품목'(PP:212-236): 수주, 고객사, 납기(D-라벨), 주문 매수, 품목 상태, 수주 담당, 이 계획 잔여. 수주가 없으면 '수주 취소로 연결이 끊긴 계획이에요. 만들어진 합격 슬래브는 여재(가용재고)로 남아요.'
- '열연 투입'(코일만, PP:407-466):
  - 메타 '코일 a/b개 압연'
  - 남은 압연, 슬래브 추가 확보 필요, 귀속된 적격 슬래브, 배정 확정 (투입 대기)
  - 귀속 슬래브 목록: '배정 확정' / '이 계획 생산분' / '여재에서 귀속'
  - 열연 배정 목록: RELEASED 제외
  - 하단: ROLLING_ALLOCATE가 없으면 LockHint, '열연 투입 배정' 링크
- 'Agent 초안' 박스: 문구(PP:246)와 SoonButton '자동 초안'. 화면에는 '준비 중 (P2)'로 보임(PP:240-251).

**모달**
- (a) 실적 시뮬레이션 (PM:38-148, 폭 560)
  - 필드 '난수 시드 (선택)': placeholder '예: 20260930'. 정수가 아니거나 2,147,483,647을 넘으면 '0 ~ 2,147,483,647 사이의 정수로 입력해 주세요'.
  - 체크박스 '검사 포함'은 기본 ON. 끄면 안내 PM:143.
  - '실행'은 RESULT_CONFIRM && 시드 오류 없음일 때 활성. POST /production-plans/:id/simulate-results, 토스트 '실적 시뮬레이션을 실행했어요'.
  - 결과 화면(폭 760):
    - 지표: 난수 시드, '연주 손실률 (0~5%)'(값이 없으면 '연주 안 함'), 연주 손실 매수, 만든 LOT, 계획 상태
    - notes 배너
    - 표: 순서 | 한 일 | 공정 | 내용 | LOT
- (b) 재생산 계획 (PM:153-251, 폭 620)
  - 지표: 주문, 누적 출고, 미확보, 진행 계획 잔여, 추가 필요.
  - 캡션 공식(PM:205).
  - 진행 중인 계획 표: 진행 중인 계획 | 상태 | 목표 | 아직 채워 줄 수 있는 매수.
  - 안내 배너(PM:225-235). 코일이면 여재 안내(PM:236-240).
  - '사유 (선택)': maxLength 500, placeholder '예: 슬래브 표면 검사 불합격 2매 대체'.
  - SoonButton '자동 초안'.
  - '재생산 계획 만들기'는 PLAN_CONFIRM && additionalQty > 0일 때 활성. POST /production-plans. 토스트는 '재생산 계획 {번호}을(를) 만들었어요 (n단위)' 또는 '가용 재고 n매를 예약해서 새 계획 없이 채웠어요'.
- (c) 계획 취소 (PM:254-284, 폭 480)
  - 문구 PM:273-277.
  - '사유 (선택)' maxLength 500.
  - '계획 취소'(danger). POST /production-plans/:id/cancel, 토스트 '생산계획을 취소했어요'. 모달 안에서는 권한을 검사하지 않음(여는 버튼에서만 검사).

### A-2. 공정 실적 `/production/results` (PR) + 작업 완료 모달 (CRM)

**왼쪽 '작업 지시'** (PR:39-79)
- GET /production-plans를 필터 없이 받은 뒤 클라이언트에서 나눔.
- 칩 '입력 필요 n'(CONFIRMED+IN_PROGRESS) / '완료 n'.
- 그룹: '생산 중'(IN_PROGRESS) / '편성 확정 · 시작 전'(CONFIRMED) / '완료'. 빈 문구가 각각 있음(PR:58-69).
- PLANNED·CANCELLED 계획은 목록에 없음.
- 고른 것이 없으면 '작업할 계획이 없어요'와 '생산계획으로' 링크(PR:82).

**상세** (PR:118-209)
- 셸 제목 '공정 실적 · {번호}'. 경로: 작업 지시 › 수주 › 실적 입력.
- 버튼: 생산계획, 열연 투입 배정(코일만), 검사 입력, 작업 로그.
- 지표: 목표 규격, 목표('n단위 · t'), 편성('n히트 · 슬래브 n매'), 여재 사용, 수주 · 고객사.
- 안내 배너(PR:173-179). 작업 시작 오류 배너.
- PLANNED면 '히트 편성 전이에요…', CANCELLED면 '취소된 계획이에요.'(PR:181-183).
- 공정별 섹션(PR:218-311):
  - 메타는 PROCESS_NOTE(PR:211-216). 열연은 '배정 확정 n매 투입 대기'. '완료 a/b'.
  - 표 열: '히트'(제강·연주) 또는 '차수'(제선·열연) | 상태 | 시작 | 완료 | 투입 | 산출 | LOT | 작업.
  - 투입·산출 표시는 ioText(PR:98-116). 시뮬레이션 행은 '시뮬레이션 손실률 x.xx%'.
  - LOT은 3개까지 판정 배지와 함께 보이고, 나머지는 '외 n개 · 생산계획에서 전체 보기'.
  - 작업 칸(PR:286-297):
    - READY → '작업 시작'(RESULT_CONFIRM, 다른 시작 요청이 진행 중이 아닐 때). POST /production-results/:id/start, 토스트 '{공정}[ 히트 n] 작업을 시작했어요'.
    - STARTED → '작업 완료'. 작업 완료 모달이 열림.
    - 계획 상태는 버튼 조건에 들어 있지 않음.
  - 권한이 없으면 '공정 실적 권한이 필요해요'.

**작업 완료 모달 (CRM)**
- 제목 '{공정}[ · 히트 n] 작업 완료 · {번호}'. 폭 480, 열연은 600.
- 캡션 '완료 시각은 등록하는 지금 시각으로 기록돼요'(CRM:113).

| 공정 | 필드 | 형식·기본값 | 검증 메시지 |
|---|---|---|---|
| 제선 | 고로 번호 * | 텍스트, 최대 4자, placeholder '예: 1', hint 'HM-고로-YYMMDD-NN' | 영문·숫자 1~4자 아니면 '고로 번호는 영문·숫자 4자 이내로 입력해 주세요' |
| 제선 | 용선량 (t) | 소수, 기본 defaultHotMetalTon. 비우면 서버 값 | 숫자(소수 3자리까지)·0 초과 아니면 '용선량은 0보다 큰 톤(소수 3자리까지)으로 입력해 주세요' |
| 제강 | 전로 번호 * | 같은 규칙, hint 'HT-전로-YYMMDD-NNN' | '전로 번호는 영문·숫자 4자 이내로 입력해 주세요' |
| 연주 | 슬래브 생산 매수 * | 정수, 접미 '매', 기본 plannedQty | '슬래브 생산 매수는 0 이상의 정수로 입력해 주세요' / '계획 매수(n매)를 넘을 수 없어요' |
| 열연 | 압연할 슬래브 (배정 확정분) | 체크박스 표(선택 \| 슬래브 LOT \| 히트 \| 배정 확정), 기본 전부 선택 | '배정 확정된 슬래브가 없어요' / '압연할 슬래브를 1매 이상 골라 주세요' / '남은 압연 n개보다 슬래브를 많이 골랐어요 (선택 k매)'. 전부 고르면 allocationIds를 보내지 않음 |

- '작업 완료 · 실적 등록'(진행 중이면 '등록 중…'): POST /production-results/:id/complete, 토스트 '{공정} 실적을 등록했어요'.
- 완료 화면: 산출·손실과 '만든 LOT n개' 표, '닫기'(CRM:37-62).
- 오류 배너는 409이면 MRP·구매요청 링크를 붙임(UI:152-172).

### A-3. 열연 투입 배정 `/production/rolling` (RA)

**왼쪽 '배정 대상'**
- GET /production-plans?itemType=COIL.
- 칩 '진행 중 n' / '전체 코일 계획 n'.
- 그룹 '코일 계획 · 편성 확정 · 생산 중'. 전체를 고르면 '편성 전 · 완료 · 취소' 그룹이 추가됨.
- 각 항목에 '열연 실적 a/b'. 빈 문구는 RA:69,74,87.

**상세**
- 셸 '열연 투입 배정 · {번호}'. 버튼: 수주 상세, 작업 로그, '공정 실적 · 열연 등록'.
- 코일 계획이 아니면 '코일 계획이 아니에요'(RA:176-177).
- 지표 9개(RA:182-196): 코일 수주 품목, 제품, 소재 슬래브, 목표 · 압연 완료, 남은 압연, 슬래브 추가 확보 필요, 귀속 슬래브, 배정 확정, 투입 완료.
- 단계 표시: 히트 편성 → FIFO 추천 → 배정 확정 → 열연 실적 → 코일 검사(RA:144-150).
- 'FIFO 추천 슬래브' 카드(RA:204-308):
  - 'FIFO 추천' 버튼(추천 뒤에는 '다시 추천'): ROLLING_ALLOCATE && CONFIRMED·IN_PROGRESS일 때 활성. POST /allocations/recommend {purpose:'ROLLING'}. 추천된 LOT이 자동으로 선택됨.
  - 결과 지표: 필요 (전체) / 이미 확정 / 더 배정할 매수 / 추천으로 못 채우는 매수.
  - 표: 선택 | 순위 | 슬래브 LOT | 히트 | 생산완료일 | 야드 | 구분('귀속분'/'여재') | 추천('FIFO 추천'/'후보'). 선택은 neededQty까지만 가능.
  - 추천과 다르게 고르면 필드 '추천과 다르게 고른 사유 (선택)'가 나옴. 최대 500자, hint는 '…작업 로그에 "배정 변경"으로 남아요'.
  - 하단: '선택 n매 · 이론중량 t (계산값)'(클라이언트에서 calcWeightTon으로 계산), '선택 해제', '배정 확정'.
  - '배정 확정': POST /allocations {purpose:'ROLLING', productionPlanId, lotIds, reason?}. 토스트 '슬래브 n매를 열연 투입으로 배정했어요[ (추천과 다르게 선택)] · 남은 필요 n매'.
  - 빈 문구: RA:273, RA:305.
- '확정 배정' 카드(RA:310-349):
  - 표: 슬래브 LOT | 히트 | 상태 | 배정 확정 | 투입 · 해제 | 작업.
  - CONFIRMED 행에만 '배정 해제'(ROLLING_ALLOCATE). POST /allocations/:id/release. 사유 입력은 없음. 토스트 '{LOT} 배정을 해제했어요'.

### A-4. 재고 `/inventories` (INV), 조회 전용

- 탭 제품/원료/여재(`?tab=`). 안내 '조회 전용 · 예약·출고·검사가 반영되면 바로 바뀌어요'.
- 강종 select('전체'와 lookups의 강종 목록).

**제품 탭** (INV:75-149)
- GET /inventories?itemType&steelGrade. 세그먼트 전체/슬래브/코일.
- KPI: '{유형} · 규격 n개', '가용 n', '합격 재고 n − 예약 n'. 클라이언트에서 합산.
- 표 열과 툴팁:
  - 규격 | 유형 | 강종 | 치수 (두께 × 폭 × 길이 mm) | 1매 중량
  - 합격 재고: '여재 포함, 열연 투입용 귀속 제외'
  - 예약: '(ACTIVE)'
  - 가용 | 가용 톤
  - 검사 대기 | 불합격
  - 열연 투입용 귀속: 코일 행은 '—'
  - 야드
- 모든 값이 0인 행은 흐리게(INVcss:4). 캡션 INV:138.

**원료 탭**: GET /inventories?itemType=RAW_MATERIAL. 열은 원료 | 코드 | 종류 | 잔량 (t) | 입고예정 (t) | 야드.

**여재 탭** (INV:216-288)
- GET /inventories/surplus.
- 배너 '…여재는 가용재고에 포함돼요…'.
- '규격별 여재': 규격 | 강종 | 여재 | 여재 톤 (계산값) | 여재 중 예약 | 여재 중 가용.
  - 마지막 두 열은 클라이언트에서 계산함: 가용 = min(여재, 가용), 예약 = max(0, 여재 − 가용)(INV:236-239).
- '여재 슬래브'(생산완료일 오래된 순): LOT | 규격 | 강종 | 히트 | 생산완료 | 보유 기간 | 1매 중량 | 야드 | 생산계획('계획 보기').
- 로딩 문구는 '재고를/원료 재고를/여재를 불러오는 중…'.

### A-5. 공통 표시

**배지 (코드 → 화면 라벨)**
- 생산계획: PLANNED 계획 / CONFIRMED 편성 확정 / IN_PROGRESS 생산 중 / COMPLETED 완료 / CANCELLED 취소 (UI:13, CODES:136)
- 실적: READY 대기 / STARTED 작업 중 / COMPLETED 완료 (CODES:141)
- 배정: 배정 확정 / 소진 / 해제
- 검사(UI:42-49):
  - 용선은 '검사 없음'
  - 불합격, '히트 불합격'
  - 검사 대기, '히트 검사 대기'
  - 합격
- LOT 상태(UI:51-57): 처리 상태(보류·격하·폐기) → '투입·소진'/'출고' → '배정 확정' → '열연 투입용 귀속' → '재고' 순서로 첫 번째 해당하는 것을 표시.

**공통 상태 처리**
- 조회(UIC:53-69):
  - 로딩: '불러오는 중…'
  - 오류: '불러오지 못했어요', 메시지와 코드, '다시 시도' 버튼
  - 403: '이 화면을 볼 권한이 없어요'
- 변경: 성공 토스트 3.5초, 실패 토스트 '{메시지} ({코드})' 6초. 끝나면 관련 주제를 다시 불러옴.

**'준비 중' 표시**: PP:249와 PM:173의 SoonButton '자동 초안'(준비 중 (P2)), PM:244 문구. 재고 화면에는 없음.

---

## B. API 의존성

**공통 규약**
- base `/api/v1`(CLI:15). 응답은 `{success, data}` 또는 `{success:false, error:{code,message}}`.
- 토큰은 sessionStorage에 두고 `Authorization: Bearer`로 보냄(AUTH:5-36, CLI:27-29). 401이면 세션을 지움.
- Decimal·톤·수율은 문자열, 시각은 ISO. GET 쿼리는 빈 값을 빼고 문자열로 바꿈(boolean은 'true').
- 쿼리 키의 첫 요소가 실시간 주제 이름임. 변경 후 다시 불러오는 주제:
  - 공통: production-plans, production-results, lots, inventories, allocations (PH:9)
  - 작업 완료: 위에 + quality-inspections, sales-orders
  - 시뮬레이션: 위에 + quality-inspections, sales-orders, business-events
  - 재생산·취소: 위에 + sales-orders

| 함수 | 메서드·경로 | 요청 | 응답 | 사용처 |
|---|---|---|---|---|
| productionApi.plans | GET /production-plans?status&itemType&needsAction | PlanListQuery | PlanSummary[] | PP:36, PR:24, RA:23, PH:45 |
| .plan | GET /production-plans/:id | - | PlanDetail | PH:16 |
| .heatPreview | POST /production-plans/:id/heat-preview | {surplusUseQty} | HeatPreview | HPC:50 (useQuery로 사용) |
| .confirm | POST /production-plans/:id/confirm | {surplusUseQty} | PlanDetail | HPC:56 |
| .cancel | POST /production-plans/:id/cancel | {reason?} | PlanDetail | PM:256 |
| .reproductionPreview | GET /production-plans/reproduction-preview?salesOrderItemId | - | ReproductionPreview | PP:120, PM:157 |
| .createReproduction | POST /production-plans | {salesOrderItemId, reason?} | ReproductionResult | PM:158 |
| .simulate | POST /production-plans/:id/simulate-results | {seed?, includeInspection?, untilProcess?} | SimulateResult | PM:45 |
| .results | GET /production-results?planId&processCode&status | (planId만 사용) | ResultView[] | PH:20 |
| .startResult | POST /production-results/:id/start | {} | ResultView | PR:124 |
| .completeResult | POST /production-results/:id/complete | CompleteBody | ResultView | CRM:26 |
| allocationApi.recommend | POST /allocations/recommend | {purpose, productionPlanId? / shipmentRequestItemId?} | AllocationRecommendationView | RA:116 |
| allocationApi.confirm | POST /allocations | {purpose, productionPlanId, lotIds, releaseAllocationIds?(화면 미사용), reason?} | AllocationConfirmView | RA:120 |
| allocationApi.release | POST /allocations/:id/release | {reason?}(화면은 항상 생략) | AllocationReleaseView | RA:126 |
| inventoryApi.list | GET /inventories?itemType&steelGrade&productSpecId | ListInventoriesQuery | {products, rawMaterials} | IH:6 |
| inventoryApi.surplus | GET /inventories/surplus?steelGrade&productSpecId | ListSurplusQuery | {lots, specs} | IH:10 |
| lookupApi.get | GET /master-data/lookups | - | Lookups(steelGrades만 사용) | INV:35 |

**타입 필드**
- **SpecView**(APIP:8-17): id, specCode, itemType, steelGradeCode, thicknessMm, widthMm, lengthMm, theoreticalWeightTon
- **PlanSalesOrder**: salesOrderId, salesOrderNo, salesOrderItemId, lineNo, orderedQty, salesOrderItemStatus(string), customerName, dueDate, ownerEmployeeName
- **PlanProgress**: processCode, totalCount, startedCount, completedCount
- **PlanSummary**(APIP:34-60): id, productionPlanNo, productionPlanStatus, isReproduction, itemType, productSpec, slabSpec\|null, steelGrade{id,steelGradeCode,steelGradeName}, salesOrder\|null, shortageQty, shortageTon, surplusUseQty, heatCount, plannedSlabQty, requiredInputTon, cumulativeYieldRate\|null, progress[], needsAction, createdAt, confirmedAt, completedAt, cancelledAt
- **PlanDetail**: PlanSummary + results[], lots{hotMetals,heats,slabs,coils}, earmarkedSlabs[], rollingAllocations[], rolling\|null{rolledQty, remainingQty, rollingNeedQty, earmarkedSlabQty, confirmedAllocationQty}, surplus{expectedQty, actualQty}, remainingTargetQty
- **PlanLotView**(APIP:64-87): id, lotNo, lotType, lotStatus('IN_STOCK'\|'CONSUMED'\|'SHIPPED'), isPassed, heatLotId, heatLotNo, heatIsPassed, isEligible, isEarmarked, confirmedAllocationId, productSpecId, specCode, weightTon, initialTon, remainingTon, salesOrderItemId, productionPlanId, productionResultId, dispositionStatus, producedAt
- **ResultView**(APIP:91-114): id, productionPlanId, productionPlanNo, processCode, heatSeq, productionResultStatus, startedAt, completedAt, blastFurnaceNo, converterNo, inputTon, outputTon, plannedQty, outputQty, lossQty, sampledLossRate, isSimulated, operatorEmployeeId, defaultHotMetalTon, lots[{id, lotNo, lotType, isPassed}]
- **PlanRollingAllocation**: id, status, lotId, lotNo, heatLotNo, confirmedAt, consumedAt, releasedAt
- **HeatPreview**(APIP:158-183): productionPlanId/No/Status, itemType, shortageQty, surplusUseQty, targetQty, targetTon, steelmaking·casting·hotRolling·cumulativeYieldRate, requiredInputTon, heatCapacityTon, heatCount, heatTon, hotMetalTon, slabQtyPerHeat, plannedSlabQty, expectedSurplusQty, slabSpecId, surplus{availableQty, maxUseQty, lots}, rawMaterials[{rawMaterialId, materialCode, rawMaterialName, rawMaterialType, requiredTon, remainingTon, shortageTon, isShort}], hasRawShortage
- **ReproductionPreview**(APIP:185-204): salesOrderItemId, salesOrderId, salesOrderNo, lineNo, customerName, salesOrderItemStatus, productSpec, orderedQty, shippedQty, unsecuredQty, openPlans[{id, productionPlanNo, productionPlanStatus, shortageQty, remainingTargetQty}], openPlanRemainingQty, additionalQty, stockAvailableQty, planQty, surplus\|null{slabSpec, availableQty, lots}
- **ReproductionResult**: additionalQty, reservedFromStockQty, planQty, plan\|null
- **CompleteBody**: blastFurnaceNo?, hotMetalTon?, converterNo?, outputQty?, allocationIds?
- **SimulateStep**: kind('RESULT'\|'INSPECTION'\|'ALLOCATION'), processCode, heatSeq, productionResultId, lotNos[], plannedQty, outputQty, lossQty
- **SimulateResult**: productionPlanId, seed, sampledLossRate, includeInspection, untilProcess, steps[], notes[], plan
- **AllocationLotView**: lotId, lotNo, lotType, heatNo, producedAt, yardName, isEarmarked
- **ConfirmedAllocationView**: id, lotId, lotNo, lotType, heatNo, producedAt, status, confirmedAt
- **AllocationRecommendationView**: purpose, shipmentRequestItemId, shipmentRequestId, productionPlanId, salesOrderItemId, salesOrderNo, salesOrderLineNo, productSpecId, specCode, requiredQty, confirmedQty, neededQty, recommendedLots[], shortageQty, candidateLots[](최대 200), confirmedAllocations[]
- **AllocationConfirmView**: purpose, shipmentRequestItemId, shipmentRequestId, productionPlanId, allocations[], releasedAllocationIds[], recommendedLotNos[], isRecommendationFollowed, neededQty, shipmentRequestItemStatus, shipmentRequestStatus
- **AllocationReleaseView**: id, purpose, status, lotId, lotNo, shipmentRequestItemStatus, shipmentRequestStatus
- **ProductInventoryView**(APII:12-37): productSpecId, specCode, itemType, qtyUnit, steelGradeId, steelGradeCode, thicknessMm, widthMm, lengthMm, theoreticalWeightTon, yardName, onHandQty, reservedQty, availableQty, pendingInspectionQty, failedQty, earmarkedQty, onHandTon, reservedTon, availableTon
- **RawMaterialInventoryView**: rawMaterialId, materialCode, itemCode, itemName, rawMaterialType(string), yardName, onHandTon, scheduledReceiptTon
- **SurplusLotView**: lotId, lotNo, productSpecId, specCode, steelGradeCode, heatNo, producedAt, ageDays, theoreticalWeightTon, yardName, productionPlanId
- **SurplusSpecView**: productSpecId, specCode, steelGradeCode, surplusQty, surplusTon, reservedQty, availableQty

**목업 참고: 화면이 읽지 않는 필드**
- PlanSummary.steelGrade·createdAt
- PlanLotView.isEligible·heatLotId·productSpecId·specCode·salesOrderItemId·productionResultId
- ResultView.operatorEmployeeId
- HeatPreview.productionPlanId·productionPlanNo·productionPlanStatus·slabSpecId, rawMaterials[].rawMaterialType
- ReproductionPreview.salesOrderItemId·surplus.lots, ReproductionResult.additionalQty
- SimulateBody.untilProcess(입력 UI 없음)
- AllocationRecommendationView.confirmedAllocations·shipment 관련·salesOrder 관련 필드
- AllocationConfirmView.releasedAllocationIds·recommendedLotNos
- SurplusSpecView.reservedQty, ProductInventoryView.steelGradeId

**업무 프로세스 정의서 12.2와 비교**
- 같음: heat-preview·confirm, simulate-results, allocations/recommend, POST allocations, POST allocations/:id/release.
- 12.2에 없음: 계획 목록·상세·취소·reproduction-preview·POST /production-plans(재생산), GET /production-results, /production-results/:id/start·/complete(12.2는 `POST /production-results`), GET /inventories/surplus.
- 재고 조회 파라미터: 12.2는 `?itemId=`, 코드는 itemType·steelGrade·productSpecId.

---

## C. 갭 분석

### C1. 요구사항 커버리지

| REQ | 판정 | 근거 |
|---|---|---|
| PRD-001 | 부분 | 계획 생성은 수주 등록 때 일어나서 이 영역 밖임(PP:83). 화면은 수주 품목 연결만 표시함(PP:212-236, UI:125-133). '부족 매수'를 '목표 매수'로 표시(PP:186). |
| PRD-002 | 커버(용어·상태 다름) | 미리보기·확정·계산표가 있음(HPC). 다만 '필요 용강량'을 '필요 투입량'이라 부르고, 확정하면 CONFIRMED 상태를 만듦. |
| PRD-003 | 커버(방식 다름) | 시작과 완료를 따로 기록함(PR:286-297, CRM). 대신 작업에 상태값(READY/STARTED/COMPLETED)이 있고, 작업일시는 직접 입력하지 않고 서버의 현재 시각을 씀(CRM:113). |
| PRD-004 | 커버(정의 다름) | 확정 배정분만 압연함(CRM:155-189). 안내 문구도 PP:456, RA:346에 있음. 다만 '귀속' 단계가 있음(C5-7). |
| PRD-005 | 부분, 영역 밖 | 편성 카드에 원료 총소요·현재 재고·부족과 MRP 링크만 있음. 부족은 입고예정을 빼지 않은 값(HPC:197-237). |
| PRD-006 | 커버 | 재생산 필요 배너와 재생산 모달이 있고, 공식이 4.5와 같음(PM:205). 자동 초안(P2)은 '준비 중'으로 표시. |
| PRD-007 | 커버(위치·표시 다름) | 시드 입력, 연주만 0~5% 손실(PM:131), 손실률 결과 표시가 있음. 버튼은 생산계획 화면에만 있음(PP:153-157). |
| INV-001 | 커버 | 제품은 매수와 톤 계산값(INV:117-122), 예약 매수(INV:120), 원료는 톤(INV:185-186). |
| INV-002 | 부분 | 예약 매수 합계(ACTIVE)만 보임. 예약 건별 목록이나 상태(ACTIVE/CONVERTED/RELEASED)는 이 영역에 없음. |
| INV-003 | 부분(표시만) | 합격 재고·검사 대기·불합격을 나눠 보이고, 히트 상위 검사도 반영함(INV:119,123,124; UI:42-49). 판정 로직은 서버. |
| INV-004 | 미표시 | 자동 예약 결과를 보여 주는 곳이 없음. |
| INV-005 | 영역 밖 | - |
| INV-006 | 부분 | 열연 투입 목적만 다룸: 추천(저장 안 한다는 안내 RA:305), 확정, 해제, 추천과 다른 선택의 사유. 기존 배정을 바꾸는 '변경' UI는 없음(APIA:59 미사용). 추천 순서에 '귀속분 우선'이 붙음(RA:220). |
| INV-007 | 부분(표시만) | 추천 후보는 합격 슬래브만(RA:208), 불합격·히트 불합격 배지(UI:44-45), 재고에서 불합격 열을 따로 둠(INV:124). |
| INV-008 | 커버(정의 다름) | 여재 탭과 '가용재고에 포함' 문구(INV:229)가 있음. 다만 귀속 슬래브는 여재·가용에서 빠지고, 규격별 '여재 중 예약/가용'은 화면에서 계산함. |
| INV-009 | 서버 몫 | 화면에는 안내 문구(RA:346), 오류 배너(RA:202), 선택 수 상한(RA:140-141)만 있음. |
| LOT-002 | 부분 | FIFO 차감은 문구로만 설명함(CRM:130,139; HPC:234). 실제로 투입된 상위 LOT과 연결 근거(기간 기반·실제 투입)는 이 영역에 표시되지 않음. |
| LOT-003 | 부분 | 채번 형식 안내가 있음(CRM:117,136,151,187). 코일 형식에 '(HT- 제외)'가 빠졌고, 고로·전로를 '번호'라 부르며 예시가 '1'임. |
| MST-009 | 커버(표시만) | 서버의 히트 용량을 표시하고 계산식에 씀(HPC:34-37,103,138). '용강 기준' 설명이 문서와 같음. 값을 바꾸는 화면은 영역 밖. |

### C2. 용어 사전과 다른 표기

1. **작업 실적(TRM-047, 금지어: 공정 실적)** → '공정 실적'으로 표기.
   - 위치: NAV:38, TTL:18, PP:148, PR:94, PR:307, RA:172, HPC:56, PM:15, PM:72, PM:131, CODES:85(PERMISSIONS 라벨). 주석 PR:1, UI:1, PH:1, APIP:1.
   - 참고: 공통 코드 정의서의 PERMISSION 표시명과 업무 프로세스 정의서 BP-PRD-02('공정 실적 화면')도 '공정 실적'을 씀. 문서끼리도 어긋나 있음.
2. **열연(TRM-008, 금지어: 압연을 공정명으로)**.
   - 명사로 공정을 가리키는 곳: PP:275·417·421, PR:112, RA:190·191, CRM:83·159·187.
   - 동사로만 쓴 곳(용어 사전 TRM-018 정의도 동사로 씀): PR:76·215, CRM:82·158.
3. **히트(TRM-016, 금지어: Heat LOT)** → '히트 LOT'으로 표기: CRM:136, CRM:139, PP:392(히트 탭의 빈 상태 문구).
4. **가용재고(TRM-055, 금지어: 가용 재고·가용량)**
   - 띄어 쓴 '가용 재고': PM:159(토스트), PM:229, 주석 PM:152.
   - 한글명을 줄인 '가용': INV:104·121·122·138·234.
5. **부족 매수(TRM-041)** → '목표 매수'/'목표': PP:186, PP:197, PR:163, RA:190, 주석 APIP:46.
6. **필요 용강량(REQ-PRD-002, TRM-026·046)** → '필요 투입량': PP:191·198, HPC:33·34·91·101·138.
7. **고로·전로 코드(TRM-009·010, REQ-LOT-003, BP-PRD-02)** → '고로 번호'·'전로 번호': CRM:68·73·117·136, PR:212·213.
8. **소요량(TRM-050, 금지어: 필요량)** → CRM:122 '필요량'. 용선 필요량을 가리키는 말이라 해당 여부는 해석 여지가 있음.
9. **'작업 지시'**(PR:1,39,42,47,140): 용어 사전 '제외한 용어'에 있는 '생산지시'와 같은 개념.
10. **해당 없음**: 잔재·잉여재고, 할당·선점, 레시피·배합, 슬라브, 로트, 가용량은 0건. 'Allocation'은 배정 뜻으로만 씀.

### C3. 공통 코드 정의서와 다른 값·라벨

1. **PRODUCTION_PLAN_STATUS** (CODES:133-137)
   - CONFIRMED('편성 확정')가 추가되어 있음. 사용처: PP:22(필터에 노출), PP:114·116·412, PR:18·32·132, RA:17·108, UI:13.
   - IN_PROGRESS 라벨이 '생산 중'(문서는 '진행중'). 쓰이는 곳: CODES:136, PR:58·60, RA:67·212·305.
2. **작업 실적 상태**: 문서에는 상태값이 없음. 코드는 PRODUCTION_RESULT_STATUS READY 대기 / STARTED 작업 중 / COMPLETED 완료(CODES:139-141).
   - 사용처: PP:115·298·310, PR:230·266·287·291·306, UI:14·33-35, APIP:98·252.
3. **PROCESS_TYPE**: 코드는 그룹 이름이 PROCESS_CODE·PROCESS_ORDER이고 값이 CASTING(CODES:48-51). 필드명은 processCode.
   - 'CASTING' 사용처: PP:274, PR:105·214·245, CRM:75·143, PM:21·63.
   - 라벨은 문서와 같음.
4. **LOT_STATUS**: 코드는 AVAILABLE 대신 IN_STOCK, CONSUMED 라벨이 '투입·소진'(문서는 '투입 소진')(CODES:191-193). 사용처 UI:53·56, APIP:68.
5. **ALLOCATION_PURPOSE**: 코드는 HOT_ROLLING 대신 ROLLING(CODES:203-205). 사용처 RA:142·297(문자열 리터럴).
6. **ALLOCATION_STATUS**: 값·라벨이 일치함. APIP:116에 같은 값을 따로 다시 정의함.
7. **RESERVATION_STATUS**: 일치함. 화면 노출은 툴팁의 '(ACTIVE)' 원문(INV:120)뿐.
8. **PERMISSION**: 문서는 PRODUCTION_PLAN_CONFIRM·PRODUCTION_RESULT_CONFIRM·HOT_ROLLING_ALLOCATE, 코드는 PLAN_CONFIRM·RESULT_CONFIRM·ROLLING_ALLOCATE(CODES:68,84-86,100-108).
   - 사용처: PP:106·107·460, PR:120, RA:105, HPC:45, PM:40·155, PH:48, NAV:37-39.
   - RESULT_CONFIRM 라벨에 문서의 '(실적 시뮬레이션 포함)'이 빠져 있음.
   - (영역 밖 참고) 같은 그룹의 ORDER_*·PO_CONFIRM·RECEIPT_CONFIRM·MILLSHEET_READ도 이름이 다르고, INSPECTION_STANDARD_MANAGE는 아예 없음(CODES:64-71).
9. **LOT_RELATION_EVIDENCE**: 코드는 LOT_EVIDENCE_TYPE, 값이 PERIOD '기간 기반' / DIRECT '직접 투입'(CODES:199-201). 문서는 PERIOD_BASED '기간 기반' / ACTUAL_INPUT '실제 투입'.
   - 이 영역 파일에서는 쓰지 않음. client 전체에서 features/trace/LotDetailPanel.tsx:4,117 한 곳.
10. **INSPECTION_RESULT**: PENDING 라벨이 '검사 대기'(문서는 '판정 대기')(CODES:162). 화면 UI:46·47. 같은 뜻의 문구 INV:123·138, CRM:139·151·187, PM:107·143.
11. **SALES_ORDER_ITEM_STATUS**: 코드에는 REGISTERED '접수', IN_PROGRESS '진행 중'이 있고 문서의 OPEN '진행중'이 없음(CODES:113-119). 이 영역 노출 PP:226, PM:150·195.
12. **ACTOR_TYPE**: 문서 라벨은 '시스템'인데 화면은 원문 'SYSTEM'을 그대로 출력함: PP:83, PP:309, PR:267, PM:107.
13. **일치**: ITEM_TYPE, RAW_MATERIAL_TYPE, LOT_TYPE, DISPOSITION_STATUS, 화면 단위(매/개).
14. **(참고) BUSINESS_EVENT_TYPE**
    - PRODUCTION_PLAN_CONFIRMED '히트 편성'(CODES:243,259)은 문서 목록에 없음.
    - 작업 시작·완료는 문서가 PRODUCTION_STARTED·PRODUCTION_RESULT_REGISTERED, 코드는 WORK_STARTED·WORK_COMPLETED·RESULT_REGISTERED(CODES:239).

### C4. 문서에 없는 화면 요소

1. **'편성 확정' 단계와 CONFIRMED 상태**
   - 위치: HPC:249-257, HPC:56, PP:198, PR:61, RA:67. 실적 진입 조건 문구 PP:83·PR:76·82·182·RA:82·87·212·305. 편성 대기 배지 PH:42-52.
   - 문서 근거는 BP-PRD-01의 '담당자 확인'과 12.2의 '/confirm' 제안뿐이고, 상태값은 정의되어 있지 않음.
2. **작업 '대기' 상태와 실적 행 미리 생성**: HPC:243, PP:320. 남은 양만큼 행이 이어서 생기는 동작 CRM:122·187.
3. **'작업 지시' 목록**(PR:39-47,140).
4. **'조치 필요' 필터·표시**(PP:62, UI:143, APIP:55·251). 무엇을 조치해야 하는지 화면에 정의가 없음.
5. **'귀속' 상태**
   - 위치: UI:55, INV:119·125·138, PP:425·432·437, RA:193·220·267, HPC:166·184, PM:275.
   - 데이터: earmarkedQty·earmarkedSlabQty·earmarkedSlabs·isEarmarked.
6. **히트 편성의 '여재 사용 매수' 입력**(HPC:142-195)과 '여재 사용' 지표(PP:187, PR:165).
7. **문서 4.4에 없는 계산 행**: 새로 생산할 매수(HPC:30), 히트당 슬래브 매수(HPC:37), 계획 슬래브 매수(HPC:38).
8. **'슬래브 추가 확보 필요' 지표**(PP:423-424, RA:192)와 **'실제 여재'**(PP:200).
9. **'여재 중 예약/가용'**: 화면에서 계산함(INV:234-239·257).
10. **생산 담당의 단독 '계획 취소' 기능과 사유 입력**(HPC:246, PP:287-289, PM:254-284). 문서에서 계획 취소는 수주 취소 흐름(BP-SO-02)과 상태 규칙에만 나옴.
11. **추천과 다른 선택을 '배정 변경'으로 기록**(RA:278-283).
12. **Agent 박스 문구**의 '일정 초안'과 '부서장 승인 후에만 반영'(PP:246).
13. **시뮬레이션의 '검사 포함' 끄기 옵션**(PM:139-143).
14. **D-라벨과 'D+' 위험색**(PP:222, UI:102·142). 문서의 납기 위험은 P2 기능이고 기준이 3일임.
15. **고로·전로 '영문·숫자 4자 이내' 규칙**(CRM:12).
16. **'원료 부족이어도 편성 확정 가능, 실적은 불가' 안내**(HPC:226).

### C5. 업무 규칙 불일치

1. **10장 생산계획 상태 전이**
   - 문서는 PLANNED → IN_PROGRESS(첫 실적 등록 시) → COMPLETED이고, 취소는 PLANNED에서만 됨.
   - 화면은 PLANNED → CONFIRMED → IN_PROGRESS로 가고, 취소 조건이 'PLANNED, 또는 CONFIRMED이면서 모든 실적이 READY'임(PP:116).
   - 같은 화면에서 안내가 둘로 갈림: HPC:243 '편성을 확정하기 전까지' vs PP:288·PM:274 '작업을 시작하기 전에만'.
   - 목록 그룹 문구 '편성 확정 · 시작 전'(PR:61)은 IN_PROGRESS가 '작업 시작' 시점에 붙는 것으로 읽힘. 서버가 실제로 언제 바꾸는지는 확인하지 않음.
2. **10장 작업 상태**: 문서는 '상태값 없음'. 화면은 상태 열(PR:246)이 있고 상태로 버튼을 나눔(PR:286-297).
3. **BP-PRD-02 입력 항목**: 문서는 작업일시, 원료 투입 기간, 제강 '투입 용선량'을 입력받음. 화면은 서버의 현재 시각을 쓰고(CRM:113), 제강 투입량 입력이 없음(CRM:134-141).
4. **BP-PRD-02 시뮬레이션 위치**: 문서는 공정 실적 화면에서 실행. 화면은 생산계획 상세에만 버튼이 있음(PP:153-157). PR에는 없음.
5. **BP-SEED-01**
   - 'floor(계획 매수 × 샘플 손실률)' 처리와 '실제 감소율'이 화면에 나오지 않음. 샘플 손실률과 손실 매수만 보임(PM:80-81, PR:272).
   - 생성 범위 중 '출하'가 없음(SimulateStep.kind, APIP:230).
   - 손실률 표기 방식이 화면마다 다름: PM:80은 fmtRate, PR:272는 toFixed(2).
6. **4.4 계산**
   - 목표중량: 편성 카드는 (부족 − 여재 사용) × 이론중량(HPC:30-31)인데, 같은 카드 캡션(HPC:138)과 상세 상단(PP:197)은 부족 매수 기준. 여재를 쓰면 화면에 서로 다른 목표중량이 두 개 보임.
   - 누적 계획수율: 문서는 '슬래브 수주는 연주 수율만'인데, 계산 행 문구는 유형과 상관없이 '연주 × 열연'(HPC:32).
   - 히트 수·히트 톤·필요 용선·원료·합금철 식은 문서와 같음.
7. **4.2 / REQ-INV-008 / TRM-048 여재**
   - 문서: 여재는 미배정 합격 슬래브이고 가용재고에 포함. 예약 가용 = 미소진 합격 − ACTIVE 예약 − 예약으로 커버되지 않는 열연용 CONFIRMED 배정.
   - 화면: '합격 재고(귀속 제외) − 예약'(INV:119,121,138). 배정을 확정하기 전에 '귀속'된 슬래브를 여재와 가용에서 미리 뺌.
   - REQ-PRD-004 '나머지는 미배정 여재로 남긴다'와도 귀속 단계만큼 차이가 남.
8. **FIFO 기준(REQ-INV-006, TRM-061)**: 문서는 생산완료일 순. 열연 추천은 '귀속분을 먼저'(RA:220).
9. **BP-INV-01 배정 변경**: 문서는 기존 배정 해제와 새 배정을 한 트랜잭션으로 처리. 화면은 해제(RA:333)와 확정(RA:292-300)을 따로 하고, 해제 사유를 받지 않음.
10. **REQ-LOT-002 문구**
    - 제강의 '이 계획의 용선 LOT을 FIFO로'(CRM:139): 문서는 계획으로 범위를 한정하지 않음.
    - 합금철 설명에 '÷ 1,000'과 '입고일 순'이 빠짐(HPC:234에는 ÷ 1,000이 있음).
11. **9.2 / REQ-LOT-003**: 코일 형식에 '(HT- 제외)'가 빠짐(CRM:187). 고로·전로 예시가 '1'(CRM:118,137)인데 문서는 'BF2, BOF1'.
12. **9.1 PP-YYMM-NNNN**: 화면은 서버의 계획번호를 그대로 보여 주기만 함. 형식을 만들거나 검증하는 곳이 없어 화면에서는 확인할 수 없음.
13. **BP-QC-01 재생산**
    - 문서는 여재와 진행 계획을 먼저 확인한 뒤 재생산(14.1 ⑥).
    - 화면의 '추가 필요' 식(PM:205)에는 코일 품목의 슬래브 여재가 들어가지 않고 안내만 나옴(PM:236-240). 그래서 여재가 있어도 재생산 계획을 만들 수 있음.
    - 슬래브 품목은 '예약 가용 재고'를 먼저 예약함(PM:229).
14. **REQ-AGT-006**: 재생산 후보는 담당 부서원이 확정하는데, 화면 문구는 '부서장 승인 후에만 반영돼요'(PP:246).
15. **수주 취소 시 여재 전환 표시(REQ-SO-006, BP-SO-02)**
    - 있는 것: '수주 연결 없음 (여재)'(UI:132), PP:233 안내, 경로의 '수주 연결 없음'(PP:134, PR:142).
    - 없는 것: '완료 후 여재' 같은 진행분 표시, LOT 상태의 '여재' 표기(UI:51-57은 '재고'만), 여재 전환 이벤트 표시.
    - 코일 계획: 문서는 '아직 열연 전이면 슬래브 단계에 남긴다'. 그런데 열연 추천·확정·실적 버튼 조건에 수주가 있는지 여부가 없음(RA:212·295, PP:149·458-463, PR:286-297).
16. **화면 안의 작은 불일치**
    - 작업 시작·완료 버튼이 계획 상태를 보지 않음(PR:286-297).
    - '실적 등록' 링크는 취소된 계획에도 보이는데(PP:290), '공정 실적' 버튼은 숨김(PP:148).
    - 재생산 토스트의 단위가 '매'로 고정되어 있음(PM:159). 코일이면 '개'여야 함.
    - PLANNED 계획을 공정 실적 상세로 열면 '0히트 · 슬래브 0매'로 보임(PR:164).

### C6. 코드 컨벤션 (2·4·9장)

1. **스택**: 컨벤션은 Next.js(App Router) + Tailwind로 확정. client는 Vite 7 + react-router 7이고, client/package.json 의존성에 Tailwind가 없음. 라우트는 APP:86,94-96에 있음.
2. **인라인 style** (9장 [강제]: Tailwind 우선)
   - style= 198곳: PP 41, PR 29, RA 38, CRM 10, HPC 23, PM 24, UI 16, INV 17.
   - 스타일 객체 상수 GROUP_STYLE(UI:17), 별도 CSS 파일 INVcss, 하드코딩 색 '#5E6977'(INV:104).
3. **API 호출 경로**
   - fetch를 직접 호출하는 곳은 0건(통과).
   - 컴포넌트 안에서 커스텀 훅을 거치지 않고 useQuery를 직접 씀: PP:120-124, HPC:50-55, PM:157.
4. **any·console**: 둘 다 0건(통과). 대신 타입을 느슨하게 둔 곳:
   - 단언: `so!`(PP:122), `as number`(PH:16,20)
   - 문자열 타입 뒤 캐스팅: salesOrderItemStatus(APIP:25,191 → PP:226, PM:150), HeatPreview.productionPlanStatus(APIP:161), rawMaterialType(APII:44 → INV:195)
   - lotType이 string: APIP:89, APIA:16·29
5. **공통코드를 한 곳에서만 정의**(4장 [강제])
   - api 타입에서 리터럴로 다시 정의함: APIP:6·62·68·85·116·151, APII:6·15, UI:19, INV:19. 문자열 리터럴 'ROLLING'(RA:142,297).
   - 상수 이름이 코드 그룹 ID와 다름: PROCESS_CODE, LOT_EVIDENCE_TYPE.
6. **네이밍**(2장)
   - 컴포넌트 파일은 PascalCase여야 함: prodUi.tsx.
   - 훅 파일은 use+camelCase여야 함: productionHooks.ts, inventoryHooks.ts.
   - 용어 사전과 다른 변수명: blastFurnaceNo·converterNo(APIP:101-102,216,220; CRM:70,74). 용어 사전은 blastFurnaceCode·converterCode.
   - heatLotNo(APIP:72,122)와 heatNo(APIA:17,30; APII:65)를 섞어 씀.
   - purpose 필드(APIA:8): 규칙상 allocationPurpose.
   - Boolean 이름: needsAction(APIP:55).
   - 생산완료일 필드가 producedAt이고, 화면이 시각까지 보여 줌(PP:389, RA:265, INV:272). HPC:182는 날짜만 보여 줘서 화면끼리도 다름. 5장은 생산완료일을 date 타입으로 정함.
7. **인증 토큰**(9장 [강제]: httpOnly 쿠키 사용, 프론트에서 토큰을 다루지 않음): sessionStorage에 토큰을 두고 Authorization 헤더로 보냄(AUTH:5-36, CLI:27-29). 파일 URL에는 쿼리로 토큰을 붙임(CLI:67-70).
8. **기타**
   - LockHint가 UI:174와 salesUi.tsx:42에 중복으로 있음.
   - 주석이 docs/api/*.md를 기준 문서로 가리킴(PP:1, PR:1, RA:2, APIP:1, APII:1, APIA:1).
   - 지켜진 것: @/ alias, named export, 변경 후 다시 불러오기.
