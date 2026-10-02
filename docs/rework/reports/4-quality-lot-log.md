# 품질·LOT 추적·작업 로그 화면 감사 보고서 (읽기 전용, 파일 수정 없음)

**범위와 읽은 자료**
- 지정한 대상 파일 27개는 모두 끝까지 읽었습니다. 줄 수 목록은 맨 끝 부록에 있습니다.
- 지정 문서도 모두 끝까지 읽었습니다.
  - 노션: 요구사항 정의서, 용어 사전, 공통 코드 정의서, 프로젝트 기획안, 코드 컨벤션
  - 로컬: `process.md` 1–1530행 전부 (`wc`는 1529로 나오지만 끝의 `</page>` 행까지 읽음)
  - 링크된 다른 노션 페이지는 열지 않았습니다.
- 라우트·메뉴·권한·토스트를 확인하려고 아래 클라이언트·공유 파일을 보조로 읽었습니다.
  - `App.tsx`(라우트), `shell/nav.ts`, `shell/titles.ts`, `shell/shellTitle.tsx`
  - `components/ui.tsx`, `stores/auth.ts`, `stores/toast.ts`, `hooks/useApi.ts`
  - `api/client.ts`, `api/queryClient.ts`, `shared/src/codes/index.ts`, `shared/src/api.ts`
- `server/`, prisma 스키마, `docs/api`, `docs/names`, `docs/SERVER-GUIDE.md`는 열지 않았습니다.
- `CLAUDE.md`가 작업 전 필독으로 정한 `SPEC.md`(78행)도 읽었습니다. 차이 판정의 기준으로는 쓰지 않고 원인 설명에만 인용합니다.
- 서버가 내려주는 표시 문구(`*Label` 필드: `eventTypeLabel`, `lotStatusLabel`, `inspectionResultLabel`, `evidenceLabel`, `statusLabel`, `purposeLabel` 등)는 서버를 보지 않았으므로 확인하지 못했습니다. 클라이언트 주석과 공유 코드 기준으로만 적었습니다.

---

## A. 화면 인벤토리

### A-1. 검사 입력 — `/quality/inspections?lot=<lotId>` (App.tsx:97, InspectionPage.tsx)

**제목**
- 기본: '검사 입력', 영역 '품질' (titles.ts:20)
- LOT을 고르면 제목은 LOT번호, 부제는 '검사 입력' (InspectionPage.tsx:54)

**메뉴·진입 경로**
- 왼쪽 메뉴: 품질 역할에만 '검사 입력'이 있습니다 (nav.ts:44). 조건은 `INSPECTION_REGISTER` VIEW 이상이고, 배지는 검사 대기 LOT 수입니다 (qualityHooks.ts:23-26).
- 생산·관리자는 시드상 `INSPECTION_REGISTER=VIEW`이지만 메뉴 항목은 없습니다 (shared codes:102,108).
- 다른 화면에서 들어오는 링크:
  - 대시보드 바로가기 (DashboardPage.tsx:26)
  - 공정 실적 (ProductionResultPage.tsx:155,176)
  - 생산계획의 판정 배지 (ProductionPlanPage.tsx:385)
  - 실적 완료 모달 (CompleteResultModal.tsx:57)
  - 불합격 관리 (RejectedLotPage.tsx:127,161)
- 라우트에는 권한 가드가 없습니다. 로그인만 확인하므로(App.tsx:51-59) URL로는 누구나 들어올 수 있고, 변경 버튼만 USE 권한으로 막힙니다.

**구성 순서 — 왼쪽 목록** (section aria '검사 대기 목록', L74)
1. 제목 '검사 대기열'과 정렬 안내. 완료 탭이면 '최근 검사 순', 그 밖에는 '생산 시각 순' (L77-78).
2. 탭(aria '공정별 보기'): '전체 n', '제강 n', '연주 n', '열연 n', '완료 n' (L80-86). 공정 이름은 `PROCESS_CODE_LABEL`에서 가져옵니다.
3. 탭 설명 (L87-89)
   - 전체: '제강 히트 성분 · 연주 슬래브 표면·치수 · 열연 코일 치수·기계적 성질'
   - 완료: '등록한 검사 (최근 300건까지)'
   - 공정 탭: '히트 성분 검사' / '슬래브 표면·치수 검사' / '코일 치수·기계적 성질 검사' (qualityUtil.ts:119-123)
4. 검색창 'LOT번호 검색' (L90-93). 대기 목록은 LOT번호, 완료 목록은 LOT번호·검사번호를 부분일치로 찾습니다.
5. 대기 항목 (L98-109)
   - 1행: 종류 아이콘, LOT번호, 배지 '대기 {n분 | n시간 n분 | n일 n시간}' (waitText)
   - 2행: `{종류} · {공정} · {강종} {규격}`
   - 3행: `계획 {번호}` 또는 '계획 없음', 뒤에 ` · 수주 {번호}`
   - 4행: `생산 {MM-DD HH:mm}`. 슬래브·코일인데 히트가 아직 판정 전이면 ' · 상위 히트 판정 전'을 붙입니다.
6. 완료 항목 (L120-130)
   - 1행: LOT번호와 판정 배지
   - 2행: `{종류} · {검사명} · {강종} {규격}`
   - 3행: `{검사번호} · {MM-DD HH:mm} · {검사자 | '시스템'}`
7. 안내 띠 (L111-114): '제강·연주·열연 실적이 저장되면 LOT이 이 대기열에 올라와요. 히트가 판정 전이어도 슬래브는 먼저 검사할 수 있어요.'

**구성 순서 — 본문**
1. LotHeader
   - 빵부스러기 '품질 › 검사 입력 › {종류}'
   - LOT번호(LOT 추적 링크), 종류 태그
   - 배지: 판정 결과, 또는 '검사 대기 {시간}'
   - 버튼: 'LOT 추적'(→ `/lots/trace?lot=`), '작업 로그'(→ `/business-events`, **필터 없음**), 'SoonButton 비슷한 사례 찾기 (EX)' (L151-163)
2. LotInfoCard (qualityUi.tsx:64-92)
   - '강종 · 규격'
   - '검사'
   - 'LOT 상태'
   - '생산 시각'
   - 슬래브·코일만: '상위 히트 성분 검사' (히트 링크 + '판정 전' / 합격 / 불합격)
   - '생산계획' (링크 또는 '없음')
   - '수주' (링크 + 고객사, 또는 '없음')
3. 아직 검사 전인 LOT
   - 히트가 판정 전이면 띠 '상위 히트 {번호}의 성분 검사가 아직 판정 전이에요. 먼저 검사할 수 있고, 히트가 합격해야 재고에 들어가요.' (L167-172)
   - 그 아래 InspectionForm
4. 이미 등록된 LOT: InspectionResultView

**InspectionForm**
- 카드 머리
  - 제목 '측정값', 메타 `{검사명} · 항목 n개 · 필수 m개` (L67-68)
  - 버튼 '기준 안 값으로 채우기'와 보조 문구 '데모용 도우미' (L70-73)
  - 안내 띠: '…기준(경계 포함)과 견준 **미리보기**예요. **시스템이 저장할 때 판정해요.**' (L77-80)
- 항목별 측정값 입력 (L83-118)

| 요소 | 내용 |
|---|---|
| 라벨 | 항목명. 필수면 '*'(title '필수'), 아니면 '선택' |
| 입력 형식 | 텍스트, `inputMode` decimal, 오른쪽 정렬. 숫자·`.`·`-` 이외 문자는 입력 즉시 제거 (L36) |
| 단위 | 항목의 `unit`을 접미사로 표시 (L108) |
| 게이지 | LimitGauge. 기준이 없으면 '기준이 없어 게이지를 그릴 수 없어요' |
| 기준 문구 | '기준 {a – b 단위 / a 단위 이상 / b 단위 이하 / 기준 없음}' (qualityUtil.ts:19-27) |
| 미리보기 배지 | '기준 없음', '미입력', '숫자 확인', '미리보기 합격', '미리보기 불합격' (L13-18) |
| 항목 아래 오류 문구 | '하한보다 {차이} {단위} 낮아요', '상한보다 … 높아요' (L113), '숫자(소수 4자리까지)로 입력해 주세요' (L114) |
| 검증 | 값 형식 `/^-?\d{1,8}(\.\d{1,4})?$/` (qualityUtil.ts:6). 미리보기 판정은 min ≤ 값 ≤ max, 경계 포함 (qualityUtil.ts:35-46) |

- '검사 메모': textarea 2행, 최대 500자, placeholder '시편 채취 위치 등 (선택)' (L120-123)
- 하단 고정 바 (aria '검사 등록', L127-142)
  - 안내 '미리보기 (저장할 때 시스템이 판정해요)'
  - 집계 '입력 x/y · 기준 밖 n개'
  - 막힌 이유 문구 (L57-61), 아래 중 하나:
    - '이 LOT의 검사 기준이 등록돼 있지 않아 입력할 수 없어요'
    - '기준(최소·최대)이 없는 필수 항목이 있어 판정할 수 없어요: …'
    - '숫자(소수 4자리까지)로 입력해 주세요: …'
    - '필수 측정값이 비어 있어요: …'
    - '측정값을 입력해 주세요'
  - 권한이 없으면 잠금 표시 '권한이 필요해요'
