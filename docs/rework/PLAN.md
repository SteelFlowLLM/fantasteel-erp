# 화면 재작업 계획 — 2026-10-01 (사용자가 "시작"함, 브랜치 feature/screen-rework)

이 파일 하나만 읽으면 이어서 작업할 수 있게 정리했다. 근거 자료 위치는 0장에 있다.

## 0. 근거 자료 (scratchpad 기준 경로)
- 노션 6개 문서(기준): 기획안 3eafd8622270806a9adfcb5442d2c017 · 요구사항 3eafd86222708082b7d5d917cab5da14 · 용어 사전 3ebfd862227080e68127f2dadf67a855 · 업무 프로세스 3ebfd862227080b0beadf2f854f770c3 · 코드 컨벤션 3eafd862227080a3a7ecc25387aaf5e9 · 공통 코드 3ecfd862227080ad9553d6bcb92522f9
  - 로컬 사본: `docs/01~06-*.md`. 04번(업무 프로세스)은 `process.md`와 같다.
- KS 규격 정리(3ecfd862227081c9b880f4edadb4621d): 2026-10-01에 사용자가 읽기를 허용했다. 검사 기준 수치에만 쓴다. 사본은 `docs/07-KS-규격-정리.md`, 추출본은 `docs/ks-values.md`.
- ERD 최종본 https://claude.ai/artifact/Q2DZcpJ4Cgr2vxQTQ4qVbd: 화면 항목 참고용으로만 쓴다. 정리본은 `reports/erd-final.txt`(테이블 49·컬럼 443·관계 95).
- 지금 코드 조사 보고서(영역별, 파일:줄 근거 포함): `reports/1-sales-shipment.md`, `2-purchasing-mrp-actiondraft.md`, `3-production-inventory.md`, `4-quality-lot-log.md`, `5-admin-masterdata-login.md`, `6-collab-dashboard-p2.md`
- 저장소 `SPEC.md`·`CLAUDE.md`는 6개 문서 밖이다. 이전 작업의 결정 파일이므로 인용할 때 "저장소 SPEC.md"라고 밝힌다.
- 읽지 않는다: server/, prisma, docs/api, docs/names, docs/SERVER-GUIDE.md. 노션은 역할별 메뉴 (v2), 화면별 데이터·API 명세, API 명세서, 개발 스택·개발 환경 V2.
- `../v1`은 이 PC에 없다(B안 원본 화면 없음). 지금 client가 B안 모양을 옮겨 둔 것이다.

## 1. 사용자 결정 (2026-10-01, 이 대화)
1. 화면만 만든다. 백엔드·DB는 "아직" 만지지 않는다. server/, DB, 루트 실행 스크립트는 그대로 두고 화면만 따로 띄운다.
2. 기준은 노션 6개 문서다. ERD는 화면 항목 참고용이다.
3. 데이터는 브라우저 안 가짜 데이터로 하고, 화면끼리 연결한다.
4. Next.js(App Router) + Tailwind로 옮긴다(코드 컨벤션 확정·[강제]). B안 모양은 유지한다.
5. 역할별 메뉴 (v2)는 읽지 않는다. USE 권한은 업무 프로세스 2장을 따르고, VIEW 권한은 내가 정해 표로 보여 준다.
6. 로그인은 지금 추가하지 않는다. 지금의 "계정 선택" 화면을 그대로 옮긴다. 사원번호·비밀번호 폼, 잠김, 비밀번호 재설정은 나중에 한다.
7. AI 호출은 나중에 한다. 지금은 건드리지 않는다.
   - Message → ERP 초안은 요청자가 직접 입력하고, 'AI 자동 추출 준비 중' 표시를 그대로 둔다.
   - 흐름(메시지 → 초안 → 요청자 확정 → 구매요청 → 부서장 승인)은 화면에서 보여 준다.
8. 사용자가 "시작"이라고 할 때 시작한다.
9. 문서에 없는 기능은 5장의 표대로 처리한다(승인됨).
10. 사용자 이해 확인:
    - 강종·적용 규격 번호는 제품 규격을 정할 때(기준정보) 쓴다.
    - 샤르피·성분·기계적 성질·두께 구간·표면·치수 허용은 품질의 검사 기준이다.
    - 제품 치수는 회사(가상)가 정하고, 고객사는 등록된 규격을 골라 매수로 수주한다(REQ-MST-002·003, 기획안 범위 제외 "톤 단위 수주").
- 피드백: 6개 문서 밖에서 온 내용은 출처를 밝힌다(예: SPEC.md 8장 "AI 호출 안 넣음"을 사용자 결정처럼 말해 혼동을 줬다).

