# production API — 생산계획·히트 편성·공정 실적·실적 시뮬레이션

기준: REQ-PRD-001~007, REQ-LOT-001~004, BP-PRD-01·02, BP-INV-01, BP-SEED-01, SERVER-GUIDE 6장.
모든 경로 앞에 `/api/v1`. 응답은 `{ success: true, data }` / `{ success: false, error: { code, message } }`.
아래 타입은 `data`의 모양이며 실제 curl 응답에서 옮겼다. **Decimal은 문자열**이다 (`…Ton`은 소수 3자리 `"263.158"`, 수율·치수는 `"0.96"`·`"250"`처럼 자릿수 고정 없음). 날짜·시각은 ISO 문자열 (`dueDate`도 `"2026-10-20T00:00:00.000Z"`).

| 메서드·경로 | 권한 | 하는 일 |
|---|---|---|
| `GET /production-plans` | PLAN_CONFIRM 조회 | 계획 목록 |
| `GET /production-plans/:id` | PLAN_CONFIRM 조회 | 계획 상세 |
| `GET /production-plans/reproduction-preview?salesOrderItemId=` | PLAN_CONFIRM 조회 | 재생산 전 확인 (필요 매수·가용 재고·여재) |
| `POST /production-plans` | PLAN_CONFIRM 사용 | 재생산 계획 생성 (201) |
| `POST /production-plans/:id/heat-preview` | PLAN_CONFIRM 조회 | 히트 편성 미리보기 (저장 안 함) |
| `POST /production-plans/:id/confirm` | PLAN_CONFIRM 사용 | 히트 편성 확정 |
| `POST /production-plans/:id/cancel` | PLAN_CONFIRM 사용 | 계획 취소 (작업 시작 전만) |
| `POST /production-plans/:id/simulate-results` | RESULT_CONFIRM 사용 | 실적 시뮬레이션 |
| `GET /production-results` | RESULT_CONFIRM 또는 PLAN_CONFIRM 조회 | 공정 실적 목록 |
| `POST /production-results/:id/start` | RESULT_CONFIRM 사용 | 작업 시작 |
| `POST /production-results/:id/complete` | RESULT_CONFIRM 사용 | 작업 완료·실적 등록 |

`POST /production-results`(실적 행을 직접 만드는 API)는 만들지 않았다. 실적 행은 편성 확정 때 생기고, 제선·열연을 나눠 등록하면 남은 양의 행이 자동으로 이어서 생긴다.
열연 투입 슬래브 배정은 inventory 모듈의 `POST /allocations/recommend`·`POST /allocations` (`{ purpose: "ROLLING", productionPlanId, lotIds }`)를 쓴다.

## 공통 타입