- 항목이 하나도 없을 때: '이 LOT의 검사 항목이 없어요. 관리자가 기준정보에서 검사 기준을 등록해야 해요.' (L81)

| 버튼 | 누를 수 있는 조건 | API |
|---|---|---|
| 기준 안 값으로 채우기 | `canUse('INSPECTION_REGISTER')`(USE) 이고 항목이 1개 이상 | 없음. 빈 칸만 기준 안 값으로 채움 (L38-48) |
| 검사 등록 (진행 중 '등록하는 중…') | USE, 항목 1개 이상, 필수 누락 0, 형식 오류 0, 기준 없는 필수 항목 0, 입력 1개 이상, 진행 중 아님 (L34) | `qualityApi.register` → `POST /api/v1/quality-inspections` `{lotId, values:[입력한 항목만 {inspectionItemCode, measuredValue(문자열)}], memo?}` |

**InspectionResultView** (방금 등록했거나 이미 등록된 LOT)
- 판정 카드 (L54-82)
  - '시스템 판정'(방금 등록) 또는 '판정'
  - '합격' / '불합격'과 '기준 밖 n개' 또는 '전 항목 기준 안'
  - 검사번호, 검사명 배지, '방금 등록' 배지
  - `{YYYY-MM-DD HH:mm} · 검사자 {이름 | '시스템'}`
  - 방금 등록이면 버튼 '다음 LOT 검사 남은 n건' 또는 '대기열로 돌아가기' (주소만 바꿈)
- '검사값' 카드, 메타 '판정에 쓴 기준과 함께 저장된 값 · 읽기 전용'
  - 표 열: **'항목 | 기준 | 측정값 | 판정 | 기준 안 위치'** (qualityUi.tsx:100)
  - 판정 칸: 합격/불합격 배지, 입력하지 않은 선택 항목은 '미입력'
  - 메모가 있으면 '메모' 줄
- '판정 뒤 처리' 카드 (L23-47)
  - 메타 '시스템이 같이 처리한 일 · 작업 로그 기준', '작업 로그' 링크(필터 없음)
  - 결과 안내 띠 5종 (stockNote, L11-21)
  - 이벤트 목록: LOT 이벤트(`limit=30`)와 수주의 `AUTO_RESERVED` 이벤트(`order=desc&limit=10`)를 합치고, 검사 시각 −2초~+30초 안의 것만 남깁니다 (qualityHooks.ts:75-95).
  - 비었을 때: '이 검사와 함께 기록된 후속 처리가 없어요 (자동 예약 대상이 아니면 기록되지 않아요)'
  - 버튼: 불합격이면 '불합격 관리에서 처리 상태 지정', 불합격이고 생산계획이 있으면 '생산계획 ({번호})', 합격이고 수주가 있으면 '수주 {번호}'

**로딩·빈 상태·오류·토스트**
- 대기열 로딩: '검사 대기열을 불러오는 중…' (L22)
- 오류: '불러오지 못했어요' + 메시지 + 코드 + '다시 시도'. 403이면 '이 화면을 볼 권한이 없어요' (ui.tsx:53-69)
- 완료 탭 (L118-131)
  - 로딩: '불러오는 중…'
  - 오류: '검사 기록을 불러오지 못했어요'
  - 빈 목록: '조건에 맞는 검사가 없어요' / '등록된 검사가 없어요'
- 대기 목록이 비었을 때: '조건에 맞는 검사 대기 LOT이 없어요' / '검사 대기 LOT이 없어요' (L110)
- 고를 LOT이 없을 때: '검사 대기 LOT이 없어요 · 실적이 저장되면 대기열에 올라와요' (L139)
- 목록에 없는 LOT (L142-147)
  - 제목 '이 LOT은 검사 대기 목록에 없어요'
  - 설명 '이미 다른 곳에서 검사했거나, 상위 히트가 불합격이거나, 투입·출고된 LOT일 수 있어요.'
  - 버튼 '불합격 관리 보기'
- 토스트
  - 성공: `{LOT}: 시스템이 {합격|불합격}으로 판정했어요` (qualityHooks.ts:47)
  - 실패: `{메시지} ({코드})`
- 저장 후 다시 불러오는 데이터: quality-inspections, lots, inventories, production-plans

**준비 중:** '비슷한 사례 찾기 준비 중 (EX)' 1개. 비활성이며 title도 '준비 중 (EX)'입니다.

### A-2. 불합격 관리 — `/quality/rejected?lot=<lotId>` (App.tsx:98, RejectedLotPage.tsx)

**제목**
- 기본: '불합격 관리', 영역 '품질' (titles.ts:21)
- LOT을 고르면 제목은 LOT번호, 부제는 '불합격 관리' (L41)

**메뉴·진입 경로**
- 왼쪽 메뉴: 품질 역할 '불합격 관리' (nav.ts:45). 조건은 `DISPOSITION_SET` VIEW 이상입니다.
- 관리자는 시드상 VIEW 권한이 있지만 메뉴 항목은 없습니다.
- 다른 화면에서 들어오는 링크: InspectionPage.tsx:146, InspectionResultView.tsx:40

**구성 순서 — 왼쪽 목록** (aria '불합격 LOT 목록')
1. 제목 '불합격 LOT'과 'n건' (L61-62)
2. 처리 상태별 타일 4개: '미지정 n', '보류 n', '격하 n', '폐기 n'. 누르면 필터가 켜지고 꺼집니다. 색은 코드에 직접 적혀 있습니다 (L43-54, L64-69).
3. 처리 상태 탭(aria '처리 상태'): '전체 / 미지정 / 보류 / 격하 / 폐기 n' (L70-74). 타일과 같은 일을 합니다.
4. 원인 칩: '모든 원인', '자체 불합격', '히트 불합격' (L75-79)
5. 검색창 'LOT번호 검색'. LOT번호와 히트번호를 부분일치로 찾습니다 (L80-83).
6. 목록 항목 (L86-110)
   - 1행: LOT번호와 처리 상태 배지
   - 2행: `{종류} · {강종} {규격}`
   - 3행: 원인 배지 '히트 불합격' 또는 '자체 불합격'과 빨간 글씨
     - 히트 원인: `{히트번호} {불합격 항목명 | '성분'}`
     - 자체 원인: `{불합격 항목명 | '기준 밖'}`
   - 4행: `{수주} 품목{n}` 또는 '연결 수주 없음', 그리고 '재생산 계획 있음'(배지) 또는 '재생산 계획 없음'
7. 빈 목록: '조건에 맞는 불합격 LOT이 없어요' / '불합격 LOT이 없어요'
8. 안내 띠 (L112-115): '…쓸 수 없는 슬래브·코일이에요. v2는 처리 상태만 관리해요.'

**구성 순서 — 본문**
1. LotHeader
   - 빵부스러기 '품질 › 불합격 관리 › {종류}'
   - 배지: 처리 상태, 그리고 '자체 검사 불합격' 또는 '상위 히트 불합격'
   - 버튼 (L149-168)
     - 자체 원인일 때만 '검사 결과' (→ 검사 입력)
     - 'LOT 추적 (영향 범위)' (→ 정추적)
     - '작업 로그' (**필터 없음**)
     - '사례로 등록 준비 중 (EX)'
     - '비슷한 사례 찾기 준비 중 (EX)'
2. 정보 카드 (L170-204)
   - '강종 · 규격'
   - '불합격 원인'
   - '근거 검사': `{번호} {공정} · {MM-DD HH:mm}` 또는 '기록 없음'
   - 히트가 아닐 때: '상위 히트'
   - '생산계획'
   - '영향받는 수주 품목': `{수주} 품목{n} {고객사} · 납기 {날짜} {D-n} · 주문 {매수} · {수주 품목 상태}` 또는 '없음 · 연결된 수주 품목이 없어요'
   - '생산 시각'
3. 왼쪽 열
   - '검사값' 카드 (L208-230)
     - 메타 `{검사번호} · 불합격 x/y개` 또는 '검사 기록 없음'
     - 히트 원인이면 띠 '이 LOT 자신이 아니라 상위 히트 {번호}의 성분 검사 결과예요.'
     - 표는 A-1과 같은 5열(**항목 | 기준 | 측정값 | 판정 | 기준 안 위치**)
     - 상세를 불러오기 전에는 바닥에 '불합격 항목' 목록
     - 검사 기록이 없으면 '연결된 검사 기록이 없어요'
   - 그 아래 DispositionForm
4. 오른쪽 열
   - '영향과 자동 처리' 카드 (L235-264)
     - 메타 '불합격 판정 때 시스템이 처리한 것'
     - 칩: **'SYSTEM'**(영문 그대로), '예약·배정·출하 대상에서 제외', 히트면 '하위 슬래브·코일 사용 불가'
     - 연결 수주가 있으면 '재생산 계획 (수주 품목 …)'과 계획 칩 `{번호} {계획 상태} · 부족 n`. 계획이 없으면 '재생산 계획이 아직 없어요. 생산 담당이 생산계획 화면에서 만들어요.'
     - 연결 수주가 없으면 '연결된 수주 품목이 없어 재생산 계획 대상이 아니에요'
     - 버튼 '정추적으로 영향 범위 보기'
   - '이력' 카드 (L266-275)
     - 메타 '이 LOT', '작업 로그' 링크(필터 없음)
     - LOT 이벤트를 `limit=100`으로 받아 마지막 8건만 표시
     - '불러오는 중…' / '기록된 이벤트가 없어요'

