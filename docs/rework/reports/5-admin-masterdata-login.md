# 읽기 전용 감사: 로그인·권한 / 조직관리 / 기준정보

저장소 파일은 하나도 고치지 않았습니다. 파일 읽기와 `git show`만 했습니다.

**경로 표기**
- `client/…` = `/Users/mjkim/Documents/GitHub/fantasteel-erp/client/src/…`
- `shared/…` = `/Users/mjkim/Documents/GitHub/fantasteel-erp/shared/src/…`
- 근거 위치는 `파일:줄`로 적었습니다.

**문서 약칭**
- 요구 = 요구사항 정의서
- 용어 = 용어 사전
- 코드표 = 공통 코드 정의서
- 기획 = 프로젝트 기획안
- 컨벤션 = 코드 컨벤션
- 프로세스 = 업무 프로세스 정의서(process.md)

## 요약

1. **로그인 화면에 사원번호·비밀번호 입력란이 없습니다.** 커밋 5b403cd에서 제거됐습니다.
   - 지금은 시연 계정 8개를 버튼으로 고르는 방식입니다.
   - 비밀번호 `'heatline'`이 클라이언트 코드에 그대로 박혀 있습니다(`LoginPage.tsx:11`).
   - 계정 목록에서 '부서장'을 역할 칩으로 보여 줍니다.
2. **권한 코드가 코드표와 다릅니다.**
   - 9개는 이름이 다르고, INSPECTION_STANDARD_MANAGE는 아예 없습니다.
   - 그래서 검사 기준을 품질 담당이 관리할 수 없습니다. 지금은 MASTER_MANAGE 사용 권한(관리자)이 있어야 합니다.
3. **검사 기준에 버전과 두께 구간이 없습니다.**
   - 검사 항목을 그 자리에서 수정·삭제합니다. 요구 QC-002·용어 TRM-110·컨벤션 7-2 [강제]는 "수정하지 않고 새 버전으로 추가"입니다.
   - 성분 규격도 버전 없이 목록 전체를 바꿉니다.
4. **직급이 엔티티가 아니라 자유 입력 글자입니다.**
   - 직급 등록·수정 화면이 없고(REQ-AUTH-002), 표시 순서도 없습니다(TRM-036).
5. **코드 그룹 이름·값이 다릅니다.**
   - 상수 이름: ROLE_CODE(문서 ROLE), PROCESS_CODE(문서 PROCESS_TYPE).
   - 연주 공정 값: CASTING(문서 CONTINUOUS_CASTING).
   - 문서에 없는 코드 그룹: EMPLOYEE_STATUS(잠김 포함), CONSUMPTION_UNIT.
6. **원료 코드 규칙이 문서와 다릅니다.**
   - 문서: 영문 3자 + 숫자 2자리(예: ORE01).
   - 화면: 영문 대문자·숫자 1~10자, 예시 'IO'.
7. **용어 차이**
   - '사용자' (문서: 사원)
   - '원료 종류'·'종류' (문서: 원료 유형)
   - '야드 종류' (문서: 야드 유형)
   - 'KS 규격 번호' (문서: 적용 규격)
   - '야드' (문서: 기본 야드)
   - '공정 실적' (용어 사전 사용 금지어)
   - 'QTY 매수'·'TON 톤' (문서 표시명: 매수·톤)
8. **문서에 없는 기능이 들어 있습니다.**
   - 준비 상태 띠, 계정 잠김·잠금 해제, 비밀번호 재설정, 이메일
   - 부서 코드·정렬 순서, 기준정보 사용/사용 안 함 토글, 강종 이름
9. **코드 컨벤션 위반**
   - Tailwind를 쓰지 않습니다. 인라인 `style`이 217곳이고 별도 CSS 파일도 있습니다.
   - 인증 토큰을 프론트가 sessionStorage에 저장하고 Bearer 헤더로 보냅니다. 컨벤션은 httpOnly 쿠키입니다.
   - 프론트가 Next.js가 아니라 Vite + react-router입니다.
10. **화면 결함 2건**
    - 야드 수정 창의 '야드 종류'가 실제 값과 관계없이 항상 '원료 야드'로 보입니다.
    - 제품 규격 화면에서 '사용 여부'라는 같은 이름이 서로 다른 두 가지 뜻으로 쓰입니다.

---

## A. 화면 목록

### A-0. 주소·진입 경로·권한 확인

| 주소 | 화면 | 상단 제목 · 영역 | 들어오는 길 | 권한 확인 |
|---|---|---|---|---|
| `/login` | `LoginPage` | 셸 없음 | 로그인 안 한 상태에서 보호 화면 접근 시 `?next=`로 이동(`App.tsx:59`)<br>401 응답 시 세션 삭제(`api/client.ts:48`)<br>셸 사용자 메뉴의 '로그아웃'(`shell/Shell.tsx:182-188,202`) | 없음 |
| 그 밖의 모든 주소(로그인 후) | `NotFoundPage` | 제목 없음 | 없는 주소(`App.tsx:109`) | 로그인 필요 |
| `/admin/employees` | `EmployeePage` | '사용자' · '관리자'(`titles.ts:29`) | 관리자 메뉴 '사용자'(`nav.ts:55`, EMPLOYEE_MANAGE 조회 이상)<br>부서·권한 화면의 '사용자' 버튼(`OrganizationPage.tsx:41`) | 화면 단위 확인 없음<br>목록 API가 403이면 목록 자리에 잠금 표시(`EmployeePage.tsx:94`)<br>변경은 EMPLOYEE_MANAGE 사용 권한 |
| `/admin/organization` | `OrganizationPage` | '부서·권한' · '관리자' | 관리자 메뉴 '부서·권한'(`nav.ts:56`, ORG_MANAGE)<br>사용자 화면의 '부서·권한' 버튼<br>'행렬에서 보기' 링크(`?tab=permissions&role=코드`) | 화면 단위 확인 없음(조직도는 '누구나 볼 수 있어요')<br>변경은 ORG_MANAGE 사용 권한 |
| `/admin/master-data` | `MasterDataPage` | '기준정보' · '관리자' | 관리자 메뉴 '기준정보'(`nav.ts:57`, MASTER_MANAGE) | 준비 상태 API가 403이면 화면 전체 잠금(`MasterDataPage.tsx:40-43`)<br>변경은 MASTER_MANAGE 사용 권한 |

- 메뉴는 역할별로 따로 정의돼 있고, 세 관리 메뉴는 관리자(ADMIN) 메뉴에만 있습니다(`nav.ts:21-60`).
- 그래서 다른 역할이 MASTER_MANAGE 조회 권한을 가져도 메뉴가 없습니다. 기본 권한상 영업·구매·생산·품질이 이 조회 권한을 가집니다(`shared/codes/index.ts:100-103`). 이들은 주소를 직접 입력해야만 들어갈 수 있습니다.

### A-1. 로그인 `/login` (`client/pages/LoginPage.tsx`)

**현재 상태**
- 사원번호·비밀번호 입력란이 없습니다.
- 오른쪽 영역 제목은 '계정 선택'이고, 안내문은 '시연용이에요. 계정을 누르면 그 역할로 바로 들어가요.'입니다(`:98-99`).

**왼쪽 소개 영역**
- 'FANTASTEEL' / '철강 제조 AI 협업 ERP'(`:58-59`)
- 제목 '수주에서 출하까지, 한 흐름으로 일합니다.'(`:63`)
- 설명 '…예약과 배정은 시스템이 추천하고 담당자가 확정합니다.'(`:64`)
- 특징 3개(`:83-85`)
  - '수주→출하 한 흐름'
  - '추천은 시스템, 확정은 사람': '예약·배정은 추천 후 담당자가 확정, 구매요청은 부서장이 승인'
  - '원료부터 코일까지 LOT 추적'

**시연 계정** (`:12-21`, 버튼 하나 = 역할 칩 / 이름 / 설명 / 화살표)

| 역할 칩 | 이름 | 사원번호 | 설명 |
|---|---|---|---|
| 영업 | 김영업 | 2104012 | 수주 등록·출하요청 |
| 구매 | 서구매 | 1907015 | MRP·구매요청·발주·입고 |
| 생산 | 박생산 | 1803021 | 생산계획·실적·열연 배정 |
| 품질 | 정품질 | 1911030 | 검사 입력·불합격 관리 |
| 물류 | 윤물류 | 2005024 | 출고 확정·밀시트 |
| **부서장** | 남구매 | 1604007 | 구매부장 · 구매요청 승인 |
| **부서장** | 강생산 | 1402002 | 생산부장 · 구매요청 승인 |
| 관리자 | 이관리 | 1704010 | 사용자·부서·권한·기준정보 |

**동작**
- 계정을 누르면 `authApi.login(사원번호, 'heatline')`을 호출합니다. POST `/api/v1/auth/login`(`:11`, `:38`).
- 성공하면 `next` 주소로 이동하고, 없으면 `/dashboard`로 갑니다.
- 진행 중에는 '들어가는 중…'을 보이고 모든 계정 버튼을 막습니다(`:104`, `:113`).
- 실패하면 서버 메시지 또는 '로그인하지 못했어요'를 보입니다(`:41`, `:114`).
- 바닥글: '인가된 사용자만 접속 · 계정 문의 경영지원부 이관리'(`:119`).

**커밋 5b403cd (2026-10-01, "fix: 로그인 기능 비활성화")**
- 9개 파일, +104/−182줄. client 쪽 변경은 `LoginPage.tsx` 하나입니다.
- 제거된 것
  - 사원번호 입력(placeholder '예: 2104012')
  - 비밀번호 입력(보기 토글 포함)
  - 검증 메시지 '사원번호와 비밀번호를 입력해 주세요'
  - 제출 버튼 '로그인' / '로그인 중…'
- 바뀐 것: 제목 '로그인' → '계정 선택'.
- 원래 폼 아래에 있던 '테스트 계정' 목록만 남겼습니다(행 높이 32 → 44).
- 머리 주석: "로그인 기능은 전면 재작업 예정 — 그때 사원번호·비밀번호 폼을 다시 만든다".
- 나머지 변경은 README, package 파일, server/ 쪽입니다(seed.ts 2줄 포함). server/는 지시대로 열지 않았습니다.

### A-2. 없는 화면 (`client/pages/NotFoundPage.tsx:7`)

- 제목 '없는 화면이에요', 안내 '주소를 다시 확인해 주세요.'
- 버튼 '대시보드로' → `/dashboard`

### A-3. 사용자 `/admin/employees` (`client/pages/admin/EmployeePage.tsx`)

**권한 변수**
- `canManage` = EMPLOYEE_MANAGE 사용 권한(`:19`)
- `canOrg` = ORG_MANAGE 조회 권한(`:127`)

#### 왼쪽 '사원 목록'

**머리**
- '사용자' + 건수 태그. 필터를 쓰면 '필터된 수 / 전체 수'로 보입니다(`:60-61`).
- 버튼 '사원 등록'(`:62-65`): `canManage`가 아니면 막히고 '권한이 필요해요' 툴팁. 누르면 등록 서랍이 열립니다.

**검색·필터**
- 검색창: placeholder '이름·사원번호', 0.25초 뒤 `keyword`로 조회(`:29-32`, `:69`)
- 역할 선택: '역할: 전체' + 영업/구매/생산/품질/물류/관리자(`:73-76`)
- 부서 선택: '부서: 전체' + 계층 들여쓰기 목록(`:80-83`)
- 상태 버튼: '전체' / '사용' / '사용 중지' / '잠김'(`:87-90`)

**목록 행** (`:95-116`)
- 아바타, 이름(사용 중지면 흐리게), 역할 칩, '부서장' 배지, 상태 배지
- 둘째 줄: '부서명 · 사원번호' 뒤에
  - 잠김이면 ' · 로그인 N회 실패'(빨강)
  - 아니면 ' · 최근 날짜·시각'
- 결과가 없으면 '조건에 맞는 사원이 없어요'(`:117`)
- 처음 선택되는 사원: 주소의 `?user=` → 없으면 첫 잠김 사원 → 첫 행(`:47-48`)

#### 오른쪽 상세 (`:154-258`)

**머리**
- 이름, 역할 칩, 상태 배지, '부서장' 배지(툴팁 '구매요청의 승인권자예요'), 본인이면 '나' 태그(`:170-174`)
- 부제: '부서 · 직급 · 사원번호 N · 이메일'(`:176`)

**버튼**

| 버튼 | 누를 수 있는 조건 | 동작 |
|---|---|---|
| (글자) '{전체}명 · 잠김 N' | — | 요약 표시 |
| '부서·권한' 링크 | `canOrg` | 부서·권한 화면 이동 |
| (글자) '권한 필요' | `canManage`가 아닐 때 표시 | — |
| '비밀번호 재설정' | `canManage` | 재설정 창 |
| '정보 수정' | `canManage` | 수정 서랍 |
| '잠금 해제' (잠김 안내 띠 안) | `canManage`, 진행 중 아님 | POST `/employees/:id/unlock`, 알림 '잠금을 풀었어요' |
| '다시 사용' (사용 중지 안내 띠 안) | `canManage` | PATCH `/employees/:id` `{employeeStatus:'ACTIVE'}`, 알림 '다시 사용하도록 바꿨어요' |

