# 품질 — 검사 입력·자동 판정·불합격 관리 (4단계 2·3번 화면)

- 2026-10-01, 작업 브랜치 `worktree-wf_b5e98464-c6e-9`(기반: `feature/screen-rework` 4ed036b, 핵심 서비스 포함).
- 근거: 02 요구사항 REQ-QC-001·003·004, REQ-INV-004·007, REQ-PRD-006 / 04 업무 프로세스 BP-QC-01, 4.3·4.5, 10장, 14.1 4~6단계 / 03 용어 사전 TRM-074~079·114 / 06 공통 코드 INSPECTION_RESULT·DISPOSITION_STATUS / PLAN 5장('기준 안 값으로 채우기' 유지, 검사 메모 삭제)·7장 품질 / 감사 보고서 4번 A-1·A-2·C절.
- 업무 규칙(판정·자동 예약·여재·히트 불합격 연쇄·배정 해제·부족 재계산·재생산)은 **핵심 서비스**(`mock/services/inspections.ts`, `productionPlans.ts`)가 한다. 이 영역은 권한 확인(`requireActor`) + 서비스 호출 + 화면만 만들었다. 규칙을 다시 만들지 않았다.

## 1. 화면·주소

| 주소 | 화면 | 여는 조건 (screens.ts 그대로) | 변경 권한 |
|---|---|---|---|
| `/quality/inspections?lot=<lotId>` | 검사 입력 | 검사 입력 조회 이상 | 검사 입력 사용 (INSPECTION_REGISTER) |
| `/quality/rejected?lot=<lotId>` | 불합격 관리 | 불합격 처리 상태 지정 조회 이상 | 불합격 처리 상태 지정 사용 (DISPOSITION_SET), 재생산 계획은 생산계획·히트 편성 사용 (PRODUCTION_PLAN_CONFIRM) |

- 새 주소는 없다(`screens.ts`·`routeTitles.ts` 변경 없음). 고른 LOT은 주소의 `?lot=`에 둔다. 주소에 없으면 목록 첫 LOT을 골라 주소에 넣는다(저장 뒤 필터에서 빠져도 같은 LOT을 계속 보이게).
- 두 화면 모두 B안 목록 | 상세 배치(MasterPane + PageMain)이고, 불러오는 중·오류(COM-002는 잠금 모양)는 QueryBoundary, 빈 목록은 EmptyNote, 고를 것이 없으면 StateView.

### 1-1. 검사 입력 (REQ-QC-001·003, BP-QC-01)

- 왼쪽 목록 '검사 대상 LOT': 판정 대기 먼저(생산완료일 → LOT 번호), 그다음 최근 판정(핵심 `inspectionQueue`).
  - 공정 보기(전체·제강·연주·열연, 숫자 = 판정 대기 수)와 설명(히트 성분 / 슬래브 표면·치수 / 코일 치수·기계적 성질 = REQ-QC-001 문구), 판정 결과 칩(판정 대기·합격·불합격·전체), LOT 번호 검색.
  - 줄: 유형 아이콘·LOT 번호·잠금(밀시트 발행)·결과 배지 / 유형·검사·강종·규격 / 계획·생산완료일(날짜)·상위 히트가 합격이 아니면 '상위 히트 판정 대기|불합격' / 판정된 것은 검사 일시·담당·기준 코드와 버전.
