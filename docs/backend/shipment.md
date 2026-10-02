# shipment — 출하요청·출고 확정·밀시트

> 근거 약어: [02] 요구사항 정의서 · [03] 용어 사전 · [04] 업무 프로세스 정의서 · [05] 코드 컨벤션 · [06] 공통 코드 정의서 · [ERD] `docs/erd/fantasteel_erp_p1.dbml` · [CSV] API 목록 · [권한표] 역할별 메뉴 (v2) 3장. 🟡 = 확인 필요.
> 경로는 컨트롤러에 쓰는 모양(전역 prefix `/api/v1` 제외). 스켈레톤은 `@Controller()`이므로 메서드마다 전체 경로를 쓴다.

## 1. 담당 범위

| 항목 | 내용 |
| --- | --- |
| REQ | REQ-SHP-001~004, REQ-INV-005(출고 시 CONVERTED)·006(배정 대기 = 미배정 상태), REQ-SO-005(품목 상태 갱신 트리거) |
| BP | BP-SHP-01 출하요청·LOT 배정·출고·밀시트([04] 6장), 13.3 |
| 등급 | P1 |

## 2. 테이블

| 구분 | 테이블 | 핵심 규칙 |
| --- | --- | --- |
| 쓰기 | `shipment_request` | `shipment_request_no`(DR-YYMM-NNNN), `customer_id`(**같은 고객사 수주 품목만**), `ship_date`, `shipment_request_status`(REQUESTED·ALLOCATED·ISSUED·CANCELLED), `issued_at`·`issued_employee_id`. **출고 확정(Goods Issue)은 별도 테이블 없이 여기에 기록** |
| 쓰기 | `shipment_request_item` | `(shipment_request_id, sales_order_item_id)` unique, `request_qty`. 미배정 매수 = `request_qty − 이 품목 CONFIRMED 배정 수`(> 0이면 배정 대기) |
| 쓰기 | `mill_sheet` | `mill_sheet_no`(MS-{출하요청 일련}-N) unique, `(shipment_request_id, sales_order_id)` unique(출하요청 × 수주당 1장), `snapshot` jsonb, `pdf_path`, `issued_at`. LOT 연결 테이블 없음 |
| 쓰기 | `lot` | 출고 LOT `lot_status` → SHIPPED |
| 다른 모듈 경유 | `allocation`, `reservation`, `inventory`(inventory), `sales_order_item` 상태(sales-order) | |
| 읽기 | `sales_order(_item)`, `customer`, `item`, `steel_grade`, `lot`, `lot_relation`, `quality_inspection(_value)`, `inspection_standard_item` | 스냅샷 |

[ERD] 설계 결정: 출하 배정은 `shipment_request_item`에 연결한다(`reservation_id` 없음). [04] 4.2 "출하용 배정은 해당 수주 품목 예약에 연결"과 다르다. 출고 LOT은 `shipment_request → shipment_request_item → allocation(CONSUMED) → lot`으로 찾는다.

## 3. API

| Method | Path | 이름 | 권한 | 비고 ([CSV]) |
| --- | --- | --- | --- | --- |
| GET | `shipment-requests` | 출하요청 목록 | `SHIPMENT_REQUEST_MANAGE` VIEW 또는 `GOODS_ISSUE_CONFIRM` VIEW | |
| POST | `shipment-requests` | 출하요청 등록 | `SHIPMENT_REQUEST_MANAGE` USE | 출하 가능 매수 초과 시 SHP-002 |
| GET | `shipment-requests/:id` | 출하요청 상세 | 목록과 같음 | |
| POST | `shipment-requests/:id/cancel` | 출하요청 취소 | `SHIPMENT_REQUEST_MANAGE` USE | 출고 후면 SHP-003 |
| POST | `shipment-requests/:id/issue` | 출고 확정 | `GOODS_ISSUE_CONFIRM` USE | INV-002·INV-004·SHP-002. SELECT FOR UPDATE |
| GET | `mill-sheets` | 밀시트 목록 | `MILL_SHEET_READ` VIEW | 쿼리 예: `shipmentRequestId`, `salesOrderId` |
| GET | `mill-sheets/:id` | 밀시트 조회 | `MILL_SHEET_READ` VIEW | 저장된 스냅샷을 반환 |
| POST | `mill-sheets/:id/pdf` | 밀시트 PDF 생성 | `MILL_SHEET_READ` USE | 실패 시 SHP-001, 같은 스냅샷으로 재시도(출고 재실행 없음) |

