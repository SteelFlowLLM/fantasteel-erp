# 시드 가정값 (1단계: 조직·기준정보)

- 대상: 브라우저 안 가짜 데이터의 시드 `client/src/mock/seed.ts` (2026-10-01, 화면 재작업 1단계)
- 6개 문서(docs/notion/01~06)·ERD 최종본·KS 추출본에 값이 있으면 그 값을 썼다. **값이 없는 것은 모두 가정값**이고, 아래 표의 "근거" 칸에 "가정"이라고 적었다. 사용자 확인을 받는다 (SPEC 6장).
- 1~4장은 1단계(조직·기준정보 시드 `client/src/mock/seed.ts`)의 내용이다. 거래·협업 시드는 5장, 영역 노트의 가정값은 6장에 있다.

## 1. 조직

### 1-1. 부서 (10개, 부서마다 부서장 1명)

| 부서 코드 | 부서명 | 상위 부서 | 정렬 순서 | 부서장 | 근거 |
|---|---|---|---|---|---|
| SAL | 영업부 | — | 1 | 김도윤 | 부서 목록: 부모 지시. 코드·정렬 순서: 가정 |
| PUR | 구매부 | — | 2 | 최준혁 | 〃 |
| PRD | 생산부 | — | 3 | 강민석 | REQ-ORG-001 예시 |
| PRD-IRON | 제선파트 | 생산부 | 1 | 윤성호 | REQ-ORG-001 예시 "생산부 하위 제선·제강·연주·열연 파트" |
| PRD-STEEL | 제강파트 | 생산부 | 2 | 장혜린 | 〃 |
| PRD-CAST | 연주파트 | 생산부 | 3 | 임재원 | 〃 |
| PRD-HR | 열연파트 | 생산부 | 4 | 한승우 | 〃 |
| QC | 품질부 | — | 4 | 오지훈 | 부서 목록: 부모 지시. 코드·정렬 순서: 가정 |
| LOG | 물류부 | — | 5 | 신현우 | 〃 |
| MGT | 경영지원부 | — | 6 | 이현정 | 〃 |

- 부서 코드는 옛 화면의 형식(영문 대문자·숫자·하이픈, 예 `PRD-COKE`)을 따랐다 (가정).
- 부서장은 역할이 아니다. `department.head_employee_id`로만 지정한다 (REQ-ORG-002, REQ-AUTH-004).

### 1-2. 직급 (job_grade, 가정)

| 직급 코드 | 직급명 | 표시 순서 | 근거 |
|---|---|---|---|
| GENERAL_MANAGER | 부장 | 10 | 가정. 표시 순서는 높은 직급이 먼저 (TRM-036 "표시 순서 보유") |
| DEPUTY_GENERAL_MANAGER | 차장 | 20 | 가정 |
| MANAGER | 과장 | 30 | 가정 |
| ASSISTANT_MANAGER | 대리 | 40 | 가정 |
| STAFF | 사원 | 50 | 가정 |

- 표시 순서를 10 간격으로 둔 것은 나중에 직급을 사이에 넣기 쉽게 하려는 가정이다.

### 1-3. 역할 (6개)

공통 코드 ROLE 그대로 (가정 아님): SALES 영업 / PURCHASE 구매 / PRODUCTION 생산 / QUALITY 품질 / LOGISTICS 물류 / ADMIN 관리자. `role_name` = 표시명.

### 1-4. 사원 (15명, 가정)

| 사원번호 | 이름 | 부서 | 직급 | 역할 | 부서장 |
|---|---|---|---|---|---|
| 1503001 | 이현정 | 경영지원부 | 부장 | 관리자 | 경영지원부 |
| 1608002 | 김도윤 | 영업부 | 부장 | 영업 | 영업부 |
| 2103003 | 박서영 | 영업부 | 대리 | 영업 | — |
| 1702004 | 최준혁 | 구매부 | 부장 | 구매 | 구매부 |
| 2207005 | 정다은 | 구매부 | 사원 | 구매 | — |
| 1401006 | 강민석 | 생산부 | 부장 | 생산 | 생산부 |
| 1709007 | 윤성호 | 제선파트 | 차장 | 생산 | 제선파트 |
| 1804008 | 장혜린 | 제강파트 | 과장 | 생산 | 제강파트 |
| 1906009 | 임재원 | 연주파트 | 과장 | 생산 | 연주파트 |
| 2001010 | 한승우 | 열연파트 | 과장 | 생산 | 열연파트 |
| 2402011 | 조은서 | 제강파트 | 사원 | 생산 | — |
| 1802012 | 오지훈 | 품질부 | 부장 | 품질 | 품질부 |
| 2205013 | 서민지 | 품질부 | 대리 | 품질 | — |
| 1610014 | 신현우 | 물류부 | 부장 | 물류 | 물류부 |
| 2304015 | 권예진 | 물류부 | 사원 | 물류 | — |

- 이름은 가상의 흔한 한국 이름이다.
- 사원번호는 7자리 숫자(입사 연월 4자리 + 순번 3자리)로 가정했다. 옛 화면의 "숫자 7자리" 검증을 따랐다.
- 역할마다 부서장이 아닌 사원을 1명 이상 두었다(관리자 제외). 구매요청 승인 흐름(사원 요청 → 소속 부서장 승인)을 시연하려면 요청자가 부서장이 아니어야 하기 때문이다.
- 모두 사용 중(`is_active = true`)이고 최근 접속(`last_login_at`)은 비어 있다. 계정 선택 화면에서 계정을 고르면 그 시각을 남긴다.
- `password_hash`는 빈 값이다. 사원번호·비밀번호 로그인은 나중에 넣는다 (SPEC 5장 결정 1).

## 2. 역할별 권한

### 2-1. 사용(USE) — 업무 프로세스 정의서 2장 그대로 (가정 아님)

| 역할 | 사용 권한 |
|---|---|
| 관리자 | 사원 관리, 부서·권한 관리, 기준정보 관리 |
| 영업 | 수주 등록, 수주 취소, 출하요청·배정 확정 |
| 구매 | 구매요청 등록·MRP, 발주, 입고 확정 |
| 생산 | 생산계획·히트 편성, 작업 실적(실적 시뮬레이션 포함), 열연 투입 배정 |
| 품질 | 검사 입력, 불합격 처리 상태 지정, 검사 기준 관리 |
| 물류 | 출고 확정, 밀시트 조회·출력 |

### 2-2. 조회(VIEW) — 화면 흐름에 필요한 만큼 정한 값 (**확인 필요**)

표의 값: 사용 = USE, 조회 = VIEW, – = 권한 없음(행 없음).

| 영역 | 권한 | 영업 | 구매 | 생산 | 품질 | 물류 | 관리자 |
|---|---|---|---|---|---|---|---|
| 영업 | 수주 등록 | 사용 | – | **조회** | – | – | 조회 |
| 영업 | 수주 취소 | 사용 | – | – | – | – | 조회 |
| 영업 | 출하요청·배정 확정 | 사용 | – | – | – | **조회** | 조회 |
| 구매 | 구매요청 등록·MRP | – | 사용 | **조회** | – | – | 조회 |
| 구매 | 발주 | – | 사용 | – | – | – | 조회 |
| 구매 | 입고 확정 | – | 사용 | – | – | – | 조회 |
| 생산 | 생산계획·히트 편성 | **조회** | **조회** | 사용 | – | – | 조회 |
| 생산 | 작업 실적(실적 시뮬레이션 포함) | – | – | 사용 | **조회** | – | 조회 |
| 생산 | 열연 투입 배정 | – | – | 사용 | – | – | 조회 |
| 품질 | 검사 입력 | – | – | **조회** | 사용 | – | 조회 |
| 품질 | 검사 기준 관리 | – | – | – | 사용 | – | 조회 |
| 품질 | 불합격 처리 상태 지정 | – | – | – | 사용 | – | 조회 |
| 물류 | 출고 확정 | **조회** | – | – | – | 사용 | 조회 |
| 물류 | 밀시트 조회·출력 | **조회** | – | – | **조회** | 사용 | 조회 |
| 관리 | 사원 관리 | – | – | – | – | – | 사용 |
| 관리 | 부서·권한 관리 | – | – | – | – | – | 사용 |
| 관리 | 기준정보 관리 | – | – | – | – | – | 사용 |

조회 권한을 준 이유:
- 영업 → 생산계획: 수주 상세에서 부족분의 생산 진행을 따라간다. 출고 확정: 출하요청 뒤 출고 결과를 본다. 밀시트: 고객사에 줄 밀시트를 본다.
- 구매 → 생산계획: MRP 소요의 근거인 생산계획을 본다.
- 생산 → 수주: 계획의 근거 수주를 본다. 구매요청: 원료 조달 진행을 본다. 검사 입력: 판정 결과로 재생산 여부를 판단한다.
- 품질 → 작업 실적: 검사할 LOT이 나온 실적을 본다. 밀시트: 검사값이 밀시트에 맞게 나가는지 본다.
- 물류 → 출하요청: 출고할 대상과 배정 결과를 본다.
- 관리자 → 사용 권한이 없는 14개 모두 조회.