```ts
type ProcessCode = 'IRONMAKING' | 'STEELMAKING' | 'CASTING' | 'HOT_ROLLING';

interface SpecView {
  id: number;
  specCode: string;              // "CL-SM355-6x1500x407000"
  itemType: 'SLAB' | 'COIL';
  steelGradeCode: string;        // "SM355"
  thicknessMm: string;           // "6"
  widthMm: string;               // "1500"
  lengthMm: string;              // "407000"
  theoreticalWeightTon: string;  // "28.755"
}

/** 목록의 한 줄이자 상세의 앞부분 */
interface PlanSummary {
  id: number;
  productionPlanNo: string;      // "PP-20260930-0067"
  productionPlanStatus: 'PLANNED' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  isReproduction: boolean;
  itemType: 'SLAB' | 'COIL';     // 목표 제품
  productSpec: SpecView;         // 목표 제품 규격
  slabSpec: SpecView | null;     // 연주에서 만들 슬래브 규격 (슬래브 계획이면 productSpec과 같다. 매핑이 없으면 null)
  steelGrade: { id: number; steelGradeCode: string; steelGradeName: string };
  /** 수주 취소로 연결이 끊긴 계획은 null (완료 후 여재) */
  salesOrder: {
    salesOrderId: number;
    salesOrderNo: string;
    salesOrderItemId: number;
    lineNo: number;
    orderedQty: number;
    salesOrderItemStatus: string;
    customerName: string;
    dueDate: string;
    ownerEmployeeName: string;
  } | null;
  shortageQty: number;           // 목표 매수 (슬래브 매 / 코일 개)
  shortageTon: string;           // 계산값 = shortageQty × 목표 규격 이론중량
  surplusUseQty: number;         // 여재 슬래브로 채우는 매수 (편성 확정 때 정함)
  heatCount: number;             // 편성 전 0
  plannedSlabQty: number;        // 히트 수 × 히트당 슬래브 계획 매수
  requiredInputTon: string;      // 필요 투입량(용강 t)
  cumulativeYieldRate: string | null; // 편성 전 null. "0.9377"
  /** 공정별 실적 진행. 실적이 있는 공정만 나온다 (편성 전에는 []) */
  progress: { processCode: ProcessCode; totalCount: number; startedCount: number; completedCount: number }[];
  /** 생산 담당이 할 일이 남았는지: 편성 전(PLANNED)이거나, 대기·작업 중인 실적이 있다 */
  needsAction: boolean;
  createdAt: string;
  confirmedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

interface LotView {
  id: number;
  lotNo: string;                 // 용선 "HM-1-260930-36" / 히트 "HT-2-260930-006" / 슬래브 "HT-2-260930-006-02" / 코일 "C2-260930-006-02"
  lotType: 'HOT_METAL' | 'HEAT' | 'SLAB' | 'COIL';
  lotStatus: 'IN_STOCK' | 'CONSUMED' | 'SHIPPED';
  isPassed: boolean | null;      // 자기 검사 결과. null = 검사 전 (용선은 항상 null)
  heatLotId: number | null;      // 슬래브·코일의 상위 히트
  heatLotNo: string | null;
  heatIsPassed: boolean | null;  // 상위 히트 성분 검사 결과 (히트·용선 LOT은 null)
  isEligible: boolean;           // 적격 = 자기 검사 합격 + 상위 히트 합격 + IN_STOCK
  isEarmarked: boolean;          // 코일 수주 품목의 열연 투입용으로 잡혀 있는 슬래브 (재고 풀 밖)
  confirmedAllocationId: number | null; // CONFIRMED 배정이 있으면 그 id
  productSpecId: number | null;
  specCode: string | null;
  weightTon: string | null;      // 규격 1매 이론중량 (용선·히트는 null)
  initialTon: string | null;     // 용선·히트
  remainingTon: string | null;   // 용선
  salesOrderItemId: number | null;
  productionPlanId: number | null;
  productionResultId: number | null;
  dispositionStatus: 'HOLD' | 'DOWNGRADED' | 'SCRAPPED' | null;
  producedAt: string;
}

interface ResultView {
  id: number;
  productionPlanId: number;
  productionPlanNo: string;
  processCode: ProcessCode;
  heatSeq: number | null;        // 제강·연주: 계획 안의 히트 순번(1부터). 제선·열연은 null
  productionResultStatus: 'READY' | 'STARTED' | 'COMPLETED';
  startedAt: string | null;
  completedAt: string | null;
  blastFurnaceNo: string | null; // 제선
  converterNo: string | null;    // 제강
  inputTon: string | null;       // 제선: 투입 원료 합계 / 제강: 투입 용선 / 연주: 히트 톤 / 열연: 투입 슬래브 이론중량 합
  outputTon: string | null;      // 제선: 용선량 / 제강: 히트 톤 / 연주: 슬래브 이론중량 합 / 열연: 코일 이론중량 합
  plannedQty: number | null;     // 연주: 히트당 슬래브 계획 매수 / 열연: 이 행에서 압연해야 할 남은 매수
  outputQty: number | null;      // 연주: 슬래브 매수 / 열연: 코일 수
  lossQty: number | null;        // 연주: plannedQty − outputQty / 열연: 0
  sampledLossRate: string | null;// 시뮬레이션이 연주에서 뽑은 손실률 "0.0005" (직접 등록은 null)
  isSimulated: boolean;
  operatorEmployeeId: number | null; // 시뮬레이션은 null
  /** 대기·작업 중인 제선 실적에만: 이 계획에 아직 필요한 용선 톤 (complete의 hotMetalTon 기본값). 그 밖은 null */
  defaultHotMetalTon: string | null;
  /** 이 실적이 만든 LOT */
  lots: { id: number; lotNo: string; lotType: string; isPassed: boolean | null }[];
}

interface PlanDetail extends PlanSummary {
  results: ResultView[];          // id 순 (제선 → 제강 1..n → 연주 1..n → 열연, 이어서 생긴 행은 뒤에)
  lots: { hotMetals: LotView[]; heats: LotView[]; slabs: LotView[]; coils: LotView[] }; // 이 계획이 만든 LOT
  /** 이 수주 품목의 열연 투입용으로 잡혀 있는 적격 슬래브 (여재에서 끌어온 것 포함). 코일 계획이 진행 중일 때만 */
  earmarkedSlabs: LotView[];
  /** 이 계획의 열연 배정 (CONFIRMED·CONSUMED·RELEASED 모두) */
  rollingAllocations: {
    id: number; status: 'CONFIRMED' | 'CONSUMED' | 'RELEASED'; lotId: number; lotNo: string; heatLotNo: string | null;
    confirmedAt: string; consumedAt: string | null; releasedAt: string | null;
  }[];
  /** 코일 계획만. 슬래브 계획은 null */
  rolling: {
    rolledQty: number;              // 이 계획으로 압연한 코일 수
    remainingQty: number;           // 목표까지 더 압연할 수 = shortageQty − rolledQty
    rollingNeedQty: number;         // 수주 품목 기준으로 슬래브를 더 확보해야 하는 수 (미확보 − 검사 대기 코일 − 귀속 슬래브)
    earmarkedSlabQty: number;       // 귀속된 적격 슬래브 수 (배정 확정분 포함)
    confirmedAllocationQty: number; // CONFIRMED 열연 배정 수 (다음 열연 완료에 투입될 수)
  } | null;
  surplus: {
    expectedQty: number;          // 편성 시 예상 여재 = plannedSlabQty − (shortageQty − surplusUseQty)
    actualQty: number;            // 실제 여재: 코일 계획 = 귀속·배정 없이 남은 적격 슬래브 / 슬래브 계획 = 합격 슬래브 − shortageQty
  };
  /** 이 계획이 수주 품목에 아직 채워 줄 수 있는 매수 (재생산 필요 매수 계산에 쓰인다). 완료·취소 계획은 0 */
  remainingTargetQty: number;
}
```