**안내 띠**
- 잠김(`:186-200`): '로그인 N회 실패로 계정이 잠겼어요' + 잠금 해제·재설정 안내
- 사용 중지(`:201-214`): '사용 중지된 계정이에요' / '로그인할 수 없고 조직도·담당자 목록에서 빠져요'

**카드 '계정 정보'** (`:217-232`)
- 사원번호, 이메일(없으면 '-'), 역할, 부서, 직급, 등록일
- 최근 접속(없으면 '접속 기록 없음')
- 상태: '잠김 (로그인 N회 실패)' / '사용 중지' / '사용'(실패가 있으면 ' · 로그인 실패 N회' 덧붙음)

**카드 '역할 권한'** (`:233-239`, `RolePermissionSummary`)
- 사용 권한: ✓ + 권한 이름
- 조회 권한: 눈 아이콘 + '권한 이름 조회'
- 권한 없음: 자물쇠 + 앞 3개 이름 + '외 N'
- '행렬에서 보기' 링크(`canOrg`일 때)

**카드 '부서장 지정'** (`:241-255`)
- '{부서명} 부서장' 배지들
- 안내 '부서장은 그 부서 사원이 올린 구매요청의 승인권자예요. 부서장을 바꾸려면 부서·권한 화면에서 지정해 주세요.'
- 해당 부서가 없으면 '부서장으로 지정된 부서가 없어요'

선택된 사원이 없으면 '사원을 골라 주세요'(`:134`).

#### 비밀번호 재설정 창 (`:260-292`)
- 제목 '비밀번호 재설정'
- 안내: '…서버가 임시 비밀번호를 만들지 않으니 정한 비밀번호를 직접 전달해 주세요. 계정 상태와 로그인 실패 횟수는 그대로예요.'
- 입력 '새 비밀번호': 비밀번호 형식, 최대 72자, 보기/숨기기, 도움말 '8~72자'
- 오류 '비밀번호는 8~72자로 입력해 주세요'
- 버튼 '취소' / '비밀번호 바꾸기'('바꾸는 중…') → POST `/employees/:id/reset-password` `{newPassword}`, 알림 '비밀번호를 바꿨어요'
- 창 안의 버튼은 권한을 확인하지 않습니다. 여는 버튼만 막혀 있습니다.

#### 사원 등록·수정 서랍 (`client/features/admin/EmployeeDrawer.tsx`)

- 제목 '사원 등록' / '사원 정보 수정'
- 부제: 등록이면 '역할이 메뉴와 업무 권한을 정해요', 수정이면 '이름 · 사원번호 N'
- Esc 키나 바깥 클릭으로 닫힘
- 권한이 없으면 띠 '사원 관리 사용 권한이 있어야 저장할 수 있어요'. 입력란 자체는 막지 않습니다(`:105-107`).

| 입력 | 형식 | 검증·메시지 | 기본값·잠금 |
|---|---|---|---|
| 이름* | 글자, 최대 50, '예: 홍길동' | '이름은 1~50자로 입력해 주세요' | — |
| 사원번호* | 숫자만, 최대 7, '숫자 7자리' | 등록 시 숫자 7자리: '사원번호는 숫자 7자리로 입력해 주세요'<br>도움말 '로그인 ID로 쓰여요' | 수정 시 읽기 전용 '사원번호는 바꿀 수 없어요' |
| 이메일 | email, 'name@example.com' | 선택. '이메일 형식이 아니에요' | — |
| 역할 선택* | 역할 카드(GET `/roles`), 카드마다 '사용 N · 조회 M' | '역할을 선택해 주세요' | 본인은 막힘 '내 계정의 역할은 바꿀 수 없어요' |
| 부서* | 선택 '부서 선택' + 계층 목록 | '부서를 선택해 주세요' | — |
| 직급* | **자유 입력** 글자, 최대 20, '예: 대리' | '직급은 1~20자로 입력해 주세요' | — |
| 사용 상태 (수정만) | 버튼 '사용' / '사용 중지' (+ '잠김' 표시) | — | '사용 중지'는 본인·부서장·잠김일 때 막힘. 안내 4종(`:169-177`) |
| 초기 비밀번호* (등록만) | 비밀번호 형식, 최대 72, '8자 이상', 보기/숨기기 | '초기 비밀번호는 8~72자로 입력해 주세요'<br>도움말 '사원에게 직접 전달해 주세요 · 서버에는 암호화해서 저장돼요' | — |
| 권한 미리보기 | 읽기 전용 | 역할 미선택 시 '역할을 고르면 권한이 보여요'<br>'구매요청 승인은 역할이 아니라 부서장으로 지정돼야 할 수 있어요'<br>'행렬에서 보기' 링크(ORG_MANAGE 조회 권한) | — |

**바닥**
- 서버 오류 또는 '빨간 표시를 확인해 주세요'
- '취소'
- '등록' / '저장'('저장 중…'): `canManage`가 아니면 막힘(`:199-206`)

**저장 API**
- 등록: POST `/employees`, 알림 '사원을 등록했어요'
- 수정: PATCH `/employees/:id`(바뀐 칸만 보냄), 알림 '사원 정보를 저장했어요'. 바뀐 게 없으면 '바뀐 내용이 없어요'.

### A-4. 부서·권한 `/admin/organization` (`client/pages/admin/OrganizationPage.tsx`)

**화면 머리**
- 제목 '부서·권한'. 부제는 탭마다 다릅니다(`:31`).
  - 부서 계층: '부서를 계층으로 관리하고 부서장을 지정해요'
  - 조직도: '부서별 인원과 부서장을 한눈에 봐요'
  - 역할별 권한: '역할이 할 수 있는 일을 정해요 · 칸을 누르면 사용 → 조회 → 없음 순으로 바뀌어요'
- '사용자' 링크(EMPLOYEE_MANAGE 조회 권한)
- 편집 권한(ORG_MANAGE 사용)이 없으면 '조회만 할 수 있어요 · 권한 필요'

**탭** (주소 `?tab=`)
- '부서 계층' + 부서 수
- '조직도'
- '역할별 권한' + 저장 전 변경이 있으면 '변경 N' 배지

화면을 열면 탭과 관계없이 GET `/departments`, `/employees/directory`, `/departments/tree`, `/roles`를 모두 부릅니다(`:25-29`).

#### 부서 계층 탭 (`client/features/admin/DepartmentTab.tsx`)

**안내 띠** (`:54-59`)
> '부서장은 구매요청의 승인권자예요. 사원이 올린 구매요청은 그 사원 부서의 부서장이 승인해요. 부서장이 직접 올린 요청은 상위 부서의 부서장이 승인하고, 부서장이 비어 있거나 사용 중지면 구매요청을 제출할 수 없어요.'

**왼쪽 '부서 계층' 카드** (`:61-100`)
- 버튼 '부서 만들기': 편집 권한이 없으면 막힘
- 트리 행: 들여쓰기 '└' + 부서명 + 부서 코드 + 'N명'
- 둘째 줄: '부서장 {이름}' 또는 빨간 '부서장 없음'
- 부서가 없으면 '등록된 부서가 없어요'

**오른쪽 편집 카드** (`:108-176`)
- 머리: 부서명, 부서 코드, 배지('부서장 {이름}' / '부서장 없음'), '소속 N명 · 하위 부서 N개'
- 권한이 없으면 '부서·권한 관리 사용 권한이 있어야 바꿀 수 있어요'

| 입력 | 형식·도움말 | 권한 없을 때 |
|---|---|---|
| 부서명* | 글자, 최대 50 | 막힘 |
| 부서 코드 | 읽기 전용, '만든 뒤에는 바꿀 수 없어요' | — |
| 상위 부서 | 선택 '상위 부서 없음 (최상위)'. 자기 자신·하위 부서는 막히고 '(자기 자신·하위 부서)' 표시<br>도움말 '자기 자신이나 하위 부서는 상위 부서로 지정할 수 없어요' | **막히지 않음** |
| 부서장 (승인권자) | 선택 '지정 안 함' + 묶음 '이 부서 사원' / '다른 부서 사원'(항목: '이름 · 직급 · 소속')<br>현재 부서장이 후보 목록에 없으면 '(현재 · 사용 중인 사원 목록에 없음)'<br>도움말 '사용 중인 사원만 지정할 수 있어요 · 바꾸면 작업 로그에 남아요' | **막히지 않음** |
| 정렬 순서 | 숫자. 도움말 '같은 상위 부서 안에서 작은 수가 먼저 나와요' | 막힘 |

- 오류: '부서명은 1~50자로 입력해 주세요', '정렬 순서는 정수로 입력해 주세요', '바뀐 내용이 없어요'
- 바닥: '저장 전 변경이 있어요', '되돌리기', '저장'('저장 중…', 편집 권한 필요)
- 저장: PATCH `/departments/:id`, 알림 '부서 정보를 저장했어요'

**'부서 만들기' 창** (`:178-233`)

| 입력 | 형식·검증 | 기본값 |
|---|---|---|
| 부서명* | '예: 코크스파트', 최대 50 | — |
| 부서 코드* | 대문자로 변환, 최대 30, 'PRD-COKE'<br>규칙 `^[A-Z0-9][A-Z0-9-]{0,29}$`, 오류 '영문 대문자·숫자·하이픈으로 30자 이내 (예: PRD-COKE)' | — |
| 상위 부서 | 선택 | 없음 |
| 부서장 (승인권자) | 도움말 '나중에 지정해도 돼요. 부서장이 없으면 이 부서 사원은 구매요청을 제출할 수 없어요' | 지정 안 함 |
| 정렬 순서 | 정수 | 0 |

- 버튼 '취소' / '만들기'('만드는 중…') → POST `/departments`, 알림 '부서를 만들었어요'
- 부서 삭제·사용 중지 기능은 없습니다.

#### 조직도 탭 (`client/features/admin/OrgChartTab.tsx`, 읽기 전용)

- 안내: '사용 중인 사원만 보여요 · 부서장이 맨 앞, 나머지는 사원번호순이에요 · 누구나 볼 수 있어요'(`:61`)
- 부서 카드 머리(`:12-19`)
  - 부서명, 코드, 'N명'
  - 하위 부서가 있으면 '하위 부서 N개 · 전체 N명'
  - 오른쪽에 '부서장 {이름} {직급}' 또는 '부서장 없음' 배지
- 인원(`:22-45`)
  - 아바타, 이름, '부서장' 배지
  - 둘째 줄 '직급 · 역할'. 요구 ORG-003에 없는 역할까지 보여 줍니다.
  - 다른 부서 소속 부서장은 '직급 · 다른 부서 소속'
  - 인원이 없으면 '이 부서에 속한 사원이 없어요'
- 데이터: GET `/departments/tree`

#### 역할별 권한 탭 (`client/features/admin/PermissionMatrixTab.tsx`)

**안내 띠** (`:85-101`)
- 편집 권한 없음: '조회 전용 — 권한을 바꾸려면 부서·권한 관리 사용 권한이 필요해요'
- 저장 전 변경 있음: '저장 전 변경이 있는 역할 N개 — … 역할마다 따로 저장해요'
- 역할별 저장 실패 띠

**카드 '역할별 권한'**
- 부제 '역할 N × 권한 16'
- 범례: '사용 = 입력·변경', '조회 = 보기만', '저장 전 변경', '기본값과 다름'

**표**
- 열 머리: (빈 칸) | '권한' | 역할마다 한 열(역할 이름 + '사용 N · 조회 M'). `?role=`로 받은 역할 열은 강조(`:118-133`)
- 행: 권한 16개를 영역(영업/구매/생산/품질/물류/관리)별로 묶고, 영역 첫 행에 영역 이름(`:136-141`)
- 칸 버튼은 '사용'(✓ 초록) → '조회'(눈 파랑) → '없음'(–) 순으로 바뀝니다(`:150-161`)
  - 저장 전 변경 칸은 주황 배경
  - 클라이언트 기본값(`DEFAULT_ROLE_PERMISSIONS`)과 다르면 파란 점, 툴팁 '기본값은 X이에요'
  - 편집 권한이 없거나 그 역할을 저장 중이면 막힘
- 바닥 행 '역할별 저장'(`:169-194`)
  - 변경 있음: '변경 N · 저장 전' + '취소' + '저장'('저장 중…')
  - 변경 없음: '변경 없음'

**저장**
- PUT `/roles/:id/permissions` `{permissions:[{permissionCode, permissionLevel}]}`(`:61-72`)
  - '없음'은 보내지 않습니다.
  - 화면이 모르는 권한 코드는 그대로 유지합니다.
