# dashboard — 대시보드 위젯

> 근거 약어: [02] 요구사항 정의서 · [03] 용어 사전 · [04] 업무 프로세스 정의서 · [05] 코드 컨벤션 · [06] 공통 코드 정의서 · [ERD] `docs/erd/fantasteel_erp_p1.dbml` · [CSV] API 목록 · [권한표] 역할별 메뉴 (v2) 3장. 🟡 = 확인 필요.
> 경로는 컨트롤러에 쓰는 모양(전역 prefix `/api/v1` 제외). 이 문서는 지금 구현을 적은 것이다(2026-10-08).

## 1. 담당 범위

| 항목 | 내용 |
| --- | --- |
| REQ | REQ-DSH-001 기본 위젯, REQ-DSH-002 위젯 추가·제외 (둘 다 P3) |
| BP | BP-DSH-01 "로그인 → 권한 내 집계 → 위젯 표시 → 위젯 추가·제외 저장" ([04] 588행) |
| 등급 | P3. 숫자는 각 모듈 계산을 그대로 읽어 묶기만 하고 다시 만들지 않는다 |
| 제외 | Agent 위험 감지(AGENT_RISK)·AI 활용 현황(AI_USAGE)은 P2라 없다. 위젯 구성 저장(API-266 `PUT dashboard/widgets`)은 ERD에 저장할 테이블이 없어 만들지 않았다(8장) |

## 2. 테이블

쓰기 없음. 읽기만 한다.

| 읽기 | 쓰는 곳 |
| --- | --- |
| `sales_order`·`sales_order_item`·`reservation`·`production_setting` | 공정 흐름(수주), 수주 충족 — sales-order 모듈 `openSalesOrderFulfillments` |
| `inventory`·`item`·`lot`·`quality_inspection`·`lot_relation`·`allocation` | 제품 재고, 공정 흐름(재고·판정 대기), 여재 보유 — inventory 모듈 `productStock`과 여재 계산 |
| `production_plan` | 공정 흐름(생산계획 상태별 건수), 공정별 수율(계획 품목) |
| `production_result`와 투입·산출 | 공정별 수율 — production 모듈 작업 실적 조회, `heatPlanBasisOf`(계획 수율) |
| `shipment_request`·`shipment_request_item`·`allocation` | 공정 흐름(출하요청·오늘 출고), 출하 실적 |

## 3. API

[CSV]에는 `GET dashboard/widgets`(API-265, 🟡 경로 제안) 한 줄뿐이다. 위젯마다 권한이 달라 그 아래에 위젯별 경로로 나눴다(API-265 단일 조회는 만들지 않음).

| Method | Path | 위젯 | 권한 | 비고 |
| --- | --- | --- | --- | --- |
| GET | `dashboard/widgets/process-flow` | 공정 흐름 현황 | 로그인만 | 6단계(수주·생산계획·검사·재고·출하요청·출고) 건수를 모두 준다. 단계 화면을 열 권한은 화면이 따로 본다(바로가기만 막음, 2026-10-07 사용자 결정) |
| GET | `dashboard/widgets/order-fulfillment` | 수주 충족 현황 | `SALES_ORDER_CREATE` VIEW | 진행 중 수주를 가장 이른 납기 순. 품목마다 `daysToDue` |
| GET | `dashboard/widgets/product-stock` | 제품 재고 | 로그인만 | 재고 화면처럼 모든 사원. 슬래브·코일 합계와 재고가 있는 규격 |
| GET | `dashboard/widgets/shipment-result` | 출하 실적 | `GOODS_ISSUE_CONFIRM` VIEW | 오늘 포함 최근 30일, 하루 단위 |
| GET | `dashboard/widgets/process-yield` | 공정별 수율 | `PRODUCTION_RESULT_CONFIRM` VIEW | 공정 4개(제선·제강·연주·열연) |
| GET | `dashboard/widgets/surplus-age` | 여재 보유 기간 | 로그인만 | 재고 화면처럼 모든 사원 |

권한은 위젯마다 달라 컨트롤러 데코레이터가 아니라 service에서 `hasPermission`으로 본다. 없으면 `COM-002`.

## 4. 업무 규칙