## 2. 작업 방식
- 새 브랜치 `feature/screen-rework`에서 작업한다(main에 직접 하지 않음).
- 커밋 메시지: `feat:` + 한글. 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `client/`를 Next.js App Router + Tailwind로 새로 구성한다.
  - 데이터를 쓰는 화면은 `'use client'`로 만들고 TanStack Query를 쓴다. Zustand는 화면 상태에만 쓴다.
  - `@/` alias를 쓴다. API 호출은 `api/` 함수 + `use*.ts` 커스텀 훅으로만 한다.
  - 컴포넌트 파일은 PascalCase, named export(라우트 파일은 default export).
  - `order` 단독 이름은 쓰지 않는다. any와 console을 쓰지 않는다.
- 스타일: B안 토큰(`client/src/styles/hl-vars.css`)을 Tailwind theme으로 옮긴다. 아이콘 마스크처럼 Tailwind로 표현할 수 없는 것만 CSS로 둔다(옛 `bundle.css` 참고).
- 공통 코드: 공통 코드 정의서 그대로 다시 정의한다. 상수 이름은 코드 그룹 ID와 같게 한다(4장). **지금은 `client/src/codes/`에 둔다.** `shared/`는 서버가 import하고 있어서 고치면 백엔드가 깨지므로 그대로 두고, 백엔드 작업 때 옮긴다. 이론중량 계산도 client 쪽에 복사해서 쓴다.
- 가짜 데이터
  - localStorage에 저장한다. 탭끼리 동기화한다(BroadcastChannel/storage 이벤트). 메신저 실시간도 이것으로 흉내 낸다.
  - "시드로 초기화" 버튼을 둔다. 탭마다 계정 선택을 sessionStorage에 둔다.
  - `api/` 함수 모양을 남겨 두어 나중에 실제 API로 바꿀 수 있게 한다.
- 계산은 순수 함수 + Vitest로 만든다: 이론중량(`shared/src/weight.ts` 재사용), 재고 우선 예약, 히트 편성(4.4), MRP(4.4), 부족·진행률(4.5), 자동 판정(경계 포함, 두께 초과~이하), FIFO 추천(생산완료일 → LOT 번호), 출고 전환(부분 출고 시 예약 분할).
- 밀시트 PDF는 브라우저 인쇄로 만든다. 생성 여부는 pdf_path 유무로 표시한다.
- 단계마다 typecheck·build·Vitest를 돌리고 브라우저로 확인한 뒤 보고한다. 큰 작업은 영역별 서브 에이전트에 맡겨 메인 컨텍스트를 작게 유지한다.
- 시작 직후 할 일
  - 이 계획을 저장소 `docs/`로 옮긴다.
  - `SPEC.md`를 이번 결정으로 갱신한다(AI 호출 문구, 백엔드 실행 방식, B안 CSS, 공통코드 접근 불가 같은 옛 내용).
  - `README`와 `docs/CLIENT-GUIDE.md`도 갱신한다.

## 3. 단계 (업무 프로세스 15장 순서)
1. 기반
   - Next.js + Tailwind, 셸: 레일, 상단 바(제목·통합 검색·AI 버튼·알림/메신저 드롭다운·사용자 메뉴), AI 패널(넓게, P2 준비 중)
   - 공통 부품: Badge, Modal, Field, DateInput(숫자 입력 + 달력), StateView, ComingSoon/SoonButton
   - shared 코드, 가짜 데이터 저장소·시드, 계정 선택 화면
2. 조직·기준정보·협업
   - 사원, 부서, 직급(새로), 권한 행렬, 조직도
   - 기준정보: 규격·매핑·강종·라우팅·원단위·품목/원료·고객사·공급업체·야드·생산 설정값
   - 검사 기준(품질, 새 화면)
   - 업무·알림, 메신저
3. 수주에서 구매까지
   - 수주 목록·등록·상세(충족 현황·생산 연결·예약·이력 재현)·취소 → 예약 → 생산계획·히트 편성
   - MRP → 구매요청·승인함·발주·입고, Message → ERP 초안
4. 생산·품질: 작업 실적·실적 시뮬레이션 → 검사 입력·불합격 관리 → 열연 투입 배정 → 재고(제품·원료·여재)
5. 출하·추적: 출하요청 목록·등록·배정 → 출고 확정 → 밀시트 → LOT 추적 → 작업 로그
6. 마무리
   - 대시보드(P3): 기본 6개 + 후보 8개. Agent·AI 활용 위젯은 준비 중으로 둔다.
   - P2·EX 준비 중 화면
   - 시연 시나리오 14.1·14.2를 클릭으로 점검한다. 금지어를 검사하고 빌드한다.