- 알림 '{역할} 역할 권한을 저장했어요'
- 내 역할이면 GET `/auth/me`로 내 권한을 바로 갱신합니다(`:57`).

**하단 안내** (`:201-202`)
- '구매요청 승인 같은 승인 권한은 이 행렬에 없어요…'
- '관리자 역할은 사원 관리·부서·권한 관리의 사용 권한을 유지해야 저장돼요… 저장하면 바로 적용돼요.'

**행에 보이는 권한 이름** (`shared/codes/index.ts:77-94`)
- 영업: 수주 등록, 수주 취소, 출하요청·배정 확정
- 구매: 구매요청 등록·MRP, 발주, 입고 확정
- 생산: 생산계획·히트 편성, **공정 실적**, 열연 투입 배정
- 품질: 검사 입력, 불합격 처리 상태 지정
- 물류: 출고 확정, 밀시트 조회·출력
- 관리: 사원 관리, 부서·권한 관리, 기준정보 관리

### A-5. 기준정보 `/admin/master-data` (`client/pages/admin/MasterDataPage.tsx`)

- 제목 '기준정보' + 탭별 부제
- 편집 권한 = MASTER_MANAGE 사용(`:33`)
- 위에 준비 상태 띠, 그 아래 탭 9개(주소 `?tab=`, 탭을 바꾸면 `?sub=`는 지움)(`:19-29`, `:37`)

| 키 | 탭 이름 | 부제 (요구사항 ID가 화면에 그대로 보임) |
|---|---|---|
| specs | 제품 규격 | 슬래브·코일 규격과 1매 이론중량 (MST-003) |
| mapping | 규격 매핑 | 슬래브 ↔ 코일 규격과 열연 계획 수율 (MST-004) |
| grades | 강종·성분 | 강종과 성분 규격 min·max (MST-002) |
| routing | 라우팅 | 품목 유형별 공정 순서와 계획 수율 (MST-005) |
| consumption | 배합 원단위 | 용선·용강 1t당 원료 투입량 (MST-006) |
| items | 품목·원료 | 품목 단위 유형과 원료·기본 공급업체 (MST-001) |
| parties | 고객사·공급업체·야드 | 고객사·공급업체·야드 등록 (MST-007·008) |
| inspection | 검사 항목 | 공정·강종별 검사 항목과 min·max (QC-002) |
| settings | 생산 설정 | 히트 용량 · 납기 위험 기준일 (MST-009) |

**탭 공통 부품** (`client/features/master-data/common.tsx`)
- 권한 없음 안내: '조회만 할 수 있어요 · 기준정보 관리 권한이 필요해요'(`:31-33`)
- 막힌 버튼 툴팁: '기준정보 관리 사용 권한이 필요해요'(`:10`)
- 사용 토글 배지: '사용' / '사용 안 함'(`:45-58`)
  - 툴팁 '누르면 사용 안 함으로 바꿔요 (삭제 대신)' / '누르면 다시 사용해요'
- 삭제: 아이콘을 누르면 '삭제' / '취소'로 한 번 더 확인(`:61-77`)
- 사용 여부 선택: '전체' / '사용' / '사용 안 함'(`:124-130`)
- 창 바닥: '취소' + 제출('저장 중…')(`:97-108`)
- 무엇이든 저장에 성공하면 기준정보 조회를 전부 다시 불러옵니다(`:15-17`).

#### 준비 상태 띠 (`ReadinessBanner.tsx`, GET `/master-data/validation`)

- 불러오는 중: '준비 상태를 확인하는 중이에요…'
- 실패: '준비 상태를 확인하지 못했어요. 다시 시도'(`:27-30`)
- 준비됨: '기준정보 준비 완료 · 생산·MRP 계산에 필요한 기준정보가 모두 있어요' + '시:분 확인' + '다시 확인'(`:31-45`)
- 덜 됨: '기준정보 준비가 덜 됐어요 (N건) · 아래를 채워야 생산·MRP 계산이 돼요'(`:46-64`)
  - 문제 3건까지 보이고 'N건 더 보기' / '접기'
  - 각 문제 앞에 영역 칩. 누르면 해당 탭으로 이동합니다.
  - 칩 이름: 제품 규격 / 규격 매핑 / 라우팅 / 배합 원단위 / 원료 / 강종·성분 / 검사 항목 / 생산 설정
  - 문제 설명은 서버 메시지를 그대로 보여 줍니다.

#### 제품 규격 (`ProductSpecTab.tsx`)

**머리** (`:25-38`)
- '제품 규격' + 건수
- 부제 '1매 이론중량 = 두께 × 폭 × 길이 × 7.85 ÷ 10^9 (t, 소수 3자리)'
- 필터: '전체' / '슬래브' / '코일' 버튼, '강종 전체' + 강종 코드(사용 안 함 포함), 사용 여부
- 버튼 '규격 추가'

**표**
- 열: 규격 코드 | 유형 | 강종 | 두께 × 폭 × 길이 (mm) | 1매 이론중량 | 매핑된 규격 | 열연 계획 수율 | **사용 여부** | **사용** | (수정)(`:44-55`)
- 칸 내용(`:58-74`)
  - 이론중량: '23.550 t' 형식
  - 매핑된 규격: 코드를 누르면 규격 매핑 탭으로 이동. 없으면 빨간 '매핑 없음'
  - 열연 계획 수율: 서버 값 그대로, 없으면 '-'
  - '사용 여부' 열: 실제로 쓰였는지(isUsed). '사용됨'(툴팁 '수주·예약·생산계획·LOT·재고에서 쓰여요') / '미사용'
  - '사용' 열: 사용 토글 → POST `/product-specs/:id/deactivate` 또는 `/activate`
- 바닥: '규격 코드와 이론중량은 서버가 만들어요 · 삭제 대신 사용 안 함으로 바꿔요 · 사용 중지한 규격은 수주 등록 선택 목록에서 빠져요'(`:83`)

**'규격 추가' / '규격 수정 · 코드' 창** (`:90-205`)

| 입력 | 형식·단위 | 검증 | 이미 쓰인 규격일 때 |
|---|---|---|---|
| 품목 유형* | 카드 선택 슬래브/코일 (기본 슬래브) | — | 수정 시에는 항상 잠김 '품목 유형은 바꿀 수 없어요' |
| 강종* | 사용 중 강종 '코드 · 이름' | '강종을 선택해 주세요' | **막힘** |
| 두께 (mm)* | 숫자, placeholder 250 | 0 초과 2,000 이하, 소수 2자리까지 ('0보다 크고 2,000 이하, 소수 2자리까지') | **읽기 전용** |
| 폭 (mm)* | placeholder 1200 | 0 초과 5,000 이하 | **읽기 전용** |
| 길이 (mm)* | placeholder 10000 | 0 초과 5,000,000 이하 | **읽기 전용** |
| 1매 이론중량 [계산값] | 읽기 전용, t | 화면에서 미리 계산(`shared/weight.ts`). '계산값 (서버가 저장 시 다시 계산해요)' | 저장된 값 표시 '저장된 확정값' |
| 야드 | '야드 없음' + 같은 유형의 야드 | 선택 사항 | **유일하게 수정 가능** |

- 쓰인 규격이면 띠: '사용된 규격은 치수·이론중량을 수정할 수 없어요. 다른 치수는 새 규격으로 추가해 주세요'(`:11`, `:156`)
- 바닥 도움말: '저장하면 규격 코드와 이론중량을 서버가 계산해 저장해요'
- 등록: POST `/product-specs`
- 수정: PATCH `/product-specs/:id`(바뀐 칸만, 쓰인 규격은 야드만)
- 알림 '규격을 추가했어요' / '규격을 저장했어요' / '바뀐 내용이 없어요'

#### 규격 매핑 (`SpecMappingTab.tsx`)

**머리**
- '슬래브 ↔ 코일 규격 매핑'
- 부제 '코일 1개 이론중량 ≤ 슬래브 1매 이론중량 · 열연 계획 수율 = 코일 ÷ 슬래브'
- 버튼 '매핑 추가'

**표**
- 열: 강종 | 슬래브 규격 | 슬래브 1매 | 코일 규격 | 코일 1개 | 열연 계획 수율 | 사용 여부 | (삭제)(`:26-37`)
- 규격 칸: 코드 + '두께 × 폭 × 길이 mm'
- 수율 칸: 서버 값 + 'NN.NN%'
- 사용됨 툴팁: '두 규격 중 하나라도 수주·재고·LOT에서 쓰이면 사용됨이에요'
- 삭제
  - 쓰인 매핑이면 막힘. 툴팁 '수주·재고·LOT에 사용된 규격의 매핑은 삭제할 수 없어요'
  - 아니면 DELETE `/spec-mappings/:id`, 알림 '매핑을 삭제했어요'
  - 매핑 수정 기능은 없습니다.
- 바닥: '열연 계획 수율은 저장하지 않고 두 규격의 이론중량으로 계산해요 · 사용된 규격의 매핑은 바꾸거나 삭제할 수 없어요 · 새 규격을 추가해 매핑해 주세요'(`:72`)

**'규격 매핑 추가' 창** (`:105-145`)
- 규칙 안내: '…같은 강종끼리만, 아직 매핑되지 않은 규격만 고를 수 있어요.'
- 강종(선택 사항, '전체 강종')
- '매핑 안 된 슬래브 규격*', '매핑 안 된 코일 규격*'
  - 사용 중이고 아직 매핑 안 된 규격만 보입니다. 항목은 '코드 · N.NNN t'
  - 고를 게 없으면 '…제품 규격 탭에서 먼저 추가해 주세요'
- 오류
  - '강종이 다른 규격은 매핑할 수 없어요'
  - '코일 이론중량이 슬래브 이론중량보다 커서 매핑할 수 없어요 (…)'
- 비교 상자: 슬래브 1매 / 코일 1개 / 열연 계획 수율(소수 4자리)
- 버튼 '매핑': 두 규격을 고르고 규칙에 맞을 때만 누를 수 있음 → POST `/spec-mappings`, 알림 '규격을 매핑했어요'

#### 강종·성분 (`SteelGradeTab.tsx`)

**왼쪽 '강종' 목록**
- 건수 + 버튼 '강종 추가'
- 행: 코드, 이름, 오른쪽에 '성분 N'(사용 안 함이면 '사용 안 함')
- 둘째 줄: KS 번호 또는 'KS 규격 번호 없음'(`:83-110`)

**오른쪽 상세** (`:120-177`)
- 머리: 코드·이름 + 사용 토글(PATCH `{isActive}`) + 삭제(DELETE `/steel-grades/:id`, 알림 '강종을 삭제했어요')
- 입력: '강종 코드'(읽기 전용), '강종 이름'(최대 50), 'KS 규격 번호'('예: KS D 3503')
- 버튼 '이름·규격 번호 저장' → PATCH `{steelGradeName, standardNo}`, 알림 '강종 정보를 저장했어요'

**성분 규격 (%)**
- 안내: '최소·최대 중 하나는 필요해요 · 저장하면 목록 전체를 바꿔요'
- 표 열: 성분 | 최소 (%) | 최대 (%) | (행 지우기)
- 버튼 '성분 추가'
- 검증 메시지(`:26-35`)
  - '성분 기호는 영문으로 시작하는 10자 이내예요 (예: C, Si, Mn)'
  - '같은 성분이 두 번 있어요'
  - '값은 소수 4자리까지 숫자로 입력해 주세요'
  - '최소·최대 중 하나는 입력해 주세요'
  - '0~100 % 안에서 입력해 주세요'
  - '최소값이 최대값보다 클 수 없어요'
  - '성분을 1개 이상 입력해 주세요'
- 버튼 '되돌리기' / '성분 규격 저장' → PUT `/steel-grades/:id/composition-specs`, 알림 '성분 규격을 저장했어요'
- 바닥: '규격·LOT·생산계획·검사 항목·배합 원단위가 쓰는 강종은 삭제할 수 없어요 · 사용 안 함으로 바꿔 주세요'

**'강종 추가' 창**
- 강종 코드*: 대문자, 'SS275', 규칙 `^[A-Z0-9][A-Z0-9-]{0,19}$`, 오류 '영문 대문자·숫자·하이픈으로 20자 이내 (예: SS275)'
- 강종 이름*: 오류 '강종 이름을 입력해 주세요'
- KS 규격 번호
- 성분 규격 (선택)
- 저장 → POST `/steel-grades`, 알림 '강종을 추가했어요'

#### 라우팅 (`RoutingTab.tsx`)

- 카드 '슬래브 라우팅' / '코일 라우팅' + '공정 N'
- 표 열: 순서 | 공정 | 계획 수율
  - 공정 칸: 공정 이름 + **공정 코드 원문**(예: CASTING)(`:70`)
  - 계획 수율 칸
    - 규격 매핑에서 계산하는 공정이면 링크 '규격 매핑에서 계산'
    - 아니면 입력칸(placeholder '0.95', 제선은 '미설정') + 'NN.N%' 미리보기