## GET /production-plans

쿼리: `status?`(PLANNED|CONFIRMED|IN_PROGRESS|COMPLETED|CANCELLED), `itemType?`(SLAB|COIL), `needsAction?`(true|false). 최신 계획이 먼저.
응답: `PlanSummary[]`

## GET /production-plans/:id

응답: `PlanDetail`. 없으면 `COM-004`(404).

## POST /production-plans/:id/heat-preview

저장하지 않는다. 요청 `{ surplusUseQty?: number }` (0 이상 정수, 기본 0). 코일 계획에서만 1 이상을 줄 수 있고 `shortageQty` 이하여야 한다 (`COM-003`).

```ts
interface HeatPreview {
  productionPlanId: number;
  productionPlanNo: string;
  productionPlanStatus: string;
  itemType: 'SLAB' | 'COIL';
  shortageQty: number;
  surplusUseQty: number;
  targetQty: number;             // 새로 생산할 매수 = shortageQty − surplusUseQty
  targetTon: string;             // targetQty × 목표 규격 이론중량
  steelmakingYieldRate: string;  // "0.95" (용선 → 용강 환산에만 쓴다)
  castingYieldRate: string;      // "0.96"
  hotRollingYieldRate: string;   // 코일 이론중량 ÷ 슬래브 이론중량 "0.9768" (슬래브 계획은 "1")
  cumulativeYieldRate: string;   // 연주 × 열연 "0.9377"
  requiredInputTon: string;      // targetTon ÷ cumulativeYieldRate
  heatCapacityTon: string;       // "250.000"
  heatCount: number;             // ceil(requiredInputTon ÷ heatCapacityTon). 여재만으로 채우면 0
  heatTon: string;               // heatCount × heatCapacityTon
  hotMetalTon: string;           // heatTon ÷ steelmakingYieldRate
  slabQtyPerHeat: number;        // floor(heatCapacityTon × castingYieldRate ÷ 슬래브 이론중량)
  plannedSlabQty: number;        // heatCount × slabQtyPerHeat
  expectedSurplusQty: number;    // max(0, plannedSlabQty − targetQty)
  slabSpecId: number;
  surplus: {
    availableQty: number;        // 재고 풀에서 지금 열연에 쓸 수 있는 여재 슬래브 매수 (다른 수주 예약분 제외)
    maxUseQty: number;           // 이 계획의 surplusUseQty 상한 = min(shortageQty, availableQty). 슬래브 계획은 0
    lots: LotView[];             // 쓸 수 있는 여재, FIFO 순 (확정하면 앞에서부터 surplusUseQty매가 귀속된다)
  };
  rawMaterials: {
    rawMaterialId: number;
    materialCode: string;        // "IO" | "CL" | "LS" | "FM" | "FS"
    rawMaterialName: string;     // "철광석"
    rawMaterialType: 'IRON_ORE' | 'COAL' | 'LIMESTONE' | 'FERROALLOY';
    requiredTon: string;         // 총소요: 철광석·석탄·석회석 = hotMetalTon × 원단위, 합금철 = heatTon × kg/t ÷ 1000
    remainingTon: string;        // 현재 원료 재고(톤)
    shortageTon: string;         // max(0, requiredTon − remainingTon). 입고예정은 빼지 않는다 (MRP 화면에서 확인)
    isShort: boolean;
  }[];
  hasRawShortage: boolean;
}
```