- 오른쪽
  - 머리: 품질 › 검사 입력 › 유형, LOT 번호(LOT 추적 링크), 결과 배지, '밀시트 발행 · 수정 불가' 배지. 버튼 'LOT 추적', 불합격이면 '불합격 관리', '비슷한 사례 찾기 준비 중 (EX)'.
  - 정보: 강종·규격, 검사, **검사 기준 코드·버전**(판정에 쓰는 버전, 현재 버전이 아니면 '현재 버전 아님'), LOT 상태, 생산완료일, 상위 히트 성분 검사(히트 링크 + 결과), 생산계획, 수주(품목·고객사, 재생산 필요가 있으면 배지), 검사 일시·담당.
  - 띠: 기준 없음(**MST-001** 문구 + 검사 기준 화면 링크), 밀시트 잠금, 상위 히트 판정 대기, 상위 히트 불합격.
  - 측정값 폼(`InspectionForm`): 항목 = 판정에 쓰는 기준 버전의 항목을 두께 구간(초과~이하)으로 거른 것(샤르피는 SM·6mm 초과 코일만 — 핵심 `inspectionFormOf`). 항목마다 이름·필수(*)/선택·코드·단위·게이지·'기준 a – b'(이상·이하)·두께 구간·미리보기 배지(저장된 값은 시스템 판정 배지)·벗어난 양. 형식은 정수 8자리·소수 4자리(음수 허용), 틀리면 '숫자(소수 4자리까지)로 입력해 주세요'(글자를 지우지 않는다).
  - **필수가 비어도 저장할 수 있다 → 판정 대기**(PLAN 7장). 아래 막대가 '저장하면 합격/불합격/판정 대기'를 미리 알려 준다(판정은 저장할 때 시스템이 한다, TRM-076).
  - **수정**: 값이 있는 검사는 버튼이 '측정값 수정'이 되고 바꾼 항목만 보낸다(빈 칸 = 값 지움). 같은 검사 기록을 고치고 전·후가 작업 로그(INSPECTION_REGISTERED before/after)에 남는다. '되돌리기'로 저장값으로 돌린다. 연 시점의 `updatedAt`을 함께 보내 다른 탭에서 바뀌었으면 COM-001.
  - **'기준 안 값으로 채우기'(시연용 도우미)**: 빈 칸만 `typicalPassValue`로 채운다. 저장은 사람이 누른다.
  - 저장 뒤 '시스템 판정' 카드: 합격·불합격·판정 대기와 같은 저장에서 일어난 일(자동 예약 n매, 여재가 된 LOT, 적격에서 빠진 LOT 수와 배정 해제·예약 조정), 연결 수주 품목의 미확보·진행 계획 잔여·**재생산 필요 N매**, '불합격 관리에서 상태 지정', '다음 판정 대기 LOT'.
  - 이력: 이 LOT의 작업 로그(최근 8건). 검사 등록·판정은 판정 전→후와 바뀐 측정값(항목명 이전 → 이후)을 보인다. 주체는 '시스템'/사원 이름.
- 조회만 가능한 사원(생산·관리자): 입력칸·버튼이 막히고 '조회만 할 수 있어요 · 검사 입력 사용 권한이 필요해요'.

### 1-2. 불합격 관리 (REQ-QC-004, REQ-INV-007, TRM-078·079)

- 왼쪽 목록 '불합격 LOT': 검사 기준을 충족하지 못한 LOT(히트 포함)과 **불합격 히트의 하위 LOT**(핵심 `rejectedLots`, 최근 생산 순).
  - 불합격 상태 타일(미지정·보류·격하·폐기, 누르면 거르기/해제), 원인 칩(모든 원인·검사 불합격·불합격 히트의 하위 LOT), LOT 번호·히트 번호 검색.
  - 줄: LOT 번호·불합격 상태 배지 / 유형·강종·규격 / 원인 배지 + 벗어난 항목(하위 LOT은 '히트 번호 + 히트의 벗어난 항목') / 수주 품목 또는 '연결 수주 없음' + **'재생산 필요 N매'**.
- 오른쪽
  - 머리: 불합격 상태·원인 배지. 버튼 '검사 결과'(하위 LOT은 '상위 히트 검사 결과'), 'LOT 추적 (영향 범위)'(정추적), **'사례로 등록'·'비슷한 사례 찾기' 준비 중 (EX)**.
  - 정보: 강종·규격, 불합격 원인, 근거 검사(공정 검사명·일시), 상위 히트, 생산계획, 영향받는 수주 품목(고객사·납기 D-n·**수주 매수**·품목 상태), 생산완료일, LOT 상태.
  - 검사값: 근거 검사(하위 LOT이면 상위 히트의 성분 검사)의 전체 항목 표(항목·기준·측정값·판정·기준 안 위치) + 기준 코드·버전, 불합격 n/m개.
  - **불합격 상태 지정**: 보류·격하·폐기 + 사유(필수, 500자). 같은 상태를 고르면 '… 사유 다시 기록'. 연 시점 `updatedAt`으로 COM-001. 후속 처리 없음 안내.
  - 영향과 자동 처리: '시스템', '예약·배정·출고 대상에서 제외', 히트면 '하위 슬래브·코일 사용 불가'. 영향받는 수주 품목의 미출하·예약·미확보·진행 계획 잔여 목표·같은 규격 예약 가용(여재 포함)·**재생산 필요**, 같은 품목의 계획 칩(재생산 표시·상태·부족 매수). 재생산 필요가 있으면 **'재생산 계획 만들기'**(확인 창 → 여재 먼저 예약, 남는 부족분만 is_reproduction 계획). 자동으로 만들지 않는다.
  - 이력: 이 LOT의 작업 로그.