- 검증(`:33-39`)
  - 제선을 뺀 공정이 비면 '계획 수율을 입력해 주세요'
  - 범위가 틀리면 '0보다 크고 1 이하로 입력해 주세요 (예: 0.95)'
- 바닥: '수율은 0보다 크고 1 이하 비율이에요 · 열연 수율은 입력하지 않아요' + '되돌리기' + '저장'
- 저장: PUT `/routings/:itemType`, 알림 '{카드 제목}을 저장했어요'
- **공정을 추가·삭제하거나 순서를 바꾸는 화면이 없습니다.**

#### 배합 원단위 (`ConsumptionTab.tsx`)

**'공통 원단위' 카드**
- 부제 't/t (용선 1t당) · 철광석·석탄·석회석은 강종과 상관없는 공통값이에요'
- 열: 원료 코드 | 원료 | 종류 | 원단위(입력, 뒤에 't/t', 비면 '미설정')
- 대상이 없으면 '사용 중인 철광석·석탄·석회석 원료가 없어요'

**'합금철 원단위 (강종별)' 카드**
- 부제 'kg/t (용강 1t당)'
- 열: 원료 코드 | 합금철 | 사용 중인 강종 코드마다 한 열(입력, 뒤에 'kg/t')
- 대상이 없으면 '사용 중인 합금철 원료가 없어요'

**검증과 저장**
- 0보다 큰 숫자만 허용. 칸을 비우고 저장하면 그 원단위를 지웁니다.
- 바닥 안내
  - 변경이 있으면 '변경 N건 · 칸을 비우고 저장하면 그 원단위를 지워요 (지우면 준비 상태 점검에 걸려요)'
  - 없으면 '값을 고치고 저장해요 · 0보다 커야 해요 · 비어 있으면 미설정이에요'
- 버튼 '되돌리기' / '저장'('저장 중…')
- 저장은 바뀐 칸마다 차례로 PUT `/specific-consumptions` 또는 DELETE `/specific-consumptions/:id`. 알림 '원단위 N건을 저장했어요'(`:44-57`)

#### 품목·원료 (`ItemMaterialTab.tsx`)

**'품목' 카드**
- 부제 '단위 유형: 제품(슬래브·코일)은 QTY 매수, 원료는 TON 톤 · 서버가 정해요'
- 필터 없음, 품목 추가 버튼 없음
- 열: 품목 코드 | 품목명 | 유형 | 단위 유형('QTY 매수' / 'TON 톤') | 기본 공급업체 | 사용 | (수정)
- 사용 토글: PATCH `/items/:id`
- 바닥: '품목 코드·유형은 바꿀 수 없어요 · 원료 품목은 아래 원료 등록에서 만들어요'
- '품목 수정 · 코드' 창
  - '품목 코드 · 유형': 읽기 전용
  - '품목명*'
  - '기본 공급업체'('지정 안 함' + 사용 중 공급업체 '이름 (코드)')
  - 저장 → PATCH `/items/:id`, 알림 '품목을 저장했어요'

**'원료' 카드**
- 부제 '원료 코드는 LOT 번호(RM-원료코드-…)에 쓰여요'
- 필터: '종류 전체' + 철광석/석탄/석회석/합금철, 사용 여부
- 버튼 '원료 추가'
- 열: 원료 코드 | 원료명 | 종류 | 단위 유형 | 기본 공급업체 | 야드 | 재고 | 사용 | (수정)
  - 기본 공급업체가 없으면 빨간 '없음'(`:114`)
  - 재고는 'N.NNN t'
- 바닥: '원료 코드·종류는 만든 뒤 바꿀 수 없어요 · 기본 공급업체를 비우면 준비 상태 점검에 걸려요 · 재고는 읽기 전용이에요'

**'원료 추가' / '원료 수정' 창** (`:133-187`)

| 입력 | 형식·검증 | 기본값·잠금 |
|---|---|---|
| 원료 코드* | 대문자, 최대 10, placeholder 'IO'<br>규칙 `^[A-Z0-9]{1,10}$`, 오류 '영문 대문자·숫자 10자 이내 (예: IO)'<br>도움말 'LOT 번호에 쓰여요 · 만든 뒤에는 바꿀 수 없어요' | 수정 시 읽기 전용 |
| 원료명* | 오류 '원료명을 입력해 주세요' | — |
| 원료 종류 | 선택 | 기본 철광석, 수정 시 막힘 |
| 기본 공급업체 | 선택 | 지정 안 함 |
| 야드 | 원료 야드만, '지정 안 함' | 지정 안 함 |

- 등록 시 도움말: '만들면 품목과 재고(0 t)가 함께 생겨요'
- 등록 POST `/raw-materials`, 수정 PATCH `/raw-materials/:id`

#### 고객사·공급업체·야드 (`PartyYardTab.tsx`)

- 하위 버튼(주소 `?sub=`): 고객사 / 공급업체 / 야드
- 카드 머리: '{대상}' + 건수 + '삭제 대신 사용 안 함으로 바꿔요 · 쓰이지 않는 것만 삭제돼요'
  - 검색 '코드·이름', 사용 여부, '{대상} 추가'
- 열: {대상} 코드 | {대상}명 | (야드만) 야드 종류 | 수정일 | 사용 | (수정·삭제)
- 바닥 안내(`:27-31`, `:120`)
  - 고객사: '수주·출하요청·밀시트가 쓰는 고객사는 삭제할 수 없어요'
  - 공급업체: '품목·발주·LOT가 쓰는 공급업체는 삭제할 수 없어요'
  - 야드: '원료·규격·LOT·입고가 쓰는 야드는 삭제할 수 없어요' + ' · 야드 종류는 등록 뒤 바꿀 수 없어요 · 야드 안의 위치는 관리하지 않아요'
  - 공통 꼬리말: ' · 그럴 땐 서버가 알려 주는 대로 사용 안 함으로 바꿔 주세요'
- 추가·수정 창
  - 코드*: 대문자, 최대 30, 규칙 `^[A-Z0-9][A-Z0-9_-]{0,29}$`, 오류 '영문 대문자·숫자·밑줄·하이픈으로 30자 이내 (예: CUS-01)', 수정 시 읽기 전용
  - 이름*: 최대 50
  - (야드만) '야드 종류': 원료 야드 / 슬래브 야드 / 코일 야드, 기본 원료 야드, 수정 시 막힘
- API: GET/POST/PATCH/DELETE `/customers`, `/suppliers`, `/yards`

#### 검사 항목 (`InspectionTab.tsx`)

**머리**
- '검사 항목' + 건수 + '성분(화학성분) 검사는 강종·성분 탭의 성분 규격을 써요'
- 공정 버튼: '연주 (슬래브)'(CASTING) / '열연 (코일)'(HOT_ROLLING)
- '강종 전체' + 강종 코드
- 버튼 '항목 추가'

**표**
- 열: 적용 강종 | 항목 코드 | 항목명 | 단위 | 최소 | 최대 | 필수 | 순서 | (수정·삭제)
  - 적용 강종이 없으면 '공통' 태그
  - 필수 칸: '필수' / '선택'
- 삭제: DELETE `/inspection-items/:id`
- 바닥: '강종을 고르면 그 강종 전용 항목과 공통 항목을 함께 보여줘요 · 최소·최대는 경계값을 포함해요 · 지워도 이미 판정한 검사 결과는 그대로예요'(`:66`)

**'검사 항목 추가' / '검사 항목 수정 · 코드' 창**

| 입력 | 형식·검증 | 기본값·잠금 |
|---|---|---|
| 공정 | 표시만 | 수정 시 '공정·강종·항목 코드는 바꿀 수 없어요' |
| 적용 강종 | '공통 (모든 강종)' + 사용 중 강종 | 기본은 현재 필터 강종. 수정 시 막힘 |
| 항목 코드* | 'TENSILE_STRENGTH', 규칙 `^[A-Z][A-Z0-9_]{0,49}$` | 수정 시 읽기 전용 |
| 항목명* | '인장강도' | — |
| 단위 | 자유 입력 'MPa' | — |
| 최소값·최대값 | 소수 4자리까지. 하나는 필수. 최소 ≤ 최대 | — |
| 순서 | 0 이상 정수 | 0 |
| 필수 검사 항목 | 체크 | 체크됨 |

- 등록 POST, 수정 PATCH
- **검사 기준 코드·버전, 적용 두께 구간 입력은 없습니다.**

#### 생산 설정 (`SettingsTab.tsx`)

- 카드 '생산 설정' + '마지막 저장 날짜·시각'
- 히트 용량
  - 숫자(소수 3자리까지), 단위 't'
  - 도움말 '전로 1히트의 용량이에요 · 히트당 매수 계산에 써요 (초기 250 t)'
  - 오류 '0보다 큰 숫자로 입력해 주세요 (소수 3자리까지)'
- 납기 위험 기준일
  - 0 이상 정수, 단위 '일'
  - 도움말 '납기까지 남은 일수가 이 값 이하이고 출하가 덜 됐으면 납기 위험이에요 (초기 3일)'
  - 오류 '0 이상의 정수로 입력해 주세요'
- 바닥: '저장하지 않은 변경이 있어요' + '되돌리기' + '저장'
- 저장: PUT `/production-settings`, 알림 '생산 설정을 저장했어요'

### A-6. 상태 배지와 표시 글자 (코드 → 한글)

| 대상 | 값 → 표시 (색) | 위치 |
|---|---|---|
| 사원 상태 EMPLOYEE_STATUS | ACTIVE '사용'(초록)<br>INACTIVE '사용 중지'(회색)<br>LOCKED '잠김'(빨강) | `shared/codes/index.ts:61`, `organizationHooks.ts:20-21` |
| 부서장 | '부서장'(파랑), '부서장 {이름}'<br>'부서장 없음'(주황 배지 또는 빨간 글자) | 사용자 화면, 부서 계층, 조직도 |
| 본인 표시 | '나' | `EmployeePage.tsx:174` |
| 권한 수준 | USE '사용' / VIEW '조회' / (없음) '없음' | `PermissionMatrixTab.tsx:13` |
| 권한 변경 표시 | '변경 N', '변경 N · 저장 전', '변경 없음' | `OrganizationPage.tsx:50`, `PermissionMatrixTab.tsx:178,188` |
| 기준정보 사용 여부(isActive) | '사용'(초록) / '사용 안 함' | `common.tsx:55` |
| 규격·매핑이 쓰였는지(isUsed) | '사용됨'(파랑) / '미사용' | `ProductSpecTab.tsx:71`, `SpecMappingTab.tsx:53` |
| 기타 경고 글자 | '매핑 없음', 원료 공급업체 '없음'(빨강) | `ProductSpecTab.tsx:68`, `ItemMaterialTab.tsx:114` |
| 검사 항목 | '필수'(초록) / '선택', '공통' | `InspectionTab.tsx:44,50` |
| 준비 상태 | 완료(초록) / 덜 됨 N건(빨강) / 확인 실패(주황) | `ReadinessBanner.tsx` |

---

## B. API 목록 (나중에 가짜 데이터 계층을 만들 때 참고)

### B-0. 공통 규칙
- 모든 경로 앞에 `/api/v1`이 붙습니다(`api/client.ts:15`).
- 응답 모양
  - 성공 `{success:true, data}`
  - 실패 `{success:false, error:{code, message}}`(`shared/api.ts:2-4`)
- 실패 처리
  - 실패는 `ApiError(code, message, status)`로 바뀝니다.
  - 403이면 잠금 화면을 보여 줍니다.
  - 토큰이 있는데 401이면 세션을 지웁니다.
- 요청 형식
  - 쿼리 값이 없거나 비어 있으면 빼고 보냅니다.
  - 본문이 없는 POST/PUT/PATCH는 `{}`를 보냅니다.
  - 인증 헤더는 `Authorization: Bearer {accessToken}`입니다.
- 소수 값 형식
  - 응답에서는 문자열입니다: 두께·폭·길이·이론중량·수율·원단위·원료 재고 톤·min/max·히트 용량.
  - 요청에서는 JSON 숫자로 보냅니다(`api/masterData.ts:1`).

### B-1. 인증 (`api/auth.ts`)

| 함수 | 메서드·경로 | 요청 | 응답 | 쓰는 곳 |
|---|---|---|---|---|
| `authApi.login` | POST `/auth/login` | `{employeeNo, password}` | `{accessToken, user: AuthUser}` | `LoginPage.tsx:38` |
| `authApi.me` | GET `/auth/me` | — | `AuthUser` | `PermissionMatrixTab.tsx:57`, `App.tsx:56` |
| `authApi.logout` | POST `/auth/logout` | `{}` | `{loggedOut}` | `Shell.tsx:183` |

- `AuthUser` = `{employeeId, employeeNo, employeeName, roleCode, departmentId, departmentName, jobGrade, headDepartmentIds: number[], permissions: Record<권한코드, 'USE'|'VIEW'>}`(`shared/api.ts:7-19`)
- 세션은 sessionStorage의 `'fantasteel.session'`에 저장합니다.

