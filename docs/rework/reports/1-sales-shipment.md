# 영업(수주)·출하·물류 화면 감사 보고서 (읽기 전용)

## 0. 전제
- 파일은 하나도 고치지 않았고, git 명령도 쓰지 않았습니다.
- **읽은 문서**
  - 노션 원문 5개를 fetch로 받았습니다(모두 응답 안에 바로 옴): 요구사항 정의서, 용어 사전, 공통 코드 정의서, 프로젝트 기획안, 코드 컨벤션.
  - 업무 프로세스 정의서는 `process.md`를 1~1530행 전부 읽었습니다.
  - 그 밖의 노션 페이지, `server/`, prisma, `docs/api`, `docs/names`, `SERVER-GUIDE.md`, scratchpad의 `erd.txt`는 열지 않았습니다.
- **보조로 읽은 client·shared 파일**: `App.tsx`, `shell/nav.ts`, `shell/titles.ts`, `shell/shellTitle.tsx`, `shell/shellData.ts`(38~69행만), `stores/auth.ts`, `stores/toast.ts`, `hooks/useApi.ts`, `lib/format.ts`, `components/ui.tsx`, `api/client.ts`, `api/queryClient.ts`, `api/lookups.ts`, `api/inventories.ts`, `api/lots.ts`, `api/businessEvents.ts`, `features/inventory/inventoryHooks.ts`, `shared/src/codes/index.ts`, `client/package.json`. `SPEC.md`는 CLAUDE.md 지시에 따라 읽었습니다.
- **배경**
  - SPEC.md 9-6은 "공통코드 정의서에 접근할 수 없어 프로세스 정의서 10장 제안 값을 쓴다"는 임시 결정입니다. 현재 shared 코드값 차이 대부분이 여기서 나왔습니다.
  - 지금은 정의서를 읽을 수 있으므로 C-3에서는 전부 갭으로 보고합니다.
- **공통 1 — 라우트 가드 없음**
  - `App.tsx:78-85`는 모든 경로를 로그인만으로 열어 줍니다. Shell에도 권한 검사가 없습니다(grep 기준).
  - 화면에서 하는 권한 처리는 두 가지뿐입니다.
    - 메뉴 노출: VIEW 이상(`nav.ts:63`)
    - 버튼 활성화: `canUse` = USE 수준(`stores/auth.ts:48-50`)
- **공통 2 — 로딩·오류·토스트**
  - `QueryBoundary`(`components/ui.tsx:53-69`)
    - 로딩: "불러오는 중…"(또는 화면별 loadingLabel)
    - 오류: "불러오지 못했어요" + 서버 message + code + [다시 시도]
    - 403: "이 화면을 볼 권한이 없어요"
  - 변경 실패: `useAction`이 토스트 "{message} ({code})"를 띄웁니다(`useApi.ts:20-23`, `toast.ts:21`).
  - 네트워크 오류: "서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요"(`client.ts:40`)
- **역할별 메뉴(`nav.ts`)**
  - SALES: 수주 `/sales-orders`(ORDER_CREATE, :23), 등록 `/sales-orders/new`(ORDER_CREATE, :24), 출하요청 `/shipment-requests`(SHIPMENT_REQUEST, 배지 = REQUESTED 건수, :25), 밀시트(MILLSHEET_READ, :27)
  - QUALITY: 밀시트(:47)
  - LOGISTICS: 출고 확정 `/goods-issues`(GOODS_ISSUE_CONFIRM, 배지 = ALLOCATED 건수, :50), 밀시트(:51)
- **기본 권한**(`shared/src/codes/index.ts:99-110`)
  - SALES: ORDER_CREATE·ORDER_CANCEL·SHIPMENT_REQUEST·MILLSHEET_READ = USE, GOODS_ISSUE_CONFIRM = VIEW
  - LOGISTICS: GOODS_ISSUE_CONFIRM·MILLSHEET_READ = USE, SHIPMENT_REQUEST·ORDER_CREATE = VIEW
  - QUALITY: MILLSHEET_READ = USE, GOODS_ISSUE_CONFIRM = VIEW
  - PRODUCTION: ORDER_CREATE = VIEW
  - ADMIN: 전부 VIEW
- 이 영역에는 "준비 중 (P2/EX)" 표시가 하나도 없습니다(ComingSoon·SoonButton·"준비 중" grep 0건).

---

## A. 화면 인벤토리

### A-1. 수주 목록 `/sales-orders` (`pages/sales/SalesOrderListPage.tsx`)
- **제목·메뉴**: 상단 바 "수주 목록 / 영업"(`titles.ts:6`). SALES의 "수주" 메뉴로 들어옵니다.
- **배치 순서**: ① 필터 레일(폭 236) ② 툴바 ③ 권한 안내 ④ 수주 표 ⑤ 선택한 수주 미리보기

**① 필터 레일 (89-150)**
- 머리: "필터", "적용 {n}" 태그, [초기화](94)
- 상태: 라디오 전체·접수·진행 중·부분출하·출하완료·취소(99-105) + 체크박스 "납기 위험만"(빨간 스타일, 106-109)
- 고객사: 라디오 전체 + lookups 고객사 목록. 로딩 "불러오는 중…", 오류 "고객사 목록을 불러오지 못했어요"(113-121)
- 품목 유형: 전체 / 코일 / 슬래브(124-135)
- 납기
  - DateInput 2개(placeholder "시작일"·"종료일", 140-141)
  - 오류 "시작일이 종료일보다 늦어요"(143)
  - 토글 칩 "D-7 이내"·"이번 달"(145-146)

**② 툴바 (152-173)**
- 검색: placeholder "수주번호·고객사·규격 코드", 300ms 디바운스(49-52)
- 상태 탭(전체·접수·진행 중·부분출하·출하완료, 36·157-163). 왼쪽 상태 필터와 같은 값이고, 취소는 탭에 없습니다.
- 건수 "{n}건 · 새로 불러오는 중…"(164)
- [작업 로그]: 선택한 행이 있으면 `/business-events?salesOrderId=`, 없으면 `/business-events`(166)
- [수주 등록]: `canUse(me,'ORDER_CREATE')`(40)이면 `/sales-orders/new` 링크, 아니면 비활성 + title "권한이 필요해요"(167-171)

**③ 권한 안내**: 권한이 없으면 LockHint "수주 등록은 영업 권한(수주 등록)이 필요해요 · 조회는 할 수 있어요"(174)

**④ 수주 표 (179-221)**
- 열: 수주번호 | 고객사 | 품목 요약 | 주문 수량 | 이론중량 | 충족 진행률 | 상태 | 납기 | 담당
  - 이론중량 열 title: "매수 × 1매 이론중량 계산값"
- 셀 내용
  - 수주번호: `/sales-orders/:id` 링크
  - 품목 요약: 1품목이면 "슬래브 SS275 250 × 1,200 × 10,000 10매", 여러 품목이면 "… 5매 + 코일 … 4개"(`salesUi.tsx:104-119`)
  - 주문 수량: "{n}{매|개|매·개}"
  - 이론중량: "235.500 t"
  - 충족 진행률: 막대 + 소수 버림 %. 100% 이상은 ok색, 위험이면 danger색
  - 상태: 상태 배지 + "납기 위험" 배지
  - 납기: "MM-DD D-n". 위험이면 빨강 + 경고 아이콘, 출하완료·취소면 날짜만(`salesUi.tsx:138-143`)
  - 담당: 담당 사원 이름
- 정렬 컨트롤은 없습니다(서버 순서 그대로).
- 행 클릭 = 미리보기 선택(기본은 첫 행).
- 빈 상태: "조건에 맞는 수주가 없어요 · 왼쪽 필터를 초기화해 보세요" 또는 "등록된 수주가 없어요"(218)
- 로딩: "수주를 불러오는 중…"(175)
- 페이지: 50건 단위. "{total}건 중 a~b", [이전]/[다음], "p / n"(222-231)

**⑤ 미리보기 (249-339)**
- 머리
  - 수주번호, 고객사, 상태·위험 배지
  - "등록 MM-DD HH:mm · 담당 · 납기 YYYY-MM-DD (D-n)"
  - 버튼: [업무방], [출하요청 만들기] → `/shipment-requests/new?salesOrderId=`, [상세 보기]
  - **[출하요청 만들기]는 권한 확인 없이 항상 보입니다(273).**
- 왼쪽 열: 품목별 충족
  - 제목 "품목별 충족 (수량)" + 범례 예약 / 생산중 / 검사합격 / 출하 / 남음
  - 품목마다 누적 막대 + 캡션 "예약 n · 생산중 n · 검사합격 n · 출하 n · (취소 n | 남음 n)"(244-246)
- 왼쪽 열: 생산 연결
  - 생산계획: 번호 링크 `/production/plans?plan=` + "품목 n · 목표 n · 남은 목표 n · 재생산" + 계획 상태 배지
  - LOT: 최대 6개, `/lots/trace?lot=` 링크
  - 그 이상이면 "LOT 외 n건 · 상세에서 보기"
  - 없음: "연결된 생산계획·LOT이 없어요 · 예약 수량은 LOT을 정하지 않아요 (출하요청 때 배정해요)"
  - 오류: "연결된 생산계획·LOT을 불러오지 못했어요"
  - 하단: "… 진행률 = (예약 + 검사합격 + 출하) ÷ 주문 수량"(317)