## 2. API (`client/src/api/`)

| 함수 | 권한 (requireActor) | 핵심 서비스 | 오류 |
|---|---|---|---|
| `inspectionApi.queue()` | 검사 입력 조회 | `inspectionQueue` | COM-002 |
| `inspectionApi.detail(lotId)` | 검사 입력 조회 | `inspectionFormOf` + `itemShortageOf`(연결 수주 품목) + `lotTimeline` | COM-002, COM-003, 입력 오류(검사 대상 유형 아님) |
| `inspectionApi.register({lotId, values, expectedUpdatedAt})` | 검사 입력 사용 | `registerInspection` → `{inspectionResult, autoReservedQty, surplusLotNos, excludedLotQty, salesOrderItem(부족)}` | COM-002, COM-003, COM-001, MST-001, 입력 오류(형식·기준에 없는 항목·밀시트 잠금) |
| `dispositionApi.list()` | 불합격 처리 상태 지정 조회 | `rejectedLots` + 연결 수주 품목 부족 | COM-002 |
| `dispositionApi.detail(lotId)` | 불합격 처리 상태 지정 조회 | 근거 검사 `inspectionFormOf`(하위 LOT은 히트), 같은 품목의 계획, `lotTimeline`. 목록에 없으면 null | COM-002 |
| `dispositionApi.set({lotId, dispositionStatus, dispositionReason, expectedUpdatedAt})` | 불합격 처리 상태 지정 사용 | `setDisposition` (DISPOSITION_SET) | COM-002, COM-003, COM-001, 입력 오류(불합격 LOT 아님·사유 필수·500자) |
| `dispositionApi.createReproductionPlan({salesOrderItemId})` | 생산계획·히트 편성 사용 | `createReproductionPlan` (RESERVATION_CREATED·REPRODUCTION_PLAN_CREATED) | COM-002, COM-003, MST-001, 입력 오류(재생산할 매수 없음) |

- 조회 키: `inspectionKeys`(`quality-inspections`), `dispositionKeys`(`rejected-lots`) — 각 api 파일 안. `useAction`이 성공 뒤 모든 조회를 무효화하므로 수주·재고·생산계획·LOT 화면도 바로 바뀐다(다른 탭은 BroadcastChannel).
- 훅: `hooks/useInspections.ts`(`useInspectionQueue`·`useInspectionDetail`·`useRegisterInspection`), `hooks/useDispositions.ts`(`useRejectedLots`·`useRejectedLotDetail`·`useSetDisposition`·`useCreateReproductionPlan`).
- 작업 로그: 이 영역이 따로 남기는 이벤트는 없다. INSPECTION_REGISTERED(전후 값)·RESERVATION_CREATED(SYSTEM)·SURPLUS_CONVERTED·RESERVATION_RELEASED/ALLOCATION_RELEASED(QUALITY_FAILURE)·DISPOSITION_SET·REPRODUCTION_PLAN_CREATED는 핵심 서비스가 같은 트랜잭션에서 남긴다.

## 3. 화면 계산 (`features/quality/lib/qualityDisplay.ts`, 테스트 있음)

- `previewOf`(형식 확인 뒤 **2단계 판정 함수 `judgeValue`** 로 미리보기, 벗어난 양은 십진 계산), `limitText`(이상·이하), `thicknessBandText`(초과~이하), `gaugeGeometry`, `fillTypicalValues`(`typicalPassValue`), `sameMeasuredValue`(자리수만 다른 값은 같음 → 바꾼 항목만 보냄), `measuredValueChanges`·`inspectionResultOfSnapshot`(작업 로그 전후 비교), `INSPECTION_NAME`(REQ-QC-001 문구).

## 4. 테스트 (Vitest, 27개 추가 → 전체 173개 통과)