메뉴 규칙 (2단계에서 바꿈 — 위 조회 표가 그대로 메뉴로 보이게):
- 레일에는 먼저 그 역할의 업무 메뉴를 둔다(권한이 조회 이상일 때. 등록 화면은 사용 권한이 있을 때만). 부서장이면 승인함이 이어진다.
- 그 뒤 얇은 구분선 아래에, 조회·사용 권한으로 열 수 있는 다른 영역 화면을 영역 순서(영업 → 구매 → 생산 → 품질 → 물류 → 관리)로 붙인다.
  - 예: 영업 = 생산계획 · 출고 확정 · 밀시트 / 구매 = 생산계획 / 생산 = 수주 · MRP · 구매요청 · 검사 입력 / 품질 = 작업 실적 · 밀시트 / 물류 = 출하요청 / 관리자 = 위 표의 조회 14개 화면 + 재고
- 권한이 없는 화면을 주소로 열면 화면 대신 잠금 상태(COM-002 해당 업무 권한 없음)를 보인다. 조회만 있으면 화면은 열리고 변경 버튼이 막힌다.
- 대시보드·LOT 추적·작업 로그·업무·알림·메신저·재고는 모든 사원이 연다. 승인함은 부서장에게만 보인다.
- 메뉴가 길어지면(관리자) 레일이 세로로 스크롤된다.

## 3. 기준정보

### 3-1. 강종 6종

| 강종 코드 | 강종 이름 | 적용 규격 번호 | 근거 |
|---|---|---|---|
| SS275 | SS275 | KS D 3503:2026 | 공통 코드 STEEL_GRADE, ks-values.md 1장 |
| SM355A | SM355A | KS D 3515:2018 | 〃 |
| SM355B | SM355B | KS D 3515:2018 | 〃 |
| SM355C | SM355C | KS D 3515:2018 | 〃 (강종만 등록, 규격 없음) |
| SM355D | SM355D | KS D 3515:2018 | 〃 (강종만 등록, 규격 없음) |
| SPHC | SPHC | KS D 3501 | 연도 없이 (요구사항 21장) |

- 강종 이름(`steel_grade_name`)은 공통 코드 표시명(= 코드)과 같게 두었다 (가정).

### 3-2. 고객사·공급업체·야드 (가정, 가상 회사명)

| 구분 | 코드 | 이름 | 비고 |
|---|---|---|---|
| 고객사 | CUS-01 | 가람중공업 | 가정 |
| 고객사 | CUS-02 | 나래조선 | 가정 |
| 고객사 | CUS-03 | 다온건설 | 가정 |
| 고객사 | CUS-04 | 보람강관 | 가정 |
| 공급업체 | SUP-01 | 가온광업 | 철광석 기본 공급업체 (가정) |
| 공급업체 | SUP-02 | 누리에너지 | 석탄 기본 공급업체 (가정) |
| 공급업체 | SUP-03 | 소담광물 | 석회석 기본 공급업체 (가정) |
| 공급업체 | SUP-04 | 하람합금철 | 합금철 기본 공급업체 (가정) |
| 야드 | YD-RM-01 | 원료 1야드 | 원료 야드. 원료 4종의 기본 야드 (가정) |
| 야드 | YD-SL-01 | 슬래브 1야드 | 슬래브 야드. 슬래브 규격 12개의 기본 야드 (가정) |
| 야드 | YD-CL-01 | 코일 1야드 | 코일 야드. 코일 규격 12개의 기본 야드 (가정) |

- 코드 형식은 옛 화면 예시(`CUS-01`)를 따랐다 (가정).

### 3-3. 원료 4종

| 원료 코드 | 원료명 | 원료 유형 | 기본 공급업체 | 기본 야드 | 근거 |
|---|---|---|---|---|---|
| ORE01 | 철광석 | 철광석 IRON_ORE | 가온광업 | 원료 1야드 | REQ-MST-001 예, 컨벤션 7-4. 공급업체·야드 짝은 가정 |
| COL01 | 석탄 | 석탄 COAL | 누리에너지 | 원료 1야드 | 〃 |
| LIM01 | 석회석 | 석회석 LIMESTONE | 소담광물 | 원료 1야드 | 〃 |
| SMN01 | 실리코망가니즈 | 합금철 FERROALLOY | 하람합금철 | 원료 1야드 | 〃 |

### 3-4. 제품 규격 (강종 4종 × 슬래브 3종 = 슬래브 12 · 코일 12)

강종 SS275 · SM355A · SM355B · SPHC마다 아래 3쌍을 똑같이 만든다 (REQ-MST-002·003).

| 슬래브 (두께×폭×길이 mm) | 슬래브 이론중량 | 대응 코일 (두께×폭×길이 mm) | 코일 이론중량 | 열연 계획 수율(계산값) | 근거 |
|---|---|---|---|---|---|
| 250 × 1,200 × 10,000 | 23.550 t | 2.3 × 1,200 × 1,065,000 | 23.074 t | 0.9798 | 슬래브: 업무 프로세스 4.1·14.1 예. 코일: 가정 |
| 250 × 1,500 × 10,000 | 29.438 t | 4.5 × 1,500 × 544,000 | 28.825 t | 0.9792 | 슬래브: REQ-MST-003 규격 코드 예. 코일: 가정 |
| 220 × 1,400 × 9,500 | 22.969 t | 9.0 × 1,400 × 227,500 | 22.502 t | 0.9797 | 슬래브·코일 모두 가정 |

- 이론중량 = 두께 × 폭 × 길이 × 7.85 ÷ 10^9, 소수 3자리 (REQ-MST-003). 반올림은 0.5 올림으로 가정했다(문서에 반올림 방식이 없음).
- 코일 두께 2.3 / 4.5 / 9.0mm를 고른 이유 (가정, PLAN 8-1장 4번 제안):
  - KS 구간 경계값이 아니다. 기계적 성질 구간(5·16·40mm, SPHC 1.2·1.6·3.2·14mm, 초과~이하), 샤르피 적용(6mm 초과), KS D 3500 표 5 두께 허용차 행(이상~미만, 2.00·2.50·4.00·5.00·8.00·10.0mm 등) 어디에도 걸리지 않는다.
  - 6mm 이하(2.3·4.5)와 초과(9.0)가 섞여 충격 시험·두께 구간이 둘 다 보인다.
  - SPHC 연신율 구간(1.2~14mm) 안이다.
- 코일 폭은 슬래브 폭과 같다(1,200·1,500·1,400). 시드 코일 너비 허용차 +25/0 구간(ks-values.md 5-2)에 들어간다.
- 코일 길이는 코일 이론중량이 슬래브보다 조금 작도록(열연 계획 수율 약 0.98) 정한 가정값이다. 코일 이론중량 ≤ 슬래브 이론중량 조건(REQ-MST-004)을 만족한다.
- 규격 코드: `SL-강종-두께x폭x길이` / `CL-…` (REQ-MST-003). 소수 끝의 0은 뺀다(예: `CL-SS275-2.3x1200x1065000`).
- 품목명: `강종 슬래브|코일 두께×폭×길이` (예: `SS275 슬래브 250×1200×10000`) — 형식은 가정.
- 규격 매핑: 같은 강종에서 위 표의 같은 줄끼리 슬래브 1 → 코일 1로 연결한다.

### 3-5. 라우팅·계획 수율

| 품목 유형 | 공정 순서 | 계획 수율 | 근거 |
|---|---|---|---|
| 슬래브 | 1 제선 → 2 제강 → 3 연주 | 제선 비움 · 제강 0.9000 · 연주 0.9800 | 순서: 부모 지시·REQ-MST-005. 수율: 가정(기획안 "시연용 가정값") |
| 코일 | 1 제선 → 2 제강 → 3 연주 → 4 열연 | 제선 비움 · 제강 0.9000 · 연주 0.9800 · 열연 저장 안 함 | 열연은 규격 매핑에서 계산 (REQ-MST-004·005) |

- 제선 계획 수율은 비웠다 (**확인 필요**). 업무 프로세스 4.4 계산식은 제선 수율을 쓰지 않는다(필요 용선 = 히트 톤 ÷ 제강 수율, 원료 = 용선 × 원단위). 옛 화면도 제선 수율을 '미설정'으로 허용했다.

### 3-6. 배합 원단위 (가정)

| 원료 | 강종 | 원단위 | 단위 | 근거 |
|---|---|---|---|---|
| ORE01 철광석 | 공통 | 1.600 | t/t (용선 1t당) | 가정 (기획안 "원단위는 시연용 가정값") |
| COL01 석탄 | 공통 | 0.600 | t/t | 가정 |
| LIM01 석회석 | 공통 | 0.150 | t/t | 가정 |
| SMN01 실리코망가니즈 | SS275 | 10.000 | kg/t (용강 1t당) | 가정 |
| SMN01 실리코망가니즈 | SM355A | 20.000 | kg/t | 가정 (Mn 상한이 SS275보다 높아 더 많이 넣는다고 봄) |
| SMN01 실리코망가니즈 | SM355B | 20.000 | kg/t | 가정 |
| SMN01 실리코망가니즈 | SPHC | 4.000 | kg/t | 가정 (Mn 상한 0.60%로 가장 낮음) |

- SM355C·D는 규격이 없어 합금철 원단위도 넣지 않았다. 규격을 추가하면 원단위도 함께 넣어야 한다.
- 단위는 원료 유형으로 정한다(합금철 kg/t, 나머지 t/t). 공통 코드 CONSUMPTION_UNIT은 없앴다 (PLAN 4장).

