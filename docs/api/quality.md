# quality API — 검사·자동 판정·불합격 처리

기준: REQ-QC-001~004, REQ-INV-003·004·007, BP-QC-01, SERVER-GUIDE 6장.
모든 경로 앞에 `/api/v1`. 응답은 `{ success: true, data }` / `{ success: false, error: { code, message } }`.
아래 타입은 `data`의 모양이며 실제 curl 응답에서 옮겼다. Decimal(기준·측정값)은 문자열 (`"0.25"`, `"489.9"`), 시각은 ISO 문자열.

| 메서드·경로 | 권한 | 하는 일 |
|---|---|---|
| `GET /quality-inspections` | INSPECTION_REGISTER 조회 | 검사 대기 LOT(기본) 또는 등록된 검사 |
| `GET /quality-inspections/:id` | INSPECTION_REGISTER 조회 | 검사 1건 |
| `POST /quality-inspections` | INSPECTION_REGISTER 사용 | 측정값 등록 → 자동 판정 (201) |
| `GET /lots/rejected` | DISPOSITION_SET 또는 INSPECTION_REGISTER 조회 | 불합격 LOT + 불합격 히트의 하위 LOT |
| `GET /quality-inspections/rejected-lots` | 위와 같음 | `GET /lots/rejected`와 같은 응답 (아래 주의 참고) |
| `POST /lots/:id/disposition` | DISPOSITION_SET 사용 | 불합격 처리 상태 지정 |

주의: `GET /lots/rejected`는 lot 모듈의 `GET /lots/:id`와 경로가 겹친다. 지금 구성에서는 정상 동작하지만(모듈 등록 순서에 달려 있다) 가려지면 `COM-003 "Validation failed (numeric string is expected)"`가 나온다. 그때는 같은 응답을 주는 `GET /quality-inspections/rejected-lots`를 쓴다.

## 검사 대상과 항목

| LOT | processCode | 검사 | 항목·기준 출처 |
|---|---|---|---|
| 히트 `HEAT` | `STEELMAKING` | 성분 검사 | 강종 성분 규격(composition_spec). 항목 코드 = 원소 코드 `C`·`Si`·`Mn`·`P`·`S`, 단위 `%`, 모두 필수 |
| 슬래브 `SLAB` | `CASTING` | 슬래브 검사(표면·치수) | 검사 항목(inspection_item)의 CASTING 항목: 강종 전용 + 공통(강종 없음). 같은 코드면 강종 전용 우선 |
| 코일 `COIL` | `HOT_ROLLING` | 코일 검사(치수·기계적 성질) | 검사 항목의 HOT_ROLLING 항목 (위와 같은 규칙) |

## 공통 타입