## 4. 공통 코드 (공통 코드 정의서 그대로. 표시명 = 화면 문구)
- RESERVATION_STATUS: ACTIVE 예약중 / CONVERTED 출고 전환 / RELEASED 해제
- ALLOCATION_STATUS: CONFIRMED 배정 확정 / CONSUMED 소진 / RELEASED 해제
- DRAFT_STATUS: AI_GENERATED 생성 / WAITING_APPROVAL 확인 대기 / APPROVED 확정 / EXECUTED ERP 반영 / REJECTED 반려
- UNIT_TYPE: QTY 매수 / TON 톤
- ACTOR_TYPE: USER 사용자 / SYSTEM 시스템
- STEEL_GRADE: SS275, SM355A, SM355B, SM355C, SM355D, SPHC. 규격 시드는 SS275·SM355A·SM355B·SPHC만 만들고, C·D는 강종만 등록한다.
- ITEM_TYPE: RAW_MATERIAL 원료 / SLAB 슬래브 / COIL 코일
- RAW_MATERIAL_TYPE: IRON_ORE 철광석 / COAL 석탄 / LIMESTONE 석회석 / FERROALLOY 합금철
- ROLE: SALES 영업 / PURCHASE 구매 / PRODUCTION 생산 / QUALITY 품질 / LOGISTICS 물류 / ADMIN 관리자
- PERMISSION_LEVEL: USE 사용 / VIEW 조회. 권한이 없으면 행을 두지 않는다.
- PERMISSION (17개)
  - 영업: SALES_ORDER_CREATE 수주 등록 · SALES_ORDER_CANCEL 수주 취소 · SHIPMENT_REQUEST_MANAGE 출하요청·배정 확정
  - 구매: PURCHASE_REQUISITION_CREATE 구매요청 등록·MRP · PURCHASE_ORDER_CONFIRM 발주 · GOODS_RECEIPT_CONFIRM 입고 확정
  - 생산: PRODUCTION_PLAN_CONFIRM 생산계획·히트 편성 · PRODUCTION_RESULT_CONFIRM "공정 실적(실적 시뮬레이션 포함)" · HOT_ROLLING_ALLOCATE 열연 투입 배정
    - PRODUCTION_RESULT_CONFIRM은 화면에 '작업 실적(실적 시뮬레이션 포함)'으로 표시한다. 용어 사전 우선이고 6장 1번 참고.
  - 품질: INSPECTION_REGISTER 검사 입력 · INSPECTION_STANDARD_MANAGE 검사 기준 관리 · DISPOSITION_SET 불합격 처리 상태 지정
  - 물류: GOODS_ISSUE_CONFIRM 출고 확정 · MILL_SHEET_READ 밀시트 조회·출력
  - 관리: EMPLOYEE_MANAGE 사원 관리 · ORG_MANAGE 부서·권한 관리 · MASTER_MANAGE 기준정보 관리
  - 기본 USE(업무 프로세스 2장): 관리자=EMPLOYEE/ORG/MASTER_MANAGE, 영업=SALES_ORDER_CREATE/CANCEL·SHIPMENT_REQUEST_MANAGE, 구매=PR_CREATE·PO_CONFIRM·GR_CONFIRM, 생산=PLAN/RESULT_CONFIRM·HOT_ROLLING_ALLOCATE, 품질=INSPECTION_REGISTER·DISPOSITION_SET·INSPECTION_STANDARD_MANAGE, 물류=GOODS_ISSUE_CONFIRM·MILL_SHEET_READ
  - VIEW는 내가 정해 1단계 때 표로 보여 준다.
- LOT_TYPE: RAW_MATERIAL 원료 / HOT_METAL 용선 / HEAT 히트 / SLAB 슬래브 / COIL 코일
- PROCESS_TYPE: IRONMAKING 제선 / STEELMAKING 제강 / CONTINUOUS_CASTING 연주 / HOT_ROLLING 열연
- YARD_TYPE: RAW_MATERIAL 원료 야드 / SLAB 슬래브 야드 / COIL 코일 야드
- SALES_ORDER_ITEM_STATUS: OPEN 진행중 / PARTIALLY_SHIPPED 부분출하 / SHIPPED 출하완료 / CANCELLED 취소
  - 헤더 상태는 품목 상태에서 계산한다.
  - 예약 완료·생산 중·출하 대기·납기 위험은 계산해서 보여 주는 값이다(저장 안 함).