### 3-7. 생산 설정값

히트 용량 250.000t(용강 기준), 납기 위험 기준일 3일 — REQ-MST-009 초기값 (가정 아님).

## 4. 그 밖의 가정

| 항목 | 값 | 근거 |
|---|---|---|
| 시드 행의 생성·수정 시각 | 2026-09-01 09:00 (Asia/Seoul) | 가정 |
| 업무 번호·LOT 번호 자리수를 넘을 때 | 자리를 늘려 그대로 붙인다 (예: SO-2610-1000) | 업무 프로세스 9.2에서 TBD |
| 슬래브 LOT 순번(SS) 카운터 | 히트 번호마다 1부터 | 9.2 "히트번호-SS" 해석 |
| 밀시트 순번 N | 출하요청마다 1부터 | 9.1 "수주별 순번" 해석 |
| 가짜 DB 저장 위치 | localStorage `fantasteel.mock-db.v5`(`MOCK_DB_VERSION` = 5, `client/src/mock/store.ts`) (키에 버전 포함). 버전을 올리면 옛 키를 지우고 시드로 다시 만든다. 탭 동기화는 같은 이름의 BroadcastChannel(없으면 storage 이벤트) | 구현 선택 |
| 계정 선택 저장 위치 | sessionStorage `fantasteel.session.employee-id` (탭마다 따로) | PLAN 2장 |
| 가짜 API가 요청 사원을 아는 방법 | 이 탭의 계정 선택(sessionStorage 위 키)을 읽는다. 사용 안 함 사원은 아무것도 할 수 없다(COM-002) | 실제 서버의 JWT 확인 대신 (BP-AUTH-01 "각 API에서 권한 재확인") — 구현 선택 |
| 메시지 첨부 1개의 최대 크기 | 512KB. 내용은 DB와 따로 localStorage `fantasteel.mock-files.v1`(파일 경로 → data URL)에 두고, 시드로 초기화하면 지운다 | REQ-MSG-003 "형식·용량 제한은 구현 단계". 브라우저 저장 공간(약 5MB)이 작아서 고른 값 (가정) |

## 5. 거래·협업 시드 (`client/src/mock/seeds/`)

`createSeedTables`(`client/src/mock/seed.ts`)가 조직·기준정보(1~3장)를 만든 뒤 `client/src/mock/seeds/index.ts`의 `AREA_SEEDERS`를 아래 순서로 실행한다. 순서가 바뀌면 안 된다(뒤 시드가 앞 시드가 만든 수주·업무방·LOT을 참조한다). 시드는 서비스 함수(`client/src/mock/services`)를 그대로 불러 만들므로 규칙·불변조건·작업 로그가 처음부터 맞고, 날짜·난수 시드가 고정이라 매번 같은 결과가 나온다. 시드 안에서 날짜를 바꿀 때는 `seedTxAt`(index.ts)을 쓴다. 거래·협업 시드가 만든 모든 기록의 날짜·사람·수량·난수 시드는 업무 프로세스 14.1·14.2와 시연 이야기에 맞춘 **가정값**이다.

| 순서 | 등록 키 | 파일 | 만드는 것 | 근거 |
|---|---|---|---|---|
| 1 | `inspectionStandards` | `client/src/mock/seeds/inspectionStandards.ts` | 검사 기준 버전 1 (`is_current`): `QS-{강종}-ST`(제강 성분)·`QS-{강종}-CC`(연주 슬래브)·`QS-{강종}-HR`(열연 코일). 제강·열연은 KS 값, 연주는 사내 규격 가정값(6-3, 6-8장) | ks-values.md, PLAN 8-1, REQ-QC-001·002 |
| 2 | `core` | `client/src/mock/seeds/core.ts` | 수주 SO-2609-001~005, 생산계획 PP-2609-0001~0005, 구매요청 PR-2609-0001~0004, 출하요청 DR-2609-0001~0002, 밀시트 MS-2609-0001-1, 수주 업무방(SO-2609-003), Message → ERP 시연 메시지. 시작 재고 = 14.1의 SS275 슬래브 250x1200x10000 합격 가용 6매. 원료 입고량은 6-3 '시드 원료 입고량'(가정값) | 업무 프로세스 14.1·14.2, BP-SEED-01 |
| 3 | `collab` | `client/src/mock/seeds/collab.ts` | 업무 6건과 업무 지정 알림, 1:1 채팅방 1개·그룹 채팅방 2개와 메시지(첨부 1개, 사원 멘션 2개, 부서 멘션 1개). 업무방은 core가 만든다 | REQ-NTF·MSG 계열 (내용은 시연용 가정값, 6-2장) |
| 4 | `dashboard` | `client/src/mock/seeds/dashboard.ts` | 8월 말 수주 SO-2608-001~004(모두 출하완료, 규격·매수·난수 시드 6001~6004·출고일은 `SEED_DASHBOARD`), 8-31 원료 입고, 9월 실적·검사·출고 | BP-DSH-01 "추이 집계에는 시계열 시드", BP-SEED-01 |

- 가짜 DB 버전 `MOCK_DB_VERSION` = 5 (`client/src/mock/store.ts`, 2026-10-02 원료 입고량 변경으로 4 → 5). 시드를 바꾸면 이 값을 올려 옛 브라우저 데이터를 버리게 한다.
- 대시보드 시드는 core 뒤에 돌아서 그 출하요청 번호가 DR-2609-0003~0007이다(번호 순서와 날짜 순서가 다르다 — 시연용 가정).
- 대시보드 시드의 원료 입고분은 자기 히트 소요만큼만 사서 FIFO로 먼저 다 쓰이므로, core 시드의 원료 잔량·입고예정과 14.1의 MRP 결과(실리코망가니즈 순소요 1.500t 등)가 바뀌지 않는다.
- 시드가 아직 넣지 않은 것: 없다. 1단계에서 "다음 단계"로 미뤘던 수주·재고·LOT·생산·검사·구매·출하·밀시트·업무방·알림·메신저는 모두 위 시드로 들어갔다. 준비 중(P2·EX) 화면의 예시 내용(`client/src/features/agent/agentExample.ts`, `client/src/features/meetings/meetingExample.ts`, `client/src/features/pastCases/pastCaseExample.ts`)은 DB 시드가 아니라 코드의 고정 예시다.
- 시드 상태로 되돌리기: 상단 사용자 메뉴의 '시드로 초기화'(`client/src/features/shell/UserMenu.tsx` → `client/src/api/mockData.ts`의 `resetToSeed`). 다른 탭에도 알려지고 첨부 파일 저장소도 지운다.

## 6. 영역별 가정값 (각 영역 노트에서 옮김, 사용자 확인 필요)

각 영역 노트(`docs/rework/areas/<영역>.md`)의 '가정값' 항목을 영역마다 한 표로 모았다. 값·규칙은 영역 노트의 문구 그대로이고(항목 이름 — 값), 새 값은 더하지 않았다. 근거 칸은 영역 노트가 든 근거이며, 6개 문서(docs/notion/01~06)·ERD·KS 값에서 온 근거가 없으면 앞에 '문서에 없음'을 붙였다. 파일 칸은 그 값이 코드에서 쓰이는 대표 파일(`client/src` 아래)이다.

### 6-1. 조직·사원(admin)

| 값·규칙 | 근거 | 파일 |
|---|---|---|
| **사원번호 형식** — 숫자 7자리 | 옛 화면 규칙, seed-assumptions 1-4. ERD는 varchar(20)만 | `client/src/features/admin/lib/orgRules.ts`, `client/src/features/admin/components/EmployeeFormModal.tsx` |
| **부서 코드 형식** — `^[A-Z0-9][A-Z0-9-]{0,29}$` | 옛 화면 규칙, ERD varchar(30) | `client/src/features/admin/lib/orgRules.ts` |
| **직급 코드 형식** — `^[A-Z][A-Z0-9_]{0,29}$` (예 MANAGER) | 시드 직급 코드 모양(대문자 스네이크), ERD varchar(30) | `client/src/features/admin/lib/orgRules.ts` |
| **직급 관리 권한** — ORG_MANAGE 사용 | 직급 탭이 부서·직급·권한 화면에 있어서. 문서는 "관리자가 등록·수정"(TRM-036)만 | `client/src/features/admin/components/JobGradeTab.tsx`, `client/src/features/shell/screens.ts` |
| **부서장 범위** — 그 부서의 사용 중인 사원 1명 | stage2 지시. 그래서 부서장인 사원은 다른 부서 이동·사용 안 함 전에 부서장을 먼저 바꿔야 한다 | `client/src/api/adminOrganization.ts`, `client/src/features/admin/lib/orgRules.ts` |
| **부서 코드 수정** — 수정 가능(중복만 막음) | stage2 지시의 편집 칸 목록에 department_code가 있음. 참조는 id라 영향 없음 | `client/src/api/adminOrganization.ts`, `client/src/features/admin/components/DepartmentTab.tsx` |
| **사용 여부 표시** — '사용' / '사용 안 함' | 문서에 없음 — is_active. 옛 '사용 중지'와 기준정보 '사용 안 함'이 섞여 있던 것을 하나로(C-2) | `client/src/features/admin/components/OrgBadges.tsx` |