- **공정 흐름**: 진행 중 수주 = 진행중·부분출하, 그중 납기 위험 수. 생산계획 PLANNED·IN_PROGRESS 건수. 판정 대기 = 검사 행이 없거나 PENDING인 히트·슬래브·코일. 재고 = 슬래브·코일 가용 매수 합(on_hand − reserved − rolling). 출하요청 REQUESTED·ALLOCATED 건수. 오늘 출고 = 서울 오늘 00:00~내일 00:00에 출고 확정한 출하요청 수와 소진된 출하 배정 LOT 수.
- **수주 충족**: 납기 위험 = 납기까지 남은 날이 생산 설정 `delivery_risk_days` 이하이고 미출하가 있음(sales-order 모듈 계산).
- **출하 실적**: 서버에 LOT별 출고 시각이 없어 출하요청의 출고 확정 시각(`issued_at`)으로 날짜를 나눈다. 톤 = 출고 LOT의 1매 이론중량 합.
- **공정별 수율**: 완료된 작업 실적(투입·산출 톤이 있는 것)의 Σ산출 ÷ Σ투입(소수 4자리)과, 계획 수율(라우팅·규격 매핑)을 투입량으로 가중한 값. 제선은 계획 수율을 쓰지 않아([04] 4.4) 톤만 준다. 기준정보가 빠진 규격(MST-001)은 계획 수율 없이 보인다.
- **여재 보유**: 여재 매수·여재 슬래브는 inventory.md 8-1 임시 결정 그대로다(미배정 합격 슬래브 − ACTIVE 예약, 진행 중 코일 수주용 슬래브 제외, FIFO상 가장 늦은 LOT이 여재). 여재 전환 시각이 ERD에 없어 보유 기간은 여재 슬래브 중 가장 이른 생산완료일부터 센다. 규격은 보유 일수 긴 순.
- **추이 기간**: 출하 실적은 오늘 포함 최근 30일. 정의가 없어 `docs/rework/areas/dashboard.md` 5장 가정값을 따른다(화면 `DASHBOARD_TREND_DAYS`와 같다).
- 톤은 소수 3자리 문자열, 매수는 정수.

## 5. 화면과의 경계

- 화면 위젯 가운데 서버가 데이터를 주는 것은 위 6개다. 납기 위험 수주는 수주 충족 위젯 응답, 강종별 불합격률은 검사 목록과 강종, 생산량은 LOT 목록과 품목 이론중량, 원료 잔량 대비 소요·구매 진행은 구매·MRP API, 최근 작업 로그는 작업 로그 API를 화면이 읽어 묶는다(`client/src/api/server/dashboard.ts`, `docs/CLIENT-GUIDE.md`).
- 위젯 추가·제외와 배치는 사원별로 브라우저 `localStorage`에 저장한다(`client/src/features/dashboard/lib/layout.ts`). 서버 저장은 없다.

## 6. 오류 코드

| 코드 | 언제 |
| --- | --- |
| `COM-002` | 수주 충족·출하 실적·공정별 수율 위젯을 그 조회 권한 없이 부름 |

## 7. 테스트

`server/src/modules/dashboard/dashboard.spec.ts` (묶음 DB `fs_sales`, `npm test -w @fantasteel/server -- dashboard`): 출하 실적·공정별 수율의 권한과 응답 모양, 여재 보유(빈 목록, 진행 중 코일 수주용 슬래브 제외 → 수주 취소 후 여재). 공정 흐름·수주 충족·제품 재고는 각 모듈 계산을 그대로 쓰므로 그 모듈 테스트가 맡는다.

## 8. 확인 필요 🟡

| 항목 | 내용 | 근거 |
| --- | --- | --- |
| 위젯 구성 저장 | API-266 `PUT dashboard/widgets`(본인 구성)를 저장할 테이블이 ERD에 없다. 서버 저장이 필요하면 ERD → schema 순서로 테이블부터 정해야 한다 | [CSV] API-266, [ERD] |
| 위젯별 경로 | [CSV]는 `GET dashboard/widgets` 하나(🟡 경로 제안)다. 위젯별 경로 6개를 명세에 반영할지 | [CSV] API-265 |
| 추이 기간·수율 계산식 | 최근 30일, Σ산출 ÷ Σ투입, 투입량 가중 계획 수율은 가정값이다 | `docs/rework/areas/dashboard.md` 5장 |
| 연주 계획 대비 매수 | 손실 매수를 저장하는 칼럼이 없어 주지 않는다 | [ERD] |
| 여재 보유 기준 | inventory.md 8-1 임시 결정(여재 전환 시각 없음)을 정식 결정으로 할지 | inventory.md 8-1 |
