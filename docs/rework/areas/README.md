# 영역 노트 색인

화면 재작업(브랜치 `feature/screen-rework`)에서 영역별로 남긴 노트다. 화면과 api 함수의 모양, 어느 요구사항(REQ)·업무 프로세스(BP)를 만족하는지, 6개 문서에 없어 정한 '가정값', 확인이 필요한 질문이 들어 있다. 모든 가정값은 한곳에 모아 `../seed-assumptions.md` 6장에 표로 있다(값·규칙, 근거, 파일).

공통 규칙·결정은 `../PLAN.md`, 시드 값은 `../seed-assumptions.md`, 감사 보고서는 `../reports/`에 있다. 경로는 화면 주소이고, 화면 파일은 `client/src/app/(main)/<주소>/page.tsx`에 있다.

| 파일 | 영역 | 경로 | 한 줄 요약 |
|---|---|---|---|
| [core-domain.md](core-domain.md) | 업무 규칙 핵심 | 화면 없음 (`client/src/mock/services`, `client/src/mock/seeds`) | 수주·예약·생산·품질·구매·출하·Message → ERP 규칙을 서비스 함수와 시드로 구현한 API 문서, 시연 시나리오 시작 상태 |
| [core.md](core.md) | 업무 규칙 핵심 (검토) | 화면 없음 | core-domain 검토에서 찾아 고친 문제와 근거의 기록 |
| [cross-cutting.md](cross-cutting.md) | 화면 공통 | 모든 화면 (왼쪽 레일) | 변경 함수의 권한 확인(COM-002), 화면 접근 제한, 레일 조회 메뉴, 첨부 파일 가짜 저장소, 테스트 준비 |
| [shell.md](shell.md) | 셸·공통 컴포넌트 | 모든 화면 (상단 바·레일) | '준비 중' 안내 띠의 조사 처리, 쓰지 않는 단계 자리 표시 삭제 |
| [admin.md](admin.md) | 관리자 | `/admin/employees`, `/admin/organization` | 사원·부서·직급·권한 행렬·조직도 (REQ-AUTH-002~004, REQ-ORG-001~004) |
| [master.md](master.md) | 기준정보·검사 기준 | `/admin/master-data`, `/quality/standards` | 품목·규격·강종·고객사·공급업체·야드·라우팅·배합 원단위와 검사 기준 버전 (REQ-MST, REQ-QC-001~003) |
| [sales.md](sales.md) | 영업(수주) | `/sales-orders`, `/sales-orders/new`, `/sales-orders/[id]` | 수주 목록·등록·상세(충족 현황·생산 연결·예약·이력)·취소·업무방 열기 (REQ-SO) |
| [production.md](production.md) | 생산 | `/production/plans`, `/production/results`, `/production/rolling` | 히트 편성 생산계획, 작업 실적과 시뮬레이션, 열연 투입 배정 (REQ-PRD, REQ-LOT) |
| [quality.md](quality.md) | 품질 | `/quality/inspections`, `/quality/rejected` | 검사 입력·자동 판정과 불합격 관리 (REQ-QC-001·003·004) |
| [inventory.md](inventory.md) | 재고 | `/inventories` | 제품·LOT 목록·원료·여재 조회 (REQ-INV) |
| [purchasing.md](purchasing.md) | 구매 | `/mrp`, `/purchase-requisitions`, `/purchase-requisitions/[id]`, `/approvals`, `/purchase-orders`, `/goods-receipts` | MRP, 구매요청과 부서장 승인, 발주, 입고 (REQ-PRD-005, REQ-PUR) |
| [drafts.md](drafts.md) | Message → ERP 초안 | `/action-drafts/[id]`, 메신저 메시지 메뉴 | 메시지에서 구매요청 초안을 만들고 요청자가 확정, 부서장이 승인 (REQ-ACT-001~004) |
| [shipment.md](shipment.md) | 출하 | `/shipment-requests`, `/shipment-requests/new`, `/shipment-requests/[id]`, `/goods-issues`, `/mill-sheets` | 출하요청, LOT 배정 추천·확정, 출고 확정, 밀시트 출력 (REQ-SHP) |
| [trace.md](trace.md) | LOT 추적·작업 로그·검색 | `/lots/trace`, `/business-events`, 상단 통합 검색 | LOT 정·역추적, 수주 단위 이력 재현, 통합 검색 (REQ-LOT-005, REQ-LOG) |
| [collab.md](collab.md) | 협업 | `/tasks`, `/messenger`, 상단 알림·메신저 드롭다운 | 업무·알림·채팅방·메시지·멘션 (REQ-NTF, REQ-MSG) |
| [dashboard.md](dashboard.md) | 대시보드 | `/dashboard` | 기본 6개 + 후보 8개 위젯, 배치·크기 편집, 사원별 저장 (REQ-DSH, P3) |
| [soon.md](soon.md) | 준비 중 화면 (P2·EX) | `/agent`, `/meetings`, `/past-cases`, 상단 AI 어시스턴트 패널 | 기능 없이 예시 내용만 보이는 AI Factory Agent·회의록·과거 사례 검색·AI 패널 |
| [scenario.md](scenario.md) | 시연 시나리오 점검 | 화면 없음 (`client/src/api/scenario`) | 업무 프로세스 14.1·14.2를 화면 api로 끝까지 돌리는 시험과 14.3 필수 검증표 |