### 6-2. 업무·알림·메신저(collab)

| 값·규칙 | 근거 | 파일 |
|---|---|---|
| **업무를 고치거나 완료할 수 있는 사람** — 만든 사람과 담당자 | 문서에 없음. 옛 화면은 제한 없음(서버 몫) | `client/src/api/tasks.ts` |
| **업무 되돌리기(다시 열기)** — 없음. 완료한 업무는 고칠 수 없음 | 10장 OPEN → DONE만 확정. 옛 화면의 `시작`·`할 일로`·`다시 열기`는 뺐다(보고서 6 C-3·C-5) | `client/src/api/tasks.ts` |
| **업무 설명 길이** — 2000자 | ERD text(제한 없음). 옛 화면 값 | `client/src/api/tasks.ts` |
| **업무 범위 `전체`** — 내가 담당 ∪ 내가 만든 업무 | 옛 화면과 같음(필터, PLAN 5장 "필터 남긴다") | `client/src/api/tasks.ts`, `client/src/hooks/useTasks.ts` |
| **메시지 길이** — 4000자 | ERD text. 옛 화면 값 | `client/src/api/messengerRules.ts` |
| **첨부 1개 최대 크기** — 512KB, 형식 제한 없음 | REQ-MSG-003 "형식·용량 제한은 구현 단계". 브라우저 저장 공간 때문(cross-cutting 5장, seed-assumptions 4장) | `client/src/mock/fileStorage.ts`, `client/src/api/messenger.ts` |
| **방 이름 길이** — 100자 | ERD chat_room.chat_room_name varchar(100) (옛 화면 50자) | `client/src/api/messenger.ts` |
| **메시지 한 번에 불러오는 수 / 알림 한 번에** — 50 / 20 | 문서에 없음 — 옛 화면 값 | `client/src/api/messenger.ts`, `client/src/api/notifications.ts` |
| **부서 멘션** — `@부서명` → 그 부서의 사용 중 사원 모두에게 MENTION 부서 알림(방 멤버가 아니어도) | BP-MSG-01 "멘션을 개인·부서 알림으로 전달", ERD "부서 발송은 부서원 수만큼". 멤버가 아닌 사원은 알림 본문으로 내용을 보고, 방은 잠금 상태로 보인다 | `client/src/api/messengerRules.ts`, `client/src/mock/services/notifications.ts` |
| **업무방 알림 대상** — 보낸 사람과 이 메시지로 멘션 알림을 받은 사람을 뺀 멤버 | 문서에 없음 — 같은 메시지로 두 번 알리지 않음 | `client/src/api/messengerRules.ts` |
| **초대한 멤버의 읽음 위치** — 초대 시점의 마지막 메시지 | 문서에 없음 — 이전 대화는 보되 안 읽음 수가 한꺼번에 늘지 않게 | `client/src/mock/services/workRooms.ts`, `client/src/api/messenger.ts` |
| **업무 지정 알림 문구** — 제목 `업무 지정 · {업무 제목}`, 본문 `{만든 사람}님이 업무를 맡겼어요 · 마감 {날짜}`, 연결 `/tasks?tab=tasks&task={id}` | 표시명 TASK_ASSIGNED `업무 지정` | `client/src/features/tasks/lib/taskNotice.ts` |
| **멘션 알림 문구** — `{보낸 사람}님이 멘션했어요` / `{보낸 사람}님이 {부서}를 멘션했어요`, 본문 `{방} · {내용 60자}`, 연결 `/messenger?room={id}` | 문서에 없음 | `client/src/api/messengerRules.ts` |
| **업무방 알림 문구** — `{방 이름 또는 업무방 · 수주번호} 새 메시지`, 본문 `{보낸 사람}: {내용 60자}` | 문서에 없음 | `client/src/api/messengerRules.ts` |
| **시드 업무·채팅방·메시지 내용** — 4장 | 문서에 없음 — 시연용 | `client/src/mock/seeds/collab.ts` |

### 6-3. 업무 규칙 핵심(core-domain)