- PRODUCTION_PLAN_STATUS: PLANNED 계획 / IN_PROGRESS 진행중 / COMPLETED 완료 / CANCELLED 취소. 첫 실적 등록 때 IN_PROGRESS가 되고, PLANNED일 때만 취소할 수 있다.
- PURCHASE_REQUISITION_STATUS: WAITING_APPROVAL 승인 대기 / APPROVED 승인 / REJECTED 반려 / ORDERED 발주 완료. 임시 저장은 없다. 반려되면 요청자가 고쳐 다시 승인 대기로 보낸다.
- PURCHASE_ORDER_STATUS: CONFIRMED 발주 확정 / PARTIALLY_RECEIVED 부분 입고 / RECEIVED 입고 완료
- INSPECTION_RESULT: PENDING 판정 대기(필수 항목·기준 누락 포함) / PASS 합격 / FAIL 불합격
- DISPOSITION_STATUS: HOLD 보류 / DOWNGRADED 격하 / SCRAPPED 폐기. 불합격 판정 때는 값 없이 두고 품질 담당이 지정한다.
- ALLOCATION_PURPOSE: SHIPMENT 출하 / HOT_ROLLING 열연 투입
- LOT_RELATION_EVIDENCE: PERIOD_BASED 기간 기반(원료 → 용선) / ACTUAL_INPUT 실제 투입
- ACTION_TYPE: PURCHASE_REQUISITION_CREATE 구매요청 생성(P1). P2 🟡: SHIPMENT_REQUEST_CREATE, SALES_ORDER_CREATE, PRODUCTION_PLAN_CREATE, ALLOCATION_CONFIRM, REPRODUCTION_PLAN_CREATE
- CHAT_ROOM_TYPE: DIRECT 1:1 / GROUP 그룹 / WORK 업무방
- LOT_STATUS: AVAILABLE 재고 / CONSUMED 투입 소진 / SHIPPED 출고. 품질은 INSPECTION_RESULT, 배정 여부는 allocation으로 따로 본다.
- SHIPMENT_REQUEST_STATUS: REQUESTED 배정 대기 / ALLOCATED 배정 확정 / ISSUED 출고 완료 / CANCELLED 취소
- TASK_STATUS: OPEN 진행 / DONE 완료
- NOTIFICATION_TYPE: MENTION 멘션 / WORK_ROOM_MESSAGE 업무방 메시지. 🟡 TASK_ASSIGNED 업무 지정 / APPROVAL_REQUESTED 승인 요청 / APPROVAL_RESULT 승인 결과
- BUSINESS_EVENT_TYPE (29개)
  - 수주: SALES_ORDER_CREATED 수주 등록 · SALES_ORDER_CANCELLED 수주 취소
  - 생산: PRODUCTION_PLAN_CREATED 생산계획 생성 · PRODUCTION_PLAN_CANCELLED 생산계획 취소 · REPRODUCTION_PLAN_CREATED 재생산 계획 생성 · SURPLUS_CONVERTED 여재 전환 · PRODUCTION_STARTED 작업 시작 · PRODUCTION_RESULT_REGISTERED 실적 등록(작업 완료)
  - 품질: INSPECTION_REGISTERED 검사 등록·판정 · DISPOSITION_SET 불합격 처리 상태 지정
  - 재고: RESERVATION_CREATED 예약 · RESERVATION_CONVERTED 예약 전환 · RESERVATION_RELEASED 예약 해제 · ALLOCATION_RECOMMENDED 배정 추천 · ALLOCATION_CONFIRMED 배정 확정 · ALLOCATION_CHANGED 배정 변경 · ALLOCATION_RELEASED 배정 해제
  - 구매: PURCHASE_REQUISITION_CREATED 구매요청 등록 · PURCHASE_REQUISITION_APPROVED 구매요청 승인 · PURCHASE_REQUISITION_REJECTED 구매요청 반려 · PURCHASE_ORDER_CREATED 발주 · GOODS_RECEIPT_CONFIRMED 입고 확정
  - 출하: SHIPMENT_REQUEST_CREATED 출하요청 등록 · GOODS_ISSUE_CONFIRMED 출고 확정 · MILL_SHEET_ISSUED 밀시트 발행
  - 초안: DRAFT_CREATED 초안 생성 · DRAFT_CONFIRMED 초안 확정 · DRAFT_REJECTED 초안 반려 · DRAFT_EXECUTED 초안 실행(ERP 반영)
  - 🟡 AGENT_RISK_DETECTED(P2), CASE_REGISTERED(EX)
  - 자동 예약은 RESERVATION_CREATED + 주체 SYSTEM으로 나타낸다. 불합격은 INSPECTION_REGISTERED의 판정 결과로 구분한다.
