# mrp — MRP 소요량 계산 조회

> 근거 약어: [02] 요구사항 정의서 · [03] 용어 사전 · [04] 업무 프로세스 정의서 · [05] 코드 컨벤션 · [06] 공통 코드 정의서 · [ERD] `docs/erd/fantasteel_erp_p1.dbml` · [CSV] API 목록 · [권한표] 역할별 메뉴 (v2) 3장. 🟡 = 확인 필요.
> 경로는 컨트롤러에 쓰는 모양(전역 prefix `/api/v1` 제외).

## 1. 담당 범위

| 항목 | 내용 |
| --- | --- |
| REQ | REQ-PRD-005(MRP 계산). REQ-PUR-001(구매요청은 MRP 결과를 참고해 담당자가 등록)의 입력 |
| BP | BP-PRD-01 히트 편성·MRP([04] 6장), 4.4 계산식 |
| 등급 | P1 |
| 성격 | **저장 없는 계산 조회**. [ERD] 설계 결정: "MRP 소요량은 저장하지 않고 계산"(`production_plan` Note: GET /mrp/requirements 계산 조회) |

## 2. 테이블

| 구분 | 테이블 | 쓰는 것 |
| --- | --- | --- |
| 읽기 | `production_plan` | 대상 계획, `heat_count`, `item_id`, `sales_order_item_id`, 상태 |
| 읽기 | `item`, `routing`, `spec_mapping`, `specific_consumption`, `production_setting` | 강종, 제강 수율, 원단위(공통 t/t, 합금철 kg/t), 히트 용량 |
| 읽기 | `lot`(RAW_MATERIAL) | 원료 LOT 잔량 `remaining_ton` 합계 |
| 읽기 | `purchase_order_item`, `goods_receipt`, `purchase_order` | 입고예정 = `ordered_ton − 입고 합계`(저장 안 함, [ERD] purchase_order_item Note), `expected_receipt_date` |
| 읽기 | `sales_order_item` | 필요일 판단(납기) 🟡 |
| 읽기 | `purchase_requisition` | 같은 계획의 기존 구매요청 표시(`production_plan_id`) |
| 쓰기 | 없음 | |

[04] 11장은 `production_plan`에 "소요량"을, `purchase_requisition`에 `required_ton`·`scheduled_receipt_ton`을 제안했지만 ERD에는 없다(ERD를 따른다). `required_ton`·`scheduled_receipt_ton`은 응답 필드 이름으로만 쓴다([03] TRM-050·051).

## 3. API

| Method | Path | 이름 | 권한 | 비고 ([CSV]) |
| --- | --- | --- | --- | --- |
| GET | `mrp/requirements` | MRP 소요량 조회 | `PURCHASE_REQUISITION_CREATE` VIEW | 12.2 명시 `?from=&to=`. 저장 없이 계산 조회, [05] 5장 예외 경로. 권한은 공통코드 "구매요청 등록·MRP" |

- 다른 초안 행: `GET /api/mrp`("여재는 가용재고에 포함, 원료 안전재고 없음"). [05] 5장 예시가 `GET /api/v1/mrp/requirements`이므로 이 경로로 만든다.
- [권한표]: 구매 USE, 생산·관리자 VIEW(2026-10-02에 생산을 USE → VIEW로 되돌림). 메뉴는 구매만.
- 컨트롤러: `@Get('mrp/requirements') @RequirePermission(PERMISSION.PURCHASE_REQUISITION_CREATE, 'VIEW')`.

## 4. 계산 ([04] 4.4 그대로)

```
목표중량(t)   = 부족 매수 × 제품 1매 이론중량
필요 용강(t)  = 목표중량 ÷ 누적 계획수율(연주 × 열연)
히트 수       = ceil(필요 용강 ÷ 히트 용량)
히트 톤(t)    = 히트 수 × 히트 용량
필요 용선(t)  = 히트 톤 ÷ 제강 계획 수율
철광석·석탄·석회석 소요(t) = 필요 용선(t) × 용선 1t당 원단위(t/t)
합금철 소요(t) = 히트 톤(t) × 강종별 원단위(kg/t, 용강 1t당) ÷ 1,000
순소요(t)     = max(0, 총소요 − 원료 LOT 잔량 − 입고예정)
```