| 값·규칙 | 근거 | 파일 |
|---|---|---|
| **시스템 메시지 보낸 사람** — `message.sender_id = 0` (`SYSTEM_SENDER_ID`) | ERD message에 시스템 표시 칸이 없고 sender_id NN. 실제 DB에서는 시스템 사원 행 또는 nullable이 필요 | `client/src/mock/services/context.ts`, `client/src/mock/services/workRooms.ts` |
| **검사 기준 코드 공정 약어** — ST 제강 · CC 연주 · HR 열연 | 문서에 없음 — 예시는 QS-SM355A-HR 하나뿐 | `client/src/mock/seeds/inspectionStandards.ts`, `client/src/mock/services/inspectionStandards.ts` |
| **연주(슬래브) 검사 항목·범위** — 두께 편차 ±5, 폭 편차 ±10, 길이 편차 −10~+30, 표면 결함 깊이 ≤ 2.00 mm | KS 없음("사내 규격"), PLAN 8-1 #1 | `client/src/mock/seeds/inspectionStandards.ts` |
| **히트 성분 판정 두께** — SM355 C·Ceq는 50mm 이하 값 | PLAN 8-1 #3 | `client/src/mock/seeds/inspectionStandards.ts`, `client/src/lib/inspectionJudgment.ts` |
| **두께 허용차 구간 저장** — 표 5(이상~미만)를 초과~이하로 저장, 시드 코일 두께 행만 | 시드 두께가 경계가 아니라 결과가 같다(PLAN 8-1 #4) | `client/src/mock/seeds/inspectionStandards.ts` |
| **판정: 필수 누락과 불합격이 같이 있을 때** — FAIL | 문서에 없음 — 벗어난 값이 이미 있으면 합격할 수 없다 | `client/src/lib/inspectionJudgment.ts` |
| **기준 버전 선택** — 값을 한 번이라도 넣은 검사는 그 버전 유지, 값 없는 PENDING 행은 현재 버전으로 바꿔 판정 | "판정에 쓴 기준 버전 표시" + "새 버전" (QC-002·003) | `client/src/mock/services/inspections.ts` |
| **검사 대상 행** — 제강·연주·열연 실적 때 현재 기준으로 PENDING 행을 만든다 | 문서에 없음 — 검사 대상 목록 | `client/src/mock/services/inspections.ts`, `client/src/mock/services/productionResults.ts` |
| **생산계획 COMPLETED** — 히트 수만큼 제강·연주 완료 + (코일·수주 연결) 불합격을 뺀 코일 수 ≥ 부족 매수 | 10장 "완료" 조건이 문서에 없음 | `client/src/mock/services/productionPlans.ts` |
| **진행 계획 잔여 목표** — 5장 정의 | 4.5 "진행 계획 잔여 목표"의 계산 방법이 없음 | `client/src/mock/services/productionPlans.ts`, `client/src/mock/services/salesOrders.ts` |
| **생산계획 생성 주체** — 이벤트는 SYSTEM(수주 등록 규칙), created_employee_id는 수주 등록자 | 문서에 없음 — 자동 생성 | `client/src/mock/services/salesOrders.ts` |
| **여재 표시(surplus_at)** — 합격했지만 원래 수주가 이미 채워져 예약하지 못한 슬래브, 연결 끊긴 계획의 슬래브, 완료된 코일 계획의 남은 슬래브, 취소로 예약이 풀린 합격 슬래브 | REQ-INV-008 "미배정 합격 슬래브" — 예약이 매수 단위라 LOT 단위 표시 기준을 정함 | `client/src/mock/services/inspections.ts`, `client/src/mock/services/productionPlans.ts`, `client/src/mock/services/salesOrders.ts` |
| **충족 현황 '검사합격'** — ACTIVE 예약 + 출고 (분모 수주 매수) | 4.5 "분모 명시". 예약은 모두 합격 제품 | `client/src/mock/services/salesOrders.ts`, `client/src/lib/salesOrderStatus.ts` |
| **품질 불합격 뒤 예약 조정 순서** — 불합격 LOT 계획의 수주 예약 → 열연 배정 → 그 밖의 예약 (모두 최근 것부터) | BP-QC-01 "부족분만 조정"의 순서가 없음 | `client/src/mock/services/reservations.ts`, `client/src/mock/services/inspections.ts` |
| **열연 배정과 예약 가용** — 열연 CONFIRMED 배정은 모두 "예약으로 커버되지 않는" 배정 | 열연 추천이 판매 예약 몫을 넘지 않음(BP-INV-01) | `client/src/mock/services/allocations.ts`, `client/src/mock/services/reservations.ts` |
| **MRP 필요일** — 연결 수주 품목 납기(없으면 계획 등록일) | 리드타임 기준이 문서에 없음 | `client/src/mock/services/mrp.ts`, `client/src/lib/mrp.ts` |
| **MRP 계획 몫 입고예정** — 그 계획에 남은 소요가 있을 때만 그 계획 전용, 아니면 누구나 | REQ-PRD-005 "다른 수주의 입고예정에서 제외" | `client/src/mock/services/mrp.ts`, `client/src/lib/mrp.ts` |
| **발주** — 요청 품목 1줄 = 발주 1줄, 발주량 = 요청 톤(나눠 발주 없음), 납기 기본 = 가장 이른 희망 입고일 | BP-PUR-01 "배분량 보존" | `client/src/mock/services/purchasing.ts` |
| **구매요청 재요청** — 반려된 요청만 요청자가 고친다. 이벤트는 PURCHASE_REQUISITION_CREATED + reasonText | 문서에 없음 — 재요청 이벤트 유형이 없음 | `client/src/mock/services/purchasing.ts` |
| **부서장 자기 요청 승인** — 막지 않는다 (16장 TBD) | 문서에 없음 — 문서에 대체 경로가 확정되지 않음 | `client/src/mock/services/purchasing.ts` |
| **같은 MRP 줄 중복** — (계획, 원료) 구매요청이 상태와 관계없이 하나라도 있으면 새로 못 만든다(반려면 고쳐 재요청) | BP-PRD-01 "중복 생성 안 함" | `client/src/mock/services/purchasing.ts` |
| **실적 시뮬레이션 시각** — 지금 끝나도록 거꾸로: 제선 4h·제강 1h·연주 2h·열연 2h | 문서에 없음 — 시연용 | `client/src/mock/services/simulation.ts` |
| **시뮬레이션 제선** — 사용 가능한 용선이 히트 1개 몫보다 적을 때만 | 문서에 없음 — 용선 재고를 먼저 쓴다 | `client/src/mock/services/simulation.ts` |
| **고로·전로 코드 형식** — 대문자·숫자 2~10자 (기본 BF2·BOF1) | 문서에 없음 — 설비 마스터 없음 | `client/src/mock/services/productionResults.ts` |
| **히트 LOT 잔량** — null (initial_ton = 히트 톤). 연주 한도는 initial_ton으로 계산 | ERD "원료·용선 잔량" | `client/src/mock/services/productionResults.ts` |
| **히트→슬래브·슬래브→코일 input_ton** — 슬래브 1매 이론중량 | 문서에 없음 — 추적 화면 표시용 | `client/src/mock/services/productionResults.ts` |
| **출하 작업 로그** — 출하요청 등록·출고 확정은 수주마다 한 건 | 수주 타임라인(REQ-LOG-003) | `client/src/mock/services/shipments.ts`, `client/src/mock/services/goodsIssues.ts` |
| **원료 투입 LOT 범위** — 실적 완료일까지 입고(생산)된 LOT만 | 문서에 없음 — 시점이 뒤인 LOT을 쓰지 않게 | `client/src/mock/services/productionResults.ts` |
| **초안 중복 생성** — 같은 메시지·유형에 반려되지 않은 초안이 있으면 그 초안을 돌려준다 | BP-ACT-01 중복 방지 | `client/src/mock/services/actionDrafts.ts` |
| **초안 원료 필드** — `payload = {itemId, requiredTon, desiredReceiptDate, requestReason, sourceText}` | REQ-ACT-001 | `client/src/mock/services/actionDrafts.ts` |
| **시드 측정값** — 기준 안 대표값(`typicalPassValue`) + 히트별 성분 값, 불합격 사례 값(표면 3.50mm, P 0.058) | PLAN 8-1 #5 | `client/src/mock/seeds/core.ts`, `client/src/lib/inspectionJudgment.ts` |
| **시드 날짜·사람·수량** — 16-2 표 | 문서에 없음 — 시연용 | `client/src/mock/seeds/core.ts` |
| **시드 원료 입고량** — PR-2609-0001: 철광석 5,000t(09-02 1,800 + 09-03 3,200)·석탄 1,900t·석회석 480t·실리코망가니즈 20t → 시드 끝 잔량 2,333.330 / 899.998 / 229.998 / 1.000t. 14.1 히트 1개 뒤에도 철광석·석탄·석회석은 구매 없이 히트 4개를 더 만든다 | 문서에 없음 — 시연용(2026-10-02 브라우저 점검: 예전 3,300·1,250·320t로는 14.1 뒤 189 / 83 / 28t만 남아 14.2 전에 구매 3건이 필요했다). 실리코망가니즈는 14.1 3단계 MRP(합금철만 순소요 1.500t, 04 14.1)를 지키려고 그대로 | `client/src/mock/seeds/core.ts` (`SEED_CORE.rawMaterialReceipts`) |
| **MRP 원료 줄의 공급 나누기** — '원료 LOT 잔량' 칸 = 표에 보이는 계획이 쓸 수 있는 잔량(표에 없는 앞선 계획이 먼저 쓴 몫 제외), '입고예정' 칸 = 보이는 계획이 필요일까지 받아 쓰는 몫, 나머지 입고예정은 다른 계획 몫 · 필요일 뒤 도착(납기 없음 포함) · 앞선 계획 몫 · 남는 몫으로 칸 아래에 따로. 순소요가 남은 줄이 있으면 그 줄들이 쓰지 못한 까닭으로 이유를 정한다 | 4.4 "필요일까지 도착하는 확정 발주만", REQ-PRD-005 "다른 수주의 입고예정에서 제외". 한 줄을 어떻게 보일지는 문서에 없음 — "총소요 − 잔량 − 입고예정 = 순소요"가 그 줄 숫자로 맞게 | `client/src/lib/mrp.ts` (`supplyBreakdownOf`), `client/src/mock/services/mrp.ts` (`mrpMaterialRows`), `client/src/features/purchasing/MrpScreen.tsx` |

### 6-4. 화면 공통(cross-cutting)

| 값·규칙 | 근거 | 파일 |
|---|---|---|
| **`MOCK_FILE_MAX_BYTES`** — 512KB (첨부 파일 가짜 저장소의 파일 1개 최대 크기. 넘으면 InputError) | 문서에 없음 (cross-cutting.md 5장, 이 문서 4장 "메시지 첨부 1개의 최대 크기") | `client/src/mock/fileStorage.ts` |

### 6-5. 대시보드(dashboard)

| 값·규칙 | 근거 | 파일 |
|---|---|---|
| **추이 위젯 기간** — 오늘 포함 최근 30일, 하루 단위 | 문서에 기간 없음(BP-AGT-01도 "불합격률 기간 TBD") | `client/src/api/dashboard.ts`, `client/src/features/dashboard/lib/widgetMath.ts` |
| **출하 실적 기준일** — LOT 출고 시각(shipped_at, 서울 날짜) | 문서에 없음 — 출고 확정 = 출하 실적 | `client/src/api/dashboard.ts` |
| **생산량 기준일** — 슬래브·코일 LOT 생산완료일 | 문서에 없음 — 연주·열연 실적 완료일 | `client/src/api/dashboard.ts` |
| **불합격률** — 판정 시각(inspected_at)이 기간 안인 PASS·FAIL 검사 수 중 FAIL. 히트 불합격으로 제외된 하위 LOT은 따로 세지 않음 | 문서에 없음 — 검사 단위 비율 | `client/src/api/dashboard.ts`, `client/src/features/dashboard/lib/widgetMath.ts` |
| **원료 잔량 대비 소요 MRP 기간** — 필요일 ~ 오늘 + 30일 (지난 필요일 포함) | MRP 기간 기본값이 문서에 없음 | `client/src/api/dashboard.ts` |
| **공정별 수율** — 완료된 작업 실적의 Σ산출 ÷ Σ투입(톤), 계획 수율은 투입량 가중(열연은 규격 매핑 수율). 제선은 계획 수율을 쓰지 않아 표시하지 않음 | 4.4: 제선은 원단위 | `client/src/api/dashboard.ts`, `client/src/features/dashboard/lib/widgetMath.ts` |
| **여재 보유 일수** — 규격별 여재(TRM-048, 재고 화면 여재 탭과 같은 core `surplusSlabs` 값) > 0인 규격의 여재 슬래브 중 surplus_at(없으면 생산완료일)이 가장 이른 날부터 | 문서에 없음 — 예약이 매수 단위라 LOT별 여재를 정할 수 없음. 여재 매수·여재 슬래브 기준은 6-7 '여재 매수·여재 LOT'(2026-10-02: 전에는 예약 가용을 여재로 세어 재고 화면과 달랐다) | `client/src/api/dashboard.ts`, `client/src/mock/services/inventoryViews.ts` |
| **공정 흐름 단계** — 진행 중 수주 · 생산계획(계획·진행중) · 판정 대기 LOT · 제품 가용재고 · 출하요청(배정 대기·배정 확정) · 오늘 출고 확정 | 문서에 없음 — 문서에 위젯 이름만 있음 | `client/src/api/dashboard.ts`, `client/src/features/dashboard/widgets/ProcessFlowWidget.tsx` |
| **위젯별 볼 권한** — 표 1장 "볼 권한" 열 (데이터를 보여 주는 화면의 여는 조건과 같게) | BP-DSH-01 "권한 내 집계" | `client/src/features/dashboard/widgetCatalog.ts` |
| **위젯 크기·기본 배치** — 표 1장 (옛 화면 값) | SPEC 4장 3번 "최소 크기" | `client/src/features/dashboard/widgetCatalog.ts`, `client/src/features/dashboard/lib/layout.ts` |
| **배치 저장** — 이 브라우저 localStorage, 사원별 | ERD에 배치 테이블 없음, stage6 지시 | `client/src/hooks/useDashboardLayout.ts`, `client/src/features/dashboard/lib/layout.ts` |
| **최근 작업 로그 줄 수** — 20 | 문서에 없음 — 옛 화면 | `client/src/features/dashboard/widgets/RecentEventsWidget.tsx` |
| **시계열 시드** — 4장 표 (날짜·사람·수량·난수 시드) | BP-DSH-01 "시계열 시드", 시연용 | `client/src/mock/seeds/dashboard.ts` |

### 6-6. Message → ERP 초안(drafts)

| 값·규칙 | 근거 | 파일 |
|---|---|---|
| **초안 화면·api 권한** — 구매요청 등록·MRP(PURCHASE_REQUISITION_CREATE): 조회 VIEW 이상, 만들기·저장·확정·반려·다시 실행 USE | 초안은 구매요청을 만드는 일. screens.ts가 `/action-drafts/`를 구매요청 화면(VIEW)으로 이미 묶어 둠. 옛 화면도 같은 권한(보고서 2 A-9). BP-ACT-01 "실행은 사용자 권한과 업무 검증을 거치는 명령 API" | `client/src/api/actionDrafts.ts`, `client/src/features/shell/screens.ts` |
| **메뉴가 보이는 메시지** — 사원이 보낸, 글이 있는 메시지(첨부만 있는 메시지 제외). 모든 채팅방 유형 | PLAN 6장 4번, 공통 코드 "메시지 유형은 첨부 유무로 판단"(옛 messageType 'TEXT' 대신) | `client/src/features/messenger/messageActions.ts` |
| **남의 메시지로 초안 만들기** — 방 멤버면 된다(core). 요청자는 메시지 작성자 | BP-ACT-01 "요청자는 메시지 작성자" | `client/src/mock/services/actionDrafts.ts` |
| **`저장` 버튼** — 둔다(확정과 별도 저장) | REQ-ACT-002 "확인·수정 후 확정". 보고서 2 C-4는 '문서에 없음'으로 적었지만 수정 단계를 나눠 저장하는 것으로 보았다 | `client/src/features/actionDrafts/components/DraftFormCard.tsx` |
| **확정 뒤 반려** — 없음. 반려는 확인 대기일 때만 | 보고서 2 C-4(확정했지만 생성 실패 상태의 반려는 문서에 없음), core 규칙 | `client/src/mock/services/actionDrafts.ts`, `client/src/api/actionDrafts.ts` |
| **다시 실행** — 확정했지만 구매요청을 만들지 못한 초안만, 요청자가 | core `executeDraft`, BP-ACT-01 중복 실행 방지 | `client/src/mock/services/actionDrafts.ts` |
| **희망 입고일 오늘 이후 규칙** — 두지 않음 | 보고서 2 C-4 | `client/src/features/actionDrafts/components/DraftFormCard.tsx` |
| **요청 근거** — 선택, 500자. 비우면 core가 `메시지: {원본 글}`을 구매요청 요청 근거로 넣음 | BP-PUR-01 입력 이름 '요청 근거'(C-2), core 가정값 | `client/src/features/actionDrafts/components/DraftFormCard.tsx`, `client/src/mock/services/actionDrafts.ts` |
| **출처 표시** — `출처: Message → ERP` | 보고서 2 C-3 7번(출처 코드 그룹은 문서에 없음), stage3 "출처는 계산해 보인다" | `client/src/features/actionDrafts/lib/draftDisplay.ts` |
| **내 초안 목록** — 내가 요청자인 초안 전체, 상태 칩 | 브리프 "list a requester's drafts" | `client/src/features/actionDrafts/components/MyDraftList.tsx` |

### 6-7. 재고(inventory)

| 값·규칙 | 근거 | 파일 |
|---|---|---|
| **히트 불합격 하위 LOT 품질 표시** — '불합격(히트)' (INSPECTION_RESULT '불합격' + 원인) | 공통 코드에 별도 값이 없고, 예약·배정 제외 이유(INV-007)를 구분해 보여야 함 | `client/src/features/inventory/lib/inventoryDisplay.ts` |
| **배정 여부 표시** — 해제되지 않은 마지막 배정(CONFIRMED·CONSUMED)의 'ALLOCATION_PURPOSE 표시명 + 배정 · ALLOCATION_STATUS 표시명'(예: 출하 배정 · 소진). 재고 LOT에 배정이 없으면 '미배정', 소진·출고 LOT에 배정 기록이 없으면 '—' | 문서에 없음 — 배정 여부 코드가 따로 없음 (검토 반영 2번) | `client/src/features/inventory/lib/inventoryDisplay.ts` |
| **여재 매수·여재 LOT** — 규격별 여재 = min(여재 전환(surplus_at) 미배정 합격 슬래브 수, 가용재고). 여재 LOT은 그중 최근 것부터 여재 매수만큼. LOT 목록 '여재' 꼬리표와 대시보드 여재 위젯도 같은 값(core `surplusSlabs`) | 문서에 없음 — 검토 반영 1번 | `client/src/lib/surplus.ts`, `client/src/mock/services/inventoryViews.ts` |
| **1매 이론중량·톤 칸** — 규격 이론중량 그대로(`theoreticalWeightTon`), 톤 = 매수 × 이론중량(소수 3자리) | REQ-INV-001, TRM-022 이론중량 | `client/src/features/inventory/lib/inventoryDisplay.ts`, `client/src/lib/weight.ts` |
| **링크 주소** — LOT → `/lots/trace?lot=<LOT 번호>`, 생산계획 → `/production/plans?plan=<id>` | 문서에 없음 — reports/3 A-0의 옛 화면 간 이동 규칙. 다른 영역이 다른 파라미터를 쓰면 병합 때 맞춘다 | `client/src/features/inventory/lib/inventoryDisplay.ts` |

### 6-8. 기준정보·검사 기준(master)

| 값·규칙 | 근거 | 파일 |
|---|---|---|
| **검사 기준 코드의 공정 부분** — 제강 `ST`, 연주 `CC`, 열연 `HR` (병합 때 검사 기준 시드에 맞춰 `SM` → `ST`) | 용어 사전 TRM-110 예(QS-SM355A-HR)는 열연만 있다. 같은 방식의 영문 약어로 정함 | `client/src/mock/seeds/inspectionStandards.ts`, `client/src/mock/services/inspectionStandards.ts` |
| **공통 기준 코드** — `QS-COMMON-공정` | ERD steel_grade_id NULL = 공통 기준 | `client/src/mock/services/inspectionStandards.ts` |
| **검사 기준 값의 근거 표시** — 연주 = 가정값, 제강·열연 = KS | ks-values.md 5-1(슬래브 전용 KS 없음), PLAN 8-1 #1 | `client/src/features/inspectionStandards/lib/standardText.ts`, `client/src/features/inspectionStandards/components/StandardDetail.tsx` |
| **검사 항목 입력 규칙** — 최소·최대 중 하나는 필수, 항목 코드 = 영문으로 시작하는 영문·숫자·밑줄 50자 | 문서에 없음 — 옛 화면 규칙. 판정할 수 없는 항목을 막음 | `client/src/features/inspectionStandards/lib/standardItems.ts` |
| **규격 '사용됨'** — 수주 품목·재고(매수 > 0)·LOT·생산계획·예약 중 하나라도 있음 | REQ-MST-003 "수주·재고", 업무 프로세스 4.1 "수주·재고·LOT" | `client/src/features/masterData/lib/references.ts` |
| **준비 상태: 배합 원단위** — 철광석·석탄·석회석 유형마다 공통 원단위 1개 이상, 규격이 있는 강종마다 합금철 원단위 1개 이상 | REQ-MST-006, 4.4 | `client/src/features/masterData/lib/readiness.ts`, `client/src/api/masterData.ts` |
| **준비 상태: 검사 기준** — 규격이 있는 강종 × 그 품목 유형 라우팅의 검사 공정(제강·연주·열연)마다 지금 버전(항목 1개 이상), 연주·열연은 공통 기준도 인정(제강은 강종 전용만) | REQ-QC-001·002, BP-QC-01 "기준 누락은 합격 아님" | `client/src/features/masterData/lib/readiness.ts`, `client/src/api/masterData.ts` |
| **준비 상태: 규격 매핑** — 슬래브마다 대응 코일, 코일마다 대응 슬래브, 대응 코일 중복 표시 | REQ-MST-004, BP-MST-01 | `client/src/features/masterData/lib/readiness.ts`, `client/src/api/masterData.ts` |
| **코드 형식** — 고객사·공급업체·야드 코드: 영문 대문자·숫자로 시작, 대문자·숫자·밑줄·하이픈(≤30). 강종 코드: 대문자·숫자·하이픈(≤20) | 문서에 형식 없음. 길이는 ERD | `client/src/api/masterData.ts` |
| **수치 자리수** — ERD decimal 자리수만 확인(치수 (8,2)/(10,2), 이론중량 (12,3), 수율 (6,4), 원단위 (12,3), 히트 용량 (12,3), 검사 값 (12,4)) | 옛 화면의 2,000·5,000·5,000,000mm·0~100% 제한은 문서에 없어 뺐다(보고서 5 C-4 #15) | `client/src/api/masterData.ts`, `client/src/lib/decimal.ts` |
| **규격 품목명** — `강종 슬래브\|코일 두께×폭×길이` 자동 | 시드와 같은 모양. ERD item_name NN | `client/src/features/masterData/components/ProductSpecTab.tsx`, `client/src/api/masterData.ts` |

### 6-9. 생산(production)

| 값·규칙 | 근거 | 파일 |
|---|---|---|
| **작업일시 기본값** — 지금 끝난 작업으로: 제선 4시간·제강 1시간·연주 2시간·열연 2시간 전 시작 | 문서에 없음 — core 시뮬레이션 가정값과 같게(시연 편의). 사용자가 바꿀 수 있다 | `client/src/features/production/components/ResultFormModal.tsx`, `client/src/features/production/lib/dateTimeLocal.ts` |
| **고로·전로 코드 입력** — 소문자는 대문자로 바꿔 보낸다. 기본값은 이 계획에서 마지막으로 쓴 코드 | 문서에 없음 — 코드 형식(대문자·숫자 2~10자)은 core 가정값 | `client/src/features/production/components/ResultFormModal.tsx`, `client/src/api/productionResults.ts` |
| **시뮬레이션 고로·전로** — BF2·BOF1 (화면에서 바꾸지 않음) | 문서에 없음 — core 기본값, 문서 예시 | `client/src/features/production/components/SimulationModal.tsx`, `client/src/mock/services/simulation.ts` |
| **난수 시드 범위** — 0 ~ 2,147,483,647 정수 | 문서에 없음 — 32비트 양의 정수(옛 화면과 같음) | `client/src/features/production/components/SimulationModal.tsx` |
| **재생산 띠 기준** — '추가 계획 필요' > 0이면 띠, '재생산 필요' > 0이면 빨간 띠·재생산 계획, 아니면 '여재로 채우기' | 4.5·14.1-6. 같은 core 함수가 여재 예약 → 재생산을 한 번에 한다 | `client/src/features/production/components/PlanModals.tsx`, `client/src/features/production/ProductionPlanScreen.tsx` |
| **연주 시 히트 판정 전** — 연주 허용 + 경고 띠 | 16장 TBD, core 기본값 | `client/src/features/production/components/ResultFormModal.tsx` |
| **납기 D-라벨** — 계획 목록·연결 품목에 D-n, 지난 납기는 빨갛게(완료·취소 제외) | 옛 화면 유지(화면 편의, PLAN 5장 납기 위험 표시) | `client/src/features/production/lib/productionDisplay.ts`, `client/src/features/production/components/MasterList.tsx` |

### 6-10. 구매(purchasing)

| 값·규칙 | 근거 | 파일 |
|---|---|---|
| **MRP 기본 기간** — 이번 달 1일 ~ 다음 달 마지막 날 (필요일 기준) | 12.2는 `from&to`만 정함. 납기가 한두 달 안인 수주를 한 번에 보게 | `client/src/features/purchasing/lib/purchasingView.ts`, `client/src/api/mrp.ts` |
| **MRP 조회 권한** — PURCHASE_REQUISITION_CREATE 또는 PRODUCTION_PLAN_CONFIRM 조회 이상 | stage3 "VIEW for 구매·생산". 화면 여는 조건(셸 표)은 PRC 조회 | `client/src/api/mrp.ts` |
| **구매요청 상세 조회** — 조회 권한(PRC·PO)이 없어도 요청자·요청 부서 부서장은 볼 수 있다 | 다른 부서 사원이 Message → ERP로 만든 요청을 그 부서장이 승인함에서 본다(REQ-AUTH-004) | `client/src/api/purchasing.ts` |
| **톤 입력 저장 모양** — api 층에서 올바른 입력(숫자, 소수 3자리 이하, 쉼표 허용)은 `decimal(12,3)` 모양('1.5' → '1.500')으로 맞춰 넘긴다. 틀린 입력은 그대로 넘겨 core가 입력 오류로 알린다 | 문서에 없음 — core `checkDecimal`이 자리수를 채우지 않아 '100'·'1.5'로 저장되던 것. core-domain 규약 "톤은 문자열 소수 3자리" | `client/src/api/purchasing.ts`, `client/src/features/purchasing/lib/purchasingView.ts` |
| **출처 표시명** — MRP 계획 / Message → ERP / 직접 | 계산값(코드 그룹 아님, C-3 7). stage3 문구 | `client/src/features/purchasing/lib/purchasingView.ts` |
| **희망 입고일** — 선택 입력(빈칸 허용), 오늘 이전도 막지 않음 | core가 선택으로 둠. "오늘 이후" 규칙은 문서 밖(C-4) | `client/src/features/purchasing/components/RequisitionFormModal.tsx` |
| **입고일** — 필수, 미래·과거 제한 없음, 기본값 오늘 | "오늘 이전" 규칙은 문서 밖(C-4) | `client/src/features/purchasing/GoodsReceiptScreen.tsx` |
| **발주 작성 기본 선택** — 주소에 `?pr=`이 있으면 그 요청 품목, `?supplier=`면 그 공급업체 묶음, 없으면 첫 공급업체 묶음 | 문서에 없음 — 옛 화면 동작(A-7) | `client/src/features/purchasing/hooks/useUrlParams.ts`, `client/src/features/purchasing/PurchaseOrderScreen.tsx` |
| **입고 확정 확인 창** — 확정 전에 한 번 묻는다 | 확정 = 등록이라 되돌릴 수 없음(10장 "확정 후 수정 차단") | `client/src/features/purchasing/GoodsReceiptScreen.tsx` |
| **MRP 기간 결과** — 필요일 ≤ 종료일인 열린 계획을 보이고, 시작일 전 계획은 '기간 전'(밀린 소요)으로 함께 보인다. 기간 뒤 계획은 보이지 않지만 차감(계획 몫 입고예정 보호)에는 들어간다 | 04 4.4 "같은 공급을 계획별로 중복 차감하지 않는다", REQ-PRD-005. 밀린 소요를 어떻게 보일지는 문서에 없음 | `client/src/mock/services/ext/purchasing.ts`, `client/src/api/mrp.ts` |
| **재요청 승인 부서** — 다시 요청한 시점의 요청자 소속 부서 | REQ-AUTH-004 "요청자 소속 부서의 부서장", core 등록 규칙 "부서 = 요청 시점 소속" | `client/src/mock/services/purchasing.ts` |

### 6-11. 품질(quality)

| 값·규칙 | 근거 | 파일 |
|---|---|---|
| **불합격 상태가 비었을 때 표시** — '미지정' 배지 | 공통 코드에 빈 값 표시명이 없음. 옛 화면 표시를 유지 | `client/src/features/quality/components/QualityBadges.tsx` |
| **불합격 원인 이름** — '검사 불합격' / '불합격 히트의 하위 LOT' | TRM-078 정의("검사 기준을 충족하지 못한 LOT과 불합격 히트의 하위 LOT")에서 따옴. 옛 '자체 불합격/히트 불합격'은 새로 지은 이름(C-4) | `client/src/features/quality/components/QualityBadges.tsx`, `client/src/lib/eligibility.ts` |
| **필드 이름** — '불합격 상태'(TRM-079 한글명). REQ-QC-004 본문의 '처리 상태'는 안내 문구에만 | 용어 사전 우선 | `client/src/features/quality/components/RejectedLotWorkspace.tsx` |
| **조회 API 권한** — 검사 입력 화면 = INSPECTION_REGISTER 조회, 불합격 관리 = DISPOSITION_SET 조회 | 문서에 없음 — 화면 여는 조건(screens.ts)과 같게 | `client/src/api/inspections.ts`, `client/src/api/dispositions.ts` |
| **측정값 형식** — 정수 8자리·소수 4자리, 음수 허용 | 가짜 서버 checkDecimal과 같게(ERD decimal 자리수) | `client/src/features/quality/lib/qualityDisplay.ts`, `client/src/mock/services/inspections.ts` |
| **미리보기** — 입력 중 항목별 미리보기 + 저장하면 판정될 결과 예고 | 옛 화면 유지(C-4: 제안 단계가 아니므로 TRM-076과 충돌 없음) | `client/src/features/quality/components/InspectionForm.tsx` |
| **다른 영역 링크** — LOT 추적 `/lots/trace?lot=<LOT 번호>&direction=forward`, 생산계획 `/production/plans?plan=<id>`, 수주 `/sales-orders/<id>`, 작업 로그 `/business-events?lotId=<id>`(이 LOT의 이력 재현, 검토 반영으로 연결), 검사 기준 `/quality/standards` | 문서에 없음 — 옛 화면 주소 형식. 해당 영역이 같은 쿼리를 읽는지 병합 때 확인 | `client/src/features/quality/components/RejectedLotWorkspace.tsx`, `client/src/features/quality/components/LotHistoryCard.tsx` |

### 6-12. 수주(sales)

| 값·규칙 | 근거 | 파일 |
|---|---|---|
| **수주 화면 조회 권한** — 수주 등록·수주 취소 중 하나라도 VIEW 이상 (screens.ts와 같음). 조회 api도 같은 규칙으로 COM-002 | BP-AUTH-01 "각 API에서 권한 재확인" | `client/src/api/salesOrders.ts`, `client/src/features/shell/screens.ts` |
| **업무방 열기 권한** — 수주를 볼 수 있는 사원이면 누구나(사용 권한 코드 없음) | 업무방·메신저는 권한 코드가 없다(공통 코드 PERMISSION) | `client/src/features/sales/components/OpenWorkRoomModal.tsx`, `client/src/api/salesOrders.ts` |
| **업무방 수주 요약** — 그 업무방 멤버이면서 수주 조회 권한(수주 등록·취소 VIEW 이상)도 있어야 볼 수 있다. 권한이 없으면 메신저가 "denied"(수주 조회 권한 없음)로 보인다 | 04 BP-MSG-01 "방 멤버 권한과 ERP 대상 조회 권한을 모두 확인한다". 요약은 메신저 영역(`messengerApi.getRoom`)이 만든다 | `client/src/features/messenger/components/WorkRoomSalesOrder.tsx`, `client/src/api/messenger.ts` |
| **목록 진행 막대** — 검사합격(= 예약 + 출하) ÷ 수주 매수 | core 충족 지표 `passed`, 4.5 분모 명시 | `client/src/features/sales/components/SalesOrderParts.tsx`, `client/src/lib/salesOrderStatus.ts` |
| **생산 연결의 '연결 해제' 계획** — 지금 연결된 계획 + 작업 로그에 이 수주로 남은 생산계획 이벤트의 계획 | 문서에 없음 — 취소 뒤에도 어떤 계획이 여재로 넘어갔는지 보이게 | `client/src/features/sales/components/ProductionLinkTab.tsx` |
| **미리보기 납기** — 미리보기는 납기를 쓰지 않으므로 서비스 입력 확인용으로 오늘 날짜를 넣는다(저장 안 함) | 문서에 없음 — core `previewSalesOrder`가 납기 형식을 확인함 | `client/src/features/sales/SalesOrderCreateScreen.tsx`, `client/src/features/sales/lib/salesOrderForm.ts` |
| **다른 영역 주소** — `/messenger?room=`, `/shipment-requests/new?salesOrderId=`, `/shipment-requests/<id>`, `/mill-sheets?id=`, `/production/plans?plan=`, `/production/results?plan=`, `/lots/trace?lot=`, `/business-events?salesOrderId=` | 문서에 없음 — 옛 화면 주소를 따름. 병합 때 각 영역 주소와 맞춰야 함 | `client/src/features/sales/SalesOrderDetailScreen.tsx`, `client/src/features/sales/components/SalesOrderActions.tsx` |

### 6-13. 출하·밀시트(shipment)

| 값·규칙 | 근거 | 파일 |
|---|---|---|
| **조회 권한** — 출하요청 조회 = SHIPMENT_REQUEST_MANAGE 또는 GOODS_ISSUE_CONFIRM 조회 이상, 출고 확정 조회 = GOODS_ISSUE_CONFIRM 조회 이상, 밀시트 조회 = MILL_SHEET_READ 조회 이상 | 문서에 없음 — 화면 여는 조건(screens.ts)과 맞춤. 출고 화면이 출하요청 내용을 읽어야 함 | `client/src/api/shipmentRequests.ts`, `client/src/api/goodsIssues.ts`, `client/src/api/millSheets.ts` |
| **PDF 생성 권한** — MILL_SHEET_READ 사용(물류). 영업·품질(조회)은 종이만 본다 | 표시명 '밀시트 조회·출력', 2장 USE = 물류 | `client/src/features/millSheets/MillSheetScreen.tsx`, `client/src/api/millSheets.ts` |
| **PDF 생성 시점** — 인쇄 창을 열면(`window.print()`가 오류 없이 끝나면) 생성됨으로 본다 | 문서에 없음 — 브라우저는 인쇄·PDF 저장 완료를 알려 주지 않는다 | `client/src/features/millSheets/MillSheetScreen.tsx` |
| **화면 링크 쿼리** — 출고 확정 `?request=<출하요청 id>`, 밀시트 `?id=<밀시트 id>`, LOT 추적 `/lots/trace?lot=<LOT 번호>` · `/lots/trace?shipmentRequestNo=<출하요청 번호>`(LOT 추적 화면과 같은 이름), 작업 로그 `/business-events?salesOrderId=<수주 id>`, 출하요청 등록 `?salesOrderId=<수주 id>` | 문서에 없음 — 다른 영역(LOT 추적·작업 로그·수주)과 병합 때 맞춰야 함 | `client/src/features/shipment/GoodsIssueScreen.tsx`, `client/src/features/shipment/ShipmentRequestDetailScreen.tsx`, `client/src/features/millSheets/MillSheetScreen.tsx` |
| **같은 규격 여러 줄 추천** — 줄 순서대로 나눠 추천 (core `shipmentRecommendation`) | 문서에 없음 — 4장 | `client/src/mock/services/shipments.ts`, `client/src/api/shipmentRequests.ts` |

### 6-14. 준비 중 화면(soon)

| 값·규칙 | 근거 | 파일 |
|---|---|---|
| **과거 사례 번호 표기** — `CASE-NNNN` (예: CASE-0005) | ERD past_case.case_no "TBD: 번호 형식 미정". 화면에 "사례 번호 형식은 아직 정하지 않았어요 (예시 표기)"로 밝힘 | `client/src/features/pastCases/pastCaseExample.ts` |
| **위험 유형 한글 이름** — 원료 부족 · 합격 매수 부족 · 납기 위험 · 여재 장기 보유 · 불합격률 상승 | 위험 코드(BP-AGT-01 제안)에 공통 코드 표시명이 없어 REQ-AGT-001·004 문구를 씀. 코드 원문은 화면에 안 보임 | `client/src/features/agent/agentExample.ts` |
| **트리거 이름** — 스케줄 / 이벤트 | REQ-AGT-001·TRM-105 문구 | `client/src/features/agent/agentExample.ts` |
| **예시 수치** — 철광석 소요 3,400 t · 잔량 1,600 t · 입고예정 600 t · 부족 1,200 t, Mn 1.68%(기준 1.60% 이하, ks-values SM355A) | 문서에 없음 — 옛 화면 예시 수치 유지. 실제 데이터 아님 | `client/src/features/agent/agentExample.ts` |

### 6-15. LOT 추적·작업 로그·통합 검색(trace)

| 값·규칙 | 근거 | 파일 |
|---|---|---|
| **다른 화면 주소의 쿼리 이름** — `/production/plans?plan=`, `/production/results?result=`, `/purchase-orders?id=`, `/goods-receipts?id=`, `/mill-sheets?id=`, `/quality/inspections?lot=<LOT id>`, `/messenger?room=<채팅방>&message=<메시지>` | 문서에 없음 — 옛 화면의 약속을 따랐다. 각 영역이 다른 이름을 쓰면 병합 때 `eventTargets.ts`의 `targetHref` 한 곳과 LOT 상세 링크만 고치면 된다 | `client/src/features/businessEvents/lib/eventTargets.ts`, `client/src/features/lotTrace/components/LotDetailPanel.tsx` |
| **원료 LOT의 공급업체** — 입고(goods_receipt) → 발주 품목 → 발주의 supplier_id. 입고가 없으면 표시하지 않음(품목 기본 공급업체로 대신하지 않음) | 문서에 없음 — 실제 그 LOT의 공급업체만 보이기 위해 | `client/src/api/lotTrace.ts` |
| **정추적의 출하요청** — 배정 SHIPMENT 중 CONFIRMED(출고 전)와 CONSUMED(출고) 모두, 취소된 출하요청은 뺌 | 불합격 영향 범위 확인(TRM-073)에는 출고 전 배정도 필요 | `client/src/api/lotTrace.ts`, `client/src/features/lotTrace/lib/traceGraph.ts` |
| **영향 수주** — 배정(CONFIRMED·CONSUMED)의 수주 품목 + LOT 생산계획의 수주 품목 | ERD 연결 그대로 | `client/src/api/lotTrace.ts`, `client/src/features/lotTrace/components/ImpactSummary.tsx` |
| **불합격 이벤트 판단(빨강)** — `INSPECTION_REGISTERED`의 after_data에 `inspectionResult: 'FAIL'`, 또는 `DISPOSITION_SET` | 문서에 없음 — 자동 판정 결과를 after_data에 남긴다는 전제(아래 7장) | `client/src/features/businessEvents/lib/eventTone.ts` |
| **대상 한글명** — 용어 사전 엔티티 한글명(예: production_result = 작업 실적, quality_inspection = 품질검사, action_draft = Action Draft). 없는 테이블은 DB명 | 용어 사전 | `client/src/features/businessEvents/lib/eventTargets.ts` |
| **대상 필터 목록** — sales_order, sales_order_item, production_plan, production_result, quality_inspection, lot, reservation, allocation, purchase_requisition, purchase_order, goods_receipt, shipment_request, shipment_request_item, mill_sheet, action_draft | 29개 이벤트의 대상 테이블 (shipment_request_item = 출하 배정 추천, 검토 반영 때 추가) | `client/src/features/businessEvents/components/SubjectPickers.tsx` |
| **사유 코드 표시** — 코드 그대로(STOCK_FIRST 등) | 06에 표시명이 없다(codes/businessEvent.ts 주석) | `client/src/codes/businessEvent.ts` |
| **작업 로그 한 번에 불러오는 수** — 50건, '더 보기'로 50건씩 | 문서에 없음 — 옛 화면과 같음 | `client/src/api/businessEvents.ts` |
| **LOT 목록 수** — 최근 40개, 검색 20개 | 문서에 없음 — 옛 화면과 같음 | `client/src/features/lotTrace/components/TraceSearchPane.tsx`, `client/src/api/lotTrace.ts` |