- 다른 초안 행(`/api/…`): `GET shipment-requests/shippable`(출하 가능 품목 조회), `PATCH shipment-requests/:id/cancel`. 취소는 [05] 5장에 따라 POST.
- "또는" 권한은 데코레이터 없이 service에서 `hasPermission`으로 확인한다.
- 배정 추천·확정·해제는 inventory 모듈 `allocations/*`(purpose = SHIPMENT).
- [권한표]: 영업 SHIPMENT_REQUEST_MANAGE USE·GOODS_ISSUE_CONFIRM·MILL_SHEET_READ VIEW / 물류 GOODS_ISSUE_CONFIRM·MILL_SHEET_READ USE·SHIPMENT_REQUEST_MANAGE VIEW / 품질 출고·밀시트 VIEW / 관리자 VIEW.

## 4. 업무 규칙

**출하요청 등록**(REQ-SHP-001)
- 요청 `{ customerId, shipDate, items: [{ salesOrderItemId, requestQty }] }`. 모든 수주 품목의 수주 고객사 = `customerId`(다른 고객사는 별도 요청, BP-SHP-01 예외).
- `requestQty`는 1 이상 정수, 출하 가능 매수 이하가 아니면 `SHP-002`. 취소된 수주 품목은 거부.
- 번호 `nextDocumentNumber(tx, 'SHIPMENT_REQUEST')`, 상태 REQUESTED(배정 대기).

**배정 → 상태**: inventory가 출하 배정을 확정·해제할 때 `refreshAllocationStatus(tx, shipmentRequestId)`(이 모듈 export)를 부른다. 모든 품목 미배정 = 0이면 ALLOCATED, 아니면 REQUESTED([06] SHIPMENT_REQUEST_STATUS).

**출하요청 취소**: REQUESTED·ALLOCATED만. ISSUED면 `SHP-003`. CONFIRMED 배정을 모두 해제(inventory) 후 CANCELLED.

**출고 확정**([04] 13.3, REQ-SHP-002)

1. 출하요청 품목·예약·배정·LOT을 고정 순서로 `SELECT … FOR UPDATE`(TypedSQL, [05] 8장).
2. LOT 재검증: 적격(제품 + 상위 히트 PASS) 아니면 `INV-002`, 이미 CONSUMED·SHIPPED면 `INV-004`, 배정이 CONFIRMED인지.
3. 품목별 출고 매수 ≤ 미출하 매수이고 ≤ ACTIVE 예약 매수, 아니면 `SHP-002`.
4. 배정 CONSUMED, LOT SHIPPED, `on_hand −n`·`reserved −n`, 예약 ACTIVE → CONVERTED 분할(inventory). 부분 출고면 해당 매수만 전환(ACTIVE 10 → ACTIVE 6 + CONVERTED 4).
5. 수주 품목·헤더 출하 상태 갱신(sales-order `recalcItemStatus`).
6. 출하요청 ISSUED, `issued_at`, `issued_employee_id` = 로그인 사원.
7. 수주별 밀시트 스냅샷 생성(REQ-SHP-003): 번호 `nextMillSheetNumber(tx, shipmentRequestId, shipmentRequestNo)`.
8. 작업 로그 기록.

**밀시트 스냅샷**(BP-SHP-01 문서 보존): 고객사·수주·규격·LOT·히트·이론중량·검사 항목과 값·발행일을 복사한다. 강종의 적용 규격 번호(`standard_no`)도 넣는다(TRM-113). 히트 성분과 슬래브·코일 검사값을 함께 넣고, 기존 재고와 새 생산분이 섞여 있으면 LOT별로 서로 다른 히트 값을 그대로 보여 준다(14.1-9).

**조회·PDF**(REQ-SHP-004): 조회는 저장된 스냅샷만 반환하고 현재 값을 다시 읽지 않는다. PDF는 버튼을 누를 때 스냅샷으로 렌더링(`pdfkit`이 이미 의존성에 있음) → `StorageService.save('mill-sheets', 파일명, buffer)` → `pdf_path` 저장. 실패하면 `SHP-001`이고, 재시도는 같은 스냅샷으로 PDF만 다시 만든다.

## 5. 오류 코드·작업 로그

| 코드 | 언제 |
| --- | --- |
| SHP-001 (500) | PDF 생성 실패(스냅샷은 있음) |
| SHP-002 (409) | 출하 가능 매수 초과(등록·출고) |
| SHP-003 (409) | ISSUED 출하요청 취소 |
| INV-002 | 출고 LOT 또는 상위 히트 미합격 |
| INV-004 | 이미 투입·출고된 LOT |
| COM-002 / COM-003 | 권한 없음 / 대상 없음 |