**DispositionForm**
- 카드 제목 '처리 상태 지정', 메타 '현재 {배지}'
- 현재 값이 있으면 '지정 {YYYY-MM-DD HH:mm}'과 '사유: …', 없으면 '아직 처리 상태를 지정하지 않았어요' (L42-47)
- 필드 '처리 상태' (radiogroup, L49-59)
  - 보류: '결정을 미뤄 두는 상태로 표시해요.'
  - 격하: '하위 등급으로 전환할 대상으로 표시해요.'
  - 폐기: '폐기(스크랩) 대상으로 표시해요.'
  - 처음 선택 값은 현재 상태입니다. 권한이 없으면 비활성.
- 필드 '사유 *' (L61-74)
  - textarea 3행, 최대 500자
  - placeholder '예: 성분 재확인 전까지 보류 / 하위 등급 용도로 전환 / 재사용 불가로 폐기'
  - 힌트 '{n}/500자 · 사유를 적어야 지정할 수 있어요'
  - 따로 뜨는 오류 문구는 없고, 버튼을 막는 것으로만 처리합니다.
- 버튼
  - 문구: '상태 지정'. 현재와 같은 상태를 고르면 '{보류|격하|폐기} 사유 다시 기록'. 진행 중이면 '저장하는 중…'
  - 누를 수 있는 조건: `canUse('DISPOSITION_SET')`(USE), 상태 선택됨, 사유가 공백이 아님, 진행 중 아님 (L26)
  - API: `qualityApi.setDisposition` → `POST /api/v1/lots/:lotId/disposition` `{dispositionStatus, reason}`
  - 권한이 없으면 '불합격 처리 상태를 지정할 권한이 필요해요'
- 안내 띠 (L83-86): 'v2는 처리 상태와 사유만 기록해요. 격하 재판정·재작업·폐기 재고 처리는 하지 않아요. 불합격 LOT은 이미 예약·배정·출하에서 빠져 있어요. 지정·변경 내역은 작업 로그에 남아요.'
- 성공 토스트: '불합격 처리 상태를 지정했어요'. 저장 후 다시 불러오는 데이터: lots, quality-inspections, business-events

**로딩·빈 상태**
- 목록 로딩: '불합격 LOT을 불러오는 중…'
- 고를 LOT이 없을 때: '불합격 LOT이 없어요'
- 목록에 없는 LOT: '이 LOT은 불합격 목록에 없어요' / '불합격이 아니거나 아직 검사 전인 LOT이에요.' / 버튼 '검사 입력에서 보기'
- 검사값 로딩: '검사값을 불러오는 중…'

**배지 (DispositionBadge, qualityUi.tsx:20-25)**
- HOLD → '보류'
- DOWNGRADED → '격하'(외곽선)
- SCRAPPED → '폐기'
- 값 없음 → '미지정'

### A-3. LOT 추적 — `/lots/trace?lot=<lotNo>&direction=backward|forward` (App.tsx:99)

**제목**
- 기본: 'LOT 추적', 영역 '추적' (titles.ts:24)
- LOT을 고르면 제목은 LOT번호, 부제는 `{종류} · 역추적|정추적` (L43)

**메뉴·권한**
- 모든 역할의 공통 메뉴입니다 (nav.ts:76).
- 조회만 하는 화면이라 권한 조건이 없고, 변경 버튼도 없습니다.

**기본 방향**
- 코일·슬래브는 역추적, 원료·용선·히트는 정추적으로 시작합니다 (traceHooks.ts:37).

**왼쪽 'LOT 검색' 영역** (L157-251)
1. 방향 버튼 '역추적 ←'(title '코일 → 원료'), '정추적 →'(title '원료·히트 → 출하'). LOT을 고르기 전에는 비활성입니다.
2. 검색창: placeholder 'LOT 번호 (일부만 입력해도 돼요)'
   - Enter를 누르면 `GET /lots/by-no/:lotNo`로 정확한 번호를 찾습니다 (L173).
   - 실패 문구: "'{x}'와 정확히 같은 번호는 없어요. 아래에서 골라 주세요", "'{x}'에 맞는 LOT이 없어요", 서버 메시지, '찾지 못했어요'
   - 평소 안내: 'Enter를 누르면 그 번호의 LOT을 추적해요'
3. 종류 칩: '전체·코일·슬래브·히트·용선·원료'. 코드에 직접 적힌 문구입니다 (L19-26).
4. 목록
   - 입력 중: '검색 결과 n' (`/lots/search?limit=20`). 빈 결과는 '번호가 맞는 LOT이 없어요'
   - 평소: '최근 LOT · 전체 N개 중 n개' (`/lots?limit=40`). 빈 목록은 '조건에 맞는 LOT이 없어요'

**본문**
1. LOT을 고르기 전: '추적할 LOT을 골라 주세요'와 설명
2. 오류: 404면 "'{LOT}'에 맞는 LOT이 없어요", 버튼 '다시 시도'
3. 머리 (L70-90)
   - 빵부스러기 '대시보드 › LOT 추적 › 역추적|정추적'
   - LOT 종류 태그, LOT 상태 배지, 판정 배지, title
   - 버튼 '작업 로그' (→ `?lot=`)
4. 경고 (L117-118)
   - 'LOT이 너무 많아 일부만 보여줘요 (최대 2,000개)…'
   - '순환 연결이 있어요…'
5. 그래프 카드 (L122-141)
   - aria 'LOT 계보', 제목 '역추적 계보' / '정추적 계보'
   - 로딩 '계보를 불러오는 중…'
   - 메타 `{단계 라벨 n · …} · 연결 n`
   - 범례: 실선 '직접 투입'(합금철이 있으면 ' (합금철 포함)'), 점선 '기간 기반 (그 기간에 쓰였을 수 있는 원료 · 실제 투입량 아님)', 그리고 '왼쪽 → 오른쪽 = 생산 흐름 · 노드를 누르면 상세가 열려요'
6. 오른쪽 열: 정추적이면 ImpactSummary가 먼저 나오고, 그 아래 고른 노드에 따라 ShipPanel 또는 LotDetailPanel이 나옵니다.

**그래프 라벨**
- 열 제목: '원료', 그다음 '용선' / '합금철' / '용선 · 합금철', '히트', '슬래브', '코일', '출하'. 각 제목 옆에 개수 (traceLayout.ts:60-69)
- 합금철 원료는 용선 열에 놓습니다 (L56-58).
- LOT 노드 (TraceGraph.tsx:11-22, 98-115)
  - 1행: 합금철이면 '합금철', 아니면 서버가 준 `lotTypeLabel`. 판정 배지 색은 PASS 초록, FAIL 빨강, PENDING 주황
  - 2행: LOT번호
  - 3행: 원료는 원료명, 용선은 `{blastFurnaceNo}고로`, 히트는 `{converterNo}전로 · {강종}`, 제품은 `{강종} · {규격}`
  - 4행: 원료·용선은 `잔량 x / 초기`, 히트는 초기 톤, 제품은 `이론중량 t`, 그리고 LOT 상태 배지
  - 시작 LOT에는 '시작' 태그
- 출하 노드 (L87-96)
  - '출하'와 '밀시트 n'
  - 출고번호, 고객사
  - `{수주} · LOT n · {MM-DD}`
- 연결선 툴팁 (L29-36)
  - 출하 연결: '출고 연결'
  - LOT 연결: `{evidenceLabel}`. 기간 기반이면 `{기간} 사이 사용 가능성 (실제 투입량이 아니에요)`, 투입량이 있으면 `투입 t`
- 기간 기반 표지: 상자 '기간 기반' + 기간 (L72-77)
- 용선→히트, 합금철→히트 선 위 라벨: `evidenceLabel` + 투입 톤. 선이 16개 이하일 때만 그립니다 (traceLayout.ts:186-190).

**ImpactSummary** (정추적일 때만)
- 제목 '영향 요약', 메타 '이 LOT에서 이어진 하위 LOT·출하'
- 수치: '슬래브', '코일', '출하된 제품', '미출하 제품', '수주'
- '출하' 목록: 출고번호, 일시, 'LOT n', 고객사, 수주 링크, 출하요청번호, '밀시트 …' 또는 '밀시트 없음'
- '수주' 목록: 수주, 고객사, '출하됨' 또는 '출하 전', '납기 … · 영향 LOT n개'
- 빈 목록: '영향받은 출하가 없어요' / '영향받은 수주가 없어요'

**LotDetailPanel**
- 제목 'LOT 상세'
- 기본 정보 (L87-104)
  - '종류'
  - '원료': `{명} ({코드}) · {원료 유형}`
  - '공급사'
  - '고로', '전로'
  - '강종'
  - '규격': 코드 + 치수 mm
  - '1매 이론중량' 또는 '1개 이론중량'
  - '초기 수량', '잔량'
  - '상위 히트'
  - '야드'
  - '생산완료'
  - '소진·출고'
  - 제품만: '예약·배정' — '여재' / '가능' / '불가'