- `api/inspections.test.ts`(12): 목록 순서·잠금, 조회 권한(생산 조회 가능, 영업·계정 없음 COM-002), 폼(기준 버전·항목·연결 수주·이력, COM-003), 합격 등록(이벤트 주체 사용자), 필수 누락 → 판정 대기, 같은 기록 수정·전후 로그·여재 전환, **히트 불합격 연쇄 → 부족·재생산 필요 8 → 다시 합격 → 자동 예약 8(SYSTEM)**, COM-002(생산·관리자), COM-003, COM-001, MST-001, 밀시트 잠금, 형식·기준에 없는 항목 입력 오류(이벤트 없음). 단계마다 불변조건 `checkInvariants` = [].
- `api/dispositions.test.ts`(7): 목록(검사 불합격·히트 하위 10개·재생산 필요 8), 상세(근거 = 히트 성분 검사, 계획, null), 조회 권한(관리자 가능·생산 COM-002), 상태 지정·재기록·하위 LOT 지정(DISPOSITION_SET), COM-002(관리자), COM-003·COM-001·사유 필수·500자·불합격 아님, 재생산(품질 COM-002 → 생산 부서장 생성·REPRODUCTION_PLAN_CREATED → 다시 누르면 입력 오류 → 재생산 필요 0).
- `features/quality/lib/qualityDisplay.test.ts`(8): 기준 문구·두께 구간, 미리보기 경계·형식, 저장값 비교, 게이지, 채우기, 전후 비교.

## 5. 보고서 4번 C절 반영

- PENDING 표시명 '판정 대기'(C-2·C-3). 필수 누락을 막지 않고 판정 대기로 저장(C-5 ④). 측정값 수정·전후 로그·밀시트 뒤 잠금(C-1 QC-003, C-5 ③). 판정에 쓴 기준 버전 표시(C-1 QC-002 ②, C-5 ⑦). 두께 구간 표시(C-5 ②). 검사 메모 삭제(C-4, PLAN 5장). 검사번호(qualityInspectionNo) 삭제(9.1에 형식 없음).
- 'SYSTEM' → '시스템', 'v2' 문구 삭제, '출하' → '출고'(예약·배정·출고 대상에서 제외), '폐기(스크랩)' → '폐기', '주문' → '수주 매수', 목록 안내를 '슬래브·코일'이 아니라 TRM-078 정의대로(히트 포함).
- 처리 상태 타일과 탭이 같은 일을 하던 것(C-4)은 타일만 남겼다. 안내 '관리자가 기준정보에서' → '품질 담당이 검사 기준 화면에서'(C-5 ⑤). LOT 상태는 LOT_STATUS 표시명(재고·투입 소진·출고), 품질은 따로 배지(C-5 ⑧). 생산 시각 → 생산완료일(날짜).
- 판정 뒤 처리 카드는 이벤트 시각 범위 추정(C-4) 대신 저장 결과(자동 예약·여재·제외 수)와 LOT 작업 로그로 보인다.

## 6. 가정값 (6개 문서에 없는 것 — 확인 필요)

| 항목 | 값 | 이유 |
|---|---|---|
| 불합격 상태가 비었을 때 표시 | '미지정' 배지 | 공통 코드에 빈 값 표시명이 없음. 옛 화면 표시를 유지 |
| 불합격 원인 이름 | '검사 불합격' / '불합격 히트의 하위 LOT' | TRM-078 정의("검사 기준을 충족하지 못한 LOT과 불합격 히트의 하위 LOT")에서 따옴. 옛 '자체 불합격/히트 불합격'은 새로 지은 이름(C-4) |
| 필드 이름 | '불합격 상태'(TRM-079 한글명). REQ-QC-004 본문의 '처리 상태'는 안내 문구에만 | 용어 사전 우선 |
| 조회 API 권한 | 검사 입력 화면 = INSPECTION_REGISTER 조회, 불합격 관리 = DISPOSITION_SET 조회 | 화면 여는 조건(screens.ts)과 같게 |
| 측정값 형식 | 정수 8자리·소수 4자리, 음수 허용 | 가짜 서버 checkDecimal과 같게(ERD decimal 자리수) |
| 미리보기 | 입력 중 항목별 미리보기 + 저장하면 판정될 결과 예고 | 옛 화면 유지(C-4: 제안 단계가 아니므로 TRM-076과 충돌 없음) |
| 다른 영역 링크 | LOT 추적 `/lots/trace?lot=<LOT 번호>&direction=forward`, 생산계획 `/production/plans?plan=<id>`, 수주 `/sales-orders/<id>`, 작업 로그 `/business-events?lotId=<id>`(이 LOT의 이력 재현, 검토 반영으로 연결), 검사 기준 `/quality/standards` | 옛 화면 주소 형식. 해당 영역이 같은 쿼리를 읽는지 병합 때 확인 |