| 이벤트 | 기록 | actor | target | salesOrderId | lotIds |
| --- | --- | --- | --- | --- | --- |
| SHIPMENT_REQUEST_CREATED | 이 모듈 | USER | `shipment_request` | 수주별로 채움 🟡 | - |
| GOODS_ISSUE_CONFIRMED | 이 모듈 | USER | `shipment_request` | 수주별로 채움 🟡 | 출고 LOT 전부 |
| MILL_SHEET_ISSUED | 이 모듈 | USER | `mill_sheet` | 채움 | 그 밀시트의 LOT |
| RESERVATION_CONVERTED | inventory | USER | `reservation` | 채움 | 출고 LOT |
| ALLOCATION_RELEASED(요청 취소) | inventory | USER | `allocation` | 채움 | 해제 LOT |

`business_event.sales_order_id`는 하나라서, 한 출하요청에 수주가 여럿이면 수주마다 이벤트를 한 건씩 남겨야 수주 타임라인(REQ-LOG-003)에 모두 나온다.

## 6. 다른 모듈과의 경계

| 방향 | 상대 | 내용 |
| --- | --- | --- |
| 호출 | inventory | `consumeShipmentAllocations`, `convertReservations`, `releaseShipmentAllocationsOfRequest`, 적격 확인 |
| 호출 | sales-order | `recalcItemStatus(tx, salesOrderItemId)` |
| 호출됨 | inventory | `refreshAllocationStatus(tx, shipmentRequestId)` |
| 읽힘 | sales-order | 진행 중 출하요청 여부(SO-004) |
| 읽힘 | quality | 밀시트 발행 여부(측정값 수정 차단) |
| 읽힘 | lot | 정추적 끝의 출하·밀시트 |
| 공통 | `StorageService`(PDF), `NumberingService` | |

## 7. 테스트

[05] 11장: **출고 확정 로직은 서버 단위 테스트 필수**. [04] 14.3·14.1 관련 행:

| 검증 | 기대 결과 |
| --- | --- |
| 부분 출고 4매 | CONVERTED 4·ACTIVE 6, 헤더 부분출하 (SO-005, INV-005) |
| 나머지 6매 출고 | 전량 CONVERTED, 출하완료 (14.1-8) |
| 출고 재시도·PDF 실패 | 출고·문서 중복 없음, PDF만 재시도 (SHP-002~004) |
| 미합격 히트 하위 제품 출고 | 차단 INV-002 (SHP-002) |
| 다른 고객사 품목 묶기 | 거부 |
| ISSUED 요청 취소 | SHP-003 |
| 밀시트 스냅샷 | 이후 검사값을 바꿔도 밀시트 값 유지 (TRM-083) |

실행: `npm test -w @fantasteel/server -- shipment`(묶음 DB `fs_sales`).

## 8. 확인 필요 🟡

| 항목 | 내용 | 근거 |
| --- | --- | --- |
| 출하 가능 매수 | SHP-002의 기준 식이 없다. 후보: `min(미출하 매수, ACTIVE 예약 매수) − 진행 중(REQUESTED·ALLOCATED) 출하요청 매수` | [04] BP-SHP-01 "ACTIVE 예약·출하 가능 잔량 확인", 9.3 |
| 부분 출고 단위 | [04] 10장은 출하요청 상태를 ISSUED 하나로 끝내므로 부분 출하는 출하요청을 나눠야 한다. 한 요청 안에서 일부 품목만 출고하는 경우는 정의 없음 | [04] 10장·13.3 |
| 출고 전 ALLOCATED 필요 여부 | 미배정 품목이 남은 REQUESTED 상태에서 출고를 허용할지 | [04] 13.3, [06] |
| 이벤트 단위 | 여러 수주를 묶은 출하요청의 SHIPMENT_REQUEST_CREATED·GOODS_ISSUE_CONFIRMED를 수주별로 나눌지 | [ERD] business_event.sales_order_id |
| 취소 이벤트 | 출하요청 취소용 BUSINESS_EVENT_TYPE이 없다 | [06] |
| 오류 코드 | 고객사 불일치, 상태 전이 위반(이미 취소·출고)용 코드가 없다 | [04] 9.3 |
| 중복 출고 방지 | [CSV]·13.3 "Idempotency-Key 적용 후보", 요청 키 저장소 미정. 상태(ISSUED) 검사로 1차 방어 | [CSV], 08 공통 규약 |
| PDF 받기 | `POST mill-sheets/:id/pdf`가 파일을 돌려줄지 경로만 줄지, 다운로드 GET이 필요한지 [CSV]에 없다 | [CSV] |
| 출하 가능 품목 조회 | 초안 행 `GET shipment-requests/shippable`이 v1 목록에 없다 | [CSV] |

참고: `nextMillSheetNumber`는 같은 tx 안의 밀시트 수 + 1이므로, 수주가 여럿이면 밀시트를 하나 저장한 뒤 다음 번호를 받는 순서로 부른다(미리 여러 번 받으면 같은 번호가 나온다).