- 섹션
  - '불합격 처리': '처리 상태'(항상 빨간 배지), '사유', '처리 시각'
  - '현재 배정': '용도', '수주', '생산계획', '출하요청'
  - '연결된 수주 품목': 태그 '생산 수주' / '배정' / '출고' (L12)
  - '출하·밀시트': '출고번호', '출고일시', '출하요청', '수주', '고객사', '밀시트'(없으면 '발행 전')
  - '바로 연결된 LOT': '위 (상위)', '아래 (하위)'. 근거는 '기간 기반 · 기간' 또는 `{근거 라벨} · 투입 t`
  - '검사' (접을 수 있음): 표 **'항목 | 기준 | 측정값 | 판정'**, 기준 표시는 `min ~ max 단위`. 측정 항목이 없으면 '측정 항목이 없어요'. 검사가 없으면 '원료·용선은 검사하지 않아요' 또는 '검사 기록이 아직 없어요'
- 바닥 버튼: '이 LOT 작업 로그', '이 LOT부터 다시 추적'

**ShipPanel**
- 제목 '출하 상세'과 '출고 확정' 배지
- 출하 정보
- '이 출고에 실린 LOT' 목록. 각 LOT 버튼은 그래프에서 해당 노드를 고르고, 옆의 '역추적' 링크로 이동합니다.

**준비 중:** 없음

### A-4. 작업 로그 — `/business-events` (App.tsx:100, BusinessEventPage.tsx)

**주소 쿼리:** `salesOrderId`, `so`, `lot` 또는 `lotId`, `includeLineage`, `eventType`, `actorType`, `targetType`, `from`, `to`, `q`, `order`

**제목**
- 기본: '작업 로그 · Decision Replay', 영역 '추적' (titles.ts:25)
- 수주·LOT을 고르면 부제가 그 제목, 아니면 'Decision Replay' (L90)

**메뉴·진입 경로**
- 공통 메뉴 '작업 로그' (nav.ts:77)
- 필터를 붙여 들어오는 링크: LOT 추적·LOT 상세(`?lot=`), 수주 목록·출하요청 상세·밀시트(`?salesOrderId=`)
- 품질·생산 화면에서는 필터 없이 들어옵니다.

**머리** (L97-117)
- 빵부스러기 '대시보드 › 작업 로그 › 수주 단위 | LOT 단위 | 전체'
- 제목(h1): 고른 수주·LOT, 아무것도 안 고르면 '전체 작업 로그'
- 태그 'Decision Replay · 시간순'
- 안내 '이벤트는 기록 전용이라 수정·삭제할 수 없어요 · 불러온 이벤트 n건 (더 있어요)'
- 버튼: '수주 상세', 'LOT 추적', '과거 사례 검색 준비 중 (EX)'

**필터 1줄** (L119-144)
- 수주번호 선택기: `GET /search?q`에서 수주만 걸러냅니다.
- LOT 번호 선택기: `GET /lots/search?limit=10`
- 체크 '상·하위 LOT 포함': LOT을 고르기 전에는 비활성. title '그 LOT의 조상·자손 LOT의 이벤트도 함께 봐요 (형제 LOT은 제외)'
- 키워드 '요약·대상 번호 검색': 최대 100자
- '조건 초기화'

**필터 2줄** (L145-174)
- '주체' 칩: 전체 / 사용자 / 시스템
- 유형 선택 '유형: 전체' + 35개
- 대상 선택 '대상: 전체' + 17개
- '기간' 시작일 ~ 종료일
- 정렬 버튼 '오래된 순' / '최신순'. 기본은 수주·LOT을 고르면 오래된 순, 아니면 최신순 (L72)

**타임라인 카드**
- 제목: 'Decision Replay' 또는 '최근 이벤트'
- 설명: '예약 → 계획 → 실적 → 검사 → 배정 → 출고 → 밀시트 순서로…' 또는 '전체 이벤트를 최신순으로…'
- 날짜 구분 `YYYY-MM-DD (요일)`
- 빈 목록: '이 조건에 기록된 이벤트가 없어요' / '조건에 맞는 이벤트가 없어요'
- '더 보기': 커서 방식, 50건씩
- LOT 번호를 못 찾으면 "'{LOT}'에 맞는 LOT이 없어요"와 'LOT 조건 지우기'
- 바닥: 범례('사람이 한 일', '시스템 자동', '처리 상태', '불합격')와 '비슷한 과거 사례 준비 중 (EX)'

**이벤트 한 줄** (eventUi.tsx:126-196)
- 접힌 상태: 시각 `HH:mm`
  - 주체: 사용자는 이름과 부서, 시스템은 '시스템'
  - 유형 라벨(서버가 준 `eventTypeLabel`)
  - 요약
  - '상·하위 LOT' 태그
  - 사유 코드 태그
  - 대상 링크
  - **`#{id}`**
- 펼친 상태 3칸
  - '당시 기록': '주체'('시스템 (자동)'), '일시', '유형', '대상', '수주'
  - '사유·근거': '사유 코드', '사유', '원본 메시지 #id'(링크 없음), '초안 #id'(링크). 사유가 없으면 '기록된 사유가 없어요'
  - '변경 전 → 변경 후' 표 **'항목 | 변경 전 | (→) | 변경 후'**. 값이 없으면 '기록된 변경값이 없어요 (요약만 남아 있어요)'
- 바닥: '관련 LOT' 링크. 12개를 넘으면 '외 n개 더 보기' / '접기', 없으면 '없음'

**유형 필터 라벨 35개** (shared codes:254-267)
- 작업 시작, 작업 완료, 실적, 검사
- 예약, 예약 전환, 예약 해제, 자동 예약
- 배정 추천, 배정 확정, 배정 변경, 배정 해제
- 수주 등록, 수주 취소
- 생산계획, 히트 편성, 재생산, 계획 취소, 여재 전환
- 불합격, 처리 상태
- MRP
- 구매요청, 승인, 반려, 발주, 입고
- 출하요청, 출고, 밀시트
- 초안, 초안 확정, 초안 실행, 초안 반려
- 기준정보

**대상 라벨 17개** (eventUi.tsx:9-14)
- 수주, 수주 품목, 예약, 배정, 생산계획, **생산 실적**, LOT, **품질 검사**, MRP 실행
- 구매요청, 발주, 입고, 출하요청, 출고, 밀시트, 초안, 기준정보

**사유 코드 라벨** (eventUi.tsx:17-21)
- 재고 우선, 선입선출 추천, 수주 부족분, 수주 취소, 품질 불합격, 여재 전환, 배정 변경, 초안 확정, 품질 합격, 출고, 시뮬레이션

**점 색이 화면마다 다름**
- 작업 로그 화면: 불합격 빨강, 처리 상태 주황, 사용자 파랑, 시스템 기본색 (eventUi.tsx:119-122)
- 품질 화면 타임라인: `AUTO_RESERVED`·`DISPOSITION_SET` 초록, `ALLOCATION_RELEASED` 주황, `INSPECTION_REGISTERED` 파랑 (qualityUi.tsx:123-124)
- 같은 '처리 상태' 이벤트가 화면에 따라 다른 색입니다.

**준비 중:** '과거 사례 검색' (EX) L115, '비슷한 과거 사례' (EX) L212

---

## B. API 의존 목록 (목업 데이터 계층용)

**공통**
- 기본 경로는 `/api/v1`, 인증은 `Authorization: Bearer` 헤더입니다.
- 쿼리 값이 undefined·null·''이면 보내지 않습니다 (client.ts:18-24).
- 응답 형식: 성공 `{success:true,data}`, 실패 `{success:false,error:{code,message}}` (shared/api.ts:2-4)
- 화면 처리: 403은 '권한 없음' 화면, 404는 개별 문구, 실패 토스트는 `메시지 (코드)`
- 쿼리 키의 첫 요소가 실시간 주제 이름입니다: `quality-inspections`, `lots`, `business-events`.

**qualityApi (api/quality.ts)**

| 함수 | 메서드·경로 | 요청 | 응답 |
|---|---|---|---|
| `pending` | GET `/quality-inspections?status=pending` | – | `PendingInspection[]` |
| `done` | GET `/quality-inspections?status=done[&processCode][&lotId]` | processCode는 쓰는 곳 없음 | `Inspection[]` (최신순, 최대 300건) |
| `get` | GET `/quality-inspections/:id` | – | `Inspection` |
| `register` | POST `/quality-inspections` | `{lotId:number; values:{inspectionItemCode:string; measuredValue:number\|string}[]; memo?:string}` | `Inspection` (201) |
| `rejectedLots` | GET `/quality-inspections/rejected-lots` | – | `RejectedLot[]` |
| `setDisposition` | POST `/lots/:lotId/disposition` | `{dispositionStatus:'HOLD'\|'DOWNGRADED'\|'SCRAPPED'; reason:string(필수, 500자 이내)}` | `RejectedLot` |

