# 생산 — 생산계획(히트 편성표)·작업 실적·실적 시뮬레이션·열연 투입 배정

- 2026-10-01, 워크트리 브랜치 `worktree-wf_b5e98464-c6e-8` (core 커밋 4ed036b 위). 근거: stage3.md 4번, stage4.md 1·4번과 2번 마지막 항목(재생산 버튼), reports/3-production-inventory.md A-1~A-3·A-5와 C절, PLAN 6·7장 생산, 02 요구사항 REQ-PRD-001~004·006·007, REQ-INV-006, REQ-LOT-001~004, 04 업무 프로세스 BP-PRD-01·02, BP-INV-01, 4.4·4.5, 8장, 9.2·9.3, 10장, 14.1 2·4단계, 14.2.
- 업무 규칙(히트 편성·실적·LOT 채번·FIFO 차감·LOT 관계·열연 배정·재생산·작업 로그)은 모두 core 서비스(`@/mock/services`)가 한다. 이 영역의 api 층은 `requireActor`로 권한을 확인하고 서비스를 부르며, 화면용 조회만 덧붙인다. 작업 로그는 core가 같은 트랜잭션에서 남기므로 따로 남기지 않았다.

## 1. 화면·라우트

| 라우트 | 여는 조건(기존 SCREEN 표) | 변경 권한 | 내용 |
|---|---|---|---|
| `/production/plans` | 조회 PRODUCTION_PLAN_CONFIRM | PRODUCTION_PLAN_CONFIRM | 목록(검색·상태·슬래브/코일) \| 상세: 편성표, 히트, 작업 실적, 생산 LOT, 연결 수주 품목, 진행. 계획 취소(계획 상태만), 재생산 필요 띠 + 재생산 계획 |
| `/production/results` | 조회 PRODUCTION_RESULT_CONFIRM | PRODUCTION_RESULT_CONFIRM | 계획 목록(진행중 / 계획·시작 전 / 완료 포함) \| 공정별 묶음(제선·제강·연주·열연): 작업 시작 · 실적 등록 · 작업 완료, 실적 시뮬레이션 |
| `/production/rolling` | 조회 HOT_ROLLING_ALLOCATE | 배정 = HOT_ROLLING_ALLOCATE, 열연 실적 = PRODUCTION_RESULT_CONFIRM | 코일 계획 목록 \| 슬래브 풀·FIFO 추천·배정 확정·변경·해제·열연 실적·코일 |

- 세 화면 모두 `?plan=<id>`로 계획을 주고받는다(`hooks/useProductionPlanParam.ts`). 페이지 파일은 `useSearchParams` 때문에 `<Suspense>`로 감쌌다.
- 사용 권한이 없으면 머리에 `ReadOnlyHint`("조회만 할 수 있어요 · …사용 권한이 필요해요")를 보이고 변경 버튼은 막고 툴팁에 같은 문구를 둔다. api도 같은 권한을 다시 확인한다(COM-002).
- 빈·불러오는 중·오류 상태: 목록은 `EmptyNote`, 상세는 `QueryBoundary`(COM-002면 잠금 모양), 고른 계획이 없으면 `StateView`.
- 새 라우트는 없다(`screens.ts`·`routeTitles.ts`는 바꾸지 않았다).

## 2. 흐름과 근거