- CASE_CATEGORY 🟡: QUALITY 품질 / EQUIPMENT 설비
- 없앨 코드 그룹(문서에 없음)
  - EMPLOYEE_STATUS → is_active만
  - CONSUMPTION_UNIT → 원료 유형으로 단위를 정한다(합금철 kg/t, 나머지 t/t)
  - PRODUCTION_RESULT_STATUS, GOODS_RECEIPT_STATUS, SHIPMENT_REQUEST_ITEM_STATUS(배정 대기 = 요청 매수 − 확정 배정 > 0), GOODS_ISSUE_STATUS
  - PDF_STATUS → pdf_path 유무
  - MESSAGE_TYPE → 첨부 유무
  - REQUISITION_SOURCE_TYPE → action_draft_id / production_plan_id로 계산해 보여 준다
  - LOT_RELATION_TYPE → 부모·자식 lot_type으로 판단
  - EVENT_TARGET_TYPE → 대상은 용어 사전 DB명(sales_order, lot …)
  - EVENT_REASON_CODE → 9.3 제안 8개만: STOCK_FIRST, FIFO_RECOMMENDATION, ORDER_SHORTAGE, ORDER_CANCELLED, QUALITY_FAILURE, SURPLUS_CONVERSION, ALLOCATION_CHANGE, DRAFT_CONFIRMED
  - WIDGET_CODE → 화면 상수로
- 번호 형식(업무 프로세스 9.1·9.2)
  - 업무 번호: SO-YYMM-NNN · PP-YYMM-NNNN · PR-/PO-/GR-YYMM-NNNN · DR-YYMM-NNNN · MS-{출하요청 일련}-N(수주별 순번) · EV-YYMMDD-NNN
  - LOT 번호: RM-원료코드-YYMMDD-NNN · HM-고로-YYMMDD-NN · HT-전로-YYMMDD-NNN · 히트번호-SS · C+슬래브번호(HT- 제외, 예 CBOF1-260929-015-03)
  - 코드: 고로 BF2·전로 BOF1. 규격 코드 SL-/CL-강종-두께x폭x길이. 원료 코드는 영문 3자 + 숫자 2자리(ORE01, COL01, LIM01, SMN01)
- 에러 메시지(9.3)

  | 코드 | 메시지 |
  |---|---|
  | SO-001 | 등록되지 않은 규격입니다 |
  | SO-002 | 수량은 1 이상의 정수로 입력해 주세요 |
  | SO-003 | 출고된 매수가 있는 수주는 취소할 수 없습니다 |
  | SO-004 | 진행 중인 출하요청을 먼저 취소해 주세요 |
  | MST-001 | 수율·배합·규격 매핑·검사 기준 누락 |
  | MST-002 | 사용된 규격은 치수·이론중량을 수정할 수 없습니다 |
  | INV-001 | 예약·배정 가능한 매수 부족 |
  | INV-002 | 제품 또는 상위 히트가 미합격 |
  | INV-003 | 이미 배정된 LOT |
  | INV-004 | 이미 투입·출고된 LOT |
  | PUR-001 | 승인권자(부서장) 미지정 |
  | PUR-002 | 승인 전 발주 불가 |
  | PUR-003 | 발주 미입고량 초과 |
  | ACT-001 | 초안 필수값 미확정 |
  | SHP-001 | 밀시트 PDF 생성 실패(스냅샷은 있음) |
  | SHP-002 | 출하 가능 매수를 넘었습니다 |
  | SHP-003 | 출고 확정된 출하요청은 취소할 수 없습니다 |
  | COM-001 | 검토 이후 데이터 변경 |
  | COM-002 | 해당 업무 권한 없음 |
  | COM-003 | 참조 대상이 없습니다 |

## 5. 문서에 없는 지금 기능 처리 (사용자 승인)
| 기능 | 처리 |
|---|---|
| 계정 잠김·잠금 해제·실패 횟수, 비밀번호 재설정, 이메일 | 지금은 뺀다. 로그인 작업 때 다시 본다 |
| 수주 비고, 출하요청 메모, 입고 비고, 검사 메모 | 뺀다(ERD에 칸 없음) |
| 기준정보 '사용 안 함' 토글(품목·원료·강종·규격·고객사·공급업체·야드) | 뺀다. 삭제만 두고, 참조가 있으면 거부한다(컨벤션 7-2) |
| 통합 검색, 필터, 위젯 끌어 옮기기·크기, 알림·메신저 드롭다운, 납기 달력, AI 창 넓게, AI 버튼 상단 바 | 남긴다(화면 편의, 저장소 SPEC.md 5번) |
| 납기 위험 배지 | 남긴다(공통 코드 비고: 계산 표시값) |
| 기준정보 준비 상태 띠 | 남긴다(BP-MST-01 "누락 표시") |
| 검사 '기준 안 값으로 채우기' | 시연 편의로 남긴다 |