- `InspectionLot`: `{id, lotNo, lotType:'HEAT'|'SLAB'|'COIL', lotTypeName, lotStatus:'IN_STOCK'|'CONSUMED'|'SHIPPED', isPassed:bool|null, steelGradeId|null, steelGradeCode|null, productSpecId|null, specCode|null, heatLotId|null, heatLotNo|null, heatIsPassed:bool|null, productionPlanId|null, productionPlanNo|null, salesOrderItemId|null, salesOrderId|null, salesOrderNo|null, customerName|null, producedAt}`
- `InspectionSpecItem`: `{inspectionItemCode, inspectionItemName, unit|null, minValue:string|null, maxValue:string|null, isRequired, sortOrder}`
- `PendingInspection`: `{inspectionResult:'PENDING', processCode:'STEELMAKING'|'CASTING'|'HOT_ROLLING', inspectionName, lot:InspectionLot, items:InspectionSpecItem[]}`
- `InspectionValue`: `{inspectionItemCode, inspectionItemName, unit, minValue, maxValue, measuredValue:string|null, isPassed:bool|null, sortOrder}`
- `Inspection`: `{id, qualityInspectionNo, processCode, inspectionName, inspectionResult:'PASS'|'FAIL', inspectorEmployeeId|null, inspectorEmployeeName|null, inspectedAt, memo|null, lot, values}`
- `RejectedLot`: `{id, lotNo, lotType, lotStatus:string, isPassed, rejectedBy:'OWN'|'HEAT', steelGradeCode, specCode, heatLotId, heatLotNo, productionPlanId, productionPlanNo, failedInspection:{id, qualityInspectionNo, processCode, inspectedAt, failedItems:{inspectionItemCode, inspectionItemName, unit, minValue, maxValue, measuredValue}[]}|null, dispositionStatus|null, dispositionReason|null, dispositionAt|null, affectedSalesOrderItem:{salesOrderItemId, salesOrderId, salesOrderNo, lineNo, customerName, dueDate, orderedQty, salesOrderItemStatus:string}|null, hasReproductionPlan, reproductionPlan:{id, productionPlanNo, productionPlanStatus:string, shortageQty}|null, producedAt}`

**lotApi (api/lots.ts)**

| 함수 | 메서드·경로 | 요청 | 응답 |
|---|---|---|---|
| `list` | GET `/lots?lotType&lotStatus&q&limit` | 화면에서는 lotType과 limit=40만 사용 | `{items:LotView[], total, limit}` |
| `search` | GET `/lots/search?q&limit` | 추적 화면 20, 작업 로그 선택기 10 | `{id, lotNo, lotType, lotTypeLabel, lotStatus, lotStatusLabel}[]` |
| `byNo` | GET `/lots/by-no/:lotNo` | – | `LotDetail` (404를 화면에서 처리) |
| `detail` | GET `/lots/:id` | – | `LotDetail` |
| `trace` | GET `/lots/:id/trace?direction=backward\|forward` | – | `LotTraceResponse`. 예전 이름 `orderLinks`는 `salesOrderLinks`로 바꿔서 받음 (L211-222) |

- `LotView`: `{id, lotNo, lotType, lotTypeLabel, lotStatus, lotStatusLabel, title, rawMaterial:{id, materialCode, materialName, rawMaterialType, rawMaterialTypeLabel}|null, productSpec:{id, specCode, thicknessMm, widthMm, lengthMm, theoreticalWeightTon}|null, steelGrade:{id, steelGradeCode, steelGradeName}|null, heat:{id, lotNo, isPassed}|null, yard:{id, yardCode, yardName}|null, supplier:{id, supplierName}|null, blastFurnaceNo, converterNo, weightTon, initialTon, remainingTon, isPassed, inspectionResult:'PENDING'|'PASS'|'FAIL'|null, inspectionResultLabel, inspection:{qualityInspectionId, qualityInspectionNo, processCode, result, resultLabel, inspectedAt, itemCount, failedItemCount}|null, disposition:{status, statusLabel, reason, at}|null, allocation:{allocationId, purpose, purposeLabel, status, confirmedAt, salesOrderItemId, salesOrderNo, lineNo, productionPlanId, productionPlanNo, shipmentRequestId, shipmentRequestNo}|null, salesOrderItem:{salesOrderItemId, salesOrderId, salesOrderNo, lineNo, customerId, customerName, dueDate}|null, isEligible, isSurplus, producedAt, consumedAt}`
- `LotDetail`: `LotView`에 아래를 더함
  - `inspections:{qualityInspectionId, qualityInspectionNo, processCode, result, resultLabel, inspectorName, inspectedAt, memo, values:{inspectionItemCode, inspectionItemName, unit, minValue, maxValue, measuredValue, isPassed}[]}[]`
  - `parents` / `children`: `{lotId, lotNo, lotType, relationType, evidenceType:'PERIOD'|'DIRECT', inputTon, periodStart, periodEnd}[]`
- `LotTraceResponse`: `{direction, rootId, nodes, edges, levels:{lotType, label, nodeIds}[], summary:{nodeCount, edgeCount, countByType, hasPeriodEvidence, hasCycle, truncated}, impact|null(정추적만)}`
- 노드: `{id, lotNo, lotType, lotTypeLabel, lotStatus, lotStatusLabel, isRoot, depth, title, steelGradeCode, productSpecCode, rawMaterialCode, rawMaterialName, rawMaterialType:'IRON_ORE'|'COAL'|'LIMESTONE'|'FERROALLOY'|null, blastFurnaceNo, converterNo, heatLotNo, initialTon, remainingTon, weightTon, producedAt, isPassed, inspectionResult, inspectionResultLabel, inspection, salesOrderLinks:(SO품목뷰 & {linkType:'PRODUCED_FOR'|'ALLOCATED'|'SHIPPED'})[], shipment|null}`
- 출하(shipment): `{goodsIssueId, goodsIssueNo, issuedAt, shipmentRequestId, shipmentRequestNo, customerId, customerCode, customerName, salesOrderId, salesOrderNo, salesOrderItemId, lineNo, millSheetIds[], millSheetNos[]}`
- 연결선(edge): `{id, parentId, childId, relationType, evidenceType, evidenceLabel("기간 기반"|"직접 투입"), isPeriodBased, inputTon, periodStart, periodEnd}`
- 영향(impact): `{shippedProductLotCount, unshippedProductLotCount, shipments:{goodsIssueId, goodsIssueNo, issuedAt, shipmentRequestNo, customerId, customerName, salesOrderId, salesOrderNo, millSheetNos, lotIds, lotNos}[], salesOrders:{salesOrderId, salesOrderNo, customerName, dueDate, lotCount, hasShipped}[]}`

**businessEventApi (api/businessEvents.ts)**
- `list`: GET `/business-events`
  - 쿼리: `salesOrderId`, `lotId`, `includeLineage`, `eventType`, `actorType`, `targetType`, `from`, `to`, `q`, `limit`, `cursor`, `order`
  - 응답: `{items:BusinessEventView[], nextCursor:number|null, hasMore, order:'asc'|'desc'}`
  - 쓰는 곳:
    - 작업 로그 화면: limit 50, 커서
    - 판정 뒤 처리: lotId limit 30, 그리고 salesOrderId + `eventType=AUTO_RESERVED&order=desc&limit=10`
    - 불합격 이력: lotId limit 100
- `get`: GET `/business-events/:id` — 정의만 있고 쓰는 곳이 없습니다.
- `searchSalesOrders`: GET `/search?q`
  - 응답 `{kind, kindLabel, label, linkPath}[]` 중 `kind==='SALES_ORDER'`만 남깁니다.
  - 수주 id는 `linkPath`의 마지막 숫자로 꺼냅니다.
- `BusinessEventView`: `{id, occurredAt, actorType:'USER'|'SYSTEM', actorLabel, actor:{employeeId, employeeNo, employeeName, departmentName, jobGrade}|null, eventType, eventTypeLabel, targetType, targetId|null, targetNo|null, salesOrderId|null, salesOrderNo|null, lotIds[], lots:{id, lotNo, lotType}[], summary, before:unknown|null, after:unknown|null, reasonCode|null, reason|null, isAiAssisted, messageId|null, actionDraftId|null, isLineageOnly}`

---

## C. 문서 대비 차이

### C-1. 요구사항 반영 여부