```ts
type InspectionProcessCode = 'STEELMAKING' | 'CASTING' | 'HOT_ROLLING';

interface InspectionLot {
  id: number;
  lotNo: string;
  lotType: 'HEAT' | 'SLAB' | 'COIL';
  lotTypeName: string;           // "히트" | "슬래브" | "코일"
  lotStatus: 'IN_STOCK' | 'CONSUMED' | 'SHIPPED';
  isPassed: boolean | null;      // null = 검사 전
  steelGradeId: number | null;
  steelGradeCode: string | null; // "SM355"
  productSpecId: number | null;  // 히트는 null
  specCode: string | null;
  heatLotId: number | null;      // 슬래브·코일의 상위 히트 (히트 자신은 null)
  heatLotNo: string | null;
  heatIsPassed: boolean | null;  // 상위 히트 성분 검사 결과. null = 아직 판정 전 (또는 히트 자신)
  productionPlanId: number | null;
  productionPlanNo: string | null;
  /** LOT의 수주 품목. 히트처럼 LOT에 없으면 생산계획의 수주 품목 */
  salesOrderItemId: number | null;
  salesOrderId: number | null;
  salesOrderNo: string | null;
  customerName: string | null;
  producedAt: string;
}

/** 측정할 항목 1개와 기준 */
interface InspectionSpecItem {
  inspectionItemCode: string;    // "C" | "TENSILE_STRENGTH" | "SURFACE_DEFECT_COUNT" …
  inspectionItemName: string;    // "C" | "인장강도" | "표면 결함 수"
  unit: string | null;           // "%" | "MPa" | "mm" | "개"
  minValue: string | null;       // null = 하한 없음
  maxValue: string | null;       // null = 상한 없음
  isRequired: boolean;
  sortOrder: number;
}

/** status=pending 의 한 줄 */
interface PendingInspection {
  inspectionResult: 'PENDING';
  processCode: InspectionProcessCode;
  inspectionName: string;        // "성분 검사" | "슬래브 검사" | "코일 검사"
  lot: InspectionLot;
  items: InspectionSpecItem[];
}

/** 등록된 검사 */
interface Inspection {
  id: number;
  qualityInspectionNo: string;   // "QI-20260930-0230"
  processCode: InspectionProcessCode;
  inspectionName: string;
  inspectionResult: 'PASS' | 'FAIL';
  inspectorEmployeeId: number | null;   // null = 시스템(실적 시뮬레이션·시드)
  inspectorEmployeeName: string | null;
  inspectedAt: string;
  memo: string | null;
  lot: InspectionLot;
  /** 판정에 쓴 기준이 함께 저장된다 */
  values: {
    inspectionItemCode: string;
    inspectionItemName: string;
    unit: string | null;
    minValue: string | null;
    maxValue: string | null;
    measuredValue: string | null; // 입력하지 않은 선택 항목은 null
    isPassed: boolean | null;     // 입력하지 않은 선택 항목은 null
    sortOrder: number;
  }[];
}
```

## GET /quality-inspections

쿼리: `status?`(`pending` 기본 | `done`), `processCode?`(STEELMAKING | CASTING | HOT_ROLLING), `lotId?`
- `status=pending` → `PendingInspection[]` (생산 시각 순). 아직 판정 전인 히트, 그리고 미소진(IN_STOCK)이면서 상위 히트가 불합격이 아닌 슬래브·코일. 상위 히트가 아직 미판정인 슬래브도 나온다 (먼저 검사할 수 있다).
- `status=done` → `Inspection[]` (검사 시각 최신순, 최대 300건)

## GET /quality-inspections/:id

응답: `Inspection`. 없으면 `COM-004`.

## POST /quality-inspections

```ts
interface RegisterBody {
  lotId: number;
  values: { inspectionItemCode: string; measuredValue: number | string }[]; // 1개 이상. 숫자, 소수 4자리까지
  memo?: string;
}
```

응답: `Inspection` (201). 판정은 시스템이 한다 (제안 단계 없음).
- 값마다 `min ≤ 측정값 ≤ max` (**경계 포함**). 하나라도 벗어나면 `FAIL`, 모두 안이면 `PASS`. 결과가 `lot.isPassed`에 들어간다.
- 같은 트랜잭션에서 재고에 반영된다 (StockService.onLotJudged):
  - 슬래브·코일 합격 + 상위 히트 합격 → 재고 풀에 들어가고, 원래 수주 품목의 미확보 매수 안에서 자동 예약. 코일 수주의 슬래브는 필요한 매수만 열연 투입용으로 귀속(재고 풀 밖), 나머지는 여재.
  - 히트 합격 → 이미 제품 검사에 합격해 있던 하위 슬래브·코일이 이때 재고에 들어간다.
  - 불합격 → 재고에 들어가지 않는다. 히트 불합격이면 하위 슬래브·코일도 쓸 수 없고, 하위 LOT의 CONFIRMED 배정은 해제된다.
- 작업 로그: `INSPECTION_REGISTERED`, 불합격이면 `REJECTED_JUDGED`(사유 QUALITY_FAILURE, 히트면 하위 LOT도 lotIds에 포함). 자동 예약은 `AUTO_RESERVED`.
- 판정 뒤 생산계획 완료 여부를 다시 본다 (production.md "계획 상태").
- 알림: 불합격 → 검사자 소속 부서(품질) `/quality/rejected?lot=:id` + 생산 역할 `/production/plans?plan=:id`. 코일 계획의 슬래브가 합격해 열연 투입이 가능해지면 생산 역할에 한 번 `/production/rolling?plan=:id`.