- 히트 수·히트 톤은 production 모듈의 계산 함수를 그대로 쓴다(같은 수율을 두 번 적용하지 않음, 4.4 구현 제안). 계획에 저장된 `heat_count`를 쓸지 다시 계산할지는 8장 🟡.
- 원료 수량은 톤, 소수 3자리(REQ-PRD-005). `Prisma.Decimal`로 계산한다.
- 원료 안전재고 없음. 여재는 가용재고에 포함(제품 단계 — 수주 등록 때 이미 예약으로 반영돼 계획의 부족 매수에 들어가지 않는다).
- 입고예정은 필요일까지 도착하는 **확정 발주**(`purchase_order`)의 미입고량만 반영하고, 같은 공급을 계획별로 중복 차감하지 않는다(4.4 구현 제안). 필요일 순으로 정렬해 공급을 누적 차감한다("시점별 가용 공급 차감", BP-PRD-01 정상 흐름).
- 수주에 연결된 생산계획의 예정 제품을 다른 수주의 공급으로 잡지 않는다(REQ-PRD-005, BP-PRD-01).
- MRP를 다시 계산해도 같은 계획의 구매요청을 중복 생성하지 않는다 → 결과에 계획별 기존 구매요청(`purchase_requisition.production_plan_id`)을 함께 보여 준다. 구매요청 자동 생성은 P2(조달 자동화)라 만들지 않는다.
- 집계 쿼리(GROUP BY)는 TypedSQL로 둔다([05] 8장 "MRP 순소요"). `prisma/sql/*.sql` → `npm run generate:sql -w @fantasteel/server`(DB 필요) → `tx.$queryRawTyped(...)`.

응답 예(원료별 1행): `itemId`, `itemCode`, `rawMaterialType`, `requiredTon`(총소요), `remainingTon`(LOT 잔량), `scheduledReceiptTon`(입고예정), `netRequirementTon`(순소요), `requiredDate`, 관련 계획·수주 목록, 기존 구매요청 목록. 톤은 소수 3자리 문자열.

**시드로 확인하는 예**(SM355A 슬래브 부족 4매, 히트 1개 250t, 제강 수율 0.90, 원단위 ORE01 1.6·COL01 0.6·LIM01 0.15 t/t, SMN01 20kg/t — `seed.ts` 가정값):

| 항목 | 값 |
| --- | --- |
| 필요 용선 | 250 ÷ 0.9 = 277.778t |
| 철광석 | 277.777… × 1.6 = 444.444t |
| 석탄 | × 0.6 = 166.667t |
| 석회석 | × 0.15 = 41.667t |
| 합금철(SMN01) | 250 × 20 ÷ 1,000 = 5.000t |

반올림 위치에 따라 값이 달라진다(필요 용선을 277.778로 먼저 반올림하면 철광석 444.445t). 중간값은 반올림하지 않고 최종값만 소수 3자리로 반올림하는 것을 권장 🟡.

## 5. 오류 코드·작업 로그

| 코드 | 언제 |
| --- | --- |
| MST-001 | 제강·연주 수율, 규격 매핑, 원단위, 히트 용량이 없는 계획 |
| COM-004 | `from`·`to` 형식 오류 |

작업 로그: 없음(조회. BUSINESS_EVENT_TYPE에 MRP 이벤트 없음).

## 6. 다른 모듈과의 경계

| 상대 | 관계 |
| --- | --- |
| production | 계획 조회 + 히트 계산 함수(export 필요) |
| master-data | 라우팅·매핑·원단위·히트 용량 |
| purchasing | 입고예정(발주 품목 − 입고 합계) 계산을 같이 쓰면 purchasing이 함수를 export. 사용자는 MRP 결과로 구매요청을 등록하며 `productionPlanId`를 넘긴다 |
| (P2) factory-agent | RAW_SHORTAGE 규칙이 같은 계산을 재사용(4.4, 7장). 지금은 만들지 않는다 |

## 7. 테스트

[05] 11장: **MRP 로직은 서버 단위 테스트 필수**. [04] 14.3 관련 행:

| 검증 | 기대 결과 |
| --- | --- |
| 합금철 소요 계산 | 히트 톤 × kg/t ÷ 1,000 (MST-006, PRD-005) |
| 순소요 | 잔량·입고예정이 총소요보다 크면 0 |
| 입고예정 | 필요일 이후 도착 발주는 빼고, 같은 발주를 두 계획에서 중복 차감하지 않음 |
| 위 시드 예 | 표의 값 |

실행: `npm test -w @fantasteel/server -- mrp`(묶음 DB `fs_prod`). 계산 함수는 DB 없는 순수 단위 테스트로도 둔다.

## 8. 확인 필요 🟡

아래 항목은 팀 확정 전까지 다음 기준으로 구현했다(`mrp.service.ts`, `mrp.calculator.ts`). 바꾸면 계산 함수와 이 목록만 고친다. DB는 바꾸지 않는다.

| 항목 | 구현 기준 |
| --- | --- |
| `from`·`to` | 필요일로 거른다. 필요일 ≤ `to`인 계획을 보이고, 필요일 < `from`이면 밀린 소요(`isBeforePeriod`)로 표시. 차감은 기간과 관계없이 열린 계획 전부를 필요일 순으로 한다 |
| 필요일 | 연결 수주 품목 납기(`sales_order_item.due_date`). 수주 연결이 없으면(재생산·수주 해제) 계획 등록일(서울 날짜). 리드타임은 빼지 않는다 |
| 대상 계획 | PLANNED·IN_PROGRESS. 남은 히트 = `heat_count` − 그 계획 실적으로 만든 HEAT LOT 수(0 이하면 제외) |
| `heat_count` | 저장값을 쓴다(다시 계산하지 않음). 히트 톤 = 남은 히트 × 지금 히트 용량 |
| 진행 중 구매요청 | 공급에 넣지 않는다. 대신 같은 계획·원료의 구매요청 번호를 `existingPurchaseRequisitionNo`로 보여 준다 |
| 입고예정 | 확정 발주(RECEIVED 아님)의 미입고량. 입고예정일 ≤ 필요일인 것만 쓰고, 입고예정일이 없으면 쓰지 않는다. 구매요청에 계획이 있으면 그 계획이 먼저 쓰고, 소요가 남은 다른 계획은 쓰지 않는다 |
| 반올림 | 중간값(용선)은 반올림하지 않고 소요량에서 한 번 소수 3자리 |
| 원단위 없음 | 용선 1t당 원단위가 하나도 없거나 제강 수율·히트 용량이 없으면 MST-001. 강종별 합금철 원단위가 없으면 그 합금철 소요 0 |

| 항목 | 내용 | 근거 |
| --- | --- | --- |
| `from`·`to`의 기준 | 어떤 날짜로 계획을 거르는지(수주 품목 납기? 계획 생성일?) 정의가 없다 | [04] 12.2 |
| 필요일 | 생산계획에 날짜 컬럼이 없다. 납기(`sales_order_item.due_date`)를 쓸지, 리드타임을 뺄지 미정. 재생산·수주 해제 계획은 납기 연결도 없다 | [ERD] production_plan |
| 대상 계획 범위 | PLANNED만? IN_PROGRESS의 남은 소요(이미 투입한 원료 제외)는? 수주 해제된 계획은? | [04] 4.4, BP-PRD-01 |
| `heat_count` vs 재계산 | 히트 용량 설정이 바뀌면 저장된 `heat_count`와 다시 계산한 값이 다를 수 있다 | [ERD], REQ-MST-009 |
| 진행 중 구매요청 | 승인 대기·승인된 구매요청(발주 전)은 4.4 공급에 없다 → 화면에서 중복 요청이 생길 수 있다 | [04] 4.4, BP-PRD-01 |
| 반올림 위치 | 중간값 반올림 여부에 따라 0.001t 차이 | [02] REQ-PRD-005 |
| 결과 확인 | BP-PRD-01 흐름 끝의 "담당자 확인"을 저장할 곳이 없다(ERD에 MRP 테이블 없음) | [04] BP-PRD-01, [ERD] |
| 권한 표시명 | "구매요청 등록·MRP" 한 권한에 등록(USE)과 MRP 조회가 묶여 있어 MRP만 볼 권한을 따로 줄 수 없다 | [06] PERMISSION |