| REQ | 판정 | 근거 |
|---|---|---|
| QC-001 공정별 검사 | 반영 | 제강·연주·열연 탭과 설명이 문서 문구와 일치 (InspectionPage.tsx:17,80-89; qualityUtil.ts:119-123) |
| QC-002 검사 항목 관리 | 이 화면 범위 밖 / 표시는 일부 | ① 항목·min·max·단위·필수는 표시 ② **기준 버전은 응답 타입에 없어 표시 안 함** (quality.ts:75-88) ③ 적용 두께 구간 필드 없음 (quality.ts:39-49) ④ 안내 문구가 "관리자가 기준정보에서"로 되어 있어 "품질 담당이 관리"와 다름 (InspectionForm.tsx:81) ⑤ `INSPECTION_STANDARD_MANAGE` 권한이 코드에 없음 |
| QC-003 자동 판정 | 일부 | 등록하면 서버가 판정하고, 미리보기도 경계 포함으로 계산 (qualityUtil.ts:35-46). **측정값 보완·오타 수정 화면·API가 없음** (quality.ts:156-167, 결과 화면은 '읽기 전용' L87). 따라서 변경 전·후 로그와 밀시트 발행 후 수정 차단도 없음 |
| QC-004 불합격 상태 | 반영 | 보류·격하·폐기와 사유(필수, 500자), 후속 처리 없음 안내 (DispositionForm.tsx) |
| INV-003 합격 재고만 예약 | 반영 (표시만) | 상위 히트 판정 표시 (qualityUi.tsx:73-81), 결과 안내 문구 (InspectionResultView.tsx:11-21), '예약·배정 가능/불가/여재' (LotDetailPanel.tsx:104). 실제 차단은 서버라 확인 불가 |
| INV-007 불합격 LOT 제외 | 반영 (표시만) | 히트 원인 하위 LOT 목록 (RejectedLotPage.tsx:76-77,97-100), 제외 칩 (L243-244) |
| LOT-001 LOT 계층 | 반영 | 열 순서 원료→용선→히트→슬래브→코일, 합금철은 히트에 직접 연결 (traceLayout.ts:5-6,56-69) |
| LOT-002 연결 규칙 | 일부 | 기간 기반 선·기간 표시 있음 (TraceGraph.tsx:29-36,72-77). 실제 투입은 **'직접 투입'**으로 표시 |
| LOT-003 LOT 채번 | 해당 없음 (표시만) | 번호를 만들거나 해석하지 않음. 고로·전로는 `…No` 필드에 '고로'/'전로'를 붙여 표시 (C-5 참고) |
| LOT-004 원료 잔량 | 반영 | `잔량 x / 초기` (TraceGraph.tsx:14,16), LotDetailPanel.tsx:98-99 |
| LOT-005 역추적·정추적 | 반영 / 입력 일부 | 방향 전환, 기본 방향, 출하·수주 영향 요약. **출하번호로는 찾을 수 없음** (BP-LOT-01 입력 항목) |
| LOG-001 이벤트 기록 | 반영 (조회) | 주체·대상·변경 전후 표시 (eventUi.tsx:150-181) |
| LOG-002 기록 대상 | 일부 | 개념은 모두 있으나 코드 값·라벨이 공통코드와 다름 (C-3) |
| LOG-003 이력 재현 | 반영 | 수주·LOT 단위 시간순 (BusinessEventPage.tsx:66-72,104,178-179) |
| CASE-002 (EX) | 디자인만 | '사례로 등록' 비활성 (RejectedLotPage.tsx:164). 처리 상태를 지정하지 않아도 항상 보임 |
| CASE-004 (EX) | 디자인만 | '비슷한 사례 찾기' (InspectionPage.tsx:160, RejectedLotPage.tsx:165). 작업 로그에도 '과거 사례 검색'·'비슷한 과거 사례'가 있음 (L115,212) — CASE-004 호출 위치 목록에는 없는 자리 |
| SHP-003 (발행 후 수정 불가) | 없음 | 밀시트는 링크·'발행 전'만 표시 (LotDetailPanel.tsx:41-45). 검사 수정 기능 자체가 없어 잠금 규칙을 표시할 자리도 없음 |

### C-2. 용어 사전 위반·한글명 차이

| 문구 (위치) | 규칙 |
|---|---|
| '계보를 불러오는 중…', aria 'LOT 계보', '역추적 계보'/'정추적 계보' (LotTracePage.tsx:91,122,124), 주석 TraceGraph.tsx:1 | TRM-068 사용 금지 'LOT 계보'. 업무 프로세스 정의서도 '계보'라고 써서 문서끼리도 충돌 |
| '공급사' (LotDetailPanel.tsx:89) | TRM-029 사용 금지 (공급업체) |
| 대상 라벨 '생산 실적' (eventUi.tsx:11) | TRM-047 사용 금지 (작업 실적) |
| '품질 검사' 띄어쓰기 (eventUi.tsx:11) | TRM-074 한글명 '품질검사' |
| '주문 {orderedQty}' (RejectedLotPage.tsx:196) | TRM-038 사용 금지 '주문'. 다만 프로세스 정의서 4.5도 '주문 매수'라고 씀 |
| 'Decision Replay'만 쓰고 한글 '이력 재현'은 전혀 안 씀 (BusinessEventPage.tsx:90,108,178; titles.ts:25) | TRM-086 한글명 '이력 재현' |
| '처리 상태'로 통일 (DispositionForm.tsx:31,49 등, LotDetailPanel.tsx:128, 범례 eventUi.tsx:204) | TRM-079 한글명은 '불합격 상태'. REQ-QC-004 본문은 '처리 상태'라고 씀 |
| '예약·배정·출하 대상에서 제외' (RejectedLotPage.tsx:243), '…출하에서 빠져 있어요' (DispositionForm.tsx:85) | TRM-078·REQ-QC-004는 '출고'. InspectionResultView.tsx:16은 '출고'로 씀 |
| '직접 투입' (LotTracePage.tsx:134, 공유 라벨) | TRM-068·REQ-LOT-002는 '실제 투입' |
| '폐기(스크랩)' (DispositionForm.tsx:16) | '스크랩'은 용어 사전의 제외 용어 |
| 'SYSTEM' 영문 그대로 (RejectedLotPage.tsx:242) | 공통코드 표시명 '시스템' |
| '판정 전', '검사 대기', '대기' (qualityUi.tsx:78; InspectionPage.tsx:103,107,155,170) | PENDING 표시명은 '판정 대기' |
| 주석 '공정별 검사 대기열' (InspectionPage.tsx:1, 주석만) | TRM-074 사용 금지 '공정별 검사' |

- 쓰지 않음(확인): 로트, 역방향·정방향, 감사 로그·감사 이력, 비즈니스 이벤트, 결정 재현, 검사 기준서
- HOLD는 처리 상태 값으로만 쓰고 별도 개념으로 쓰지 않음

### C-3. 공통코드 정의서와 다른 값·라벨 (사용 위치 전부)

참고: `SPEC.md` 9-6항에 "공통코드 정의서에 접근할 수 없어 업무 프로세스 정의서 10장 제안 값을 썼다"고 적혀 있습니다. shared codes:2-3 주석도 같은 내용입니다.

**INSPECTION_RESULT**
- 값은 같습니다.
- PENDING 라벨이 '**검사 대기**'로, 문서의 '판정 대기'와 다릅니다 (codes:162).
- 사용 위치
  - 라벨 사용: qualityHooks.ts:8,47; qualityUi.tsx:4,16
  - 추적 화면 배지: 서버 label을 그대로 씀 (traceUi.tsx:13-17)
  - `Inspection.inspectionResult`는 'PASS'|'FAIL'만 가짐 (quality.ts:80). PENDING은 '아직 등록 전'이라는 뜻으로만 씀 (quality.ts:53)

**DISPOSITION_STATUS**
- 값·라벨 모두 일치합니다 (codes:165-167).
- 다만 RejectedLotPage.tsx:65-71에 라벨을 다시 직접 적었습니다.
- 값이 없을 때의 '미지정'은 문서에 없는 표시입니다.

**LOT_TYPE**
- 일치합니다 (codes:188-190).
- 다만 LotTracePage.tsx:19-26에 라벨을 다시 직접 적었습니다.

**LOT_STATUS**
- 값: 코드 `IN_STOCK`, 문서 `AVAILABLE`
- 라벨: 코드 '투입·소진', 문서 '투입 소진' (codes:191-193)
- 사용 위치: quality.ts:15, traceUi.tsx:19, qualityUi.tsx:71(LotInfoCard). `RejectedLot.lotStatus`는 타입 없는 `string`입니다 (quality.ts:110).

**LOT_RELATION_EVIDENCE**
- 상수 이름: 코드 `LOT_EVIDENCE_TYPE`, 문서 그룹 ID `LOT_RELATION_EVIDENCE`
- 값: 코드 `PERIOD`/`DIRECT`, 문서 `PERIOD_BASED`/`ACTUAL_INPUT`
- 라벨: 코드 '직접 투입', 문서 '실제 투입' (codes:199-201)
- 필드 이름은 `evidenceType`입니다.
- 사용 위치: lots.ts:2,83,173-174; LotDetailPanel.tsx:4,115-117; LotTracePage.tsx:134; traceLayout.ts:153 주석

**PROCESS_TYPE**
- 상수 이름: 코드 `PROCESS_CODE`
- 값: 코드 `CASTING`, 문서 `CONTINUOUS_CASTING` (codes:48-51). 라벨은 같습니다.
- 사용 위치: quality.ts:6,54,78,125,160; InspectionPage.tsx:4,16-17,70,105; qualityUtil.ts:119-123; RejectedLotPage.tsx:184; LotDetailPanel.tsx:4,14; lots.ts:8 주석

**ACTOR_TYPE**
- 값은 같습니다 (codes:26-27).
- 공유 코드에 라벨이 정의돼 있지 않습니다.
- 화면 표시
  - BusinessEventPage.tsx:147: '사용자'/'시스템' (문서와 일치)
  - RejectedLotPage.tsx:242: 'SYSTEM' (불일치)
  - eventUi.tsx:154: '시스템 (자동)', 범례 L202-203: '사람이 한 일'/'시스템 자동' (변형 문구)

**BUSINESS_EVENT_TYPE** (코드 35개, 문서 29개)
- 값·라벨 모두 같은 것 (9개): SALES_ORDER_CANCELLED, SURPLUS_CONVERTED, RESERVATION_CREATED·CONVERTED·RELEASED, ALLOCATION_RECOMMENDED·CONFIRMED·CHANGED·RELEASED
- 값은 같고 라벨이 다른 것 (10개)