주의: `plannedSlabQty`가 `targetQty`보다 작게 나올 수 있다 (예: SS275 슬래브 101매 → 히트 10개, 슬래브 계획 100매). 핵심 계산기(YieldCalculator)의 문제로 보고해 두었다. 화면에서는 `plannedSlabQty < targetQty`이면 경고를 보여 주는 것이 좋다.

## POST /production-plans/:id/confirm

요청은 heat-preview와 같다 (`{ surplusUseQty?: number }`). 응답: `PlanDetail` (200).
- `PLANNED` 계획만 (`COM-005`). 편성 값을 저장하고 `CONFIRMED`로 바꾼다.
- READY 실적 행을 만든다: **제선 1행(계획당, heatSeq null) · 제강 1행/히트 · 연주 1행/히트(plannedQty = 히트당 슬래브 계획 매수) · 열연 1행(코일 계획, plannedQty = shortageQty)**. `heatCount = 0`이면 열연 행만 생긴다.
- `surplusUseQty > 0`이면 여재 슬래브를 FIFO로 그 매수만큼 이 수주 품목의 열연 투입용으로 귀속시킨다 (재고 풀에서 빠진다). 여재가 모자라면 `INV-001`.
- 작업 로그 `PRODUCTION_PLAN_CONFIRMED`.

## POST /production-plans/:id/cancel

요청 `{ reason?: string }`. 응답: `PlanDetail` (200, `productionPlanStatus: "CANCELLED"`).
- `PLANNED`·`CONFIRMED`이고 모든 실적이 READY일 때만. 하나라도 시작했으면 `COM-005`.
- 이 계획의 CONFIRMED 열연 배정을 해제하고, 편성 때 귀속시킨 여재(`surplusUseQty`매)를 재고 풀로 돌린다. 작업 로그 `PRODUCTION_PLAN_CANCELLED`.

## GET /production-plans/reproduction-preview?salesOrderItemId=