### B-2. 조직 (`api/organization.ts`)

| 함수 | 메서드·경로 | 요청 | 응답 | 쓰는 곳 |
|---|---|---|---|---|
| `employeeApi.list` | GET `/employees` | 쿼리 `departmentId`, `roleCode`, `employeeStatus`, `keyword` | `EmployeeView[]` | `EmployeePage.tsx:41-42` |
| `employeeApi.directory` | GET `/employees/directory` | — | `EmployeeDirectoryEntry[]` (사용 중 사원만) | `OrganizationPage.tsx:26` → 부서장 후보 |
| `employeeApi.create` | POST `/employees` | `{employeeNo, employeeName, departmentId, roleId, jobGrade, email?, initialPassword}` | `EmployeeView` | `EmployeeDrawer.tsx:50,71` |
| `employeeApi.update` | PATCH `/employees/:id` | `{employeeName?, departmentId?, roleId?, jobGrade?, email?: string\|null, employeeStatus?: 'ACTIVE'\|'INACTIVE'}` | `EmployeeView` | `EmployeeDrawer.tsx:51,88`, `EmployeePage.tsx:159,210` |
| `employeeApi.unlock` | POST `/employees/:id/unlock` | `{}` | `EmployeeView` | `EmployeePage.tsx:158,195` |
| `employeeApi.resetPassword` | POST `/employees/:id/reset-password` | `{newPassword}` | `EmployeeView` | `EmployeePage.tsx:264,269` |
| `departmentApi.list` | GET `/departments` | — | `DepartmentView[]` | `EmployeePage.tsx:43,155`, `OrganizationPage.tsx:25` |
| `departmentApi.tree` | GET `/departments/tree` | — | `OrgChartNode[]` | `OrganizationPage.tsx:27` |
| `departmentApi.create` | POST `/departments` | `{departmentCode, departmentName, parentId?, headEmployeeId?, sortOrder?}` | `DepartmentView` | `DepartmentTab.tsx:186,197` |
| `departmentApi.update` | PATCH `/departments/:id` | `{departmentName?, parentId?, headEmployeeId?, sortOrder?}` | `DepartmentView` | `DepartmentTab.tsx:115,133` |
| `roleApi.list` | GET `/roles` | — | `RoleView[]` | `EmployeePage.tsx:44`, `OrganizationPage.tsx:28` |
| `roleApi.replacePermissions` | PUT `/roles/:id/permissions` | `{permissions: [{permissionCode, permissionLevel}]}` | `RoleView` | `PermissionMatrixTab.tsx:51,68` |

**응답 필드**
- `EmployeeView`(`:8-25`): `{id, employeeNo, employeeName, email|null, departmentId, departmentName, roleId, roleCode, roleName, jobGrade(문자열), employeeStatus 'ACTIVE'|'INACTIVE'|'LOCKED', failedLoginCount, lastLoginAt|null, isDepartmentHead, createdAt, updatedAt}`
- `EmployeeDirectoryEntry`(`:28-37`): `{id, employeeNo, employeeName, departmentId, departmentName, jobGrade, roleCode, isDepartmentHead}`
- `DepartmentView`(`:39-50`): `{id, departmentCode, departmentName, parentId|null, headEmployeeId|null, headEmployeeName|null, sortOrder, memberCount, createdAt, updatedAt}`
- `OrgChartNode`(`:52-68`): `{id, departmentCode, departmentName, sortOrder, head: {id, employeeName, jobGrade}|null, members: [{id, employeeName, jobGrade, roleCode, isHead}], children: OrgChartNode[]}`
- `RoleView`(`:70-71`): `{id, roleCode, roleName, permissions: [{permissionCode, permissionLevel: 'USE'|'VIEW'}]}`

### B-3. 기준정보 (`api/masterData.ts`)

| 함수 | 메서드·경로 | 요청 | 응답 | 쓰는 곳 |
|---|---|---|---|---|
| `validation` | GET `/master-data/validation` | — | `ValidationResult` | `MasterDataPage.tsx:38`, `ReadinessBanner.tsx:23` |
| `items.list` | GET `/items` | 쿼리 `active`, `q`, `itemType` | `ItemView[]` | `ItemMaterialTab.tsx:25` |
| `items.update` | PATCH `/items/:id` | `{itemName?, defaultSupplierId?, isActive?}` | `ItemView` | `ItemMaterialTab.tsx:27,65` |
| `items.create` | POST `/items` | `{itemCode, itemName, itemType, unitType?, defaultSupplierId?}` | `ItemView` | **어디서도 안 씀** |
| `rawMaterials.list` | GET `/raw-materials` | 쿼리 `active`, `q`, `rawMaterialType` | `RawMaterialView[]` | `ItemMaterialTab.tsx:90`, `ConsumptionTab.tsx:14` |
| `rawMaterials.create` | POST `/raw-materials` | `{materialCode, itemName, rawMaterialType, yardId?, defaultSupplierId?}` | `RawMaterialView` | `ItemMaterialTab.tsx:144,154` |
| `rawMaterials.update` | PATCH `/raw-materials/:id` | `{itemName?, yardId?, defaultSupplierId?, isActive?}` | `RawMaterialView` | `ItemMaterialTab.tsx:91,145,153` |
| `steelGrades.list` | GET `/steel-grades` | 쿼리 `active`, `q` | `SteelGradeView[]` | 강종 쓰는 탭 5곳 |
| `steelGrades.create` | POST `/steel-grades` | `{steelGradeCode, steelGradeName, standardNo?, compositionSpecs?: [{elementCode, minValue?, maxValue?, sortOrder?}]}` | `SteelGradeView` | `SteelGradeTab.tsx:186,193` |
| `steelGrades.update` | PATCH `/steel-grades/:id` | `{steelGradeName?, standardNo?, isActive?}` | `SteelGradeView` | `SteelGradeTab.tsx:125,140,153` |
| `steelGrades.remove` | DELETE `/steel-grades/:id` | — | `{id, deleted: true}` | `SteelGradeTab.tsx:127,141` |
| `steelGrades.replaceComposition` | PUT `/steel-grades/:id/composition-specs` | `{compositionSpecs: [...]}` | `SteelGradeView` | `SteelGradeTab.tsx:126,167` |
| `productSpecs.list` | GET `/product-specs` | 쿼리 `itemType`, `steelGradeId`, `active`, `q` | `ProductSpecView[]` | `ProductSpecTab.tsx:20`, `SpecMappingTab.tsx:81` |
| `productSpecs.create` | POST `/product-specs` | `{itemType, steelGradeId, thicknessMm, widthMm, lengthMm, yardId?}` | `ProductSpecView` | `ProductSpecTab.tsx:142` |
| `productSpecs.update` | PATCH `/product-specs/:id` | `{steelGradeId?, thicknessMm?, widthMm?, lengthMm?, yardId?}` | `ProductSpecView` | `ProductSpecTab.tsx:139` |
| `productSpecs.activate` / `deactivate` | POST `/product-specs/:id/activate` · `/deactivate` | `{}` | `ProductSpecView` | `ProductSpecTab.tsx:21` |
| `specMappings.list` | GET `/spec-mappings` | 쿼리 `steelGradeId`(화면에서는 안 보냄) | `SpecMappingView[]` | `SpecMappingTab.tsx:12` |
| `specMappings.create` | POST `/spec-mappings` | `{slabSpecId, coilSpecId}` | `SpecMappingView` | `SpecMappingTab.tsx:86,101` |
| `specMappings.remove` | DELETE `/spec-mappings/:id` | — | `{id, deleted}` | `SpecMappingTab.tsx:14,60` |
| `routings.list` | GET `/routings` | — | `RoutingView[]` | `RoutingTab.tsx:12` |
| `routings.save` | PUT `/routings/:itemType` (SLAB 또는 COIL) | `{processes: [{processCode, plannedYieldRate?: number\|null}]}` — 규격 매핑에서 계산하는 공정은 `plannedYieldRate`를 빼고 보냄 | `RoutingView` | `RoutingTab.tsx:46-52` |
| `consumptions.list` | GET `/specific-consumptions` | 쿼리 `rawMaterialId`, `steelGradeId`(화면에서는 안 보냄) | `SpecificConsumptionView[]` | `ConsumptionTab.tsx:13` |
| `consumptions.upsert` | PUT `/specific-consumptions` | `{rawMaterialId, steelGradeId?: number\|null, consumptionRate}` | `SpecificConsumptionView` | `ConsumptionTab.tsx:53` |
| `consumptions.remove` | DELETE `/specific-consumptions/:id` | — | `{id, deleted}` | `ConsumptionTab.tsx:51` |
| `customers.*` | GET `/customers` (쿼리 `active`, `q`)<br>POST `{customerCode, customerName}`<br>PATCH `/:id` `{customerName?, isActive?}`<br>DELETE `/:id` | — | `CustomerView` | `PartyYardTab.tsx:36,75,77,136` |
| `suppliers.*` | `/suppliers`에 같은 모양(`supplierCode`, `supplierName`) | — | `SupplierView` | `PartyYardTab.tsx`, `ItemMaterialTab.tsx:61,135` |
| `yards.*` | GET `/yards` (쿼리 `active`, `q`, `yardType`)<br>POST `{yardCode, yardName, yardType}`<br>PATCH `{yardName?, isActive?}`<br>DELETE | — | `YardView` | `PartyYardTab.tsx`, `ItemMaterialTab.tsx:136`, `ProductSpecTab.tsx:94` |
| `productionSettings.get` / `save` | GET · PUT `/production-settings` | 저장 시 `{heatCapacityTon, deliveryRiskDays}` | `ProductionSettingView` | `SettingsTab.tsx:10,23,36` |
| `inspectionItems.list` | GET `/inspection-items` | 쿼리 `processCode`, `steelGradeId` | `InspectionItemView[]` | `InspectionTab.tsx:19` |
| `inspectionItems.create` | POST `/inspection-items` | `{processCode, steelGradeId?, inspectionItemCode, inspectionItemName, unit?, minValue?, maxValue?, isRequired?, sortOrder?}` | `InspectionItemView` | `InspectionTab.tsx:85,107` |
| `inspectionItems.update` | PATCH `/inspection-items/:id` | `{inspectionItemName?, unit?, minValue?, maxValue?, isRequired?, sortOrder?}` | `InspectionItemView` | `InspectionTab.tsx:86,106` |
| `inspectionItems.remove` | DELETE `/inspection-items/:id` | — | `{id, deleted}` | `InspectionTab.tsx:20,55` |

**응답 필드** (줄 번호는 `api/masterData.ts`)
- `ValidationResult`(`:11-13`): `{ready, checkedAt, problemCount, problems: [{code: 'MST-001', area, targetId|null, targetNo|null, message}]}`
  - `area`는 PRODUCT_SPEC, SPEC_MAPPING, ROUTING, SPECIFIC_CONSUMPTION, RAW_MATERIAL, STEEL_GRADE, INSPECTION_ITEM, PRODUCTION_SETTING 중 하나
- `ItemView`(`:16-23`): `{id, itemCode, itemName, itemType, itemTypeName, unitType 'QTY'|'TON', defaultSupplierId|null, defaultSupplierName|null, rawMaterialId|null, isActive, createdAt, updatedAt}`
- `RawMaterialView`(`:28-36`): `{id, itemId, itemCode, itemName, materialCode, rawMaterialType, rawMaterialTypeName, unitType 'TON', yardId|null, yardName|null, defaultSupplierId|null, defaultSupplierName|null, onHandTon, isActive, createdAt, updatedAt}`
- `SteelGradeView`(`:42-46`): `{id, steelGradeCode, steelGradeName, standardNo|null, isActive, compositionSpecs: [{id, elementCode, minValue|null, maxValue|null, sortOrder}], createdAt, updatedAt}`
- `ProductSpecView`(`:52-67`): `{id, specCode, itemId, itemType, itemTypeName, itemName, steelGradeId, steelGradeCode, thicknessMm, widthMm, lengthMm, theoreticalWeightTon, yardId|null, yardName|null, isActive, isUsed, mappingId|null, mappedSpec: {id, specCode, itemType, thicknessMm, widthMm, lengthMm, theoreticalWeightTon, isActive}|null, hotRollingPlannedYieldRate|null, createdAt, updatedAt}`
- `SpecMappingView`(`:73-81`): `{id, steelGradeId, steelGradeCode, slabSpec, coilSpec, hotRollingPlannedYieldRate, isUsed, createdAt, updatedAt}`
  - `slabSpec`·`coilSpec` = `{id, specCode, steelGradeId, steelGradeCode, thicknessMm, widthMm, lengthMm, theoreticalWeightTon, isActive}`