| 값 | 코드 라벨 | 문서 라벨 |
|---|---|---|
| INSPECTION_REGISTERED | 검사 | 검사 등록·판정 |
| PRODUCTION_PLAN_CREATED | 생산계획 | 생산계획 생성 |
| REPRODUCTION_PLAN_CREATED | 재생산 | 재생산 계획 생성 |
| PRODUCTION_PLAN_CANCELLED | 계획 취소 | 생산계획 취소 |
| DISPOSITION_SET | 처리 상태 | 불합격 처리 상태 지정 |
| PURCHASE_REQUISITION_APPROVED | 승인 | 구매요청 승인 |
| PURCHASE_REQUISITION_REJECTED | 반려 | 구매요청 반려 |
| GOODS_RECEIPT_CONFIRMED | 입고 | 입고 확정 |
| GOODS_ISSUE_CONFIRMED | 출고 | 출고 확정 |
| MILL_SHEET_ISSUED | 밀시트 | 밀시트 발행 |

- 값이 다른 것 (10개)

| 코드 값 | 문서 값 | 라벨 차이 |
|---|---|---|
| SALES_ORDER_REGISTERED | SALES_ORDER_CREATED | 같음 |
| WORK_STARTED | PRODUCTION_STARTED | 같음 |
| RESULT_REGISTERED | PRODUCTION_RESULT_REGISTERED | '실적' vs '실적 등록(작업 완료)' |
| PURCHASE_REQUISITION_CONFIRMED | PURCHASE_REQUISITION_CREATED | '구매요청' vs '구매요청 등록' |
| PURCHASE_ORDER_CONFIRMED | PURCHASE_ORDER_CREATED | 같음 |
| SHIPMENT_REQUESTED | SHIPMENT_REQUEST_CREATED | '출하요청' vs '출하요청 등록' |
| ACTION_DRAFT_CREATED | DRAFT_CREATED | '초안' vs '초안 생성' |
| ACTION_DRAFT_APPROVED | DRAFT_CONFIRMED | 같음 |
| ACTION_DRAFT_EXECUTED | DRAFT_EXECUTED | '초안 실행' vs '초안 실행(ERP 반영)' |
| ACTION_DRAFT_REJECTED | DRAFT_REJECTED | 같음 |

- 코드에만 있는 것 (6개)
  - WORK_COMPLETED
  - AUTO_RESERVED — 문서는 RESERVATION_CREATED + 주체 SYSTEM으로 표현
  - REJECTED_JUDGED — 문서는 INSPECTION_REGISTERED의 판정 결과로 구분
  - PRODUCTION_PLAN_CONFIRMED (히트 편성)
  - MRP_RUN
  - MASTER_CHANGED
  - 이 가운데 마지막 세 개는 LOG-002 목록에도 없습니다.
- 정의 위치: shared codes:238-267
- 사용 위치
  - BusinessEventPage.tsx:6,23,45,152-155 (필터에 35개 전부 노출)
  - qualityHooks.ts:81 (`'AUTO_RESERVED'`로 걸러 판정 뒤 처리 카드에 사용)
  - qualityUi.tsx:123-124 (`REJECTED_JUDGED`, `AUTO_RESERVED`, `DISPOSITION_SET`, `ALLOCATION_RELEASED`, `INSPECTION_REGISTERED`)
  - eventUi.tsx:120 (`REJECTED_JUDGED`, `DISPOSITION_SET`)
  - 행 라벨은 서버 `eventTypeLabel` (eventUi.tsx:139,158; qualityUi.tsx:136)

**PERMISSION**
- `INSPECTION_REGISTER`
  - InspectionForm.tsx:22 (USE)
  - qualityHooks.ts:25 (VIEW, 메뉴 배지)
  - nav.ts:44
  - DashboardPage.tsx:26
  - codes:69,87,102,103,108
- `DISPOSITION_SET`
  - DispositionForm.tsx:22 (USE)
  - nav.ts:45
  - codes:69,88,103,108
  - 같은 이름이 이벤트 유형 값으로도 쓰임 (codes:245)
- `INSPECTION_STANDARD_MANAGE`: **코드 어디에도 없습니다.** 공통코드 정의서와 프로세스 정의서 2장은 품질 역할 권한으로 정의합니다.

**이 화면에 나오는 다른 코드 (참고)**
- SALES_ORDER_ITEM_STATUS (RejectedLotPage.tsx:196)
  - 코드: REGISTERED '접수' / IN_PROGRESS '진행 중' …
  - 문서: OPEN '진행중' …
- PRODUCTION_PLAN_STATUS (L253)
  - 코드에 CONFIRMED '편성 확정'이 더 있음
  - 진행 중 라벨: 코드 '생산 중', 문서 '진행중'
- ALLOCATION_PURPOSE (LotDetailPanel '용도'): 코드 `ROLLING`, 문서 `HOT_ROLLING`
- 공통코드 정의서에 없는 코드 그룹
  - EVENT_TARGET_TYPE (codes:268-274)
  - EVENT_REASON_CODE (codes:276-281). QUALITY_PASSED, GOODS_ISSUE, SIMULATION은 프로세스 정의서 9.3 제안 목록에도 없음
  - LOT_RELATION_TYPE (codes:195-198)
  - `rejectedBy` OWN/HEAT, `linkType` PRODUCED_FOR/ALLOCATED/SHIPPED

### C-4. 문서에 없는 화면 요소

**검사 입력**
- '기준 안 값으로 채우기 · 데모용 도우미' (InspectionForm.tsx:38-48,70-73)
- 입력 중 미리보기 판정과 게이지, 표의 '기준 안 위치' 열. 확정 단계는 없으므로 TRM-076("제안 단계 없음")과 부딪히지는 않음
- '검사 메모'. BP-QC-01 입력 항목에 없음
- 대기 시간 표시 (waitText)
- '완료' 탭(최근 300건)과 '다음 LOT 검사' 흐름
- '판정 뒤 처리' 카드. 시각 −2초~+30초 범위로 이벤트를 추정해서 보여 줌
- 검사번호 `qualityInspectionNo`. 9.1에 번호 형식이 없음

**불합격 관리**
- '자체 불합격' / '히트 불합격' 분류와 칩 (`rejectedBy`). 개념 자체는 TRM-078에 있지만 이 이름은 새로 지음
- '미지정' 라벨
- 처리 상태 타일과 탭이 같은 일을 중복으로 함
- '재생산 계획 있음/없음'과 계획 칩 (`hasReproductionPlan`)
- '영향과 자동 처리' 카드
- 같은 상태를 다시 고르는 '사유 다시 기록'
- 사용자 화면에 'v2' 문구 노출 (RejectedLotPage.tsx:114; DispositionForm.tsx:85)
- 목록 안내 띠는 '슬래브·코일'이라고 하지만 실제 목록에는 히트도 나올 수 있음

**LOT 추적**
- 최근 LOT 목록과 종류 칩
- 최대 2,000개 잘림 경고, 순환 연결 경고
- '시작' 태그
- '예약·배정 가능/불가/여재' (`isEligible`, `isSurplus`)
- '공급사', '야드', '초기 수량'
- 연결 태그 '생산 수주' / '배정' / '출고'
- '이 LOT부터 다시 추적'
- 출고를 **출고번호(`goodsIssueId`/`goodsIssueNo`)를 가진 별도 대상으로 다룸**. TRM-081 비고는 "별도 테이블 없음"이고, 9.1에도 번호 형식이 없음

**작업 로그**
- '상·하위 LOT 포함' (`includeLineage`, `isLineageOnly`)
- 키워드, 대상 종류, 기간 필터와 정렬 버튼
- 사유 코드 라벨, KEY_LABEL
- '관련 LOT' 링크
- 범례
- '과거 사례 검색', '비슷한 과거 사례' 버튼

### C-5. 업무 규칙 불일치

**BP-QC-01**
- ① 경계 포함(이상·이하): 미리보기는 일치합니다. 서버 판정은 확인하지 못했습니다.
- ② 두께 구간 '초과~이하': 응답 타입에 두께 구간 필드가 없어 화면에 근거가 없습니다.
- ③ **측정값 수정**(같은 행 수정, 변경 전후 로그, 밀시트 발행 후 차단): **없습니다.**
- ④ **필수 누락 시 PENDING**: 코드는 필수 누락이나 '기준 없는 필수 항목'이 있으면 **등록 자체를 막습니다** (InspectionForm.tsx:29-34,57-61). 그래서 등록된 검사가 PENDING이 되는 경우가 없습니다 (quality.ts:80). 문서(공통코드 PENDING 의미, 10장)와 다른 방식입니다.
- ⑤ '검사 기준은 품질 담당이 관리' ↔ 안내 문구 '관리자가 기준정보에서' (InspectionForm.tsx:81)
- ⑥ 자동 예약 문구는 문서와 일치합니다 (InspectionResultView.tsx:19). 다만 이벤트 모델은 `AUTO_RESERVED`로 문서와 다릅니다.
- ⑦ 판정에 쓴 기준 버전을 표시하지 않습니다.
- ⑧ 의미 충돌: 판정 결과 문구는 불합격 LOT이 '재고에 들어가지 않아요'라고 하지만, 같은 화면의 'LOT 상태'는 '재고'로 표시합니다 (qualityUi.tsx:71; InspectionResultView.tsx:13-20). 공통코드는 LOT_STATUS(위치)와 품질을 따로 보도록 정의합니다.