## 6. 문서끼리 충돌 → 내가 정한 기본값 (사용자에게 알림)
1. '공정 실적'은 용어 사전 금지어인데 공통 코드 권한 표시명과 BP-PRD-02는 이 말을 쓴다 → 화면은 '작업 실적'으로 한다.
2. 수주 취소: 9.3(SO-003 출고분 있으면 불가, SO-004 출하요청 먼저 취소)과 16장 TBD(잔량 취소)가 다르다 → 9.3을 따른다.
3. 히트 편성 '확정'은 12.2 API에 있지만 상태값은 없다 → 생산계획을 만들 때 편성까지 계산하고(ERD heat_count·required_steel_ton·cumulative_yield_rate), 화면은 편성표를 보여 준다. CONFIRMED 상태는 두지 않는다.
4. Message → ERP 시작점: 요구사항은 "메시지", 프로세스는 "업무방 메시지" → 요구사항대로 모든 채팅방 메시지에서 만들 수 있게 한다.
5. '주문 매수'(4.1·4.5)는 금지어다 → '수주 매수'. 'LOT 계보'(프로세스)는 금지어다 → 'LOT 관계'. '출하번호'(BP-LOT-01) → '출하요청 번호'.

## 7. 화면별 변경 (상세 근거는 reports/N의 C절)
- 영업 (reports/1)
  - 수주
    - 납기를 품목마다 받는다(ERD sales_order_item.due_date).
    - 상태는 4장 SALES_ORDER_ITEM_STATUS를 따른다. 취소는 SO-003·004를 따른다.
    - '주문' → '수주'. 비고를 뺀다. 담당은 owner_employee_id, 취소 사유는 cancel_reason이다.
    - 진행률은 분모를 명시한다(4.5: 단계를 더해 수주보다 커지지 않게).
  - 출하요청
    - 등록하면 바로 FIFO 추천을 보여 준다(SHP-001). 같은 고객사 품목만 묶는다.
    - 출하 매수는 정수만 받는다(SO-002 문구, 글자를 지우지 않음). 톤은 십진 계산한다.
    - 메모를 뺀다. 요청자·출하 요청일은 둔다(ERD).
  - 배정: 변경은 해제와 새 배정을 함께 처리하고 사유를 남긴다. 생산완료일은 날짜로 보여 준다.
  - 출고
    - 별도 출고 대상과 번호를 없앤다. shipment_request.issued_at·issued_employee_id에 기록한다.
    - 확정하면 예약 CONVERTED, 배정 CONSUMED, LOT SHIPPED가 된다.
  - 밀시트: 1장 = 출하요청 × 수주(ERD unique), 번호는 MS-. 히트 성분과 슬래브·코일 검사값을 스냅샷으로 남긴다. PDF는 인쇄로 만든다.
  - 업무방 열기: 수주 연결, 멤버는 조직도에서 고른다(MSG-001).
- 구매 (reports/2)
  - MRP
    - 실행 이력을 저장하지 않는다. 기간을 정해 바로 계산한다(12.2 GET /mrp/requirements?from&to).
    - 4.4 식대로 계산한다. 용선 잔량을 빼는 단계를 없앤다.
    - 예상 슬래브 여재를 추가한다. 여재는 가용재고에 포함한다.
  - 구매요청
    - 작성 중(DRAFT)을 없앤다. 등록하면 바로 승인 대기다.
    - 반려되면 고쳐서 다시 요청한다.
    - 입력란 이름은 '요청 근거'다(BP-PUR-01).
    - MRP에서 만들면 production_plan_id를 연결한다(ERD). 출처는 계산해서 보여 준다.
  - 승인함: 부서장만 본다. Agent 칸을 뺀다(AGT-006). '상위 부서장 승인'은 확정된 규칙처럼 쓰지 않는다(16장 TBD).
  - 발주: 공급업체 1곳당 1건, 입고예정은 scheduled_receipt_ton이다.
  - 입고: 등록이 곧 확정이다. 비고와 야드 선택을 빼고 기본 야드를 자동으로 넣는다. RM- LOT을 만든다.
  - 초안: ACTION_TYPE 표시명은 '구매요청 생성'. 직접 입력하고 'AI 자동 추출 준비 중'을 둔다. 확정은 요청자가 한다.
  - '메신저 → ERP' → 'Message → ERP'. '입고 예정' → '입고예정'. '대화방' → '채팅방'.