```ts
interface ReproductionPreview {
  salesOrderItemId: number;
  salesOrderId: number;
  salesOrderNo: string;
  lineNo: number;
  customerName: string;
  salesOrderItemStatus: string;
  productSpec: SpecView;
  orderedQty: number;
  shippedQty: number;
  unsecuredQty: number;          // 현재 미확보 = max(0, 주문 − 누적 출고 − ACTIVE 예약)
  openPlans: { id: number; productionPlanNo: string; productionPlanStatus: string; shortageQty: number; remainingTargetQty: number }[];
  openPlanRemainingQty: number;  // 진행 계획 잔여 목표 합계
  additionalQty: number;         // 추가 계획 필요 매수 = max(0, unsecuredQty − openPlanRemainingQty). 0이면 재생산 불가
  stockAvailableQty: number;     // 같은 규격의 예약 가용 재고. 재생산 시 이만큼 먼저 예약한다
  planQty: number;               // 재고 예약 뒤 새 계획으로 만들 매수 = max(0, additionalQty − stockAvailableQty)
  /** 코일 품목만: 대응 슬래브 규격의 여재 (새 계획의 히트 편성에서 surplusUseQty로 쓸 수 있다). 슬래브 품목은 null */
  surplus: { slabSpec: SpecView; availableQty: number; lots: LotView[] } | null;
}
```

`remainingTargetQty`(계획이 아직 채워 줄 수 있는 매수): 편성 전 계획은 `shortageQty`, 편성 후에는 `min(shortageQty, 아직 나올 수 있는 매수)`.
아직 나올 수 있는 매수 = 연주 전 히트의 슬래브 계획 매수 + 판정 대기 중인 슬래브 (+ 코일 계획이면 귀속된 적격 슬래브 + 검사 대기 코일).

## POST /production-plans — 재생산 (REQ-PRD-006)

요청 `{ salesOrderItemId: number; reason?: string }`. 매수는 서버가 계산한다. 응답 (201):

```ts
interface ReproductionResult {
  additionalQty: number;         // 추가 계획 필요 매수
  reservedFromStockQty: number;  // 계획을 만들기 전에 가용 재고(슬래브 품목이면 여재)에서 먼저 예약한 매수
  planQty: number;               // 새 재생산 계획의 목표 매수 = additionalQty − reservedFromStockQty
  plan: PlanDetail | null;       // planQty가 0이면 null (재고로 모두 채워 계획을 만들지 않음)
}
```

- `additionalQty = 0`이면 `COM-005` "추가로 생산할 매수가 없습니다". 취소된 품목 `COM-005`, 없는 품목 `COM-004`.
- 새 계획은 `PLANNED`, `isReproduction: true`. 작업 로그 `REPRODUCTION_PLAN_CREATED` (재고 예약분은 `RESERVATION_CREATED`).

## GET /production-results

쿼리: `planId?`, `processCode?`, `status?`(READY|STARTED|COMPLETED). 응답: `ResultView[]` (계획 최신순, 계획 안에서는 id 순).

## POST /production-results/:id/start

본문 없음. 응답: `ResultView` (200, `STARTED`).
- READY 실적만 (`COM-005`). 계획이 CONFIRMED·IN_PROGRESS여야 한다. 계획의 첫 시작이면 계획이 `IN_PROGRESS`가 된다.
- 연주는 같은 히트의 제강 실적이 완료돼 있어야 시작할 수 있다 (`COM-005`).
- 작업 로그 `WORK_STARTED`.

## POST /production-results/:id/complete

STARTED 실적만 (`COM-005` "먼저 작업을 시작해 주세요"). 응답: `ResultView` (200, `COMPLETED`, `lots`에 새 LOT).
작업 로그 `WORK_COMPLETED` + `RESULT_REGISTERED` (lotIds = 만든 LOT + 투입한 LOT).

```ts
interface CompleteBody {
  blastFurnaceNo?: string;   // 제선 필수. 영문·숫자 4자 이내 (LOT 번호에 들어간다)
  hotMetalTon?: string | number; // 제선 선택. 0보다 큰 톤(소수 3자리까지). 비우면 defaultHotMetalTon
  converterNo?: string;      // 제강 필수. 영문·숫자 4자 이내
  outputQty?: number;        // 연주 필수. 0 이상 정수, plannedQty 이하
  allocationIds?: number[];  // 열연 선택. 투입할 CONFIRMED 열연 배정 id. 비우면 이 계획의 CONFIRMED 열연 배정 전부
}
```