### 생산계획 (REQ-PRD-001·002·006, BP-PRD-01, 10장)
- 계획은 수주 등록 때 core가 히트 편성까지 계산해 만든다. 화면은 **편성표**를 보인다: 부족 매수 → 수주 목표(목표중량 = 부족 매수 × 1매 이론중량) → 누적 계획수율(슬래브 = 연주만, 코일 = 연주 × 열연) → 필요 용강량 → 히트 수(ceil) → 히트 톤(히트 전체) → 히트당 슬래브 → 계획 슬래브 → 예상 슬래브 여재. 14.1-2대로 "히트 전체 톤 가운데 수주 목표"를 나눠 적었다.
- CONFIRMED(편성 확정)·'조치 필요' 필터·'여재 사용 매수' 입력·'귀속'을 없앴다(PLAN 6-3, 7). 상태는 계획 → 진행중 → 완료 / 취소.
- 배지: 상태, **재생산**(is_reproduction), **완료 후 여재**(is_surplus_on_completion). 완료 후 여재 계획은 상세에 "수주 취소로 연결이 끊긴 계획… 여재로 남아요"(코일이면 "열연하지 않아요") 띠.
- **계획 취소**: 계획 상태(작업 실적 없음)일 때만 버튼이 보인다. 사유(선택, 500자), 연 시점 updatedAt을 보내 다른 탭에서 바뀌었으면 COM-001. core `cancelProductionPlan` → PRODUCTION_PLAN_CANCELLED.
- **재생산** (stage4 2번 마지막 항목, 14.1-6): 연결 수주 품목의 4.5 부족을 계산해(`reproductionCheckOf` = core `itemShortageOf` + 진행 계획 목록) '추가 계획 필요' > 0이면 띠를 보인다.
  - 재생산 필요(= 추가 계획 필요 − 예약 가용) > 0 → 빨간 띠 "재생산 필요 N매" + **재생산 계획** 버튼.
  - 여재로 다 채울 수 있으면 노란 띠 + **여재로 채우기** 버튼.
  - 창에서 수주 매수·출고·미출하·예약·현재 미확보·진행 계획 잔여·추가 계획 필요·예약 가용·재생산 필요와 식, 품목의 계획 목록을 보이고 core `createReproductionPlan`을 부른다(여재 먼저 예약 → 남으면 is_reproduction 계획, REPRODUCTION_PLAN_CREATED). 자동 생성은 없다. 'AI Factory Agent 재생산 자동 초안'은 SoonButton(P2).
- 작업 실적 버튼은 `/production/results?plan=`로만 간다(시뮬레이션은 작업 실적 화면에서만, BP-PRD-02).

### 작업 실적 (REQ-PRD-003, REQ-LOT-001~004, BP-PRD-02 모든 행)
- 이름은 '작업 실적'(PLAN 6-1), '작업 지시'·작업 상태값 없음. 진행 중 = 작업 완료 일시 없음(`진행 중` 배지).
- 공정마다 **작업 시작**(시작 일시만 기록, PRODUCTION_STARTED, 첫 실적이면 계획이 진행중) / **실적 등록**(시작·완료 한 번에) / 진행 중 행의 **작업 완료**(같은 실적 행을 완료).
  - 제선: 고로 코드(대문자·숫자 2~10자, 예 BF2, 소문자는 대문자로 바꿔 보냄), 작업 시작·완료 일시, 원료 투입 기간(= 작업 시작~완료, 읽기 전용), 용선량(기본 = 히트 용량 ÷ 제강 수율). 원료별 투입 예정 = 용선량 × 원단위와 원료 LOT 잔량을 미리 보여 주고, 모자라면 빨갛게. core가 입고일 FIFO 차감 → `HM-고로-YYMMDD-NN`, 차감한 LOT만 PERIOD_BASED(기간·차감량).
  - 제강: 전로 코드(예 BOF1), 히트 편성 순번(읽기 전용), 투입 용선량(쓸 수 있는 용선 표시, 용선 LOT은 생산 순 FIFO 자동). 히트 톤 = 투입 용선 × 제강 수율, 합금철 = 히트 톤 × kg/t ÷ 1,000 미리보기. core → `HT-전로-YYMMDD-NNN`, 용선→히트·합금철→히트 ACTUAL_INPUT, 성분 검사 대상. 편성 히트를 다 만들었으면 버튼을 막는다.
  - 연주: 히트(연주 전 히트만), 규격(계획의 슬래브 규격, 읽기 전용), 슬래브 생산 매수(정수만, 글자를 지우지 않고 거부), 작업일시. 최대 매수 = floor(히트 톤 × 연주 수율 ÷ 슬래브 1매 이론중량)를 안내하고 넘으면 core가 거부. 히트 판정 전이면 "연주는 되지만 합격 전에는 예약·열연·출고 불가" 띠(16장 TBD → core 기본값 그대로 연주 허용).
  - 열연: 이 화면에서는 실적을 보여 주기만 하고 등록은 열연 투입 배정 화면 한 곳에서 한다(stage4 "keep one place").