## 7. 공유 파일 변경

- 없음. (screens.ts·routeTitles.ts·codes·components·mock 서비스 모두 그대로)

## 8. 시드

- 새 시드 없음. 핵심 시드(`seeds/core.ts`)의 판정 대기 LOT(히트 HT-BOF1-260918-001, PP-2609-0003 슬래브 2매), 표면 불합격 슬래브 HT-BOF1-260914-001-03(불합격 상태 비어 있음), 성분 불합격 히트 HT-BOF1-260924-001(하위 슬래브 10매, SO-2609-005 재생산 필요 8), 밀시트 잠금 HT-BOF1-260905-001로 두 화면이 모두 채워진다. 등록할 것 없음.

## 9. 확인이 필요한 것 / 남은 일

1. **재생산 버튼을 누를 수 있는 사람이 시드에 없다**: 불합격 관리를 여는 역할(품질 사용, 관리자 조회)에는 생산계획·히트 편성 사용 권한이 없고, 생산은 불합격 처리 상태 지정 조회가 없어 이 화면을 못 연다. 버튼은 막힌 채 툴팁으로 필요한 권한을 알리고 생산계획 칩 링크를 둔다. 생산에 DISPOSITION_SET 조회를 줄지(seed-assumptions 2-2 VIEW 표) 결정 필요. 같은 api는 생산계획·수주 상세 화면도 쓸 수 있다(병합 때 생산계획 api로 옮겨도 된다).
2. 밀시트 발행 뒤 수정 거부는 9.3 코드가 없어 입력 오류(코드 없음)로 보인다(핵심 결정 그대로).
3. 작업 로그 버튼은 필터 없이 연다. 작업 로그 영역이 LOT 필터 쿼리를 정하면 연결한다. 대신 각 화면의 '이력' 카드가 이 LOT의 로그를 보여 준다.
4. 화면 렌더 테스트는 없다(테스트 환경이 node, DOM 없음). 병렬 규칙상 dev 서버·next build를 돌리지 않았다 → 병합 단계에서 두 주소를 클릭으로 점검해야 한다.
5. 검사 대상 목록에 판정된 LOT이 모두 나온다(옛 '최근 300건' 제한 없음). 시드 크기에서는 문제없다.

## 검토 반영

| 지적 | 근거 | 고친 내용 |
|---|---|---|
| 이력 카드의 '작업 로그' 링크가 필터 없이 `/business-events`로 가서 이 LOT의 이력 재현이 안 됨 | 02 REQ-LOG-003, 04 BP-LOG-01, 이 문서 §9-3 | `LotHistoryCard`에 `lotId`를 받아 `/business-events?lotId=<id>`로 연결. 검사 입력은 `lot.lotId`, 불합격 관리는 `row.lotId`를 넘긴다 (작업 로그 화면이 `?lotId=`를 읽어 이력 재현으로 바뀜) |
| 불합격 관리에서 '불합격 히트의 하위 LOT' 행의 이력 카드가 `THICKNESS_DEV — → 0`처럼 영문 항목 코드를 그대로 보임 | common.md Names(06 표시명·03 한글명), 02 REQ-QC-003, ERD `inspection_standard_item.inspection_item_name` | 항목명을 근거 검사 폼(상위 히트의 C·MN·P·S)에서 만들지 않고, 작업 로그의 INSPECTION_REGISTERED 전후 값에 실제로 나온 코드로 `inspection_standard_item`에서 찾는다(현재 기준 먼저). `inspectionApi.detail`·`dispositionApi.detail`이 `inspectionItemNames: Record<string,string>`을 돌려주고, 둘 다 `historyWithItemNames(tables, lotId)`(api/inspections.ts)를 쓴다. 이름을 못 찾으면 코드 대신 '검사 항목'(`UNKNOWN_ITEM_NAME`)을 보인다 |

- 순수 함수 추가: `inspectionItemCodesOfHistory(events)` (`features/quality/lib/qualityDisplay.ts`, 테스트 있음).
- 테스트: `qualityDisplay.test.ts` 1개 추가, `dispositions.test.ts`(하위 LOT 상세의 항목명이 THICKNESS_DEV 등 이 LOT 자신의 코드까지 덮는지)·`inspections.test.ts`(불합격 슬래브 상세의 항목명) 검사 보강 → 전체 543개 통과, 타입 검사 0 오류.
- 공유 파일 변경 없음.