| 공정 | 처리 |
|---|---|
| 제선 | 철광석·석탄·석회석을 `용선량 × 원단위`만큼 원료 LOT 입고일 FIFO로 차감 → 용선 LOT `HM-고로-YYMMDD-NN`. 계보 `RAW_TO_HOT_METAL`(PERIOD, 작업 시작~완료, input_ton). 필요량보다 적게 출선하면 남은 양의 제선 READY 행이 이어서 생긴다 |
| 제강 | 이 계획의 용선 LOT을 FIFO로 `히트 용량 ÷ 제강 수율`만큼, 합금철 LOT을 `히트 톤 × kg/t ÷ 1000`만큼 차감 → 히트 LOT `HT-전로-YYMMDD-NNN`(성분 검사 대기). 계보 `HOT_METAL_TO_HEAT`·`ALLOY_TO_HEAT`(DIRECT, input_ton). 품질 역할에 알림 |
| 연주 | 슬래브 LOT `히트번호-SS`를 매별로 생성(검사 대기), 계보 `HEAT_TO_SLAB`, 히트는 CONSUMED. 히트가 미판정이어도 진행할 수 있다. 품질 역할에 알림 |
| 열연 | 배정을 투입(배정 CONSUMED, 슬래브 CONSUMED) → 슬래브 1매당 코일 LOT `C + 슬래브번호(HT- 제외)`(검사 대기), 계보 `SLAB_TO_COIL`. 목표 매수에 못 미치면 남은 매수의 열연 READY 행이 이어서 생긴다. 품질 역할에 알림 |

오류
- 원료·합금철 부족: `COM-005`(409) `원료가 부족해 제선 실적을 등록할 수 없습니다: 철광석 12.345t 부족(필요 421.053t, 잔량 408.708t), … ` — 아무것도 바뀌지 않는다.
- 용선 부족(제강): `COM-005` `용선이 263.158t 부족합니다 (필요 …, 잔량 …). 제선 실적을 먼저 등록해 주세요`
- 필수값 누락·연주 매수 초과·열연 필요 매수 초과·다른 계획의 배정: `COM-003`
- 열연인데 CONFIRMED 배정 없음: `COM-005` `배정 확정된 슬래브가 없습니다…`. 미합격 슬래브 `INV-002`, 이미 투입된 LOT `INV-004` (StockService).

### 계획 상태

`PLANNED` →(confirm) `CONFIRMED` →(첫 start) `IN_PROGRESS` → `COMPLETED`. 시작 전 `CANCELLED`.
`COMPLETED`는 실적 완료나 검사 등록 뒤에 서버가 판단한다 — 아래를 모두 만족할 때:
1. 제선·제강·연주 실적이 전부 COMPLETED
2. 이 계획이 만든 히트·슬래브·코일 LOT이 모두 판정됨 (불합격 히트의 하위 LOT은 판정된 것으로 본다)
3. 코일 계획이면 열연이 끝남: 작업 중인 열연 실적과 CONFIRMED 열연 배정이 없고, (압연한 코일 수 ≥ shortageQty) 또는 (귀속된 적격 슬래브가 더 없음)

완료될 때 한 번도 시작하지 않은 열연 READY 행은 지운다 (합격 슬래브가 모자라 목표만큼 압연하지 못한 경우). 부족분은 재생산으로 채운다.

## POST /production-plans/:id/simulate-results — 실적 시뮬레이션 (REQ-PRD-007)