- 실적 표: 작업 시작·완료, 고로·전로 코드, 투입·산출(제선 원료→용선 t, 제강 용선→히트 t, 연주 히트 t→슬래브 매·t, 열연 슬래브 t→코일 개·t), 만든 LOT(LOT 추적 링크), 실적 시뮬레이션 값(시드, 연주는 샘플 손실률·손실 매수·실제 감소율), 작업자.
- 진행 표시: 히트 편성 · N히트 → 제선 n건 → 제강 a/N → 연주 b/N → (열연 c/부족 매수). 분모를 함께 보인다(4.5).

### 실적 시뮬레이션 (REQ-PRD-007, 8장 BP-SEED-01)
- 작업 실적 화면 머리의 **실적 시뮬레이션**(PRODUCTION_RESULT_CONFIRM, 계획·진행중 계획만). 난수 시드(선택, 0~2,147,483,647 정수). core `simulatePlan`(고로 BF2·전로 BOF1 기본값) → 결과 창: 난수 시드, 만든 작업 실적 수, 연주 손실 매수 합, 만든 LOT 수, 공정별 표(계획 슬래브·샘플 손실률·손실 매수·**실제 감소율**·실적 매수·LOT), 열연을 건너뛴 이유. 검사값은 넣지 않는다(검사 입력에서 판정).

### 열연 투입 배정·열연 실적 (REQ-PRD-004, REQ-INV-006·008·009, BP-INV-01, 14.2)
- 코일 계획 목록(계획·진행중 / 전체). 수주 연결이 없는 계획은 '수주 연결 없음' 배지와 "열연하지 않아요… 남은 합격 슬래브는 여재" 띠.
- 슬래브 풀 띠: 미소진 합격 − 판매 예약 − 열연 배정 = 예약 가용, 지금 배정할 수 있는 매수 = min(더 필요한 슬래브, 예약 가용). 판매 예약 몫은 추천·확정하지 않는다(core가 INV-001로도 막음).
- FIFO 추천 표: 적격·미소진·미배정 슬래브 전부를 생산완료일 → LOT 번호 순으로, 순위·히트·생산완료일(날짜)·야드·생산계획·구분(이 계획 생산분 / 여재 / 미배정 합격)·추천/후보. 추천분을 미리 골라 두고 한도까지만 고를 수 있다. 추천과 다르게 고르면 안내(작업 로그 ALLOCATION_RECOMMENDED에 추천·선택 LOT과 같은지가 함께 남는다). 추천은 저장하지 않는다.
- 확정 배정 표: 변경(새 슬래브 + 사유 필수 → 해제와 새 배정을 한 번에, ALLOCATION_CHANGED) · 해제(사유 선택).
- **열연 실적 등록**(PRODUCTION_RESULT_CONFIRM): 적격인 확정 배정을 고르고(기본 전부) 작업일시 → core `registerHotRolling` → 슬래브 CONSUMED·배정 CONSUMED, 코일 `C+슬래브번호(HT- 제외)` 1:1, 코일 검사 대상, 계획 완료(코일 수 ≥ 부족 매수)면 남은 슬래브 여재. 열연 실적·코일 표(투입 슬래브·검사·상태).

## 3. api 함수 (`client/src/api/`)