- `RoutingView`(`:84-88`): `{itemType, processes: [{id, processCode, processName, processSeq, plannedYieldRate|null, yieldSource 'INPUT'|'MAPPING'}]}`
- `SpecificConsumptionView`(`:91-96`): `{id, rawMaterialId, materialCode, rawMaterialName, rawMaterialType, rawMaterialTypeName, steelGradeId|null, steelGradeCode|null, consumptionRate, consumptionUnit 'TON_PER_TON'|'KG_PER_TON', consumptionUnitName, updatedAt}`
- `CustomerView` / `SupplierView` / `YardView`(`:100-102`): `{id, …Code, …Name, (yardType), isActive, createdAt, updatedAt}`
- `ProductionSettingView`(`:106`): `{heatCapacityTon, deliveryRiskDays, updatedAt}`
- `InspectionItemView`(`:111-116`): `{id, processCode 'CASTING'|'HOT_ROLLING', processName, steelGradeId|null, steelGradeCode|null, inspectionItemCode, inspectionItemName, unit|null, minValue|null, maxValue|null, isRequired, sortOrder, updatedAt}`

### B-4. 조회 키와 저장 후 다시 불러오는 범위

**조회 키**
- 사원 쪽: `['employees','list',q]`, `['employees','directory']`, `['employees','roles']` — 역할 목록도 'employees' 아래에 있습니다(`organizationHooks.ts:7-17`).
- 부서 쪽: `['departments','list']`, `['departments','tree']`
- 기준정보: `['master-data', 영역, q]`(`masterHooks.ts:8-23`)

**저장 후 다시 불러오는 범위**

| 저장한 것 | 다시 불러오는 묶음 |
|---|---|
| 사원 등록·수정 | employees, departments |
| 잠금 해제, 비밀번호 재설정 | employees |
| 부서 | departments, employees |
| 역할 권한 | employees |
| 기준정보 아무거나 | master-data 전체 |

**화면별로 처음 필요한 API**
- 사용자 화면: GET `/employees` 두 번(필터 없이 1번, 필터 넣고 1번), `/departments`, `/roles`
- 부서·권한 화면: GET `/departments`, `/employees/directory`, `/departments/tree`, `/roles` (탭과 관계없이 모두)
- 기준정보 화면: GET `/master-data/validation` + 탭마다 위 목록 API

---

## C. 문서와 비교

### C-1. 요구사항 충족도

| 요구사항 | 판정 | 근거 |
|---|---|---|
| REQ-AUTH-001 로그인·로그아웃 | 부분 | 사원번호·비밀번호 입력란이 없습니다(5b403cd에서 제거). 계정 버튼 + 고정 비밀번호를 씁니다(`LoginPage.tsx:11-21,38`).<br>JWT는 POST `/auth/login`으로 그대로 발급받습니다.<br>로그아웃은 셸 사용자 메뉴에 있습니다(`Shell.tsx:182-188`). |
| REQ-AUTH-002 사원·부서·직급 관리 | 부분 | 사원·부서 등록·수정은 있습니다.<br>**직급은 사원 입력 화면의 자유 글자뿐**입니다(`EmployeeDrawer.tsx:153-157`).<br>용어 TRM-036은 직급을 엔티티(`job_grade`)로 보고 '관리자가 등록·수정, 표시 순서 보유'라고 합니다. 컨벤션 7-4 시드에도 직급이 있습니다.<br>클라이언트 어디에도 직급 API가 없습니다. |
| REQ-AUTH-003 역할별 접근 권한 | 부분 | 6개 역할, 사용·조회 권한 행렬 편집이 됩니다.<br>메뉴는 조회 권한 이상(`nav.ts:62-64`), 버튼은 사용 권한(`stores/auth.ts:47-54`)으로 막습니다.<br>권한 코드가 다르고 1개가 없습니다(C-3).<br>로그인 화면이 부서장을 역할처럼 보여 줍니다. |
| REQ-AUTH-004 승인 권한 | 충족 (화면에 보이는 범위) | 행렬에 승인 권한이 없다는 안내(`PermissionMatrixTab.tsx:201`), 부서장 배지와 문구가 있습니다. |
| REQ-ORG-001 부서 계층 | 충족 | 상위 부서 지정, 트리 표시, 자기 자신·하위 부서를 상위로 못 고르게 막음(`DepartmentTab.tsx:30-42,114`, `organizationHooks.ts:44-52`) |
| REQ-ORG-002 부서장 지정 | 충족 | 부서마다 한 명만 고르는 선택칸(`DepartmentTab.tsx:12-28`) |
| REQ-ORG-003 조직도 | 충족 (+추가 표시) | 이름·직급·부서장 여부에 역할까지 보여 줍니다.<br>순서는 직급 표시 순서가 아니라 사원번호순입니다(`OrgChartTab.tsx:61`). |
| REQ-ORG-004 조직 정보 활용 | 이 화면 범위 밖 | 안내 띠만 있습니다. |
| REQ-MST-001 품목 | 부분 | 단위 유형, 기본 공급업체, 원료 유형은 있습니다.<br>**원료 코드 규칙이 문서와 다릅니다**(1~10자, 예시 'IO')(`ItemMaterialTab.tsx:11,146,163`).<br>'품목 코드 = 원료 코드·규격 코드'인지는 클라이언트로 확인할 수 없습니다(별도 열 `:35`, `:106`).<br>`items.create`는 안 씁니다. |
| REQ-MST-002 강종·성분 | 부분 | 강종 관리와 적용 규격 번호는 있습니다.<br>**성분을 바꿔도 새 버전을 만들지 않고 목록 전체를 바꿉니다**(`SteelGradeTab.tsx:126,158,167`).<br>성분 규격이 제강 검사 기준 항목이 아니라 강종 화면에 따로 있습니다(TRM-020: '별도 테이블 없음, 제강 검사 기준 항목'). |
| REQ-MST-003 제품 규격 | 대부분 충족 | 강종×두께×폭×길이, 이론중량 소수 3자리, 쓰인 규격의 강종·치수 잠금이 됩니다.<br>**같은 조합 중복은 화면에서 미리 막지 않고 서버에 맡깁니다.**<br>규격 코드 형식은 서버가 만들어서 화면으로 확인할 수 없습니다. |
| REQ-MST-004 규격 매핑 | 충족 | 1:1, 같은 강종, 코일 ≤ 슬래브, 수율 계산(`SpecMappingTab.tsx:88-96,110,142`) |
| REQ-MST-005 라우팅 | 부분 | 공정별 수율 입력, 열연은 매핑에서 계산합니다.<br>**공정 순서를 추가·삭제·변경하는 화면이 없습니다.** |
| REQ-MST-006 배합 원단위 | 충족 | 공통 t/t, 합금철 강종별 kg/t |
| REQ-MST-007 고객사·공급업체 | 충족 | 관리 화면과 기본 공급업체 1곳 지정이 있습니다. |
| REQ-MST-008 야드 | 부분 | 3가지 야드 유형, 위치 미관리 안내가 있습니다.<br>기본 야드는 원료·규격에만 있고 선택 사항입니다. 라벨은 '야드'이고 품목 표에는 없습니다. |
| REQ-MST-009 생산 설정값 | 충족 | 히트 용량, 납기 위험 기준일 |
| REQ-QC-002 검사 기준 | 부분 (핵심이 빠짐) | 연주·열연 항목과 min/max, 강종별·공통 지정은 됩니다.<br>빠진 것:<br>· 검사 기준·버전 개념(지금은 PATCH 수정, DELETE 삭제)<br>· 적용 두께 구간(초과~이하, 샤르피 충격은 6mm 초과만)<br>· 품질 담당 관리 권한(INSPECTION_STANDARD_MANAGE)<br>· 제강(성분)을 검사 기준으로 관리하는 것 |

**시드 데이터 기대값**

| 기대값 | 판정 | 근거 |
|---|---|---|
| 강종 6종 | 확인 불가 (서버 시드는 안 봄) | 화면에 강종 목록을 박아 두지 않았습니다. 예시만 'SS275', 'KS D 3503'입니다. |
| 시드 강종 4종 × 슬래브 규격 3종 = 슬래브 12·코일 12, 매핑 | 확인 불가 | 화면에 박아 둔 값이 없습니다. |
| 원료 ORE01·COL01·LIM01·SMN01 | 확인 불가 / 규칙 불일치 | 화면 규칙이 ORE01을 받아 주기는 하지만 형식을 강제하지 않습니다. 예시는 'IO'입니다. |
| 규격 코드 SL-·CL- 형식 | 확인 불가 | 서버가 만든다는 안내만 있습니다(`ProductSpecTab.tsx:83,154`).<br>다른 영역 주석에 'SL-SS275-250x1200x10000' 예시가 있습니다(`client/features/shipment/shipmentUi.tsx:63`). |
| 이론중량 소수 3자리 | 충족 (클라이언트) | 반올림해 소수 3자리로 계산합니다(`shared/weight.ts:16-23`). 23.550 예시와 맞습니다. |
| 테스트 계정 | 화면에 박혀 있음 | 로그인 화면에 8명 |
| 직급 시드 | 화면에서 쓸 수 없음 | 직급 목록 화면·API가 없습니다. |
| 부서 계층 시드 | 확인 불가 | 예시 글자 '코크스파트'/'PRD-COKE'(`DepartmentTab.tsx:216,219`)는 문서 예시(생산부 아래 제선·제강·연주·열연 파트)와 다릅니다. |

### C-2. 용어 사전과 다른 화면 글자

| 화면 글자 | 위치 | 문서 기준 |
|---|---|---|
| '사용자' (사원 관리 화면 이름) | `nav.ts:55`, `titles.ts:29`, `EmployeePage.tsx:60`, `OrganizationPage.tsx:41`, `LoginPage.tsx:20,119` | TRM-032 한글명은 '사원'입니다.<br>같은 화면 안에서 '사원 등록', '사원 관리'와 섞여 쓰입니다.<br>참고로 기획안의 관리자 행은 '사용자·부서…'라고 써서 문서끼리도 다릅니다. |
| '부서장' 역할 칩, '구매부장'/'생산부장' | `LoginPage.tsx:18-19,105` | 부서장은 역할이 아닙니다(REQ-AUTH-003, TRM-034·037, 코드표 ROLE).<br>'부장'은 용어 사전에 없는 말입니다. |
| '공정 실적' (권한 이름) | `shared/codes/index.ts:85` → 행렬·권한 요약·권한 미리보기 | 용어 TRM-047에서 '작업 실적'의 사용 금지 동의어입니다.<br>그런데 코드표의 표시명은 '공정 실적(실적 시뮬레이션 포함)'이라 **문서끼리 충돌**합니다. 코드는 둘 다와 다릅니다. |
| '원료 종류', '종류' | `ItemMaterialTab.tsx:95,96,106,127,166`, `ConsumptionTab.tsx:89` | TRM-112와 코드표는 '원료 유형'입니다. |
| '야드 종류' | `PartyYardTab.tsx:96,120,158` | 코드표는 '야드 유형'입니다. |
| 'KS 규격 번호' | `SteelGradeTab.tsx:105,149,201` | TRM-113은 '적용 규격', REQ-MST-002는 '적용 규격 번호'입니다. |
| '야드' (기본 야드라는 뜻으로 씀) | `ItemMaterialTab.tsx:106,178`, `ProductSpecTab.tsx:196-198` | TRM-011·030, REQ-MST-008은 '기본 야드'입니다. |
| 탭 '검사 항목' (검사 기준을 관리하는 화면) | `MasterDataPage.tsx:27`, `ReadinessBanner.tsx:17`, `InspectionTab.tsx:25` | TRM-110 '검사 기준'(버전 묶음)과 TRM-075 '검사 항목'(기준에 속한 항목)이 따로 있는데, 화면에는 '검사 기준' 개념이 아예 없습니다. |
| '생산 설정' | `MasterDataPage.tsx:28`, `SettingsTab.tsx:42` | REQ-MST-009는 '생산 설정값'입니다. |
| '사용 중지' (사원) / '사용 안 함' (기준정보) | `shared/codes/index.ts:61`, `common.tsx:55` | 컨벤션 7-2는 'isActive로 퇴사 처리'라고만 합니다. 화면 안에서도 두 표현이 섞입니다. |
| 'QTY 매수' / 'TON 톤' | `ItemMaterialTab.tsx:10,30` | 코드표 표시명은 '매수' / '톤'입니다. |

- **사용 금지 동의어 검사 결과**: 대상 파일의 화면 글자에서 아래 단어는 하나도 나오지 않았습니다.
  - 팀/팀장, 승인 권한자, 거래처, 공급사/협력사, 원자재, 레시피, '배합' 단독, 검사 기준서
  - 로트, 슬라브, 압연, 성적서, 출하 확정, 할당/선점
  - 가용 재고/가용량, 필요량, '구매 요청'(띄어쓰기), 주문/오더, 챗봇, 감사 로그, 비즈니스 이벤트
  - 예외: '배합'이 단독으로 나오는 곳은 `shared/codes/index.ts:287` 주석 하나뿐이고 화면 글자는 아닙니다.