- 오른쪽 열: 최근 작업 로그
  - 최근 8건 + [전체 보기]
  - 오류 "작업 로그를 불러오지 못했어요", 없음 "기록된 작업이 없어요"
  - 하단 [업무방 #{수주번호}] + "수주 담당자와 생산·품질·물류·구매 부서장이 함께 있어요" 또는 "아직 업무방이 없어요 · 열면 만들어져요"(333)
- 미리볼 수주가 없을 때: "미리 볼 수주가 없어요"(234)

**쓰는 API**: `salesOrderApi.list`, `salesOrderApi.fulfillment`, `businessEventApi.list`, `lookupApi.get`, `salesOrderApi.openWorkRoom`

### A-2. 수주 등록 `/sales-orders/new` (`SalesOrderCreatePage.tsx`)
- **제목·메뉴**: "수주 등록 / 영업"(`titles.ts:4`). SALES의 "등록" 메뉴.
- 화면 자체에는 권한 가드가 없습니다. 권한이 없으면 [저장]이 비활성되고 LockHint "수주 등록 권한 필요"(261)가 보입니다.
- lookups가 오기 전에는 "고객사·규격을 불러오는 중…"(134-140)을 보여 줍니다.

**왼쪽 "수주 입력" (폭 380, 145-273)**
- 머리: "1 · 2단계", [목록]
- 1 기본 정보
  - 고객사: select("고객사 선택"). 오류 "고객사를 선택해 주세요"(101, 157-163)
  - 납기
    - DateInput(min = 오늘, 167)
    - 오류 "납기를 입력해 주세요" / "납기는 오늘 이후로 입력해 주세요"(102). 실제로는 오늘 날짜도 통과합니다.
    - 힌트 "숫자로 입력(예: 20261020)하거나 달력에서 골라요"(170)
  - 담당: 읽기 전용 "{이름} · {부서} · 등록한 사원이 담당이 돼요"(173)
  - 비고: text 입력, 최대 500자, placeholder "고객 요청 사항 (선택)"(175)
- 2 품목
  - "{n}행" 태그 + "코일·슬래브 혼합" 표시(177-181)
  - 행마다(188-246)
    - select 품목 유형(슬래브/코일), select 강종, select 규격("두께 × 폭 × 길이", 없으면 "규격 없음"), 삭제 버튼(1행이면 비활성)
    - "1{단위} {이론중량 t}"
    - 수량 입력: text, 숫자 키패드, placeholder "0", 뒤에 매/개 표시
  - 검증(parseQty 28-34)
    - `/^\d+$/` 이고 1 이상이어야 통과. 반올림하지 않습니다.
    - 오류 문구 "규격을 선택해 주세요" / "수량은 1 이상의 정수로 입력해 주세요"(20, 85)
    - 저장을 한 번 누른 뒤에는 빈칸도 같은 오류로 표시합니다.
    - 정상이면 "= n{단위} · x t [계산값]", 아무것도 없으면 "정수로 입력해요 · 톤은 자동으로 계산돼요"
  - 행 아래 캡션: 규격 코드 · "합격 가용재고 n{단위}" → "재고에서 n 예약 · 부족 n → 생산계획 (예상)"(240-245)
  - [품목 행 추가]: 앞 행의 유형·강종을 이어받습니다(249).
  - 안내 "수량은 정수로 입력해요 (슬래브 매 · 코일 개) · 톤은 수량 × 1매 이론중량 계산값이고 저장하지 않아요"(254)
- 하단
  - 서버 오류 줄: "{message} ({code})" 또는 "저장하지 못했어요"(258)
  - 상태 캡션: "기본 정보를 확인해 주세요" / "{행}행 수정 후 저장" / "합계 n · x t (계산값)"(264)
  - [취소](목록으로), [저장](진행 중이거나 권한 없으면 비활성, 누르는 동안 "저장 중…")

**오른쪽 미리보기 (274-375)**
- 단계: 1 · 기본 정보 → 2 · 품목(n행 입력 · m행 확인 필요) → 3 · 저장·예약 결과(276-285)
- 안내 배너: "아래는 지금 가용재고로 본 미리보기예요…"(289)
- KPI 3개
  - 주문 합계(n{단위}; 톤 계산값 · 품목 수 · 고객사 · 납기)
  - 재고 예약 (예상)("합격·가용 재고 우선 · LOT은 정하지 않아요")
  - 생산 필요 (예상)
- 표 "품목별 예약 미리보기"(meta "수량 기준 · 저장 전")
  - 열: 품목 | 규격 코드 | 주문 | 가용재고 | 예약 / 생산 필요(막대) | 예상 결과
  - 예상 결과 배지: "수량 입력 필요" / "수량 확인 필요" / "가용재고 정보 없음"
  - 빈 상태: "품목 행을 추가해 주세요" / "사용 중인 제품 규격이 없어요 · 기준정보에서 규격을 등록해 주세요"
  - 하단: "시스템" 칩 + "저장하면 합격·가용 재고를 수량 단위로 먼저 예약하고(부분 예약 허용)…"
- 카드 "저장하면 이렇게 돼요"(366-374)
  - 상세 화면으로 이동
  - 업무방 생성(담당자 + 생산·품질·물류·구매 부서장)
  - 작업 로그 기록
  - "저장을 두 번 눌러도 수주는 한 건만 만들어져요"

**저장 동작**
- `salesOrderApi.create` → `POST /sales-orders`, 헤더 Idempotency-Key(화면을 연 동안 키 하나, 43)
- 본문: `{customerId, dueDate, note?, items:[{productSpecId, orderedQty}]}`(123-128)
- 성공 토스트: "{수주번호} 수주를 등록했어요 · 재고 예약 n{단위}" + (" · 부족 n{단위}는 생산계획 k건으로 넘겼어요" 또는 " · 생산계획은 필요 없어요")(113). 이후 상세 화면으로 이동합니다.

**쓰는 API**: `lookupApi.get`, `inventoryApi.list`(useInventories, 필터 없음), `salesOrderApi.create`

### A-3. 수주 상세·충족 현황 `/sales-orders/:id` (`SalesOrderDetailPage.tsx`)
- **제목**: 기본은 "충족 현황 / 영업 · 수주"(`titles.ts:5`). 데이터가 오면 수주번호·고객사로 덮어씁니다(29).
- **메뉴**: SALES의 "수주"(`/sales-orders/` 경로 일치).

**왼쪽 수주 목록 (59-117)**
- 머리: "수주" + 총 건수 + [목록] + [등록](`canUse 'ORDER_CREATE'`일 때만, 78)
- 검색: "수주번호·고객사 검색"
- 칩: 전체 / 진행 중(status = IN_PROGRESS) / 납기 위험(deliveryRiskOnly)
- 항목: 수주번호 + (위험 배지 또는 상태 배지), 고객사 · 수량 · 톤, 납기, 진행률 막대
- 최대 50건, 페이지 넘김 없음. 하단 "최신 등록순 · n건까지 표시 · 진행률 = (예약+검사합격+출하) ÷ 주문"
- 빈 상태: "검색 결과가 없어요" / "납기 위험 수주가 없어요" / "진행 중인 수주가 없어요" / "등록된 수주가 없어요"
- 오류: "수주 목록을 불러오지 못했어요"

**잘못된 id (47-56)**: "수주 {id}를 찾을 수 없어요" + [수주 목록으로]. 로딩 문구는 "수주를 불러오는 중…"입니다.

**머리 (144-169)**
- 수주번호, 고객사, 상태·위험 배지
- 태그 "납기 YYYY-MM-DD · D-n"
- "등록 YYYY-MM-DD HH:mm · 담당 {이름} ({사번})"
- "비고: …"(153)
- [수주 취소]
  - `canUse 'ORDER_CANCEL'`(126) 필요
  - 막히는 경우와 문구: "이미 취소된 수주예요" / "전량 출하된 수주는 취소할 수 없어요" / "수주 취소 권한 필요"(127)
- [업무방], [작업 로그]
- [출하요청 만들기]
  - 조건: `canUse 'SHIPMENT_REQUEST'` && 취소 아님 && 출하완료 아님(128)
  - 안 되면 비활성 + title "취소된 수주예요" / "전량 출하됐어요" / "권한이 필요해요"
- 취소된 수주 배너(171-174): "취소된 수주예요 · {일시} · 사유 · 예약은 해제됐고, 생산 중이던 물량은 완료 후 여재가 돼요. 출하된 수량은 그대로예요."

**탭 (176-182)**: 충족 현황 | 생산 연결 {n} | 예약 이력 {n} | 작업 로그 {n}. 오른쪽 캡션 "수량 기준 (슬래브 매 · 코일 개) · 톤은 계산값".

**충족 현황 탭**
- 표(187-236)
  - 열: 품목 | 주문 | 예약(재고) | 검사합격 | 생산중 | 출하 | 미확보 | 추가 계획 필요 | 진행률
  - 열 title: "재고에서 잡은 예약 (ACTIVE)", "부족분 생산분이 검사에 합격해 자동 예약된 수량", "진행 중 생산계획의 남은 목표 (미확보 안에서만 센다)", "주문 − 출하 − 예약 − 검사합격", "미확보 − 진행 계획 잔여 목표"
  - 품목 셀: 품목 상태 배지 + "규격 코드 · 톤 · 취소 잔량 n"
  - 합계 행 + 하단 안내(240): 진행률 공식과 "예약+검사합격+출하+미확보 = 주문" 관계
- 추가 계획 필요 배너(244-250): "품목 n · 추가 계획 필요 n — 미확보 n 가운데 진행 중인 생산계획으로 채워지지 않는 수량이에요" + [생산계획] 링크
- "수량 구성"(251-275)
  - "막대 전체 = 주문 수량", 품목별 막대
  - 오른쪽 캡션: "취소 · 잔량" / "생산중 n = PP-… 상태" / "확보 완료" / "진행 중인 생산계획 없음"
- 카드 "출하 준비"(277-294)
  - 품목별 "예약 n + 검사합격 n" 또는 "확보된 수량 없음"
  - "LOT은 출하요청 때 선입선출(생산완료일 오래된 순)로 추천받아 확정해요"
  - [출하요청 만들기]
- 카드 "업무방"(295-305): [업무방 열기]

**생산 연결 탭 (308-350)**
- 생산계획 표
  - 열: 계획번호 | 품목 | 상태 | 목표 | 남은 목표 | 히트 | 계획 슬래브 | 여재 사용
  - 재생산 계획에는 "재생산" 배지
  - 빈 상태: "연결된 생산계획이 없어요 · 재고로 전량 예약됐거나 부족분이 없어요"
- LOT 표
  - 열: LOT | 품목 | 히트 | 상태 | 배정 | 생산완료
  - 배정 셀: "{배정 목적 라벨} · {배정 상태 라벨}" 또는 "배정 전"(342)
  - 빈 상태: "연결된 LOT이 없어요 · 예약은 LOT을 정하지 않아요 (출하요청 때 배정해요)"

**예약 이력 탭 (352-380)**
- 열: 품목 | 규격 코드 | 상태 | 예약 수량 | 톤 (계산값) | 구분 | 생성 | 변경
- 상태 배지 title에 원래 코드값을 보여 줍니다.
- 구분: "시스템"+"자동 예약" 또는 "수주 등록 시 재고 예약"
- 해제(RELEASED) 행은 흐리게, 빈 상태 "예약 이력이 없어요"
- 하단 안내(375): "…출고가 확정되면 '출고 전환', 수주를 취소하면 '해제'… 부분 출고는 예약을 둘로 나눠요…"

**작업 로그 탭 (382-406)**
- 열(머리 없음): 시각 | 행위자 칩 | 이벤트 유형 라벨 | 요약 — 사유
- 하단 "최근순 n건 · 더 있어요" + [시간순으로 전체 보기]
- 최대 50건(22)

**오른쪽 옆 칸 (408-457)**
- 진행률: "{progressRate}%"를 **버림 없이** 그대로 표시합니다(413). "n 중 확보 n", "출하 n · 톤".
- 생산 연결: 계획 3건 + LOT 4건 + [생산계획 n건 · LOT m건 모두 보기](탭 전환)
- 최근 작업 로그 6건

**쓰는 API**: `salesOrderApi.fulfillment`, `salesOrderApi.list`, `salesOrderApi.reservations`, `businessEventApi.list`, `salesOrderApi.openWorkRoom`, `salesOrderApi.cancel`(모달)

### A-4. 수주 취소 모달 (`features/sales/CancelOrderModal.tsx`)
- 제목 "수주 취소 · {수주번호}", 폭 600
- 배너: "{고객사} · n{단위} 수주를 취소해요. 취소하면 되돌릴 수 없어요."
- "취소하면 이렇게 돼요" 5항목(83-87)
  1. 예약 해제: 예약 n = reserved+passed
  2. 배정 해제: "아직 출고하지 않은 출하요청은 요청 전체가 취소되고 확정 배정이 풀려요…"
  3. 시작 전 생산계획 취소: 진행 계획 n건
  4. 생산 중 물량은 완료 후 여재
  5. 출하분은 그대로: "…일부 출하된 품목은 남은 수량만 취소돼요"
- 입력 "취소 사유": text, 500자, 선택 입력, placeholder "예: 고객 요청", 힌트 "작업 로그에 남아요 (선택, 500자 이하)"(90-92)
- 버튼: [닫기], [취소 확정]
  - 진행 중에는 비활성, 문구 "취소하는 중…"
  - 모달 안에서는 권한을 다시 보지 않습니다(여는 버튼에서만 확인).
- 호출: `salesOrderApi.cancel` → `POST /sales-orders/:id/cancel {reason}`. 성공 토스트 "{수주번호} 수주를 취소했어요".
- 결과 모달(23-58)
  - 제목 "취소 결과 · {no}"
  - 표 열: 품목 | 상태 | 주문 | 출하 (유지) | 취소 잔량
  - 캡션: "예약은 해제되고… 작업 로그에 남아 있어요"
  - 버튼: [작업 로그에서 보기], [확인]

### A-5. 출하요청 목록 `/shipment-requests` (`ShipmentRequestListPage.tsx`)
- **제목·메뉴**: "출하요청 / 영업"(`titles.ts:9`). SALES의 "출하요청" 메뉴(배지 = 배정 대기 건수).
- 머리
  - 경로 "출하", 제목 "출하요청"
  - 설명 "여러 수주 품목을 묶어 요청하고, 합격 LOT을 FIFO로 배정해요"
  - [출하요청 등록]: `canUse 'SHIPMENT_REQUEST'`(19), 없으면 자물쇠 아이콘 + 비활성
- 필터(66-90). **전부 화면에서 거르고, 목록은 파라미터 없이 한 번에 받습니다.**
  - 상태 칩: "전체 n" + 배정 대기 / 배정 확정 · 출고 대기 / 출고 완료 / 취소(건수 포함). 값은 URL `?status=`에 저장.
  - 고객사 select("고객사 전체")
  - "출하 요청일" DateInput 2개
  - 검색: "출하번호·고객사·수주·규격 검색"
- 카드 meta: "{n}/{전체}건 · 최신순"
- 표(100-112)
  - 열: 출하번호 | 상태 | 고객사 | 출하 요청일 | 품목 | 수주 | 요청 매수 | 이론중량 | 배정 | 요청 | 다음
  - 출하 요청일: "MM-DD (요일)"
  - 품목: "규격 코드 외 n"(title에 전체 목록)
  - 배정: "a / r", 취소면 "-"
  - 요청: "{요청자} · MM-DD HH:mm"
  - 다음(149-161)
    - 배정 대기 → "LOT 배정"(상세로)
    - 배정 확정 → "출고 확정" → `/goods-issues?request=`
    - 출고 완료 → 밀시트 번호 링크들
- 정렬·페이지 없음. 빈 상태 "조건에 맞는 출하요청이 없어요" / "아직 등록된 출하요청이 없어요".
- **쓰는 API**: `shipmentRequestApi.list()`

### A-6. 출하요청 등록 `/shipment-requests/new` (`ShipmentRequestCreatePage.tsx`)
- **제목**: "출하요청 등록 / 영업"(`titles.ts:7`), 페이지 제목 "새 출하요청" + "작성 중" 배지
- **초기값(46-59)**
  - `?salesOrderId=`가 있으면 그 수주의 고객사와 모든 품목을 미리 고르고, 수량은 출하 가능 매수 전량으로 채웁니다.
  - 그렇지 않고 고객사가 하나뿐이면 그 고객사를 자동으로 고릅니다.

**왼쪽 "출하 가능 수주" (117-182)**
- 고객사 select(필수 표시). 항목 "{고객사} (n품목)", 기본 "고객사를 골라 주세요"
- 검색 "수주번호·규격 검색"(고객사를 고르기 전에는 비활성)
- 수주별 그룹: 수주번호 링크 + "납기 MM-DD"
- 품목 행
  - 체크박스 + 유형 태그 + 규격 코드
  - "품목 n · 출하 가능 n"
  - 오른쪽: "n 요청" 또는 "예약 n · 요청됨 n"
- 빈 상태 4종
  - "고객사를 먼저 골라 주세요. 같은 고객사의 수주 품목만 묶을 수 있어요"
  - "출하요청할 수 있는 수주 품목이 없어요. 합격 재고가 예약된 품목만 나와요"
  - "조건에 맞는 품목이 없어요"
  - "이 고객사는 출하요청할 수 있는 품목이 없어요"
- 하단 안내: "출하 가능 매수 — 예약 매수(ACTIVE) − 다른 미출고 출하요청 매수예요."

**본문**
- 머리 버튼: [목록], [출하요청 등록 · 배정 추천 →]
- KPI(207-228)
  - 묶은 품목
  - 출하 매수
  - 이론중량 (계산값): "x.xxx t", "매수 × 1매 이론중량 · 등록하면 서버가 다시 계산해요"
  - 출하 요청일: "가장 이른 납기 …"
- 표 "선택한 품목"(238-252)
  - 열: 수주 | 구분 | 강종 | 규격 | 납기 | 주문 | 출고 누계 | 예약 매수 | 다른 출하요청 | 출하 가능 | 출하 매수 | 이론중량 (계산값) | 빼기(x)
  - 출하 매수 입력
    - 숫자 키패드, 뒤에 단위 표시, title "1 ~ n"
    - **숫자가 아닌 글자는 지워 버립니다(103).**
  - 검증(18-26): "매수를 입력해 주세요" / "1 이상의 정수로 입력해 주세요" / "출하 가능 n{단위}까지 요청할 수 있어요"
  - 합계 행 "합계 · 수주 n건"
  - 빈 상태: "왼쪽에서 고객사를 고르고 출하할 품목을 체크해 주세요" / "왼쪽 목록에서 출하할 품목을 체크해 주세요"
  - 하단 안내: "부분 출하는 출하요청을 나눠서 해요. 예: 10매 중 4매…"(309)
- "요청 정보"(314-335), meta "출하번호는 등록할 때 정해져요"
  - 출하 요청일: 필수, DateInput(min = 오늘). 오류 "오늘 이후 날짜로 입력해 주세요", 힌트 "오늘 이후 날짜 · 출고는 물류가 확정해요"
  - 요청자: 읽기 전용 "{이름} · {부서}"
  - 메모: textarea 2줄, placeholder "예: 1차 출하 · 오전 상차 희망", "n / 500자"
- "등록하면"(336-354)
  - 배너 "품목별로 합격 LOT을 FIFO로 추천해요. 추천은 담당자가 확정해요."
  - 체크 3줄
  - 권한 없을 때: "출하요청 등록은 영업 담당만 할 수 있어요 (권한 필요)"
  - [등록하고 배정 추천 보기 →]

**등록 동작**
- 활성 조건 ready(94): 권한 && 고객사 && 품목 1개 이상 && 모든 수량 유효 && 요청일 있음 && 메모 500자 이하
- 호출: `shipmentRequestApi.create` → `POST /shipment-requests {customerId, requestedShipDate, memo?, items:[{salesOrderItemId, requestQty}]}`. **Idempotency-Key는 없습니다.**
- 성공 토스트 "출하요청 {no}을(를) 등록했어요" 후 배정 화면으로 이동

**쓰는 API**: `shipmentRequestApi.shippable()`, `shipmentRequestApi.create`

### A-7. 출하요청 배정 `/shipment-requests/:id`
관련 파일: `ShipmentRequestDetailPage.tsx`, `ShipmentRequestMaster.tsx`, `AllocationItemCard.tsx`
- **제목**: "출하요청 배정 / 영업"(`titles.ts:8`). 데이터가 오면 "{no} 배정"과 고객사로 덮어씁니다(21).

**왼쪽 목록 (`ShipmentRequestMaster`)**
- 머리: "출하요청" + 건수 + [새 출하요청](권한이 있을 때)
- 검색: "출하번호·수주·고객사 검색"
- 칩: "전체" / "배정 대기"(REQUESTED) / "출고 대기"(ALLOCATED) — 라벨은 코드에 직접 적혀 있습니다(48-49)
- 항목: 번호 + 상태 배지, 고객사 + 수주(여러 건이면 "수주 n건"), 품목 요약 + 수량·톤, "출하 요청일 … · {캡션}"
  - 캡션 예: "요청 MM-DD HH:mm · FIFO 추천 확인 필요 (a/r)" / "배정 확정 · 출고 대기" / "취소됨 …" / "출고 … · 밀시트 …"
- 하단 "배정 규칙": "…생산완료일 오래된 순(같으면 LOT 번호 순) 추천 · 담당자 확정 · 출고 전까지 변경 가능"

**본문 (`ShipmentRequestDetailPage`)**
- 잘못된 id: 빈 상태 "출하요청을 찾을 수 없어요" / "왼쪽 목록에서 골라 주세요"
- 머리(61-83)
  - "{no} 배정" + 상태 배지 + 고객사 · 수주 링크들
  - [작업 로그]: 첫 수주 기준
  - [출하요청 취소]
    - 배정 대기·배정 확정 상태에서만 보입니다.
    - `canUse 'SHIPMENT_REQUEST'`(19)가 없으면 비활성 + 자물쇠 아이콘
  - 상태별 다음 버튼: 출고 완료면 [밀시트 보기](첫 장), 배정 확정이면 [출고 확정 화면]
- 요약 띠(85-92): 요청 / 고객사 / 출하 요청일 / 배정 매수 "a / r" / 이론중량 / 진행 단계(출하요청 → LOT 배정 → 출고 확정 → 밀시트)
- 메모 배너
- 상태별 배너
  - 배정 확정: "…물류가 출고를 확정할 수 있어요 (물류 담당에게 '출고 대기' 알림이 갔어요)"(104)
  - 출고 완료: "출고 {goodsIssueNo} 확정 · {이름} · {시각} · 밀시트 …" + [출고 내역](108-117)
  - 취소: "…예약은 그대로라 같은 매수를 다시 요청할 수 있어요"(121)
- 하단 줄(127-140)
  - "{n}개 품목 모두 배정 확정" 또는 "배정 확정 a/n 품목"
  - "추천은 저장하지 않고, 확정할 때 작업 로그에 남아요."
  - 권한이 없으면 LockHint "배정 확정·변경은 영업 담당만 할 수 있어요"
- 출하요청 취소 확인 창(142-153)
  - 제목 "출하요청 취소"
  - 본문 "…확정된 배정 {allocatedQty}건은 모두 해제돼요…". 수량 값에 "건"을 붙입니다.
  - 입력 "사유 (선택)": textarea, 500자
  - 호출 `shipmentRequestApi.cancel` → `POST /shipment-requests/:id/cancel {reason}`, 성공 토스트 "출하요청 {no}을(를) 취소했어요"

**품목별 배정 카드 (`AllocationItemCard`)**
- 머리
  - "품목 n", "{유형} {규격}", 수주 링크 #줄번호 · "요청 n · 톤", 품목 상태 배지
  - [FIFO 추천]: 수정 가능 && 배정 대기 && 대기 상태일 때 보입니다. 권한이 없으면 비활성.
  - 패널이 열려 있으면 [닫기]
- 확정 배정 표(114-158)
  - 열: No | 배정 LOT | 히트 | 생산완료일 | 배정 확정 | 상태 | (동작)
  - 생산완료일을 "YYYY-MM-DD HH:mm"로 보여 줍니다.
  - 배정 확정 상태 && 수정 가능이면 [변경]/[변경 취소], [배정 해제]. 권한이 없거나 처리 중이면 비활성.
  - 빈 상태: "아직 배정된 LOT이 없어요. [FIFO 추천]으로 후보를 확인해 주세요" / "배정된 LOT이 없어요"
- 추천 패널(162-250)
  - 안내 띠: "FIFO 추천 · 생산완료일 오름차순, 같으면 LOT 번호 순 · 필요 n (확정 c / 전체 r)". 변경 모드에서는 "{LOT} 대신 배정할 LOT을 1개 골라 주세요".
  - [추천대로]: 직접 고른 뒤에 보입니다.
  - 로딩 "추천을 불러오는 중…", 오류 배너(메시지·코드) + [다시 시도]
  - 부족 배너: "적격 LOT이 n 모자라요. 지금 있는 LOT만 먼저 확정하고…"
  - 후보 표: 선택(체크박스, 변경 모드는 라디오) | FIFO 순위 | LOT | 히트 | 생산완료일 | 야드 | 추천("추천" 배지 / "대안" 태그). 최대 높이 340.
  - 후보 없음: "강종·규격이 같은 합격·미배정 LOT이 아직 없어요"
  - 사유 입력: 추천과 다르게 고르거나 변경할 때만 보입니다
    - 라벨 "변경 사유 (선택)" / "추천과 다르게 고른 사유 (선택)"
    - placeholder "예: 야드 작업 순서 · 작업 로그에 남아요", 500자 초과 시 "500자 이하로 입력해 주세요"
  - 하단: "선택 n / 필요 n" + 안내("FIFO 추천과 같아요" / "추천과 다르게 골랐어요 — 확정하면 변경 이력이 남아요" / "· 대안 n") + [배정 확정] 또는 [배정 변경 확정]
- 패널이 닫혀 있을 때 하단: "배정 a / 필요 r" + "n 더 배정해야 해요" / "출고 확정 전까지 배정을 바꿀 수 있어요" / "출고 완료 — 배정 LOT이 소진됐어요" / "배정을 바꿀 수 없는 상태예요"
- 배정 해제 확인 창: "{LOT} 배정을 해제할까요? 품목은 배정 대기로 돌아가고…" + "사유 (선택)"
- 호출과 토스트
  - 추천: `POST /allocations/recommend`
  - 확정: `POST /allocations`. 토스트 "LOT n건을 배정했어요 · 남은 n" 또는 "배정을 바꿨어요 (LOT…)"
  - 해제: `POST /allocations/:id/release`. 토스트 "{LOT} 배정을 해제했어요"

**쓰는 API**: `shipmentRequestApi.list`, `.get`, `.cancel`, `shipmentAllocationApi.recommend/confirm/release`

### A-8. 출고 확정 `/goods-issues` (`GoodsIssuePage.tsx`)
- **제목·메뉴**: "출고 확정 / 물류"(`titles.ts:22`). 데이터가 오면 "출고 확정 · {no}"로 덮어씁니다(141). LOGISTICS의 "출고 확정" 메뉴(배지 = 배정 확정 건수).
- 권한: `canUse 'GOODS_ISSUE_CONFIRM'`(23)

**왼쪽 (49-129)**
- 머리: "출고 대기" + 건수 + "배정 확정된 요청만 출고"
- 검색: "출하번호·고객사·LOT 검색"
- 칩: "출고 대기 n" / "최근 출고 n"(최대 30건)
- 대기 항목
  - 번호 + **코드에 직접 적은 배지 "출고 대기"**(76)
  - 고객사 + 수량·톤
  - "배정 확정 a/r · 출하 요청일 …"
- 최근 출고 항목
  - goodsIssueNo + 직접 적은 배지 "출고 완료"(102)
  - "고객사 · 출하요청번호" + 수량·톤
  - "출고 MM-DD HH:mm · 밀시트 링크들"
- 빈 상태 4종: "조건에 맞는 요청이 없어요" / "출고 대기 중인 요청이 없어요. 영업이 배정을 확정하면 여기에 올라와요" / "조건에 맞는 출고가 없어요" / "아직 확정된 출고가 없어요"
- 하단: "오늘 (MM-DD) · 출고 대기 n건 · n단위" + "출고 확정은 출하요청 단위예요. 부분 출하는 출하요청을 나눠서 해요."

**본문**
- 선택: `?request=` 값, 없으면 대기 목록의 첫 요청
- 아무것도 없으면 빈 상태 "출고할 출하요청이 없어요" / "영업이 배정을 확정하면 여기에 올라와요"
- 머리: 경로 "출고 확정 > {no}", 제목 = 출하요청 번호 + 상태 배지 + 고객사, 버튼 [출하요청·배정], [LOT 추적]
- 요약 띠: 요청 / 출하 요청일 / 수주 / 품목 / "수량 n · 이론중량 x t"
- 거부 배너(235-249)
  - "출고를 확정하지 못했어요 ({code})" + 서버 메시지
  - 코드별 안내
    - INV-002: "미합격 LOT이 있으면 출고 전체가 막혀요…"
    - INV-004: "이미 투입·출고된 LOT이 배정돼 있어요…"
    - 그 밖: "아무것도 출고되지 않았어요…"
  - [배정 화면]
- LOT 표(253-319)
  - 제목: "배정 LOT 출고 확인" / 출고 후에는 "출고한 LOT"
  - 오른쪽 배지: "출고 불가 LOT n" / "확인 중" / "n LOT"
  - 열: 품목 | 수주 | LOT | 히트 | 생산완료일 | 배정 + 출고 전에는 제품 검사 | 상위 히트 | 재고
  - 품목·수주 셀은 여러 행을 합칩니다(rowSpan).
  - 자격이 없는 LOT 행은 위험 색(is-risk)입니다.
  - 배정이 없는 품목: "취소된 요청이라 배정된 LOT이 없어요" / "배정 대기 — 아직 배정된 LOT이 없어요 (영업 확정 필요)"
  - 합계 행 "n LOT · n단위 / 이론중량"
- 출고 전·취소 아님일 때 카드 2개(321-349)
  - "출고 전 확인": 배정 확정 c/t, 검사 합격(제품 + 상위 히트) p/t, 미소진(재고) s/t + "서버가 확정할 때 다시 확인해요…"
  - "확정하면 바뀌는 것"
    - 배정·LOT → 소진·출고
    - 예약 n → 출고 전환 (CONVERTED)
    - 수주 품목 출고 매수 +n
    - "밀시트: 수주 품목마다 1장 · n장 자동 발행 (히트 성분 + 검사값 스냅샷)"(344)
    - "작업 로그: … 수주 담당에게 알림"(345)
- 하단 줄(351-364)
  - 막힘 안내(202-204): "배정 대기 — 출고 불가 · 영업의 배정 확정이 필요해요" / "취소된 출하요청이에요" / "출고 확정은 물류 담당만 할 수 있어요"
  - 출고 후: "출고 MM-DD HH:mm · 담당 …", 출고 전: "두 번 눌러도 한 번만 출고돼요"
  - [출고 확정]: 권한 && 배정 확정 상태 && 처리 중 아님일 때 활성, 누르는 동안 "출고 확정 중…". 출고 후에는 [밀시트 보기].
- 출고 확정 호출
  - `confirmGoodsIssue` → `POST /shipment-requests/:id/goods-issue`, 헤더 Idempotency-Key
  - 4xx를 받으면 키를 새로 만들고, 네트워크·5xx면 같은 키를 다시 씁니다(158, 176-181, 198-201).
  - 성공 토스트 "출고 {goodsIssueNo}을(를) 확정했어요 · 밀시트 n장 발행"
- 결과 카드(370-423)
  - "출고 {GI no} 확정" + "예약 전환(CONVERTED) n · 톤"
  - 열: 수주 품목 | 규격 | 예약 전환 (CONVERTED) | 이론중량 | 누적 출고 / 주문 | 수주 품목 상태 | 출고 LOT
  - 하단: 발행된 밀시트 + PDF 상태 배지, "밀시트는 발행 시점 값을 스냅샷으로 저장해요"
  - 출고 기록 로딩: "출고 기록을 불러오는 중…"

**쓰는 API**: `shipmentRequestApi.list({status:'ALLOCATED'})`, `goodsIssueApi.list()`, `shipmentRequestApi.get`, `lotApi.detail`(배정마다 1건씩 조회, 162-164), `goodsIssueApi.list({shipmentRequestId})`, `shipmentRequestApi.confirmGoodsIssue`

### A-9. 밀시트 `/mill-sheets` (`MillSheetPage.tsx`, `MillSheetPaper.tsx`)
- **제목·메뉴**: "밀시트 / 물류"(`titles.ts:23`), 데이터가 오면 밀시트 번호로 덮어씁니다. SALES·QUALITY·LOGISTICS 모두 "밀시트" 메뉴가 있습니다(MILLSHEET_READ).
- 권한: `canUse 'MILLSHEET_READ'`(20)

**왼쪽 (47-101)**
- 머리: "밀시트" + 건수 + "출고 확정 시 자동 생성"
- 검색: "밀시트·수주·고객사·규격·히트 검색"
- 칩: 전체 / 슬래브 / 코일(라벨을 코드에 직접 적음, 60-61)
- 출고별 그룹: "{MM-DD HH:mm} 출고 · goodsIssueNo"
- 항목: 밀시트 번호 + PDF 상태 배지, 고객사 + "수주번호 #줄", "유형 규격" + 수량·톤, "발행 YYYY-MM-DD"
- 빈 상태: "조건에 맞는 밀시트가 없어요" / "아직 발행된 밀시트가 없어요. 출고를 확정하면 자동으로 생겨요"
- 하단 "스냅샷" 안내

**본문**
- 밀시트가 없으면: 제목 "밀시트" + "발행 없음" 배지 + "출고 확정된 출하요청이 없어서 밀시트가 아직 없어요"
- 상세 머리(155-183)
  - 경로 "출고 확정 > 밀시트"(빈 화면 경로는 "출하 > 밀시트"라 서로 다름)
  - 밀시트 번호 + **코드에 직접 적은 "발행 완료" 배지**(164) + PDF 상태 배지
  - "고객사 · 수주 링크 #줄 · 발행 일시"
  - 버튼: [작업 로그], [LOT 추적]
  - PDF 버튼
    - 준비됨이면 [PDF 열기]: `<a href>`, 권한 확인 없음
    - 아니면 [PDF 생성] / [PDF 다시 생성] / "PDF 만드는 중…": 권한 없으면 비활성
- 실패 배너(185-197): "PDF를 만들지 못했어요 ({code})" + "스냅샷은 그대로 저장돼 있어요… 출고는 다시 실행하지 않아요" + [다시 시도]
- 안내 배너: "발행 시점 값을 스냅샷으로 저장해요… 화면과 PDF 모두 이 스냅샷만 써요."
- PDF 생성 성공: 토스트 "PDF를 만들었어요" + 새 탭으로 엽니다(`window.open`, 143)

**밀시트 종이 (`MillSheetPaper`)**
- 머리: "FANTASTEEL" / "FantaSteel 제철소", "MILL SHEET" / "검사증명서", 발행번호·발행일·출고번호
- 정보 표: 고객사(+코드), 수주번호 #줄, 출하요청, 품목, 강종, 적용 규격, 치수 (mm), 수량, 이론중량(+1단위 중량)
- 1. 제품 LOT 표
  - 열: No | 코일 LOT·슬래브 LOT | 히트 | (코일이면) 압연 전 슬래브 | 이론중량 | 생산완료일
  - 합계 행
- 2. 화학성분 (히트 성분 검사): 검사 항목 × 히트 행렬. "기준" 행, 판정, 검사번호.
- 3. 제품 검사 ({공정 라벨}): 같은 형식
- 4. 압연 전 슬래브 검사: 코일일 때만
- 하단: "출하 {DR} | 출고 {GI} · 일시", 종합 판정 상자(합격 / 불합격 / —), "위 제품은 해당 규격에 따라 제조·검사되었음을 증명합니다."

**쓰는 API**: `millSheetApi.list()`, `.get`, `.generatePdf`, PDF 파일 `GET /mill-sheets/:id/pdf?access_token=`

### A-10. 공용 부품
- **`DateInput.tsx`**
  - text 입력, 숫자 키패드, 기본 placeholder "YYYY-MM-DD"
  - 해석하는 입력: "20261012", "2026.10.12", "26-10-12", "10/12", "261012", "1012" (2000~2100년)
  - 해석이 안 되거나 min보다 이르면 빨간 테두리만 표시합니다. 문구는 없고, 부모에게 값을 넘기지 않아 이전 값이 남습니다(81-84).
  - 달력: [이전 달]/[다음 달], min 이전 날짜 비활성, [지우기], [오늘](min보다 이르면 비활성), Esc·바깥 클릭으로 닫힘
  - SPEC 5-2(숫자 입력 + 달력)를 충족합니다.
- **`salesUi.tsx`**: 상태 배지, 진행률 막대, 충족 막대·범례, 품목 이름, 납기 셀, 업무방 버튼, 훅(useLookups, useOrderEvents)
- **`shipmentUi.tsx`**: 상태 배지들, 링크, 요약 띠, 진행 단계, 사유 확인 창

### A-11. 상태 배지 대응표 (코드 그룹 → 화면 라벨, 색)
- **수주 / 수주 품목** SALES_ORDER_STATUS(= SALES_ORDER_ITEM_STATUS, `salesUi.tsx:19-26`)
  - REGISTERED 접수(neutral), IN_PROGRESS 진행 중(run), PARTIALLY_SHIPPED 부분출하(wait), SHIPPED 출하완료(ok), CANCELLED 취소(danger)
  - 출고 결과 카드만 색이 다릅니다: SHIPPED ok, PARTIALLY_SHIPPED run, 나머지 neutral(`GoodsIssuePage.tsx:402`)
- **납기 위험**: 코드값이 아니라 `isDeliveryRisk` → "납기 위험"(danger)
- **예약** RESERVATION_STATUS: ACTIVE 예약중(run), CONVERTED 출고 전환(ok), RELEASED 해제(neutral)
- **배정** ALLOCATION_STATUS: CONFIRMED 배정 확정(run), CONSUMED 소진(ok), RELEASED 해제(neutral)
- **배정 목적** ALLOCATION_PURPOSE: SHIPMENT 출하, ROLLING 열연 투입
- **생산계획** PRODUCTION_PLAN_STATUS: PLANNED 계획(wait), CONFIRMED 편성 확정(run), IN_PROGRESS 생산 중(run), COMPLETED 완료(ok), CANCELLED 취소(danger)
- **LOT (화면에서 합성, `salesUi.tsx:149-162`)**: 불합격 → LOT_STATUS 라벨(CONSUMED 투입·소진 / SHIPPED 출고) → "검사 대기" → "합격" 순으로 판단
- **출하요청** SHIPMENT_REQUEST_STATUS: REQUESTED 배정 대기(wait), ALLOCATED 배정 확정 · 출고 대기(run), PARTIALLY_ISSUED 부분 출고(run), ISSUED 출고 완료(ok), CANCELLED 취소(neutral)
- **출하요청 품목** SHIPMENT_REQUEST_ITEM_STATUS: WAITING_ALLOCATION 배정 대기(wait), ALLOCATED 배정 완료(run), ISSUED 출고 완료(ok)
- **PDF (화면 로컬 라벨, `shipmentUi.tsx:17`)**: PENDING PDF 미생성, READY PDF 준비됨, FAILED PDF 생성 실패
- **출고 화면 자격**
  - 제품 검사: INSPECTION_RESULT(PENDING 검사 대기 / PASS 합격 / FAIL 불합격) 또는 "검사 전"
  - 상위 히트: 합격 / 불합격 / 판정 전(코드에 직접 적음)
  - 재고: LOT_STATUS(IN_STOCK 재고)
- **코드에 직접 적은 라벨**: "출고 대기", "출고 완료", "발행 완료", "발행 없음", "작성 중", "추천" / "대안", "시스템"(`SalesOrderCreatePage.tsx:358`, `SalesOrderDetailPage.tsx:366`)

---

## B. API 의존성 (목업 작성용)

**공통 규칙**
- 기본 경로 `/api/v1`
- 응답 형식: `{success:true, data}` 또는 `{success:false, error:{code,message}}`(`client.ts:42-51`)
- 인증: Bearer 헤더
- GET 쿼리에서 undefined·null·빈 문자열은 뺍니다.
- POST 본문 기본값은 `{}`
- 톤·치수·이론중량은 문자열입니다.

### B-1. 수주 (`salesOrders.ts`)
1. **`salesOrderApi.list(q)`** — `GET /sales-orders`
   - 쿼리: status, customerId, itemType, dueFrom, dueTo, keyword, deliveryRiskOnly(true일 때만), page, size
   - 응답 `SalesOrderListView`: `{rows: SalesOrderView[], total, page, size}`
   - `SalesOrderView`
     - id, salesOrderNo
     - customer{id, customerCode, customerName}
     - dueDate('YYYY-MM-DD')
     - ownerEmployee{id, employeeNo, employeeName}
     - note|null
     - salesOrderStatus, isCancelled, cancelledAt|null, cancelReason|null
     - orderedQty, orderedTon, shippedQty, shippedTon
     - progressRate(소수 1자리, 버림), daysToDue, isDeliveryRisk
     - workRoomId|null, createdAt
     - items: `SalesOrderItemView[]`
   - `SalesOrderItemView`
     - id, lineNo, productSpecId, specCode, itemType('SLAB'|'COIL'), qtyUnit
     - steelGradeCode, thicknessMm, widthMm, lengthMm, theoreticalWeightTon
     - salesOrderItemStatus
     - orderedQty, orderedTon, shippedQty, shippedTon
     - reservedQty, passedQty, inProductionQty, unsecuredQty, additionalPlanNeededQty, cancelledQty
     - progressRate
2. **`salesOrderApi.get(id)`** — `GET /sales-orders/:id` → `SalesOrderView`. 정의만 있고 쓰는 곳이 없습니다.
3. **`salesOrderApi.fulfillment(id)`** — `GET /sales-orders/:id/fulfillment` → `FulfillmentView`
   - `SalesOrderView`에서 items를 뺀 모양 + items: `FulfillmentItemView[]`
   - `FulfillmentItemView` = `SalesOrderItemView` + 아래 두 배열
   - productionPlans `{id, productionPlanNo, productionPlanStatus(str), isReproduction, shortageQty, remainingTargetQty, heatCount, plannedSlabQty, surplusUseQty}`
   - lots `{id, lotNo, lotType, lotStatus, isPassed|null, heatNo|null, isHeatPassed|null, producedAt, productionPlanId|null, allocationPurpose 'SHIPMENT'|'ROLLING'|null, allocationStatus 'CONFIRMED'|'CONSUMED'|null}`
4. **`salesOrderApi.reservations(id)`** — `GET /sales-orders/:id/reservations` → `ReservationView[]`
   - `{id, salesOrderItemId, lineNo, productSpecId, specCode, itemType, reservedQty, reservedTon, status, isAutoReserved, createdAt, updatedAt}`
5. **`salesOrderApi.create(body, key)`** — `POST /sales-orders`, 헤더 `Idempotency-Key`
   - 본문 `{customerId, dueDate, note?, items:[{productSpecId, orderedQty}]}`
   - 응답 `SalesOrderView`
6. **`salesOrderApi.cancel(id, reason?)`** — `POST /sales-orders/:id/cancel`
   - 본문 `{reason}` 또는 `{}`
   - 응답 `SalesOrderView`
7. **`salesOrderApi.openWorkRoom(id)`** — `GET /chat-rooms/work-room?salesOrderId=` → `{id, displayName}`. 방을 찾고, 없으면 만들고, 부른 사람을 멤버로 넣습니다.

### B-2. 기준정보·재고·작업 로그
8. **`lookupApi.get`** — `GET /master-data/lookups`
   - 화면이 쓰는 것: customers `{id, customerCode, customerName}`, productSpecs `{id, specCode, itemType, steelGradeId, steelGradeCode, thicknessMm, widthMm, lengthMm, theoreticalWeightTon, mappedSpecId}`
   - 그 밖의 필드: steelGrades, rawMaterials, suppliers, yards, productionSetting{heatCapacityTon, deliveryRiskDays}|null
9. **`inventoryApi.list({})`** — `GET /inventories`
   - 응답 `{products: ProductInventoryView[], rawMaterials[]}`
   - 화면은 products의 productSpecId, availableQty만 씁니다.
   - 나머지 필드: specCode, itemType, qtyUnit, steelGrade*, 치수, theoreticalWeightTon, yardName, onHandQty, reservedQty, pendingInspectionQty, failedQty, earmarkedQty, *Ton
10. **`businessEventApi.list({salesOrderId, order:'desc', limit})`** — `GET /business-events`
    - 응답 `{items: BusinessEventView[], nextCursor, hasMore, order}`
    - 화면이 쓰는 필드: id, occurredAt, actorType, actorLabel, eventTypeLabel, summary, reason
    - 나머지 필드: actor, eventType, target*, salesOrderNo, lotIds, lots, before, after, reasonCode, isAiAssisted, messageId, actionDraftId, isLineageOnly

### B-3. 출하요청·출고·밀시트 (`shipments.ts`)
11. **`shipmentRequestApi.list(q)`** — `GET /shipment-requests`(`?status`)
    - 응답 `ShipmentRequestView[]`, 페이지 없음
    - 쿼리 타입에 customerId, salesOrderId, shipFrom, shipTo, keyword가 있지만 화면은 쓰지 않습니다.
    - `ShipmentRequestView`
      - id, shipmentRequestNo, customer
      - requestedShipDate, shipmentRequestStatus
      - requester{id, employeeNo, employeeName}|null, memo|null, cancelledAt|null, createdAt
      - requestQty, requestTon, allocatedQty
      - items: `ShipmentRequestItemView[]`
      - goodsIssue `{id, goodsIssueNo, confirmedAt|null, confirmedEmployee|null}`|null
      - millSheets `{id, millSheetNo, salesOrderId, pdfStatus}[]`
    - `ShipmentRequestItemView`
      - id, lineNo, salesOrderItemId, salesOrderId, salesOrderNo, salesOrderLineNo
      - productSpecId, specCode, itemType, qtyUnit, steelGradeCode, theoreticalWeightTon
      - requestQty, requestTon, allocatedQty, shipmentRequestItemStatus
      - allocations `{id, lotId, lotNo, lotType, heatNo|null, producedAt, status, confirmedAt}[]`
12. **`shipmentRequestApi.get(id)`** — `GET /shipment-requests/:id` → `ShipmentRequestView`
13. **`shipmentRequestApi.shippable()`** — `GET /shipment-requests/shippable` → `ShippableItemView[]`
    - `{salesOrderItemId, salesOrderId, salesOrderNo, lineNo, customer, dueDate, productSpecId, specCode, itemType, qtyUnit, steelGradeCode, theoreticalWeightTon, orderedQty, shippedQty, reservedQty, requestedQty, shippableQty, shippableTon}`
14. **`shipmentRequestApi.create(body)`** — `POST /shipment-requests`
    - 본문 `{customerId, requestedShipDate, memo?, items:[{salesOrderItemId, requestQty}]}`
    - 응답 `ShipmentRequestView`
15. **`shipmentRequestApi.cancel({id, reason})`** — `POST /shipment-requests/:id/cancel {reason?}` → `ShipmentRequestView`
16. **`shipmentRequestApi.confirmGoodsIssue({id, idempotencyKey})`** — `POST /shipment-requests/:id/goods-issue`, 헤더 `Idempotency-Key`, 본문 `{}` → `GoodsIssueView`
17. **`goodsIssueApi.list(q)`** — `GET /goods-issues`(`?shipmentRequestId`) → `GoodsIssueView[]`
    - `GoodsIssueView`
      - id, goodsIssueNo, goodsIssueStatus
      - confirmedAt|null, confirmedEmployee|null
      - shipmentRequestId, shipmentRequestNo, customer
      - issuedQty, issuedTon
      - items `{shipmentRequestItemId, salesOrderItemId, salesOrderId, salesOrderNo, salesOrderLineNo, productSpecId, specCode, itemType, qtyUnit, steelGradeCode, issuedQty, issuedTon, orderedQty, shippedQty, salesOrderItemStatus, lots:{lotId, lotNo, heatNo}[]}[]`
      - millSheets
18. **`millSheetApi.list()`** — `GET /mill-sheets` → `MillSheetListItem[]`
    - `{id, millSheetNo, issuedAt, pdfStatus, goodsIssueId, goodsIssueNo, salesOrderId, salesOrderNo, lineNo, customerId, customerName, specCode, itemType, steelGradeCode, qty, qtyUnit, weightTon, heatNos[]}`
19. **`millSheetApi.get(id)`** — `GET /mill-sheets/:id` → `MillSheetView`
    - `{id, millSheetNo, goodsIssueId, salesOrderId, customerId, issuedAt, pdfStatus, pdfUrl|null, snapshot}`
    - snapshot
      - millSheetNo, issuedAt
      - customer{customerCode, customerName}
      - salesOrder{salesOrderId, salesOrderNo, salesOrderItemId, lineNo}
      - shipment{shipmentRequestNo, goodsIssueNo, goodsIssuedAt}
      - productSpec{specCode, itemType, steelGradeCode, steelGradeName, standardNo|null, 치수 3개, theoreticalWeightTon}
      - qty, qtyUnit, weightTon
      - heats `{heatNo, composition: Inspection|null}[]`
      - lots `{lotNo, lotType, heatNo, producedAt, inspection|null, parentSlab:{lotNo, inspection}|null}[]`
    - Inspection = `{qualityInspectionNo, processCode, inspectionResult, inspectedAt|null, values:{inspectionItemCode, inspectionItemName, unit, minValue, maxValue, measuredValue, isPassed}[]}`
20. **`millSheetApi.generatePdf(id)`** — `POST /mill-sheets/:id/pdf` → `MillSheetView`. 실패하면 500 SHP-001.
21. **PDF 파일** — `GET /mill-sheets/:id/pdf?access_token=…`(`fileUrl`, `client.ts:67-70`)

### B-4. 배정 (`shipmentAllocations.ts`)
22. **`shipmentAllocationApi.recommend(itemId)`** — `POST /allocations/recommend {purpose:'SHIPMENT', shipmentRequestItemId}`
    - 응답: purpose, shipmentRequestItemId, shipmentRequestId, productionPlanId, salesOrderItemId, salesOrderNo, salesOrderLineNo, productSpecId, specCode, requiredQty, confirmedQty, neededQty, recommendedLots[], shortageQty, candidateLots[](FIFO 순, 최대 200), confirmedAllocations[]
    - LOT 모양: `{lotId, lotNo, lotType, heatNo, producedAt, yardName, isEarmarked}`
23. **`shipmentAllocationApi.confirm`** — `POST /allocations`
    - 본문 `{purpose:'SHIPMENT', shipmentRequestItemId, lotIds, releaseAllocationIds?, reason?}`
    - 응답 `{purpose, shipmentRequestItemId, shipmentRequestId, productionPlanId, allocations[], releasedAllocationIds, recommendedLotNos, isRecommendationFollowed, neededQty, shipmentRequestItemStatus, shipmentRequestStatus}`
24. **`shipmentAllocationApi.release({id, reason})`** — `POST /allocations/:id/release {reason?}`
    - 응답 `{id, purpose, status, lotId, lotNo, shipmentRequestItemStatus, shipmentRequestStatus}`

### B-5. 기타
25. **`lotApi.detail(lotId)`** — `GET /lots/:id` → `LotDetail`. 출고 화면이 쓰는 필드: isPassed, heat.isPassed, lotStatus, lotStatusLabel, inspectionResult, isEligible.
26. **`allocationApi`(`allocations.ts`)** — 위 3개 엔드포인트의 범용판(purpose: AllocationPurpose, productionPlanId 대상). 이 영역 화면은 쓰지 않습니다(열연 투입 화면용). `shipmentAllocations.ts`와 타입이 거의 겹칩니다.

### B-6. 쿼리 키와 다시 불러오기 주제 (실시간 목업용)
- **쿼리 키**
  - `['sales-orders','list',q]`, `['sales-orders','fulfillment',id]`, `['sales-orders','reservations',id]`
  - `['master-data','lookups']`(60초 유지), `['inventories','list',{}]`, `['business-events','sales-order',id,limit]`
  - `['shipment-requests','list',{}|{status}]`, `['shipment-requests','detail',id]`, `['shipment-requests','shippable']`
  - `['allocations','recommend','SHIPMENT',itemId]`(staleTime 0)
  - `['goods-issues','list',{}]`, `['goods-issues','by-request',id]`, `['lots','detail',lotId]`
  - `['mill-sheets','list',{}]`, `['mill-sheets','detail',id]`
- **변경 후 다시 불러오는 주제**
  - 수주 등록: sales-orders, inventories, production-plans, chat-rooms, business-events
  - 수주 취소: sales-orders, inventories, production-plans, shipment-requests, allocations, business-events
  - 출하요청 등록: shipment-requests, sales-orders
  - 출하요청 취소: shipment-requests, allocations, lots, inventories, sales-orders
  - 배정 확정·해제: shipment-requests, allocations, lots, inventories
  - 출고 확정: shipment-requests, goods-issues, mill-sheets, allocations, lots, inventories, sales-orders
  - PDF 생성: mill-sheets
  - 업무방 열기: chat-rooms

---

## C. 문서 대비 갭 분석

### C-1. 요구사항 충족 여부

**영업·수주 (SO)**
| REQ | 판정 | 근거 |
|---|---|---|
| SO-001 수주 등록 | 충족 | 행마다 품목 유형 선택(`SalesOrderCreatePage.tsx:191-195`), "코일·슬래브 혼합"(180) |
| SO-002 수주 수량 | 충족 | 정수 검증(28-34), 문구가 SO-002와 같음(20), 매/개 표시(228), 톤 계산값 + "계산값" 태그(88, 235), 저장 본문에 톤 없음(127). 본문 키는 productSpecId(프로세스 12.2는 itemId) |
| SO-003 재고 우선 예약 | 충족(화면은 예상치) | 예상 예약·부족 미리보기(74-98, 291-365), 결과는 토스트(113) 후 상세로 이동. 단계 "3 · 저장·예약 결과"(284)에 해당하는 화면은 없음 |
| SO-004 충족 현황 | 충족 | 상세 탭(`SalesOrderDetailPage.tsx:186-243`), 목록 미리보기(280-294). BP-SO-02 "상세의 탭"과 일치 |
| SO-005 부분 출하 상태 | 부분 | 품목·헤더 상태 표시는 있음(208, 148). 코드값이 정의서와 다름(C-3-1) |
| SO-006 수주 취소 | 부분 | 취소 모달(`CancelOrderModal.tsx:61-95`)과 취소 배너는 있음. SO-003·SO-004와 충돌(C-5-6) |

**재고·예약·배정 (INV)**
| REQ | 판정 | 근거 |
|---|---|---|
| INV-001 재고 관리 | 부분 | 등록 화면 "합격 가용재고 n"(243, 337). 재고 화면은 영역 밖 |
| INV-002 예약 | 충족 | 예약 이력 탭(352-380) |
| INV-003 예약 대상(합격 재고) | 부분 | 문구만 있음(243, 300). 판단은 서버 |
| INV-004 자동 예약 | 충족(표시) | 검사합격 열(193, 213), 예약 이력 "자동 예약"(366) |
| INV-005 예약 해제 | 충족(표시) | 출고 "CONVERTED"(`GoodsIssuePage.tsx:342, 378, 387`), 취소 "예약 해제"(`CancelOrderModal.tsx:83`) |
| INV-006 배정 | 대부분 충족 | FIFO 추천·선택·확정·변경·해제(`AllocationItemCard.tsx:36-89, 141-147, 267-278`), "추천은 저장하지 않음"(`ShipmentRequestDetailPage.tsx:132`). "배정 대기"를 저장 상태 코드로 표현(C-3-3) |
| INV-007 불합격 LOT 제외 | 부분 | 출고 화면 자격 표시, "출고 불가 LOT"(`GoodsIssuePage.tsx:258, 294-296`), INV-002 안내(242). 후보에서 빼는 것은 서버 |
| INV-008 여재 | 해당 적음 | "여재 사용" 열(`SalesOrderDetailPage.tsx:313`), 취소 안내(`CancelOrderModal.tsx:86`) |
| INV-009 중복 방지 | 부분 | Idempotency-Key가 수주 등록(43)과 출고 확정(`GoodsIssuePage.tsx:158`)에만 있음. 출하요청 등록·배정 확정·취소에는 없음 |

**출하·메신저·작업 로그**
| REQ | 판정 | 근거 |
|---|---|---|
| SHP-001 출하요청 | 부분 | 여러 품목을 묶어 등록은 됨. "요청 시 배정 추천"이 자동이 아님: 등록 후 품목마다 [FIFO 추천]을 눌러야 함(`AllocationItemCard.tsx:103-107`). 그런데 버튼 문구는 "출하요청 등록 · 배정 추천"(`ShipmentRequestCreatePage.tsx:201, 350`) |
| SHP-002 출고 확정 | 충족 | 확정(198-201), 사전 점검(321-337), 거부 안내(242-244) |
| SHP-003 밀시트 자동 생성 | 충족(표시) | 출고 결과에 밀시트(409-419), 스냅샷만으로 그림(`MillSheetPaper.tsx`) |
| SHP-004 밀시트 조회·PDF | 충족 | 조회와 PDF 생성·재시도(`MillSheetPage.tsx:174-197`). PDF 상태값 문제는 C-3-11 |
| MSG-006 ERP 화면 이동 | 부분 | 수주 → 업무방 방향만(`salesUi.tsx:181-192`). 반대 방향은 영역 밖 |
| LOG-003 수주 타임라인 | 부분 | 상세 탭은 최근순 50건(`SalesOrderDetailPage.tsx:22, 400`). 시간순 전체는 작업 로그 화면 링크로 넘김(401) |

### C-2. 용어 사전 위반·차이
1. **"주문"** — TRM-038 사용 금지 동의어입니다. 화면 문구 위치:
   - `SalesOrderListPage.tsx`: 185(열 "주문 수량"), 317
   - `SalesOrderCreatePage.tsx`: 293("주문 합계"), 318(열)
   - `SalesOrderDetailPage.tsx`: 113, 191(열), 196, 240, 253, 271, 419
   - `CancelOrderModal.tsx:42`(열), `salesUi.tsx:70`(스크린리더 라벨)
   - `ShipmentRequestCreatePage.tsx:244`(열), `GoodsIssuePage.tsx:389`("누적 출고 / 주문")
   - 참고: 프로세스 정의서 4.1·4.5는 "주문 수량·주문 매수"를 쓰고, TRM-107은 "수주 매수"를 써서 문서끼리도 다릅니다.
2. **"가용 재고"(띄어 씀)** — TRM-055 금지어입니다. `SalesOrderCreatePage.tsx:300, 359`. 한글명은 "가용재고"이고 같은 파일의 다른 곳은 맞게 씁니다. REQ-SO-003 원문도 띄어 씁니다.
3. **"선입선출"** — `SalesOrderDetailPage.tsx:291`. TRM-061 한글명은 "FIFO"입니다.
4. **"검사증명서"** — `MillSheetPaper.tsx:98`. TRM-082 한글명은 "밀시트"이고, 이 별칭은 등록돼 있지 않습니다(금지어는 "성적서"만).
5. **"출고번호"** — `MillSheetPaper.tsx:105`. 용어 사전과 9.1에 없는 업무 번호입니다(C-4-4).
6. **"출하번호"** — 출하요청 번호를 이렇게 부릅니다: `ShipmentRequestListPage.tsx:87, 101`, `ShipmentRequestCreatePage.tsx:317`, `GoodsIssuePage.tsx:58`, `ShipmentRequestMaster.tsx:44`. 엔티티명은 TRM-080 "출하요청"입니다(BP-LOT-01은 "출하번호"를 써서 문서끼리 섞여 있음).
7. **"생산 필요"** — `SalesOrderCreatePage.tsx:303, 320, 362`. 같은 화면 244·349는 "부족"을 씁니다. 용어는 TRM-041 "부족 매수"입니다.
8. **"남음"** — `salesUi.tsx:86`, `SalesOrderListPage.tsx:246`, `SalesOrderDetailPage.tsx:271`. 같은 값을 프로세스 4.5는 "추가 계획 필요 매수"라고 부릅니다.
9. **상태 표시명 차이**: "진행 중"(정의서 "진행중"), "출고 대기"(정의서는 ALLOCATED = "배정 확정"), "배정 완료"(정의서에 없음), "검사 대기"·"판정 전"·"검사 전"(PENDING은 "판정 대기"), "생산 중"(계획 IN_PROGRESS는 "진행중"), "투입·소진"("투입 소진"). 위치는 C-3에 정리했습니다.
10. **사용 금지어 검사 결과**: 오더·할당·선점·거래처·성적서·출하 확정·잔재·잉여재고·슬라브·로트·원자재·공급사·협력사·팀장은 영역 파일 grep에서 0건입니다.

### C-3. 코드값·한글 라벨이 공통 코드 정의서와 다른 곳
1. **SALES_ORDER_ITEM_STATUS / 헤더 상태**
   - 정의서: OPEN 진행중 / PARTIALLY_SHIPPED 부분출하 / SHIPPED 출하완료 / CANCELLED 취소
   - 코드: REGISTERED 접수 + IN_PROGRESS 진행 중(`shared/src/codes/index.ts:113-123`, 집계 함수 124-131)
   - 사용처: `salesUi.tsx:19-26`(STATUS_TONE·STATUS_KEYS·StatusBadge), `SalesOrderListPage.tsx:36, 100-104, 160, 197, 288`, `SalesOrderDetailPage.tsx:68`(status 'IN_PROGRESS'), 86, 110, 208, `CancelOrderModal.tsx:47`, `GoodsIssuePage.tsx:402`, `salesOrders.ts:18, 49, 68`
2. **SHIPMENT_REQUEST_STATUS**
   - 코드에 정의서에 없는 PARTIALLY_ISSUED "부분 출고"가 있습니다(shared:172-176, `shipmentUi.tsx:13`). `ShipmentRequestListPage.tsx:13-14`는 "서버가 쓰지 않는다"고만 적어 둠.
   - ALLOCATED 라벨: 정의서 "배정 확정", 코드 "배정 확정 · 출고 대기"(shared:175)
   - 코드에 직접 적은 다른 라벨: `ShipmentRequestMaster.tsx:49`·`GoodsIssuePage.tsx:76` "출고 대기", `GoodsIssuePage.tsx:102` "출고 완료"
3. **SHIPMENT_REQUEST_ITEM_STATUS**(WAITING_ALLOCATION / ALLOCATED / ISSUED, "배정 완료" 포함)
   - 정의서에 이 그룹이 없습니다. 정의서는 "배정 대기 = 출하요청 품목의 미배정 상태로 표현"하고, TRM-115는 "요청 매수 − 확정 배정 > 0이면 배정 대기"로 계산합니다.
   - 사용처: shared:169-171, `shipments.ts:41`, `shipmentAllocations.ts:71, 81`, `shipmentUi.tsx:14, 23-25`, `AllocationItemCard.tsx:32, 102, 258`, `ShipmentRequestDetailPage.tsx:43`
4. **ALLOCATION_PURPOSE**: 정의서 SHIPMENT / HOT_ROLLING, 코드 SHIPMENT / ROLLING
   - shared:203-205, `salesOrders.ts:105`, `SalesOrderDetailPage.tsx:342`, `allocations.ts:2-8`, `shipmentAllocations.ts:2`(주석)
   - 라벨 "출하 / 열연 투입"은 정의서와 같습니다.
5. **RESERVATION_STATUS·ALLOCATION_STATUS**: 값과 라벨 모두 정의서와 같습니다.
6. **LOT_STATUS**: 정의서 AVAILABLE "재고" / CONSUMED "투입 소진", 코드 IN_STOCK / "투입·소진"
   - shared:191-193, `salesUi.tsx:155, 160`, `GoodsIssuePage.tsx:148, 189, 296`
7. **INSPECTION_RESULT**: PENDING 라벨이 정의서 "판정 대기", 코드 "검사 대기"
   - shared:162, `GoodsIssuePage.tsx:294`, `MillSheetPaper.tsx:18`
   - 코드에 직접 적은 라벨: `salesUi.tsx:154-156`, `GoodsIssuePage.tsx:294-295`
8. **PRODUCTION_PLAN_STATUS**: 정의서에 없는 CONFIRMED "편성 확정"이 있고, IN_PROGRESS 라벨이 "생산 중"(정의서 "진행중")
   - shared:133-137, `salesUi.tsx:146-147`, `SalesOrderListPage.tsx:303`, `SalesOrderDetailPage.tsx:257, 264, 319, 426`, `CancelOrderModal.tsx:21`
9. **PROCESS_TYPE**: 코드는 그룹 이름이 PROCESS_CODE이고 CASTING을 씁니다(정의서 CONTINUOUS_CASTING). `MillSheetPaper.tsx:3, 20, 176`, `shipments.ts:164`
10. **PERMISSION**
    - 코드 → 정의서 이름: ORDER_CREATE → SALES_ORDER_CREATE, ORDER_CANCEL → SALES_ORDER_CANCEL, SHIPMENT_REQUEST → SHIPMENT_REQUEST_MANAGE, MILLSHEET_READ → MILL_SHEET_READ. GOODS_ISSUE_CONFIRM만 같습니다.
    - 사용처:
      - `SalesOrderListPage.tsx:40`
      - `SalesOrderCreatePage.tsx:39`
      - `SalesOrderDetailPage.tsx:78, 126, 128`
      - `ShipmentRequestListPage.tsx:19`, `ShipmentRequestCreatePage.tsx:33`, `ShipmentRequestDetailPage.tsx:19`
      - `AllocationItemCard.tsx:22`(주석)
      - `MillSheetPage.tsx:20`
      - `nav.ts:23-27, 47, 50-51`, `shellData.ts:48`
      - shared:64-94
11. **PDF 상태**(PENDING / READY / FAILED)
    - 정의서 4장은 "공통코드로 만들지 않음, 밀시트 PDF는 경로 유무로 판단"이라고 하고, 프로세스 변경 이력에도 "PDF 작업 상태 삭제"가 있습니다.
    - 코드: shared:180-181, 화면 로컬 라벨 `shipmentUi.tsx:16-18, 29-31`, `shipments.ts:7, 208, 232-234`, `MillSheetPage.tsx:79, 143, 148-150, 165`, `GoodsIssuePage.tsx:415`
12. **GOODS_ISSUE_STATUS(CONFIRMED)**: 정의서에 없습니다(shared:177, `shipments.ts:132`). 화면에 표시하지는 않습니다.
13. **ERROR_CODE**: shared:284-306에 SO-003, SO-004, SHP-002, SHP-003이 없습니다. COM-003 설명도 다릅니다(shared "입력값이 올바르지 않습니다", 프로세스 9.3 "참조 대상이 없습니다").
14. **BUSINESS_EVENT_TYPE**: 정의서는 SALES_ORDER_CREATED, SHIPMENT_REQUEST_CREATED 등, shared는 SALES_ORDER_REGISTERED, SHIPMENT_REQUESTED 등입니다. 화면은 서버가 주는 eventTypeLabel을 그대로 보여 줘서 간접적으로만 영향을 받습니다.
15. **일치하는 것**: ITEM_TYPE(슬래브·코일), 수량 단위 매·개, ACTOR_TYPE(시스템), ROLE

### C-4. 문서에 없는 기능·필드·데이터
1. **수주 "비고"(note)**: `SalesOrderCreatePage.tsx:174-175`, `SalesOrderDetailPage.tsx:153`, `salesOrders.ts:47, 135`. BP-SO-01 입력과 11장 sales_order에 없습니다.
2. **출하요청 "메모"(memo)**: `ShipmentRequestCreatePage.tsx:329-333`, `ShipmentRequestDetailPage.tsx:94-99`
3. **출하요청 "요청자"(requester)**: `ShipmentRequestCreatePage.tsx:325-328`, `ShipmentRequestListPage.tsx:128`, `ShipmentRequestDetailPage.tsx:86`. 11장 shipment_request에 없습니다.
4. **출고 엔터티·출고번호**
   - goodsIssueNo, `GET /goods-issues`, "최근 출고" 목록이 있습니다: `GoodsIssuePage.tsx:30, 62, 96-117, 370-423`, `ShipmentRequestDetailPage.tsx:112`, `MillSheetPaper.tsx:105-106, 192`, `MillSheetPage.tsx:30-36, 71`
   - TRM-081은 "별도 테이블 없음, 출하요청에 출고 시각·확정자 기록"이고, 9.1에도 출고 번호 형식이 없습니다.
5. **품질검사 번호 "검사번호"**(qualityInspectionNo): `MillSheetPaper.tsx:36, 56`. 9.1에 형식이 없습니다.
6. **PDF 상태 배지와 "PDF 다시 생성" 상태 판단**: C-3-11 참고
7. **업무방 자동 멤버 문구** "수주 담당자와 생산·품질·물류·구매 부서장": `SalesOrderListPage.tsx:333`, `SalesOrderCreatePage.tsx:370`, `SalesOrderDetailPage.tsx:302`. REQ-MSG-001은 "멤버는 조직 정보에서 선택"입니다.
8. **알림 동작 문구**: "물류 담당에게 '출고 대기' 알림이 갔어요"(`ShipmentRequestDetailPage.tsx:104`), "수주 담당에게 알림"(`GoodsIssuePage.tsx:345`)
9. **납기 위험 배지·필터·칩**
   - `SalesOrderListPage.tsx:106-109, 209`, `SalesOrderDetailPage.tsx:87, 149`, `salesUi.tsx:27-29`
   - 개념은 TRM-107과 공통코드 비고("계산 표시값")에 있지만, 화면 요구로 적힌 곳은 Agent(P2)와 대시보드(P3)뿐입니다.
   - 빠른 칩 "D-7 이내"·"이번 달"(145-146)도 문서에 없습니다.
10. **목록 필터·미리보기 패널**: 고객사·품목 유형·납기 범위·키워드 필터와 미리보기 패널은 B안 UI이고 요구사항에 명시된 것은 아닙니다.
11. **진행률 공식** "(예약 + 검사합격 + 출하) ÷ 주문"과 "확보" 개념: `SalesOrderDetailPage.tsx:240`. REQ-SO-004는 "진행률"이라는 말만 있고 공식을 정하지 않습니다(프로세스 4.5는 "분모를 명시하라"고만 함).
12. **생산계획 열 "히트 / 계획 슬래브 / 여재 사용"**(heatCount, plannedSlabQty, surplusUseQty): `SalesOrderDetailPage.tsx:313`
13. **밀시트 표시 요소**: "종합 판정"(`MillSheetPaper.tsx:72-77, 194-197`), "FantaSteel 제철소"(94, SPEC 9-18은 제품명 "FantaSteel"까지만), 코일의 "압연 전 슬래브 검사" 절(180-185)은 REQ-SHP-003을 확장 해석한 것입니다.
14. **날짜 검증 규칙**: 납기 "오늘 이후"(`SalesOrderCreatePage.tsx:102`), 출하 요청일 "오늘 이후"(`ShipmentRequestCreatePage.tsx:93`). 문서에 없는 규칙입니다.
15. **"등록한 사원이 담당"** 규칙: `SalesOrderCreatePage.tsx:173`. 11장에 owner_employee_id는 있지만 이 규칙은 없습니다.

### C-5. 업무 규칙 불일치 (업무 프로세스 정의서 기준)
1. **수량 정수 검증 (4.1: 소수·0·음수 거부, 변환하지 않음)**
   - 수주 등록은 맞습니다(`SalesOrderCreatePage.tsx:20, 28-34`).
   - **출하 매수 입력은 숫자가 아닌 글자를 지워 버립니다**(`ShipmentRequestCreatePage.tsx:103`). 그래서 "10.5"가 "105"로, "-3"이 "3"으로 조용히 바뀝니다.
   - 출하 쪽 오류 문구는 "1 이상의 정수로 입력해 주세요"로 SO-002 문구와 다릅니다(21, 23).
2. **톤 계산**
   - 수주 등록은 shared의 calcWeightTon과 sumTon을 씁니다.
   - 출하요청 미리보기 합계는 `Number()`로 부동소수 합산합니다(`ShipmentRequestCreatePage.tsx:91, 220`). 4.1은 "십진수 연산"을 요구합니다. 표시는 3자리로 맞춥니다.
3. **납기 위치**
   - 11장: `sales_order_item.due_date`(품목 납기, REQ-AGT-004)
   - 화면·API: 수주 헤더에 납기 1개
     - `SalesOrderCreatePage.tsx:48, 125, 165-171`
     - `salesOrders.ts:44-45, 134`
     - `SalesOrderListPage.tsx:61-62, 212`
     - `SalesOrderDetailPage.tsx:150`
   - 출하요청 등록의 수주 그룹 납기도 첫 행 값을 씁니다(`ShipmentRequestCreatePage.tsx:79, 144`).
4. **같은 고객사 수주 품목만 묶기**: 지킵니다. 고객사 선택을 강제하고(71, 96, 173), 본문에 customerId를 넣습니다(107).
5. **부분 출하·출고 단위·예약 CONVERTED**: 출고 확정은 출하요청 단위이고(SPEC 9-15, `GoodsIssuePage.tsx:127`), 전환 표시도 있습니다(342, 378). 일치합니다.
6. **수주 취소 에러 코드 SO-003·SO-004 (9.3, 2026-10-01 추가)**
   - SO-003 "출고된 매수가 있는 수주는 취소할 수 없습니다"와 다릅니다. 화면은 전량 출하만 막고(`SalesOrderDetailPage.tsx:127`), 부분 출하 수주는 잔량만 취소한다고 안내합니다(`CancelOrderModal.tsx:87, 55`). 16장 TBD 제안("잔량만 취소")과는 맞습니다.
   - SO-004 "진행 중인 출하요청을 먼저 취소해 주세요"와 정반대입니다. 화면은 "아직 출고하지 않은 출하요청은 요청 전체가 취소"된다고 안내합니다(`CancelOrderModal.tsx:84`).
7. **SHP-002·SHP-003**
   - SHP-002: 화면이 먼저 막는 문구 "출하 가능 n까지 요청할 수 있어요"(`ShipmentRequestCreatePage.tsx:24`)가 서버 문구와 다르고, 서버 거부는 토스트로만 보입니다.
   - SHP-003: 출고 완료 요청에는 취소 버튼을 숨겨서(`ShipmentRequestDetailPage.tsx:41, 76`) 맞습니다.
8. **출고 API 경로**: 프로세스 12.2와 컨벤션 5장 예시는 `POST /shipment-requests/:id/issue`, 코드는 `/goods-issue`(`shipments.ts:255`)입니다.
9. **밀시트 스냅샷·PDF**
   - 스냅샷만 쓰고, PDF 실패 시 출고를 다시 하지 않는 점은 맞습니다(`MillSheetPage.tsx:191`, BP-SHP-01).
   - PDF 상태 코드는 맞지 않습니다(C-3-11).
   - 발행 단위: 화면은 "수주 품목마다 1장"(`GoodsIssuePage.tsx:344`, 스냅샷에 lineNo)이고, 9.1은 "MS-{출하요청 일련}-N, 수주별 순번"입니다. 해석에 따라 불일치일 수 있습니다.
10. **업무 번호 형식**: 화면은 서버 값을 그대로 보여 줄 뿐이라 화면 코드로는 SO-YYMM-NNN / DR-YYMM-NNNN / MS-… 형식을 확인할 수 없습니다. 문서에 형식이 없는 번호(goodsIssueNo, qualityInspectionNo)를 보여 주는 점만 확인됩니다.
11. **"요청 시 배정 추천" (REQ-SHP-001, BP-SHP-01)**: 자동이 아니라 품목마다 직접 눌러야 합니다(C-1 참고).
12. **생산완료일**: 컨벤션 5장은 date 타입인데 화면은 시각까지 보여 줍니다(`AllocationItemCard.tsx:135, 217`, `SalesOrderListPage.tsx:309`, `SalesOrderDetailPage.tsx:343`). 출고 화면과 밀시트는 날짜만 보여 줍니다.
13. **요청 고유키 (12.2 "변경 API에는 요청 고유키")**: 출하요청 등록, 배정 확정·해제, 출하요청·수주 취소에는 없습니다.
14. **화면 사이 불일치(소소함)**
    - 상세 옆 칸 진행률이 버림 없이 표시됩니다(`SalesOrderDetailPage.tsx:413`).
    - 목록 미리보기의 [출하요청 만들기]만 권한을 확인하지 않습니다(`SalesOrderListPage.tsx:273`).
    - 출하요청 취소 문구가 수량 값에 "건"을 붙입니다(`ShipmentRequestDetailPage.tsx:151`).
    - DateInput에 잘못된 날짜를 넣으면 부모 쪽 오류가 "납기를 입력해 주세요"로 나옵니다(`DateInput.tsx:81-84`).

### C-6. 코드 컨벤션 위반 (9장 프론트 중심)
1. **스타일 (9장 Tailwind 강제)**
   - client에 Tailwind가 없습니다(`client/package.json`). B안 hl-* 클래스, 별도 CSS 파일 4개(`SalesOrderListPage.css`·`SalesOrderCreatePage.css`·`SalesOrderDetailPage.css`·`MillSheetPage.css`), 인라인 style을 대량으로 씁니다.
   - 인라인 `style={` 개수 / 직접 쓴 hex 색 개수: List 55/11, Create 70/7, Detail 81/9, CancelModal 6/0, salesUi 17/7, SR List 11/0, SR Create 35/4, SR Detail 13/2, GoodsIssue 60/6, MillSheetPage 24/4, AllocationItemCard 25/4, MillSheetPaper 31/11, SR Master 13/2, shipmentUi 8/3, DateInput 2/0
   - SPEC 9-12 임시 결정("B안 CSS 그대로, 컨벤션에서 미정 항목")과 현재 컨벤션(Tailwind ✅ 확정)이 충돌합니다.
2. **프레임워크**: 컨벤션 0·1·9장은 Next.js App Router(`app/…/page.tsx`)입니다. 실제로는 Vite + react-router(`App.tsx`, `pages/*`)입니다.
3. **fetch·any·console**: 화면에서 fetch·axios를 직접 부르지 않고, any나 console.log도 없습니다.
   - 단, 조회를 영역별 커스텀 훅으로 묶지 않고 화면 안에서 `useQuery` + api 함수로 바로 부릅니다. 예: `SalesOrderListPage.tsx:68, 250`, `SalesOrderDetailPage.tsx:28, 69, 123`, `ShipmentRequestListPage.tsx:28`, `GoodsIssuePage.tsx:29-30, 140, 162-170`, `MillSheetPage.tsx:24, 127`, `AllocationItemCard.tsx:36-41`
   - 같은 쿼리 키가 여러 파일에 중복됩니다.
4. **토큰 처리 (6·9장: httpOnly 쿠키, credentials include, 프론트는 토큰을 다루지 않음)**
   - 토큰을 sessionStorage에 두고 Bearer 헤더로 보냅니다(`stores/auth.ts:4-6`, `client.ts:27-29`).
   - PDF는 토큰을 URL 쿼리(`access_token`)에 붙입니다(`client.ts:67-70` → `MillSheetPage.tsx:135, 143, 175`).
5. **GET 요청이 데이터를 바꿈 (5장: 상태 변경은 `POST /:id/동작`)**: `GET /chat-rooms/work-room`이 방을 만듭니다(`salesOrders.ts:148`).
6. **파일 이름 (2장)**
   - 컴포넌트를 담은 파일이 PascalCase가 아닙니다: `features/sales/salesUi.tsx`, `features/shipment/shipmentUi.tsx`
   - 훅이 UI 파일 안에 있습니다(`salesUi.tsx:167-178` useLookups·useOrderEvents). 규칙은 `use*.ts` 파일입니다.
7. **"order" 단독 사용 금지 (2장)**
   - `CancelOrderModal`(파일·컴포넌트, prop `order` :11), `OrderNoLink`(`salesUi.tsx:197`), `useOrderEvents`(172), `OrderMaster`(`SalesOrderDetailPage.tsx:59`)
   - `requestOrders`·`OrderLinks`(`shipmentUi.tsx:46, 51`), `presetOrderId`·`orderId`·`orderNo`·`orderNos`(`ShipmentRequestCreatePage.tsx:32, 75-79, 88`), `orders`(`ShipmentRequestDetailPage.tsx:45`, `ShipmentRequestMaster.tsx:57`)
   - `salesUi.tsx:175`의 `order:'desc'`는 정렬 방향이라 다른 개념입니다.
8. **공통코드 라벨을 shared 한 곳에 두는 규칙 (4장)**
   - 화면 로컬 라벨 맵: PDF_LABEL(`shipmentUi.tsx:17`)
   - 코드에 직접 적은 상태 문구: `GoodsIssuePage.tsx:76, 102, 295`, `ShipmentRequestMaster.tsx:48-49`, `MillSheetPage.tsx:60-61, 164`, `salesUi.tsx:154-156`
9. **용어 사전에 없는 변수명 (2장, SPEC 4)**: requestedShipDate, memo, requester, note, goodsIssueNo, qualityInspectionNo, shippableQty, passedQty, inProductionQty, unsecuredQty, additionalPlanNeededQty, progressRate, isDeliveryRisk, daysToDue, workRoomId, plannedSlabQty, surplusUseQty. 용어 사전과 11·12장에는 없습니다(`docs/names`는 지시에 따라 확인하지 않음).
10. **기타**
    - `eslint-disable react-hooks/exhaustive-deps`(`SalesOrderCreatePage.tsx:67`)
    - 도우미 중복: unitOf(`salesUi.tsx:35-38` vs `shipmentUi.tsx:59-62`, 동작도 다름), 배정 타입(`allocations.ts` vs `shipmentAllocations.ts`), LOT·작업 로그 링크를 곳곳에 직접 적음(`GoodsIssuePage.tsx:223`, `MillSheetPage.tsx:172-173`, `ShipmentRequestDetailPage.tsx:75`)
    - 쓰지 않는 코드: `salesOrderApi.get`, 목록 API의 서버 필터 파라미터. 출하요청·밀시트·출고 목록을 전부 받아서 화면에서 거릅니다.
    - 출고 화면은 LOT마다 상세를 따로 조회합니다(N+1, `GoodsIssuePage.tsx:162-164`).
    - `@/` 별칭과 named export 규칙은 지킵니다.

---

## 부록: 지정 파일 전부 읽음 (wc -l 기준)
| 파일 | 줄 수 |
|---|---|
| pages/sales/SalesOrderListPage.tsx | 339 |
| pages/sales/SalesOrderListPage.css | 9 |
| pages/sales/SalesOrderCreatePage.tsx | 378 |
| pages/sales/SalesOrderCreatePage.css | 11 |
| pages/sales/SalesOrderDetailPage.tsx | 471 |
| pages/sales/SalesOrderDetailPage.css | 10 |
| features/sales/CancelOrderModal.tsx | 96 |
| features/sales/salesUi.tsx | 199 |
| pages/shipment/ShipmentRequestListPage.tsx | 161 |
| pages/shipment/ShipmentRequestCreatePage.tsx | 362 |
| pages/shipment/ShipmentRequestDetailPage.tsx | 156 |
| pages/shipment/GoodsIssuePage.tsx | 423 |
| pages/shipment/MillSheetPage.tsx | 207 |
| pages/shipment/MillSheetPage.css | 11 |
| features/shipment/AllocationItemCard.tsx | 281 |
| features/shipment/MillSheetPaper.tsx | 206 |
| features/shipment/ShipmentRequestMaster.tsx | 84 |
| features/shipment/shipmentUi.tsx | 136 |
| api/salesOrders.ts | 149 |
| api/shipments.ts | 269 |
| api/shipmentAllocations.ts | 99 |
| api/allocations.ts | 93 |
| components/DateInput.tsx | 171 |
| **합계** | **4321** |

모든 경로는 `/Users/mjkim/Documents/GitHub/fantasteel-erp/client/src/` 아래입니다. 23개 파일 모두 처음부터 끝까지 읽었습니다.