| 파일 | 함수 | 권한 | core |
|---|---|---|---|
| `production.ts` | `productionPlanApi.list` / `detail(id)` | 조회 PRODUCTION_PLAN_CONFIRM | `listProductionPlans`, `productionPlanView` + LOT 표·연결 품목 상태·담당·`reproductionCheckOf` |
| | `cancel({productionPlanId, reasonText?, expectedUpdatedAt?})` | 사용 PRODUCTION_PLAN_CONFIRM | `cancelProductionPlan` |
| | `createReproduction({salesOrderItemId})` | 사용 PRODUCTION_PLAN_CONFIRM | `createReproductionPlan` |
| | `reproductionCheckOf(tables, soItem)`, `lotQualityOf`, `planLotRowOf` (내보냄) | — | `itemShortageOf`, `planProgressOf`, `heatOf` |
| `productionResults.ts` | `productionResultApi.plans` / `work(id)` | 조회 PRODUCTION_RESULT_CONFIRM | `listProductionPlans`(취소 제외), `productionPlanView` + 제강·연주 수율, 히트 용량, 히트 1개 용선, 용선 LOT, 원료·합금철 잔량과 원단위, 연주 전 히트와 최대 매수 |
| | `startWork` / `registerIronmaking` / `registerSteelmaking` / `registerCasting` / `simulate` | 사용 PRODUCTION_RESULT_CONFIRM | `startWork`, `register*`, `simulatePlan` |
| `rolling.ts` | `rollingApi.plans` / `detail(id)` | 조회 HOT_ROLLING_ALLOCATE | `rollingPlanView`, `rollingRecommendation`, `unallocatedEligibleLotsOf` + FIFO 정렬, 열연 실적, 코일 |
| | `confirm` / `change` / `release` | 사용 HOT_ROLLING_ALLOCATE | `confirmRollingAllocations`, `changeAllocation`, `releaseAllocation` (열연 배정인지 먼저 확인) |
| | `registerHotRolling` | 사용 PRODUCTION_RESULT_CONFIRM | `registerHotRolling` |

- 조회 키: `productionPlanKeys`, `productionResultKeys`, `rollingKeys`(각 api 파일 안). 변경은 `useAction`이 모든 조회를 무효화한다.
- 훅: `hooks/useProductionPlans.ts`, `useProductionResults.ts`, `useRolling.ts`, `useProductionPlanParam.ts`.
- **다른 영역이 쓸 수 있는 것**: 수주 상세 충족 현황·불합격 관리의 "재생산 필요 N매" 버튼은 `productionPlanApi.createReproduction({salesOrderItemId})`를 부르면 된다(생산 사용 권한 확인 포함). 표시용 계산은 `reproductionCheckOf`.

## 4. 테스트 (Vitest, 이 영역 29개 · 전체 175개 통과)
- `api/production.test.ts`(7): 목록·편성표·LOT, COM-002(물류)·COM-003, 히트 불합격 계획의 재생산 필요 8매, LOT 품질 표시, 재생산 계획(영업 COM-002 → 생산 성공, REPRODUCTION_PLAN_CREATED, 두 번째는 입력 오류, 불변조건), 계획 취소(이벤트·사유, 다시 취소·진행중 취소 거부, COM-001·COM-003·COM-002).
- `api/productionResults.test.ts`(9): 조회 권한(품질 가능·영업 COM-002), 작업 기준값, 제선(HM 번호·PERIOD_BASED·기간·철광석 160t 차감·이벤트), 원료 부족 시 아무것도 저장 안 됨, 용선량 0·완료 일시 역전 거부, 작업 시작 → 같은 행 완료, 전로 코드 형식, 제강 편성 초과 거부, 연주 최대 매수(10매)·정수·COM-002·슬래브 번호·검사 대상·계획 완료, COM-003, 시뮬레이션(연주만 손실 floor·시드·is_simulated 저장·같은 시드 같은 결과, 시드 범위·완료 계획·COM-002).
- `api/rolling.test.ts`(5): 필요 매수·FIFO 순서·코일 번호, INV-002·INV-004·COM-002·INV-003, 14.2 판매 예약 비침범(INV-001), 변경(사유 필수·ALLOCATION_CHANGED)·해제, 열연 실적(C+슬래브번호·코일 검사 대상·계획 완료·소진 배정 해제 INV-004).
- `features/production/lib/productionDisplay.test.ts`(5): 수율 백분율, 실제 감소율, 라우팅, 진행 표시 분모, 작업일시 서울 시각 변환.
- `features/production/productionScreens.test.ts`(3): 세 상세 본문을 시드로 서버 렌더해 런타임 오류가 없는지, 금지어('공정 실적'·'귀속')가 없는지, 조회만 하는 사원에게 읽기 전용 표시가 나오는지.
- 도우미 `api/productionTestKit.ts`(테스트 전용: 번호로 찾기, 수주 등록, 원료 입고).