```ts
interface SimulateBody {
  seed?: number;               // 0 ~ 2147483647 정수. 같은 시드 → 같은 손실률. 비우면 서버가 정해 응답에 돌려준다
  includeInspection?: boolean; // 기본 true: 검사도 기준 안쪽 값으로 자동 등록
  untilProcess?: ProcessCode;  // 이 공정(과 그 검사)까지만. 비우면 끝까지
}

interface SimulateResult {
  productionPlanId: number;
  seed: number;
  sampledLossRate: string | null; // "0.0005". 이번 실행에서 연주를 하지 않았으면 null
  includeInspection: boolean;
  untilProcess: ProcessCode | null;
  steps: {
    kind: 'RESULT' | 'INSPECTION' | 'ALLOCATION'; // 공정 실적 / 검사 자동 등록 / 열연 투입 슬래브 FIFO 배정
    processCode: ProcessCode;
    heatSeq: number | null;
    productionResultId: number | null; // RESULT만
    lotNos: string[];            // RESULT: 만든 LOT / INSPECTION: 검사한 LOT / ALLOCATION: 배정한 슬래브
    plannedQty: number | null;   // 연주·열연 RESULT의 계획 매수, ALLOCATION의 필요 매수
    outputQty: number | null;    // 연주·열연 RESULT의 산출, INSPECTION의 검사 건수, ALLOCATION의 배정 매수
    lossQty: number | null;      // 연주 RESULT만 의미 있음
  }[];
  notes: string[];               // 건너뛴 일과 이유 (예: "열연에 투입할 합격 슬래브가 없어 배정하지 않았습니다 …")
  plan: PlanDetail;              // 실행 뒤 계획 상세
}
```

- `CONFIRMED`·`IN_PROGRESS` 계획만. 편성 전이면 `COM-005` "히트 편성을 먼저 확정해 주세요".
- 남은 공정을 순서대로 끝낸다: 제선 → 제강(→ 성분 검사) → 연주(→ 슬래브 검사) → (코일) 필요한 슬래브만 FIFO 배정 → 열연(→ 코일 검사). 이미 끝난 공정은 건너뛴다 (다시 실행하면 이어서 진행).
- 주체는 SYSTEM: 실적 `isSimulated: true`, `operatorEmployeeId: null`, 작업 로그 `actor_type = SYSTEM`·`reason_code = SIMULATION`. 고로·전로 번호는 `"1"`.
- 연주 손실: 손실률을 0~5%에서 한 번 뽑고(시드로 재현) **손실 매수 = floor(남은 연주 계획 매수 합계 × 손실률)** 을 뒤 히트부터 1매씩 나눈다. 각 연주 실적에 `sampledLossRate`와 `lossQty`가 남는다. 열연은 추가 손실 없음.
- 검사는 품질 API와 같은 코드로 등록돼 자동 판정·재고 반영·자동 예약·귀속이 그대로 일어난다. `includeInspection: false`이면 검사 대기로 남고, 코일 계획은 합격 슬래브가 없어 열연을 하지 않는다(`notes`).
- 시각은 남은 작업 시간만큼 과거에서 시작해 현재 쪽으로 채운다 (제선 6시간, 제강 50분, 연주 90분 …). 미래 시각은 만들지 않는다. 작업 로그의 발생 시각은 실행 시각이다.
- **원료 부족**: 남은 제선·제강에 필요한 원료를 먼저 한꺼번에 확인하고, 모자라면 아무것도 바꾸지 않고 `COM-005`(HTTP 409):
  `원료가 부족해 실적 시뮬레이션을 시작하지 않았습니다: 철광석 8842.103t 부족(필요 9684.211t, 잔량 842.108t), 합금철 FeMn 67.500t 부족(필요 69.000t, 잔량 1.500t). 구매요청으로 원료를 확보한 뒤 다시 진행해 주세요`
  부족 내역을 표로 보여 주려면 `heat-preview`의 `rawMaterials`를 쓴다.

## 알림 (linkPath)

- 히트·슬래브·코일 검사 대기 → 품질 역할, `/quality/inspections?lot=:lotId`
- 계획 완료 → 수주 담당, `/sales-orders/:id`

## 실시간 주제

`production-plans`, `production-results`, `lots`, `inventories`, `sales-orders`, `quality-inspections`, `business-events`