**BP-LOT-01**
- 역추적 열 순서 (코일→슬래브→히트→용선→원료): 일치
- 합금철 표시: 일치
- 슬래브 출하에서 코일 단계 생략: 데이터대로 그려지므로 일치
- 정추적이 출하·수주까지 이어짐: 일치
- 기간 기반 근거와 시간 범위 표시: 일치
- **출하번호로 찾기**: 없음
- 실제 투입 라벨: '직접 투입'으로 표시 (불일치)

**BP-LOG-01**
- 주체, 대상, 유형, 변경 전후, 시각, 사유, Action Draft 링크, 수주·LOT 타임라인: 있음
- 원본 메시지: `#id`만 보이고 링크는 없음
- AI 경유 (P2): `isAiAssisted` 필드는 있으나 화면에 표시하지 않음. '준비 중' 표시 자리도 없음

**9.1 이벤트 번호 EV-YYMMDD-NNN**
- 화면은 DB id `#{id}`를 보여 줍니다 (eventUi.tsx:144).
- 응답 타입에 이벤트 번호 필드가 없습니다.

**9.2 LOT 채번**
- 클라이언트는 번호를 만들거나 해석하지 않습니다.
- 고로·전로를 `blastFurnaceNo`·`converterNo` 값에 '고로'/'전로'를 붙여 표시합니다 (TraceGraph.tsx:16,18; LotDetailPanel.tsx:90-91).
- REQ-LOT-003은 고로·전로를 코드(BF2, BOF1)로 식별하므로, 값이 코드라면 'BF2고로'처럼 보일 수 있습니다. 실제 값은 서버를 보지 않아 확인하지 못했습니다.

### C-6. 코드 컨벤션

**9장 — API 호출**
- 컴포넌트에서 `fetch`를 직접 부르는 곳은 없습니다. `fetch`는 `api/client.ts:38`에만 있습니다.
- 커스텀 훅을 거치지 않는 호출이 있습니다.
  - LotTracePage.tsx:173: 이벤트 처리기에서 `lotApi.byNo` 직접 호출
  - BusinessEventPage.tsx:124,131: API 호출 람다를 화면에서 만들어 선택기에 넘김
  - PickerInput.tsx:27: 컴포넌트 안에서 `useQuery`를 직접 사용

**9장 — 스타일**
- Tailwind를 쓰지 않습니다. `client/package.json`에 의존성도 없습니다.
- 화면 전용 CSS 4개와 `quality.css`, 그리고 B안 `hl-*` 클래스를 씁니다.
- 인라인 `style=`이 191곳입니다.

| 파일 | 개수 |
|---|---|
| RejectedLotPage | 33 |
| eventUi | 27 |
| BusinessEventPage | 17 |
| qualityUi | 16 |
| LotTracePage | 16 |
| InspectionForm | 14 |
| InspectionResultView | 14 |
| LotDetailPanel | 12 |
| DispositionForm | 11 |
| ImpactSummary | 9 |
| TraceGraph | 9 |
| InspectionPage | 7 |
| PickerInput | 6 |

- 대부분 정적인 값이고, 그래프 좌표나 게이지 % 같은 동적인 값은 일부입니다.
- 색상이 코드에 직접 적힌 곳: RejectedLotPage.tsx:48,65-68,91,250,270; InspectionPage.tsx:101; InspectionResultView.tsx:31
- `SPEC.md` 9-12항은 "B안 CSS 그대로(컨벤션 미정)"라고 적었지만, 현재 컨벤션 0장은 Tailwind를 '확정'으로 표시합니다.

**9장 — 화면 전체에 걸친 사항 (대상 파일 밖이지만 위 API 전부에 영향)**
- Vite + react-router SPA입니다. 컨벤션은 Next.js App Router입니다.
- 토큰을 `sessionStorage`에 두고 Bearer 헤더로 보냅니다 (stores/auth.ts; client.ts:27-29). 컨벤션은 "프론트 코드에서 토큰을 다루지 않고 `credentials:'include'`"입니다.
- 확인 결과 문제 없음: `@/` 별칭 사용, 이름 있는 export, 저장 후 쿼리 무효화

**11장 (요청에서 9장으로 묶은 항목)**
- `any`: 없음
- `console.*`: 없음
- `eslint-disable-line react-hooks/exhaustive-deps`: 2곳 (BusinessEventPage.tsx:54,56)

**2장 — 이름 규칙**

용어 사전 변수명과 다른 이름:

| 코드 이름 | 용어 사전 이름 | 위치 |
|---|---|---|
| `blastFurnaceNo` / `converterNo` | `blastFurnaceCode` / `converterCode` | lots.ts:42-43,152-153 |
| `heatLotNo`, `heatLotId` | `heatNo` | quality.ts:24-25,117-118; lots.ts:154 |
| `weightTon` | `theoreticalWeightTon` | lots.ts:44,157 |
| `specCode` / `productSpecCode` / `materialCode` / `rawMaterialCode` (서로 섞여 있음) | `productSpec`·`itemCode` | – |
| `InspectionSpecItem`, `inspectionItemCode` | `inspectionStandardItem` | – |
| `Inspection` | `qualityInspection` | – |

추가로 볼 이름:
- `isEligible`, `isSurplus`: 여재의 변수명이 용어 사전에서 '-'입니다. `SPEC.md` 4항은 이런 이름을 "만들기 전에 물어본다"고 정합니다.
- 같은 뜻인데 이름이 다름: `lotTypeName`(quality) ↔ `lotTypeLabel`(lots), `inspectorEmployeeName` ↔ `inspectorName`
- '`order` 단독 사용 금지' 규칙에 걸릴 수 있는 이름
  - 정렬 쿼리 `order` (businessEvents.ts:40,56; BusinessEventPage.tsx:50; qualityHooks.ts:81). 5장 페이징 규칙은 `sort`를 씀
  - 상수 `ORDER` (DispositionForm.tsx:12)
  - `orderQ` (qualityHooks.ts:79), `orderLinks` (LotDetailPanel.tsx:106; lots.ts:211-222)

파일 이름:
- 훅 파일이 `useXxx.ts` 형식이 아닙니다: `qualityHooks.ts`, `traceHooks.ts`, `eventHooks.ts`
- 컴포넌트를 export하는 파일인데 PascalCase가 아닙니다: `qualityUi.tsx`, `traceUi.tsx`, `eventUi.tsx`

**4장 — 공통코드 정의 방식**
- 상수 이름이 공통코드 그룹 ID와 다릅니다: `PROCESS_CODE`(문서 `PROCESS_TYPE`), `LOT_EVIDENCE_TYPE`(문서 `LOT_RELATION_EVIDENCE`)
- 한글 라벨을 `shared`가 아닌 곳에 따로 정의했습니다.
  - `TARGET_TYPE_LABEL`, `REASON_CODE_LABEL`, `KEY_LABEL` (eventUi.tsx:9-23)
  - `LINK_TYPE_LABEL` (LotDetailPanel.tsx:12)
  - 직접 적은 라벨: TYPE_FILTERS (LotTracePage.tsx:19-26), 보류·격하·폐기 (RejectedLotPage.tsx:65-71), 사용자·시스템 (BusinessEventPage.tsx:147), 합격·불합격 (InspectionResultView.tsx:61; LotDetailPanel.tsx:72)
- 공통코드 정의서에 먼저 올리지 않은 코드 그룹: EVENT_TARGET_TYPE, EVENT_REASON_CODE, LOT_RELATION_TYPE

---

## 부록: 읽은 대상 파일과 줄 수 (27개, 총 3,283행, 모두 끝까지 읽음)

| 파일 | 줄 수 |
|---|---|
| pages/quality/InspectionPage.tsx | 183 |
| pages/quality/InspectionPage.css | 5 |
| pages/quality/RejectedLotPage.tsx | 280 |
| pages/quality/RejectedLotPage.css | 9 |
| features/quality/DispositionForm.tsx | 90 |
| features/quality/InspectionForm.tsx | 145 |
| features/quality/InspectionResultView.tsx | 102 |
| features/quality/quality.css | 37 |
| features/quality/qualityHooks.ts | 100 |
| features/quality/qualityUi.tsx | 168 |
| features/quality/qualityUtil.ts | 125 |
| pages/trace/LotTracePage.tsx | 251 |
| pages/trace/LotTracePage.css | 66 |
| pages/trace/BusinessEventPage.tsx | 217 |
| pages/trace/BusinessEventPage.css | 37 |
| features/trace/ImpactSummary.tsx | 74 |
| features/trace/LotDetailPanel.tsx | 227 |
| features/trace/PickerInput.tsx | 85 |
| features/trace/TraceGraph.tsx | 120 |
| features/trace/eventHooks.ts | 16 |
| features/trace/eventUi.tsx | 208 |
| features/trace/traceHooks.ts | 37 |
| features/trace/traceLayout.ts | 193 |
| features/trace/traceUi.tsx | 39 |
| api/quality.ts | 167 |
| api/lots.ts | 224 |
| api/businessEvents.ts | 78 |

모든 경로는 `/Users/mjkim/Documents/GitHub/fantasteel-erp/client/src/` 아래에 있습니다. 공유 코드는 `/Users/mjkim/Documents/GitHub/fantasteel-erp/shared/src/codes/index.ts`(334행)입니다.