- 생산·재고 (reports/3)
  - 생산계획
    - CONFIRMED를 없앤다(6장 3번).
    - 이름: '필요 용강량', '부족 매수'. 슬래브 수주의 누적 수율은 연주만 쓴다.
    - 완료 후 여재를 표시한다(ERD is_surplus_on_completion). 재생산은 여재·진행 계획을 확인한 뒤 만든다(14.1 ⑥).
    - '조치 필요' 필터를 뺀다. 생산 담당 단독 계획 취소는 PLANNED일 때만 한다.
  - 작업 실적
    - 상태값 대신 started_at·completed_at을 쓴다.
    - 입력은 BP-PRD-02대로: 고로 코드, 작업일시, 원료 투입 기간, 용선량 / 전로 코드, 투입 용선량 / 히트, 슬래브 매수, 작업일시.
    - 실적 시뮬레이션을 이 화면에서 실행한다. 샘플 손실률·시드·손실 매수(floor)를 보여 준다(ERD).
    - '작업 지시' 이름을 뺀다.
  - 열연 배정
    - '귀속'을 없앤다. FIFO는 생산완료일 → LOT 번호 순이다. HOT_ROLLING을 쓴다.
    - 변경은 한 번에 하고 사유를 남긴다. 수주 연결이 끊긴 코일 계획은 열연하지 않는다.
  - 재고
    - 가용 = 미소진 합격 − ACTIVE 예약 − 예약 밖 열연 CONFIRMED 배정(4.2).
    - 여재 = 미배정 합격 슬래브(가용에 포함). 귀속 열을 뺀다.
    - 원료 = LOT 잔량 합계 + 입고예정. 생산완료일은 날짜로 보여 준다.
- 품질·추적·로그 (reports/4)
  - 검사 입력
    - 필수가 비면 PENDING으로 저장한다.
    - 측정값을 같은 기록에서 고칠 수 있다. 전후 값을 작업 로그에 남기고, 밀시트 발행 뒤에는 잠근다(QC-003).
    - 판정에 쓴 기준 버전을 표시한다. 두께 구간은 초과~이하로 판정한다.
    - 메모를 뺀다. '판정 대기' 문구를 쓴다.
  - 불합격 관리: 'SYSTEM' → '시스템'. 'v2' 문구를 뺀다. '출하' → '출고'. 사례로 등록·비슷한 사례 찾기는 EX 준비 중이다.
  - 검사 기준(새 화면, 품질 메뉴, INSPECTION_STANDARD_MANAGE)
    - 공정·강종별 기준을 버전으로 관리한다. 바꾸면 새 버전을 만든다.
    - 항목: 코드, 이름, 단위, min/max, 두께 구간, 필수, 순서. 코드 예 QS-SM355A-HR.
    - 제강 기준의 항목이 곧 성분 규격이다. 강종 화면의 성분 편집을 여기로 옮긴다.
  - LOT 추적
    - 'LOT 관계', '실제 투입'으로 표시한다.
    - 출하요청 번호로도 찾는다. 고로·전로는 코드를 그대로 보여 준다. 출고번호 대신 출하요청을 쓴다. '공급사' → '공급업체'.
  - 작업 로그
    - 이벤트 29개, EV- 번호를 쓴다. 대상은 테이블명, 사유는 8개다.
    - 'AI 경유'는 P2 준비 중으로 둔다. 원본 메시지 링크를 단다.
    - 이름은 '이력 재현'. 색을 통일하고 '품질검사'로 붙여 쓴다.
- 관리자 (reports/5)
  - '사용자' → '사원'.
  - 직급 관리 탭을 새로 만든다(job_grade: 코드, 이름, 표시 순서).
  - 사원 칸: 사원번호, 이름, 부서, 직급(선택), 역할, 사용 여부, 최근 접속.
  - 부서 칸: department_code, 이름, 상위 부서, 부서장, 정렬 순서. 순환을 막는다.
  - 권한 행렬은 17개로 한다.
  - 기준정보
    - 원료 코드는 영문 3자 + 숫자 2자리.
    - 이름: '원료 유형', '야드 유형', '적용 규격', '기본 야드', '생산 설정값'.
    - 사용 토글을 없애고 삭제만 둔다.
    - 라우팅 공정 순서를 고칠 수 있게 한다(MST-005).
    - 슬래브·코일 품목에는 공급업체를 지정하지 않는다.
    - 같은 규격 조합은 화면에서 미리 막는다.
    - 화면 부제에 보이던 REQ ID를 뺀다.
    - 야드 수정 창의 '종류' 표시 버그를 고친다.
  - 로그인: '계정 선택'을 그대로 옮긴다. '부서장' 칩은 역할처럼 보이지 않게 정리한다.
- 협업·대시보드·P2/EX (reports/6)
  - 업무: OPEN/DONE 2단계. 연결 화면(link_path)은 둔다.
  - 알림: 유형 5개, 부서 알림.
  - 메신저: 업무방은 수주에 연결하고 멤버를 조직도에서 고른다. 첨부는 1개, 안 읽은 수, 멘션 알림, ERP 이동. SYSTEM 메시지는 '시스템'으로 표시한다.
  - 대시보드: 수주 충족 위젯에 검사합격을 추가한다. '주문' → '수주'.
  - Agent 예시
    - 대응 후보는 담당 부서원이 확정한다(확정자가 요청자). 구매요청이면 부서장이 최종 승인한다.
    - 주체는 USER/SYSTEM만 쓴다(AI 주체 없음). 메뉴를 부서장만 보게 하지 않는다.
    - 번호·강종을 9장 형식과 SM355A~D로 고친다.
  - 회의록 예시: AI_GENERATED 배지 남용을 정리한다.
  - 과거 사례: CASE-004 호출 위치(AI 패널·@AI·품질 관리 버튼)로 맞춘다.
  - 레일 이름: 'Agent' → 'AI Factory Agent', '사례 검색' → '과거 사례 검색'.