오류 (아무것도 저장하지 않는다. LOT은 검사 대기로 남는다)
- 필수 측정값 누락: `COM-003` `필수 측정값이 비어 있어 판정하지 않았습니다: Si, Mn, P, S`
- 기준에 없는 항목 / 같은 항목 중복: `COM-003`
- 검사 기준이 없음(항목 없음, 필수 항목에 min·max 둘 다 없음): `MST-001`
- 이미 검사한 LOT(재검사 미지원): `COM-005` `HT-2-260930-006: 이미 성분 검사가 등록된 LOT입니다 (재검사는 지원하지 않습니다)`
- 상위 히트가 불합격인 LOT, 이미 투입·출고된 슬래브·코일: `COM-005`
- 히트·슬래브·코일이 아닌 LOT: `COM-003`, 없는 LOT: `COM-004`

## GET /lots/rejected

응답: `RejectedLot[]` (생산 시각 최신순). 자기 검사에 불합격한 LOT과, 상위 히트가 성분 불합격인 슬래브·코일.

```ts
interface RejectedLot {
  id: number;
  lotNo: string;
  lotType: 'HEAT' | 'SLAB' | 'COIL';
  lotStatus: string;
  isPassed: boolean | null;      // 히트 때문에 못 쓰는 LOT은 true(자기 검사는 합격)나 null(검사 전)일 수 있다
  rejectedBy: 'OWN' | 'HEAT';    // OWN = 자기 검사 불합격, HEAT = 상위 히트 성분 불합격으로 사용 불가
  steelGradeCode: string | null;
  specCode: string | null;
  heatLotId: number | null;
  heatLotNo: string | null;
  productionPlanId: number | null;
  productionPlanNo: string | null;
  /** 불합격의 근거가 된 검사. rejectedBy = HEAT 이면 상위 히트의 성분 검사 */
  failedInspection: {
    id: number;
    qualityInspectionNo: string;
    processCode: 'STEELMAKING' | 'CASTING' | 'HOT_ROLLING';
    inspectedAt: string;
    failedItems: { inspectionItemCode: string; inspectionItemName: string; unit: string | null; minValue: string | null; maxValue: string | null; measuredValue: string | null }[];
  } | null;
  dispositionStatus: 'HOLD' | 'DOWNGRADED' | 'SCRAPPED' | null; // null = 미지정
  dispositionReason: string | null;
  dispositionAt: string | null;
  /** 영향받는 수주 품목: LOT의 수주 품목, 없으면(히트 등) 생산계획의 수주 품목 */
  affectedSalesOrderItem: {
    salesOrderItemId: number; salesOrderId: number; salesOrderNo: string; lineNo: number;
    customerName: string; dueDate: string; orderedQty: number; salesOrderItemStatus: string;
  } | null;
  /** 그 수주 품목에 취소되지 않은 재생산 계획이 있는지 (가장 최근 것) */
  hasReproductionPlan: boolean;
  reproductionPlan: { id: number; productionPlanNo: string; productionPlanStatus: string; shortageQty: number } | null;
  producedAt: string;
}
```

재생산이 필요한지는 `GET /production-plans/reproduction-preview?salesOrderItemId=`로 확인하고 `POST /production-plans`로 만든다 (production.md).

## POST /lots/:id/disposition

요청 `{ dispositionStatus: 'HOLD' | 'DOWNGRADED' | 'SCRAPPED'; reason: string }` (사유 필수, 500자 이내). 응답: `RejectedLot` (200).
- 불합격 LOT(자기 검사 불합격 또는 상위 히트 불합격)에만 지정할 수 있다. 아니면 `COM-005`. 다시 지정해 바꿀 수 있다.
- 상태·사유·시각만 기록한다. 재고·예약·배정은 바뀌지 않는다 (REQ-QC-004). 작업 로그 `DISPOSITION_SET` (변경 전·후 값).
- 값·사유 누락 `COM-003`, 없는 LOT `COM-004`.

## 실시간 주제

`quality-inspections`, `lots`, `inventories`, `production-plans`