- **문서와 같은 글자**: 사원번호, 부서, 직급, 역할, 권한, 부서장, 승인권자, 고객사, 공급업체, 기본 공급업체, 원료 코드, 규격 코드, 1매 이론중량, 규격 매핑, 열연 계획 수율, 라우팅, 계획 수율, 배합 원단위, 히트 용량, 납기 위험 기준일, 단위 유형

### C-3. 공통 코드 정의서와 다른 코드

| 코드 그룹 (문서) | 문서 값·표시명 | 코드 (shared / 화면) | 다른 점 · 화면 위치 |
|---|---|---|---|
| ROLE | SALES 영업 / PURCHASE 구매 / PRODUCTION 생산 / QUALITY 품질 / LOGISTICS 물류 / ADMIN 관리자 | `ROLE_CODE`, `ROLE_CODE_LABEL`, `ROLE_CODES` (`index.ts:54-57`) | 값·표시명은 같습니다.<br>**상수 이름이 그룹 이름(ROLE)과 다릅니다.**<br>로그인 화면은 상수를 안 쓰고 한글을 직접 적고, '부서장'을 더 넣었습니다(`LoginPage.tsx:13-20`).<br>화면 위치: 사원 역할 필터·칩, 서랍 역할 카드, 행렬 열 머리, 조직도 |
| PERMISSION | 17개 | 16개 (`index.ts:64-94`) | 아래 표 참고.<br>화면 위치: 행렬 행, 권한 요약, 권한 미리보기, 메뉴 노출 판단(`nav.ts`, 옛 코드 사용) |
| PERMISSION_LEVEL | USE 사용 / VIEW 조회. 권한이 없으면 행을 두지 않음 | 값은 같습니다. | 한글 표시명이 shared에 없고 화면 파일에만 있습니다(`PermissionMatrixTab.tsx:13`, '없음' 포함).<br>같은 타입을 따로 또 정의했습니다(`organization.ts:5`). |
| ITEM_TYPE | RAW_MATERIAL 원료 / SLAB 슬래브 / COIL 코일 | 같습니다 (`index.ts:30-32`). | 화면 일부는 상수 대신 '슬래브'/'코일'을 직접 적었습니다(`ProductSpecTab.tsx:27,164`, `RoutingTab.tsx:9`).<br>같은 타입을 따로 또 정의했습니다(`masterData.ts:6`). |
| UNIT_TYPE | QTY 매수 / TON 톤 | 값은 같지만 한글 표시명 상수가 없습니다. | 화면은 'QTY 매수'/'TON 톤'으로 코드값을 섞어 보여 줍니다(`ItemMaterialTab.tsx:10`).<br>같은 타입을 따로 또 정의했습니다(`masterData.ts:5`). |
| RAW_MATERIAL_TYPE | 철광석 / 석탄 / 석회석 / 합금철 | 같습니다 (`index.ts:36-38`). | 그룹 이름 표시가 '원료 유형' ↔ '원료 종류'로 다릅니다. |
| STEEL_GRADE | SS275, SM355A–D, SPHC (표시명 = 값) | shared 상수 없음 (테이블로 관리) | 값은 일치합니다(API 값을 그대로 보여 줌).<br>문서에 없는 '강종 이름'을 따로 보여 줍니다. |
| YARD_TYPE | 원료 야드 / 슬래브 야드 / 코일 야드 | 같습니다 (`index.ts:44-46`). | 그룹 이름 표시가 '야드 유형' ↔ '야드 종류'로 다릅니다. |
| PROCESS_TYPE | IRONMAKING / STEELMAKING / **CONTINUOUS_CASTING** / HOT_ROLLING | `PROCESS_CODE` 안에 **CASTING** (`index.ts:48-51`) | 상수 이름과 연주 값이 다릅니다. 한글 표시명은 같습니다.<br>라우팅 화면은 코드 원문 'CASTING'을 그대로 보여 줍니다(`RoutingTab.tsx:70`).<br>검사 항목 화면도 CASTING을 씁니다(`InspectionTab.tsx:8-11`, `masterData.ts:110`). |
| EMPLOYEE_STATUS | **문서에 없음.** 컨벤션 7-2는 isActive만 언급 | ACTIVE 사용 / INACTIVE 사용 중지 / LOCKED 잠김 (`index.ts:59-61`) | 문서에 없는 코드 그룹입니다. 사용자 화면 전체와 서랍에 쓰입니다. |
| CONSUMPTION_UNIT | **문서에 없음** | TON_PER_TON 't/t (용선 1t당)', KG_PER_TON 'kg/t (용강 1t당)' (`index.ts:40-42`) | 문서에 없는 코드 그룹입니다(`ConsumptionTab.tsx:86,106`). |

**권한 코드 비교 (문서 → 코드)**

| 영역 | 문서 코드 | 문서 표시명 | 코드 | 차이 |
|---|---|---|---|---|
| 영업 | SALES_ORDER_CREATE | 수주 등록 | ORDER_CREATE | 이름 다름 |
| 영업 | SALES_ORDER_CANCEL | 수주 취소 | ORDER_CANCEL | 이름 다름 |
| 영업 | SHIPMENT_REQUEST_MANAGE | 출하요청·배정 확정 | SHIPMENT_REQUEST | 이름 다름 |
| 구매 | PURCHASE_REQUISITION_CREATE | 구매요청 등록·MRP | 같음 | — |
| 구매 | PURCHASE_ORDER_CONFIRM | 발주 | PO_CONFIRM | 이름 다름 |
| 구매 | GOODS_RECEIPT_CONFIRM | 입고 확정 | RECEIPT_CONFIRM | 이름 다름 |
| 생산 | PRODUCTION_PLAN_CONFIRM | 생산계획·히트 편성 | PLAN_CONFIRM | 이름 다름 |
| 생산 | PRODUCTION_RESULT_CONFIRM | 공정 실적(실적 시뮬레이션 포함) | RESULT_CONFIRM ('공정 실적') | 이름·표시명 다름 |
| 생산 | HOT_ROLLING_ALLOCATE | 열연 투입 배정 | ROLLING_ALLOCATE | 이름 다름 |
| 품질 | INSPECTION_REGISTER | 검사 입력 | 같음 | — |
| 품질 | INSPECTION_STANDARD_MANAGE | 검사 기준 관리 | **없음** | 빠짐 |
| 품질 | DISPOSITION_SET | 불합격 처리 상태 지정 | 같음 | — |
| 물류 | GOODS_ISSUE_CONFIRM | 출고 확정 | 같음 | — |
| 물류 | MILL_SHEET_READ | 밀시트 조회·출력 | MILLSHEET_READ | 이름 다름 |
| 관리 | EMPLOYEE_MANAGE | 사원 관리 | 같음 | — |
| 관리 | ORG_MANAGE | 부서·권한 관리 | 같음 | — |
| 관리 | MASTER_MANAGE | 기준정보 관리 | 같음 | — |

- shared 주석은 "업무 프로세스 정의서 2장 제안"을 따른다고 적혀 있습니다(`index.ts:63`). 하지만 프로세스 문서 2장도 이미 새 이름(SALES_ORDER_CREATE 등)을 쓰고, 변경 이력에 '권한 코드 이름 변경'이 있습니다(process.md:1526).
- **역할별 기본 권한을 프로세스 2장 '시스템 권한 제안'과 비교**
  - 코드에만 있는 사용 권한
    - 영업: 밀시트 조회·출력 USE
    - 생산: 구매요청 등록 USE
    - 품질: 밀시트 조회·출력 USE
  - 빠진 권한: 품질의 INSPECTION_STANDARD_MANAGE
  - 코드표가 가리키는 기본값 페이지는 링크된 별도 노션 페이지라 열지 않았습니다.

### C-4. 문서에 없는데 화면에 있는 것

1. **준비 상태 띠 전체**: 검증 API, 영역 칩, '기준정보 준비 완료', 화면 전체 잠금 판단.
   - 문서에는 BP-MST-01의 "누락을 표시한다"(구현 제안)와 MST-001 오류 코드만 있습니다.
2. **계정 잠김 관련 전부**: 사원 상태 '잠김', 로그인 실패 횟수, 최근 접속, 잠금 해제 API, '잠김' 필터, 잠긴 사원을 먼저 선택, 요약의 '잠김 N'.
   - 문서는 '비활성 계정 차단'만 말하고, 실패 횟수 제한은 미결정(BP-AUTH-01 예외 → 16장)입니다.
3. **비밀번호 재설정 창과 API, 초기 비밀번호 입력란**. REQ-AUTH-002는 등록·수정만 말합니다.
4. **사원 이메일**. TRM-032에 없습니다.
5. **문서에 없는 사원 보호 규칙**
   - 내 역할 변경 금지, 나를 사용 중지 금지
   - 부서장은 사용 중지 금지
   - 관리자 역할은 사원 관리·부서·권한 관리 사용 권한을 반드시 유지
6. **부서 코드(필수, 형식 규칙)와 부서 정렬 순서**. TRM-033에 없습니다.
7. **부서장 지정 범위**: 다른 부서 사원도 부서장이 될 수 있고, 한 사람이 여러 부서 부서장이 될 수 있습니다. 문서는 언급이 없습니다.
8. **"부서장이 직접 올린 요청은 상위 부서장이 승인"**(`DepartmentTab.tsx:57`). 문서에서는 아직 미결정(BP-AUTH-01, 16장 제안)인데 화면은 정해진 규칙처럼 적었습니다.
9. **'바꾸면 작업 로그에 남아요'(부서장 변경)**. 문서의 LOG-002와 BUSINESS_EVENT_TYPE에는 부서장·기준정보 변경 이벤트가 없습니다. 코드에만 MASTER_CHANGED가 있습니다(`index.ts:251`).
10. **조직도의 추가 표시**: 역할, '다른 부서 소속' 부서장.
11. **권한 행렬 칸의 동작**: '없음'까지 순환, '기본값과 다름' 표시(기본값은 클라이언트 상수 `index.ts:99-110`).
12. **강종 이름, 강종 사용 토글**.
13. **기준정보 사용/사용 안 함 토글**: 품목·원료·강종·규격·고객사·공급업체·야드. 컨벤션 7-2는 기준정보를 "참조가 없을 때만 삭제"라고만 합니다.
14. **규격 사용·사용 중지 API**와 '사용 중지한 규격은 수주 등록 선택 목록에서 빠져요'. 반대로 규격 삭제 기능은 없습니다.
15. **문서에 없는 숫자 제한**
    - 치수: 2,000 / 5,000 / 5,000,000 mm 이하, 소수 2자리
    - 성분: 0~100%, 소수 4자리
    - 검사 min/max: 소수 4자리
    - 히트 용량: 소수 3자리
16. **검사 항목 부가 속성**: '공통 (모든 강종)', 필수, 순서, 자유 입력 단위, 항목 코드 형식.
17. **라우팅**: 제선 수율을 비워 둘 수 있음, 입력/매핑 계산 구분 필드.
18. **원료 '재고' 열**과 '만들면 품목과 재고(0 t)가 함께 생겨요'.
19. **고객사·공급업체·야드의 '수정일' 열**.
20. **화면 부제에 요구사항 ID 노출**: '(MST-003)' 등.
21. **로그인 화면 내용**: 계정 선택, 시연 계정 8명, 고정 비밀번호, '경영지원부 이관리', 'FANTASTEEL' 이름(기획안은 정식 명칭 미정).

### C-5. 업무 규칙과 다른 점