## 5. 시드
- 새 시드 없음. core 시드(PP-2609-0001~0005)로 모든 화면이 채워진다: 진행중 슬래브 계획(PP-2609-0004, 제선·제강 끝, 연주 전, 히트 판정 대기), 진행중 코일 계획(PP-2609-0003, 열연할 적격 슬래브 3매·판정 대기 2매·코일 3개), 히트 불합격 완료 계획(PP-2609-0005, 재생산 필요 8매), 완료 계획 2개.

## 6. 가정값
| 항목 | 값 | 이유 |
|---|---|---|
| 작업일시 기본값 | 지금 끝난 작업으로: 제선 4시간·제강 1시간·연주 2시간·열연 2시간 전 시작 | core 시뮬레이션 가정값과 같게(시연 편의). 사용자가 바꿀 수 있다 |
| 고로·전로 코드 입력 | 소문자는 대문자로 바꿔 보낸다. 기본값은 이 계획에서 마지막으로 쓴 코드 | 코드 형식(대문자·숫자 2~10자)은 core 가정값 |
| 시뮬레이션 고로·전로 | BF2·BOF1 (화면에서 바꾸지 않음) | core 기본값, 문서 예시 |
| 난수 시드 범위 | 0 ~ 2,147,483,647 정수 | 32비트 양의 정수(옛 화면과 같음) |
| 재생산 띠 기준 | '추가 계획 필요' > 0이면 띠, '재생산 필요' > 0이면 빨간 띠·재생산 계획, 아니면 '여재로 채우기' | 4.5·14.1-6. 같은 core 함수가 여재 예약 → 재생산을 한 번에 한다 |
| 연주 시 히트 판정 전 | 연주 허용 + 경고 띠 | 16장 TBD, core 기본값 |
| 납기 D-라벨 | 계획 목록·연결 품목에 D-n, 지난 납기는 빨갛게(완료·취소 제외) | 옛 화면 유지(화면 편의, PLAN 5장 납기 위험 표시) |

## 7. 공유 파일 변경
- 없음. (core 서비스·codes·components·shell 파일을 고치지 않았다.)

## 8. 확인
- `npm run typecheck -w @fantasteel/client` 0 오류, `npm run test -w @fantasteel/client` 전부 통과. 병렬 규칙대로 `next build`·개발 서버는 돌리지 않았다(화면은 서버 렌더 테스트로만 확인).

## 9. 열린 질문·남은 일
1. BP-PRD-02·공통 코드 권한 표시명이 '공정 실적'을 쓰는데 화면은 PLAN 6-1대로 '작업 실적'. 문서 정리 필요.
2. 연주 작업을 '작업 시작'만 했을 때 어떤 히트인지는 작업 로그(PRODUCTION_STARTED.afterData.heatLotId)에만 남는다(ERD production_result에 히트 칸이 없음). 완료할 때 히트를 다시 고른다.
3. 히트 미판정 상태의 연주 허용 여부(16장 TBD)는 core 기본값(허용)을 따랐다.
4. 생산계획 목록의 납기 표시는 D-라벨(옛 화면)이고, 공통 코드 비고의 '납기 위험'(delivery_risk_days) 배지는 수주 화면에서 계산한다. 생산 화면에도 같은 배지를 쓸지 결정 필요.
5. 브라우저로 직접 확인하지 못했다(병렬 규칙). 병합 뒤 빌드·브라우저 확인 필요: 창(Modal)은 서버 렌더 테스트에 들어가지 않는다.