## 8. 시드 (가정값은 한곳에 모아 표시)
- 강종 6종 + 적용 규격 번호: SS275 KS D 3503:2026, SM355A~D KS D 3515:2018, SPHC KS D 3501. 연도는 ks-values.md로 확인한다.
- 규격: 4강종 × 슬래브 3종 + 대응 코일 12개 + 매핑.
  - 치수는 문서 예시(250×1,200×10,000, 250×1,500×10,000)를 바탕으로 정한다.
  - 코일 두께는 6mm 이하·초과를 섞어 충격 시험·두께 구간이 둘 다 보이게 한다.
- 원료 4종: ORE01 철광석, COL01 석탄, LIM01 석회석, SMN01 실리코망가니즈(합금철).
- 라우팅·수율·원단위: 시연 가정값(기획안). 생산 설정값: 250t, 3일.
- 조직: 고객사·공급업체·야드, 부서 계층(생산부 하위에 제선·제강·연주·열연 파트, REQ-ORG-001 예), 부서장, 직급, 역할 6개 + 권한, 사원(역할별 + 부서장).
- 초기 재고: 14.1 시나리오용으로 SS275 250×1,200×10,000 합격 가용 6매.
- 검사 기준: ks-values.md 수치를 쓰고, 없는 것은 가정값으로 표시한다.

## 8-1. KS 결과 (docs/ks-values.md, 2026-10-01 추출)
- **바로 쓸 수 있는 값**
  - 적용 규격 번호: SS275 KS D 3503:2026, SM355A–D KS D 3515:2018, SPHC는 "KS D 3501"만(연도 없이)
  - 히트 성분 상한: C·Si·Mn·P·S. 하한은 없다.
  - SM 계열 탄소당량 상한 0.47(50 이하)/0.49(50 초과 100 이하). 계산식: C + Mn/6 + (Cr+Mo+V)/5 + (Ni+Cu)/15
  - 코일 기계적 성질: 항복·인장·연신율의 두께 구간별 값(초과~이하). SPHC는 인장·연신율만 있다.
  - 샤르피: SM355A 20℃ / B 0℃ / C −20℃ / D −40℃, 27J 이상, 두께 6 초과에만 적용
  - 코일 치수(KS D 3500)
    - 두께 허용차는 표 5를 쓴다. 표 5의 구간은 "이상–미만"이다.
    - 시드 코일 너비 허용차 +25/0, 캠버 길이 2000당 5 이하
- **KS에 없어서 가정값이나 결정이 필요한 것** (사용자 확인 대기; 내 제안을 함께 적음)
  1. 슬래브 표면·치수 검사 기준: KS에 없고 "사내 규격으로 정의" 상태다(KS 페이지 L266) → 가정값을 쓴다.
  2. 코일 길이 허용차: KS 치수가 아니다 → 검사 항목에서 뺀다. 코일 표면은 REQ-QC-001(코일 치수·기계적 성질)에 없다 → 뺀다.
  3. 히트 성분 판정에 쓸 두께: SM355 C·탄소당량은 두께별 값이다 → 더 엄격한 50mm 이하 값을 쓴다. 요구사항 21장 "시드 히트 C 0.18 이하"와도 맞는다.
  4. 두께 구간 경계: 기계적 성질은 초과~이하, 두께 허용차 표는 이상~미만이다 → 시드 코일 두께를 경계가 아닌 값으로 고른다(6mm 이하·초과 섞어서).
  5. 데모 측정값(합격·불합격 사례)은 가정값으로 만든다.
- 문서끼리 다른 점(알림만)
  - SM355B C 상한: KS 페이지는 "재확인"했다고 적었고, 요구사항·공통 코드는 "재확인 중"이다. 값(0.18/0.20)은 같다.
  - SPHC 판 연도는 미확인이다.

## 9. 남은 일
- ks-values.md 결과를 사용자에게 요약한다(무엇이 KS에 있고 무엇이 가정값인지).
- 1단계 때 역할별 VIEW 권한표와 시드 가정값 목록을 보여 준다.
- 문서 충돌(6장)은 팀 문서 수정이 필요하다고 알린다.