| 규칙 (문서) | 화면 | 판정 |
|---|---|---|
| 사원번호·비밀번호 로그인 (BP-AUTH-01, REQ-AUTH-001, 컨벤션 6장) | 계정 버튼 + 고정 비밀번호 | 불일치 |
| 로그아웃하면 세션 종료 | 셸 로그아웃 | 일치 |
| 사원 한 명에 역할 하나 (TRM-037) | 역할 카드에서 하나만 선택 | 일치 |
| 부서장은 역할이 아님 | 행렬·서랍은 맞음. 로그인 화면만 '부서장' 칩 | 부분 |
| 부서 계층 순환 금지 | 자기 자신·하위 부서를 상위로 못 고름 | 일치 (클라이언트에서) |
| 부서장 1명 | 한 명만 선택 | 일치 |
| 부서장 자기 요청·부재 시 처리 (미결정) | 상위 부서장 승인, 제출 불가로 정해진 것처럼 안내 | 불일치 |
| 같은 강종·두께·폭·길이 조합 중복 금지 | 화면에서 미리 막지 않음. 서버 오류만 보여 줌 | 부분 |
| 쓰인 규격의 치수·이론중량 수정 불가 (MST-002) | 강종·치수 잠금, 저장된 이론중량 표시 | 일치<br>단, '쓰였다'의 범위 문구가 다릅니다: 규격 화면은 '수주·예약·생산계획·LOT·재고', 매핑 화면은 '수주·재고·LOT', 문서는 '수주·재고'(REQ-MST-003) 또는 '수주·재고·LOT'(프로세스 4.1) |
| 아직 안 쓰인 규격은 수정 허용 | 허용 | 일치 |
| 코일 중량 ≤ 슬래브 중량 | 매핑 창에서 막음 | 일치 |
| 열연 수율은 매핑에서 계산하고 입력하지 않음 | 라우팅에 입력칸 없고 링크만 | 일치 |
| 수율 0 이하·1 초과는 표시 | 입력할 때 0 초과 1 이하만 허용. 제선은 비워도 됨 | 일치 (입력을 막는 방식) |
| 대응 코일 중복 표시 | 아직 매핑 안 된 규격만 고를 수 있음 | 일치 |
| 기본 공급업체 누락 표시 | 원료는 빨간 '없음' + 준비 상태 점검. 하지만 슬래브·코일 품목에도 공급업체를 지정할 수 있음(`ItemMaterialTab.tsx:45,75-81`) | 부분<br>(TRM-029: 공급업체 = 원료를 납품하는 회사) |
| 품목별 기본 야드 1곳 | 원료·규격에만 있고 선택 사항, 누락 표시 없음 | 부분 |
| 검사 기준은 새 버전으로 추가 (REQ-QC-002, TRM-110, 컨벤션 7-2 [강제]) | 그 자리에서 수정·삭제. 성분은 목록 전체 교체 | 불일치 |
| 검사 기준은 품질 담당이 관리 | 기준정보 관리 권한(관리자) 필요 | 불일치 |
| 검사 항목 적용 두께 구간(초과~이하) | 입력칸 없음 | 누락 |
| 라우팅 공정 순서 관리 | 순서는 보여 주기만 함 | 부분 |
| 원료 재고 = 원료 LOT 잔량 합계, 재고 행 없음 (TRM-054) | '재고(0 t)가 함께 생겨요' | 문구 불일치 |
| 히트 용량 = 용강 기준, 히트 수 계산에 사용 | '전로 1히트의 용량·히트당 매수 계산에 써요' | 표현 차이 |
| 사원 퇴사 처리 = isActive (컨벤션 7-2) | 사원 상태 3가지 값 | 불일치 |
| 예약은 수주 등록 때 자동(REQ-SO-003·INV-004), 추천 후 확정은 배정만(REQ-INV-006) | 로그인 소개 '예약과 배정은 시스템이 추천하고 담당자가 확정'(`LoginPage.tsx:64,84`) | 문구 불일치 |

### C-6. 코드 컨벤션 위반

1. **스타일 — 9장 [강제] Tailwind**
   - Tailwind를 쓰지 않습니다. 디자인 CSS 클래스를 쓰고, 인라인 `style`이 모두 217곳입니다.
   - 파일별 인라인 style 수

     | 파일 | 수 | 파일 | 수 |
     |---|---|---|---|
     | LoginPage | 27 | ConsumptionTab | 8 |
     | EmployeeDrawer | 23 | InspectionTab | 7 |
     | PermissionMatrixTab | 23 | RoutingTab | 7 |
     | EmployeePage | 19 | ItemMaterialTab | 6 |
     | DepartmentTab | 18 | RolePermissionSummary | 6 |
     | SteelGradeTab | 17 | common | 6 |
     | OrgChartTab | 14 | PartyYardTab | 5 |
     | ProductSpecTab | 10 | SettingsTab | 5 |
     | ReadinessBanner | 9 | SpecMappingTab | 3 |
     | OrganizationPage | 2 | MasterDataPage | 2 |

   - 별도 CSS 파일도 있습니다(`MasterDataPage.css`).
2. **인증 토큰 처리 — 6장·9장 [강제] httpOnly 쿠키, 프론트에서 토큰을 다루지 않음**
   - 토큰을 sessionStorage에 저장합니다(`stores/auth.ts:4-36`).
   - Bearer 헤더로 보냅니다(`api/client.ts:27-29`).
   - `credentials: 'include'`가 없습니다.
   - 파일 주소에는 토큰을 쿼리로 붙입니다(`api/client.ts:66-70`, 이 영역 화면에서는 안 씀).
3. **비밀번호를 클라이언트 코드에 박아 둠** (`LoginPage.tsx:11`)
4. **9장 "api/ 함수 + 커스텀 훅으로만"**
   - 컴포넌트가 훅 없이 API를 직접 부르는 곳: `LoginPage.tsx:38`(`authApi.login`), `PermissionMatrixTab.tsx:57`(`authApi.me`)
   - fetch·axios를 직접 쓰는 곳은 없습니다. fetch는 `api/client.ts:38`에만 있습니다.
5. **9장 "서버 데이터를 전역 스토어에 복사 금지"**
   - 로그인 사원 정보(`AuthUser`)를 zustand 스토어에 두고 갱신합니다(`stores/auth.ts:16-36`, `PermissionMatrixTab.tsx:57`).
6. **4장 공통코드 규칙**
   - 상수 이름이 그룹 이름과 다름: `ROLE_CODE`, `PROCESS_CODE`
   - 문서에 먼저 올리지 않은 코드: `EMPLOYEE_STATUS`, `CONSUMPTION_UNIT`
   - 한글 표시명을 화면 파일에서 또 정의함: `UNIT_LABEL`, `LABEL`, `PROCESSES`, `TITLE`, '슬래브'/'코일', 로그인 역할명
   - 같은 타입을 또 정의함: `UnitType`, `SpecItemType`, `PermissionLevelValue`
7. **5장 "상태 변경은 `POST /:id/동작`"**
   - 사용 여부·사원 상태를 PATCH 본문으로 바꾸는 곳: items, raw-materials, steel-grades, customers, suppliers, yards, employees
   - 반면 product-specs는 POST activate/deactivate를 씁니다. 두 방식이 섞여 있습니다.
8. **2장 이름 규칙**
   - 훅 파일 이름이 `use…`가 아님: `organizationHooks.ts`, `masterHooks.ts`. `usePermissionEdits`는 컴포넌트 파일 안에 있습니다.
   - 컴포넌트 파일 이름이 소문자: `common.tsx`
   - 동사로 시작하지 않는 함수 이름: `roleLabel`, `statusLabel`, `statusTone`, `avatarCls`, `errMsg`, `serverLevel`, `rowsOf`, `newRow`, `cellKey`, `validRate`, `descendantIds`
   - 한 글자 상수 `K`(`masterHooks.ts:8`)
9. **2장 [강제] 용어 사전 변수명**
   - `InspectionItemView`·`inspectionItemCode`가 용어 사전 TRM-075 이름 `inspectionStandardItem`과 다릅니다.
   - `jobGrade`가 문자열이라 `jobGradeId`(엔티티 참조)가 없습니다.
   - `processCode`는 그룹 이름이 PROCESS_TYPE이므로 4장 규칙상 `process_type`이어야 합니다.
   - 용어 사전에 없는 이름: `employeeStatus`, `failedLoginCount`, `lastLoginAt`, `isDepartmentHead`, `consumptionUnit`, `yieldSource`
10. **0·1장 기술 구성**
    - 컨벤션은 Next.js App Router로 확정했는데, 코드는 React + Vite + react-router입니다(`App.tsx:2,72-111`).
    - 화면 파일이 `app/`이 아니라 `pages/`에 있습니다.
11. **문제없는 항목**
    - `console.log`, `any`, `ts-ignore`, `../` 상대 경로 모두 없습니다.
    - 사소한 것: `React.CSSProperties`를 import 없이 씁니다(`common.tsx:35`).
12. **안 쓰는 코드**: `masterApi.items.create`(`masterData.ts:131`), `useCanManage`(`common.tsx:9`)

### 덧붙여 발견한 화면 결함 (사실만)

1. **야드 수정 창의 '야드 종류'가 항상 '원료 야드'로 보입니다.**
   - 선택칸 값이 무조건 RAW_MATERIAL로 시작하고(`PartyYardTab.tsx:131`), 목록 행 데이터에 실제 야드 종류 값이 없습니다(`:19,45`). 선택칸은 막혀 있어서 고칠 수도 없습니다.
2. **제품 규격 화면에서 '사용 여부'가 두 가지 뜻입니다.**
   - 필터(화면 낭독용 이름 '사용 여부')는 사용 중인지(isActive)입니다(`ProductSpecTab.tsx:35`).
   - 표 열 머리 '사용 여부'는 실제로 쓰였는지(isUsed)입니다(`:52,71`).
   - 그리고 '사용' 열이 다시 isActive입니다(`:53`).
3. **부서 편집에서 권한이 없어도 '상위 부서'·'부서장' 선택칸은 조작할 수 있습니다.** 다른 입력칸은 막혀 있습니다(`DepartmentTab.tsx:157,160` 대 `:151,163`).
4. **사원 서랍에서 권한이 없어도 모든 입력칸을 고칠 수 있고, 저장 버튼만 막힙니다**(`EmployeeDrawer.tsx:105-107,202`).
5. **원료가 '품목' 표와 '원료' 표 양쪽에 나오는 것으로 보입니다.**
   - 그러면 사용 토글이 두 군데입니다(`ItemMaterialTab.tsx:27,91`).
   - 품목 목록에 원료가 들어 있는지는 `rawMaterialId` 필드로 짐작한 것입니다.
6. **배합 원단위 저장이 칸마다 따로 요청이라, 중간에 실패하면 일부만 저장됩니다**(`ConsumptionTab.tsx:44-57`).

### 참고: SPEC.md

CLAUDE.md 지시에 따라 SPEC.md도 읽었습니다. 9장 임시 결정 가운데 위 차이의 배경이 되는 항목이 있습니다.
- #6: 공통코드 정의서 페이지에 접근할 수 없어서, 업무 프로세스 정의서 10장 제안 값을 쓰기로 했습니다. 지금은 문서를 볼 수 있으므로 C-3의 차이가 그대로 남아 있습니다.
- #12: 스타일은 B안 디자인 CSS를 그대로 쓰기로 했습니다. 당시 컨벤션에서는 미정이었는데, 지금 컨벤션은 Tailwind로 확정하고 [강제]로 정했습니다.
- #18: 제품 이름을 'FantaSteel'로 임시로 정했습니다.

---

## 부록: 끝까지 읽은 파일과 줄 수 (wc -l)

| 파일 | 줄 | 파일 | 줄 |
|---|---|---|---|
| client/pages/LoginPage.tsx | 124 | client/features/master-data/RoutingTab.tsx | 106 |
| client/pages/NotFoundPage.tsx | 10 | client/features/master-data/SettingsTab.tsx | 69 |
| client/pages/admin/EmployeePage.tsx | 292 | client/features/master-data/SpecMappingTab.tsx | 146 |
| client/pages/admin/OrganizationPage.tsx | 69 | client/features/master-data/SteelGradeTab.tsx | 208 |
| client/pages/admin/MasterDataPage.tsx | 77 | client/features/master-data/common.tsx | 130 |
| client/pages/admin/MasterDataPage.css | 15 | client/features/master-data/masterHooks.ts | 23 |
| client/features/admin/DepartmentTab.tsx | 233 | client/api/organization.ts | 133 |
| client/features/admin/EmployeeDrawer.tsx | 210 | client/api/masterData.ts | 197 |
| client/features/admin/OrgChartTab.tsx | 65 | client/api/auth.ts | 8 |
| client/features/admin/PermissionMatrixTab.tsx | 206 | client/stores/auth.ts | 55 |
| client/features/admin/RolePermissionSummary.tsx | 38 | shared/codes/index.ts | 334 |
| client/features/admin/organizationHooks.ts | 54 | shared/weight.ts | 41 |
| client/features/master-data/ConsumptionTab.tsx | 143 | client/features/master-data/PartyYardTab.tsx | 166 |
| client/features/master-data/InspectionTab.tsx | 147 | client/features/master-data/ProductSpecTab.tsx | 205 |
| client/features/master-data/ItemMaterialTab.tsx | 187 | client/features/master-data/ReadinessBanner.tsx | 65 |

지정 파일 30개, 합계 3,756줄.

**보조로 끝까지 읽은 파일**: `client/App.tsx` 116, `client/shell/nav.ts` 103, `client/shell/titles.ts` 40, `client/api/client.ts` 70, `client/hooks/useApi.ts` 25, `client/components/ui.tsx` 149, `shared/api.ts` 19, `/Users/mjkim/Documents/GitHub/fantasteel-erp/SPEC.md` 78

**일부만 읽은 파일**: `client/lib/format.ts` 50–79행, `client/shell/Shell.tsx` 175–200행

**문서**
- 노션 5개(요구사항 정의서, 용어 사전, 공통 코드 정의서, 프로젝트 기획안, 코드 컨벤션)는 페이지 전체를 가져와 읽었습니다.
- process.md는 1~1530행 전부 읽었습니다.
- 링크된 다른 노션 페이지는 열지 않았습니다.

**읽지 않은 것**: server/, prisma, docs/api, docs/names, docs/SERVER-GUIDE.md