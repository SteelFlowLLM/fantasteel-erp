# LOT API (`modules/lot`)

REQ-LOT-001~005, BP-LOT-01. 기준 URL `/api/v1`, 모든 응답은 `{ success: true, data }` / `{ success: false, error: { code, message } }`.
**로그인한 사원은 모두 조회할 수 있다** (권한 데코레이터 없음). 토큰 없으면 `401 AUTH-002`.

응답 값 규칙 (전역 인터셉터): Decimal은 문자열(이름이 `…Ton`이면 소수 3자리), Date는 ISO 8601 문자열이다.
`@db.Date` 컬럼(`dueDate`)도 `"2026-10-05T00:00:00.000Z"` 처럼 오며 날짜는 앞 10자리(`YYYY-MM-DD`)를 쓴다.

| 메서드·경로 | 설명 |
|---|---|
| `GET /lots` | LOT 목록 |
| `GET /lots/search?q=` | 번호 일부로 빠르게 찾기 (자동완성) |
| `GET /lots/by-no/:lotNo` | LOT 번호로 상세 |
| `GET /lots/:id` | id로 상세 |
| `GET /lots/:id/trace?direction=backward\|forward` | 역추적·정추적 |

> 통합 연동 주의: `GET /lots/:id` 는 정수 id만 받는다. 품질 모듈의 `GET /lots/rejected` 같은 문자열 경로는 이 라우트보다 먼저 등록돼야 한다 (이 문서 맨 아래 "통합 시 주의").

---

## 공통 타입

```ts
type LotType = 'RAW_MATERIAL' | 'HOT_METAL' | 'HEAT' | 'SLAB' | 'COIL';       // 라벨: 원료 · 용선 · 히트 · 슬래브 · 코일
type LotStatus = 'IN_STOCK' | 'CONSUMED' | 'SHIPPED';                          // 라벨: 재고 · 투입·소진 · 출고
type InspectionResult = 'PENDING' | 'PASS' | 'FAIL';                           // 라벨: 검사 대기 · 합격 · 불합격
type LotRelationType = 'RAW_TO_HOT_METAL' | 'HOT_METAL_TO_HEAT' | 'ALLOY_TO_HEAT' | 'HEAT_TO_SLAB' | 'SLAB_TO_COIL';
type LotEvidenceType = 'PERIOD' | 'DIRECT';                                    // 라벨: 기간 기반 · 직접 투입

interface LotInspectionSummary {           // 그 LOT의 가장 최근 검사 1건
  qualityInspectionId: number;
  qualityInspectionNo: string;
  processCode: string;                     // STEELMAKING(히트 성분) | CASTING(슬래브) | HOT_ROLLING(코일)
  result: InspectionResult;
  resultLabel: string;
  inspectedAt: string | null;
  itemCount: number;                       // 측정 항목 수
  failedItemCount: number;
}

interface LotSalesOrderItemView {
  salesOrderItemId: number;
  salesOrderId: number;
  salesOrderNo: string;
  lineNo: number;
  customerId: number;
  customerName: string;
  dueDate: string;
}
```

## `GET /lots` — 목록

쿼리 (모두 선택): `lotType`, `lotStatus`, `productSpecId`, `steelGradeId`, `q`(LOT 번호 일부, 대소문자 무시), `limit`(1~200, 기본 50).
정렬: 생산완료일(`producedAt`) 내림차순 → id 내림차순.

```ts
interface LotListResponse {
  items: LotView[];
  total: number;      // 필터에 맞는 전체 건수 (limit 무관)
  limit: number;
}

interface LotView {
  id: number;
  lotNo: string;
  lotType: LotType;
  lotTypeLabel: string;
  lotStatus: LotStatus;
  lotStatusLabel: string;
  title: string;                               // 화면 한 줄 표시용. 예: "SS275 · CL-SS275-4.5x1200x542000", "철광석 (IO)", "히트 · 1전로 · SS275", "용선 · 1고로"
  rawMaterial: { id: number; materialCode: string; materialName: string; rawMaterialType: string; rawMaterialTypeLabel: string } | null;   // 원료 LOT만
  productSpec: { id: number; specCode: string; thicknessMm: string; widthMm: string; lengthMm: string; theoreticalWeightTon: string } | null; // 슬래브·코일만
  steelGrade: { id: number; steelGradeCode: string; steelGradeName: string } | null;                 // 히트·슬래브·코일
  heat: { id: number; lotNo: string; isPassed: boolean | null } | null;   // 슬래브·코일의 상위 히트 (lot.heat_lot_id)
  yard: { id: number; yardCode: string; yardName: string } | null;
  supplier: { id: number; supplierName: string } | null;                  // 원료 LOT
  blastFurnaceNo: string | null;               // 용선
  converterNo: string | null;                  // 히트
  weightTon: string | null;                    // 슬래브·코일: 1매(개) 이론중량 계산값(소수 3자리). 그 밖은 null
  initialTon: string | null;                   // 원료·용선·히트 (소수 3자리)
  remainingTon: string | null;                 // 원료·용선 (소수 3자리)
  isPassed: boolean | null;                    // null = 검사 전
  inspectionResult: InspectionResult | null;   // 히트·슬래브·코일만 값이 있음(원료·용선은 null). isPassed null → 'PENDING'
  inspectionResultLabel: string | null;
  inspection: LotInspectionSummary | null;     // 검사 기록이 없으면 null
  disposition: { status: string; statusLabel: string; reason: string | null; at: string | null } | null; // 불합격 처리 상태 (HOLD 보류 · DOWNGRADED 격하 · SCRAPPED 폐기)
  allocation: {                                // 현재 배정 = status CONFIRMED 1건. 없으면 null
    allocationId: number; purpose: string; purposeLabel: string; status: string; confirmedAt: string;
    salesOrderItemId: number | null; salesOrderNo: string | null; lineNo: number | null;
    productionPlanId: number | null; productionPlanNo: string | null;
    shipmentRequestId: number | null; shipmentRequestNo: string | null;
  } | null;
  salesOrderItem: LotSalesOrderItemView | null;     // 이 LOT을 생산한 원래 수주 품목 (lot.sales_order_item_id)
  isEligible: boolean | null;                  // 슬래브·코일만: 자기 검사 합격 + 상위 히트 합격 + IN_STOCK (예약·배정 후보). 그 밖은 null
  isSurplus: boolean | null;                   // 슬래브만: isEligible + 수주 미귀속 + CONFIRMED 배정 없음 (여재). 그 밖은 null
  producedAt: string;
  consumedAt: string | null;
}
```

실제 응답 (일부, `GET /lots?lotType=COIL&limit=2` 의 첫 항목):

```json
{
  "id": 55, "lotNo": "C1-260923-001-09", "lotType": "COIL", "lotTypeLabel": "코일",
  "lotStatus": "IN_STOCK", "lotStatusLabel": "재고", "title": "SPHC · CL-SPHC-3.2x1000x632000",
  "rawMaterial": null,
  "productSpec": { "id": 18, "specCode": "CL-SPHC-3.2x1000x632000", "thicknessMm": "3.2", "widthMm": "1000", "lengthMm": "632000", "theoreticalWeightTon": "15.876" },
  "steelGrade": { "id": 3, "steelGradeCode": "SPHC", "steelGradeName": "열간 압연 연강판" },
  "heat": { "id": 37, "lotNo": "HT-1-260923-001", "isPassed": true },
  "yard": { "id": 3, "yardCode": "CY-01", "yardName": "코일 야드" }, "supplier": null,
  "blastFurnaceNo": null, "converterNo": null, "weightTon": "15.876", "initialTon": null, "remainingTon": null,
  "isPassed": true, "inspectionResult": "PASS", "inspectionResultLabel": "합격",
  "inspection": { "qualityInspectionId": 47, "qualityInspectionNo": "QI-20260924-0047", "processCode": "HOT_ROLLING", "result": "PASS", "resultLabel": "합격", "inspectedAt": "2026-09-24T05:09:00.000Z", "itemCount": 4, "failedItemCount": 0 },
  "disposition": null, "allocation": null, "salesOrderItem": null,
  "isEligible": true, "isSurplus": null,
  "producedAt": "2026-09-24T04:09:00.000Z", "consumedAt": null
}
```

## `GET /lots/:id`, `GET /lots/by-no/:lotNo` — 상세

`LotView` 전체 + 아래 필드. 없으면 `404 COM-004`, id가 숫자가 아니면 `400 COM-003`.

```ts
interface LotDetail extends LotView {
  inspections: {                                // 그 LOT의 모든 검사, 최신순
    qualityInspectionId: number; qualityInspectionNo: string; processCode: string;
    result: InspectionResult; resultLabel: string;
    inspectorName: string | null; inspectedAt: string | null; memo: string | null;
    values: { inspectionItemCode: string; inspectionItemName: string; unit: string | null;
              minValue: string | null; maxValue: string | null; measuredValue: string | null; isPassed: boolean | null }[];
  }[];
  parents: LotLink[];                           // 바로 위 LOT (lot_relation의 부모)
  children: LotLink[];                          // 바로 아래 LOT
}
interface LotLink {
  lotId: number; lotNo: string; lotType: LotType;
  relationType: LotRelationType; evidenceType: LotEvidenceType;
  inputTon: string | null; periodStart: string | null; periodEnd: string | null;
}
```

실제 응답 (`GET /lots/9`, 코일; 측정 항목 일부 생략):

```json
{
  "id": 9, "lotNo": "C1-260921-001-01", "lotType": "COIL", "title": "SS275 · CL-SS275-4.5x1200x542000",
  "productSpec": { "id": 2, "specCode": "CL-SS275-4.5x1200x542000", "thicknessMm": "4.5", "widthMm": "1200", "lengthMm": "542000", "theoreticalWeightTon": "22.975" },
  "heat": { "id": 7, "lotNo": "HT-1-260921-001", "isPassed": true },
  "weightTon": "22.975", "isPassed": true, "inspectionResult": "PASS",
  "inspection": { "qualityInspectionId": 3, "qualityInspectionNo": "QI-20260922-0003", "processCode": "HOT_ROLLING", "result": "PASS", "resultLabel": "합격", "inspectedAt": "2026-09-22T05:01:00.000Z", "itemCount": 5, "failedItemCount": 0 },
  "disposition": null, "allocation": null, "salesOrderItem": null, "isEligible": true, "isSurplus": null,
  "inspections": [ { "qualityInspectionId": 3, "qualityInspectionNo": "QI-20260922-0003", "processCode": "HOT_ROLLING", "result": "PASS", "resultLabel": "합격", "inspectorName": null, "inspectedAt": "2026-09-22T05:01:00.000Z", "memo": null,
      "values": [ { "inspectionItemCode": "TENSILE_STRENGTH", "inspectionItemName": "인장강도", "unit": "MPa", "minValue": "410", "maxValue": "550", "measuredValue": "480", "isPassed": true } ] } ],
  "parents": [ { "lotId": 8, "lotNo": "HT-1-260921-001-01", "lotType": "SLAB", "relationType": "SLAB_TO_COIL", "evidenceType": "DIRECT", "inputTon": null, "periodStart": null, "periodEnd": null } ],
  "children": []
}
```

(위에서 `…` 없이 보인 필드 외의 `LotView` 나머지 필드도 모두 함께 온다.)

원료 LOT 예 (`GET /lots/by-no/RM-IO-260918-001`): `title: "철광석 (IO)"`, `weightTon: null`, `initialTon: "900.000"`, `remainingTon: "900.000"`, `supplier: { id: 1, supplierName: "호주광업상사" }`, `inspectionResult: null`, `isEligible: null`, `children` 3건.

불합격 LOT 예: `isPassed: false`, `inspectionResult: "FAIL"`, `disposition: { "status": "HOLD", "statusLabel": "보류", "reason": "표면 결함 재검토 대기", "at": "…" }`, `isEligible: false`.

## `GET /lots/search?q=` — 번호 일부 검색

쿼리: `q`(비면 빈 배열), `limit`(1~50, 기본 20). 정확히 일치하는 번호를 앞에, 그다음 최근 생산순.

```ts
type LotSearchResponse = { id: number; lotNo: string; lotType: LotType; lotTypeLabel: string; lotStatus: LotStatus; lotStatusLabel: string }[];
```
```json
[ { "id": 402, "lotNo": "CTSTDOC-HT-01", "lotType": "COIL", "lotTypeLabel": "코일", "lotStatus": "SHIPPED", "lotStatusLabel": "출고" },
  { "id": 401, "lotNo": "TSTDOC-HT-02", "lotType": "SLAB", "lotTypeLabel": "슬래브", "lotStatus": "SHIPPED", "lotStatusLabel": "출고" } ]
```

---

## `GET /lots/:id/trace?direction=backward|forward` — 정·역추적

`direction` 생략 시 `backward`. 다른 값은 `400 COM-003`, LOT이 없으면 `404 COM-004`.

- **역추적(backward)**: 그 LOT의 부모 방향으로만 따라간다. 코일 → 슬래브 → 히트 → 용선 → 원료, 히트에 직접 투입된 합금철 포함. 슬래브에서 시작하면 코일 단계 없이 슬래브 → 히트 …
- **정추적(forward)**: 자식 방향으로만 따라간다. 원료·히트 → 용선·히트·슬래브·코일 → 출하(출고번호·밀시트·고객사). 슬래브가 코일 단계 없이 출하됐으면 슬래브 노드에 바로 `shipment`가 붙는다.
- `lot_relation`의 내부 id로만 따라가며 LOT 번호를 해석하지 않는다. 이미 방문한 LOT은 다시 펼치지 않으므로 **순환 연결이 있어도 끝난다** (`summary.hasCycle = true`). 한 번에 최대 2000개 LOT까지 (`summary.truncated`).
- N:M(용선 ↔ 히트), 1:N(히트 → 슬래브), 1:1(슬래브 → 코일)은 그대로 `edges` 로 표현된다. 같은 LOT이 여러 부모/자식을 가질 수 있다.
- **원료 → 용선은 `evidenceType: 'PERIOD'`** (기간 기반)이며 `periodStart`~`periodEnd`가 있다. 실제 투입량이 아니므로 UI는 "기간 내 사용 가능성"으로 표시해야 한다 (`isPeriodBased: true`). 용선 → 히트, 합금철 → 히트는 `DIRECT` + `inputTon`.

```ts
interface LotTraceResponse {
  direction: 'backward' | 'forward';
  rootId: number;                        // 시작 LOT id
  nodes: LotTraceNode[];                 // depth 오름차순 → 생산 시각 → id
  edges: LotTraceEdge[];
  levels: { lotType: LotType; label: string; nodeIds: number[] }[];   // 공정 순서(원료→용선→히트→슬래브→코일)로 묶은 열. 존재하는 유형만
  summary: {
    nodeCount: number; edgeCount: number;
    countByType: Partial<Record<LotType, number>>;
    hasPeriodEvidence: boolean;          // 기간 기반 연결이 하나라도 있는지
    hasCycle: boolean;
    truncated: boolean;
  };
  impact: LotTraceImpact | null;         // forward에서만, backward는 null
}

interface LotTraceNode {
  id: number; lotNo: string;
  lotType: LotType; lotTypeLabel: string; lotStatus: LotStatus; lotStatusLabel: string;
  isRoot: boolean;                       // 시작 LOT
  depth: number;                         // 시작 LOT에서의 거리
  title: string;                         // LotView.title 과 같은 규칙
  steelGradeCode: string | null; productSpecCode: string | null;
  rawMaterialCode: string | null; rawMaterialName: string | null;
  rawMaterialType: 'IRON_ORE' | 'COAL' | 'LIMESTONE' | 'FERROALLOY' | null;   // 원료 LOT만. FERROALLOY = 합금철
  blastFurnaceNo: string | null; converterNo: string | null; heatLotNo: string | null;
  initialTon: string | null; remainingTon: string | null;   // 소수 3자리
  weightTon: string | null;              // 슬래브·코일 이론중량
  producedAt: string;
  isPassed: boolean | null;
  inspectionResult: InspectionResult | null; inspectionResultLabel: string | null;
  inspection: LotInspectionSummary | null;
  salesOrderLinks: (LotSalesOrderItemView & { linkType: 'PRODUCED_FOR' | 'ALLOCATED' | 'SHIPPED' })[];
       // PRODUCED_FOR: 생산한 원래 수주 품목 / ALLOCATED: CONFIRMED·CONSUMED 배정된 수주 품목 / SHIPPED: 출고된 수주 품목. 없으면 []
  shipment: {                            // 출고된 LOT(슬래브·코일)만. 없으면 null
    goodsIssueId: number; goodsIssueNo: string; issuedAt: string | null;
    shipmentRequestId: number; shipmentRequestNo: string;
    customerId: number; customerCode: string; customerName: string;
    salesOrderId: number; salesOrderNo: string; salesOrderItemId: number; lineNo: number;
    millSheetIds: number[]; millSheetNos: string[];      // 그 출고·수주에 발행된 밀시트
  } | null;
}

interface LotTraceEdge {
  id: number;
  parentId: number; childId: number;     // nodes[].id
  relationType: LotRelationType;
  evidenceType: LotEvidenceType; evidenceLabel: string;   // "기간 기반" | "직접 투입"
  isPeriodBased: boolean;                // evidenceType === 'PERIOD'
  inputTon: string | null;               // 소수 3자리
  periodStart: string | null; periodEnd: string | null;
}

interface LotTraceImpact {               // forward: 영향받은 출하·수주
  shippedProductLotCount: number;        // 영향받은 슬래브·코일 중 출고된 수
  unshippedProductLotCount: number;
  shipments: { goodsIssueId: number; goodsIssueNo: string; issuedAt: string | null; shipmentRequestNo: string;
               customerId: number; customerName: string; salesOrderId: number; salesOrderNo: string;
               millSheetNos: string[]; lotIds: number[]; lotNos: string[] }[];
  salesOrders: { salesOrderId: number; salesOrderNo: string; customerName: string; dueDate: string; lotCount: number; hasShipped: boolean }[];
}
```

### 실제 응답 1 — 역추적 (시드 코일 `GET /lots/9/trace?direction=backward`)

노드 9개(코일 1 · 슬래브 1 · 히트 1 · 용선 1 · 원료 5). 노드는 대표 3개만 싣는다 (히트·원료·루트).

```json
{
  "direction": "backward",
  "rootId": 9,
  "levels": [
    { "lotType": "RAW_MATERIAL", "label": "원료", "nodeIds": [4, 5, 1, 2, 3] },
    { "lotType": "HOT_METAL", "label": "용선", "nodeIds": [6] },
    { "lotType": "HEAT", "label": "히트", "nodeIds": [7] },
    { "lotType": "SLAB", "label": "슬래브", "nodeIds": [8] },
    { "lotType": "COIL", "label": "코일", "nodeIds": [9] }
  ],
  "summary": { "nodeCount": 9, "edgeCount": 8, "countByType": { "COIL": 1, "SLAB": 1, "HEAT": 1, "RAW_MATERIAL": 5, "HOT_METAL": 1 }, "hasPeriodEvidence": true, "hasCycle": false, "truncated": false },
  "impact": null,
  "nodes": [
    { "id": 9, "lotNo": "C1-260921-001-01", "lotType": "COIL", "lotTypeLabel": "코일", "lotStatus": "IN_STOCK", "lotStatusLabel": "재고", "isRoot": true, "depth": 0,
      "title": "SS275 · CL-SS275-4.5x1200x542000", "steelGradeCode": "SS275", "productSpecCode": "CL-SS275-4.5x1200x542000",
      "rawMaterialCode": null, "rawMaterialName": null, "rawMaterialType": null, "blastFurnaceNo": null, "converterNo": null, "heatLotNo": "HT-1-260921-001",
      "initialTon": null, "remainingTon": null, "weightTon": "22.975", "producedAt": "2026-09-22T04:01:00.000Z",
      "isPassed": true, "inspectionResult": "PASS", "inspectionResultLabel": "합격",
      "inspection": { "qualityInspectionId": 3, "qualityInspectionNo": "QI-20260922-0003", "processCode": "HOT_ROLLING", "result": "PASS", "resultLabel": "합격", "inspectedAt": "2026-09-22T05:01:00.000Z", "itemCount": 5, "failedItemCount": 0 },
      "salesOrderLinks": [], "shipment": null },
    { "id": 7, "lotNo": "HT-1-260921-001", "lotType": "HEAT", "lotTypeLabel": "히트", "lotStatus": "CONSUMED", "lotStatusLabel": "투입·소진", "isRoot": false, "depth": 2,
      "title": "히트 · 1전로 · SS275", "steelGradeCode": "SS275", "productSpecCode": null, "converterNo": "1", "initialTon": "250.000", "remainingTon": null, "weightTon": null,
      "isPassed": true, "inspectionResult": "PASS", "inspection": { "qualityInspectionNo": "QI-20260921-0001", "processCode": "STEELMAKING", "result": "PASS", "itemCount": 5, "failedItemCount": 0 },
      "salesOrderLinks": [], "shipment": null },
    { "id": 1, "lotNo": "RM-IO-260918-001", "lotType": "RAW_MATERIAL", "lotTypeLabel": "원료", "lotStatus": "IN_STOCK", "lotStatusLabel": "재고", "isRoot": false, "depth": 4,
      "title": "철광석 (IO)", "rawMaterialCode": "IO", "rawMaterialName": "철광석", "rawMaterialType": "IRON_ORE", "initialTon": "900.000", "remainingTon": "900.000", "weightTon": null,
      "isPassed": null, "inspectionResult": null, "inspectionResultLabel": null, "inspection": null, "salesOrderLinks": [], "shipment": null }
  ],
  "edges": [
    { "id": 8, "parentId": 8, "childId": 9, "relationType": "SLAB_TO_COIL", "evidenceType": "DIRECT", "evidenceLabel": "직접 투입", "isPeriodBased": false, "inputTon": null, "periodStart": null, "periodEnd": null },
    { "id": 7, "parentId": 7, "childId": 8, "relationType": "HEAT_TO_SLAB", "evidenceType": "DIRECT", "evidenceLabel": "직접 투입", "isPeriodBased": false, "inputTon": null, "periodStart": null, "periodEnd": null },
    { "id": 4, "parentId": 6, "childId": 7, "relationType": "HOT_METAL_TO_HEAT", "evidenceType": "DIRECT", "evidenceLabel": "직접 투입", "isPeriodBased": false, "inputTon": "263.158", "periodStart": null, "periodEnd": null },
    { "id": 5, "parentId": 4, "childId": 7, "relationType": "ALLOY_TO_HEAT", "evidenceType": "DIRECT", "evidenceLabel": "직접 투입", "isPeriodBased": false, "inputTon": null, "periodStart": null, "periodEnd": null },
    { "id": 6, "parentId": 5, "childId": 7, "relationType": "ALLOY_TO_HEAT", "evidenceType": "DIRECT", "evidenceLabel": "직접 투입", "isPeriodBased": false, "inputTon": null, "periodStart": null, "periodEnd": null },
    { "id": 1, "parentId": 1, "childId": 6, "relationType": "RAW_TO_HOT_METAL", "evidenceType": "PERIOD", "evidenceLabel": "기간 기반", "isPeriodBased": true, "inputTon": null, "periodStart": "2026-09-20T10:00:00.000Z", "periodEnd": "2026-09-20T18:00:00.000Z" },
    { "id": 2, "parentId": 2, "childId": 6, "relationType": "RAW_TO_HOT_METAL", "evidenceType": "PERIOD", "evidenceLabel": "기간 기반", "isPeriodBased": true, "inputTon": null, "periodStart": "2026-09-20T10:00:00.000Z", "periodEnd": "2026-09-20T18:00:00.000Z" },
    { "id": 3, "parentId": 3, "childId": 6, "relationType": "RAW_TO_HOT_METAL", "evidenceType": "PERIOD", "evidenceLabel": "기간 기반", "isPeriodBased": true, "inputTon": null, "periodStart": "2026-09-20T10:00:00.000Z", "periodEnd": "2026-09-20T18:00:00.000Z" }
  ]
}
```

원료 LOT id 4·5는 합금철(`rawMaterialType: "FERROALLOY"`, FeMn·FeSi)로 히트에 직접 연결(`ALLOY_TO_HEAT`)되고, id 1·2·3(철광석·석탄·석회석)은 용선에 기간 기반으로 연결된다.

### 실제 응답 2 — 정추적 + 출하 (시험 데이터 `GET /lots/397/trace?direction=forward`)

원료 LOT(397) → 용선 → 히트 → 슬래브 2매(하나는 코일 1개로 압연, 다른 하나는 슬래브로 바로 출하) → 출고 `GI-TSTDOC`. 슬래브 401은 **코일 단계 없이 슬래브로 출하**, 코일 402는 코일로 출하.
(시험용 번호라 `TSTDOC-…` 형식이다. 아래 `nodes`는 코일 노드 1개만 싣고 나머지 5개는 생략했다 — 같은 모양이며, 슬래브 401은 `shipment.lineNo = 1`, 슬래브 400·히트·용선·원료는 `shipment: null`, `salesOrderLinks: []`.)

```json
{
  "direction": "forward",
  "rootId": 397,
  "levels": [
    { "lotType": "RAW_MATERIAL", "label": "원료", "nodeIds": [397] },
    { "lotType": "HOT_METAL", "label": "용선", "nodeIds": [398] },
    { "lotType": "HEAT", "label": "히트", "nodeIds": [399] },
    { "lotType": "SLAB", "label": "슬래브", "nodeIds": [400, 401] },
    { "lotType": "COIL", "label": "코일", "nodeIds": [402] }
  ],
  "summary": { "nodeCount": 6, "edgeCount": 5, "countByType": { "RAW_MATERIAL": 1, "HOT_METAL": 1, "HEAT": 1, "SLAB": 2, "COIL": 1 }, "hasPeriodEvidence": true, "hasCycle": false, "truncated": false },
  "nodes": [
    { "id": 402, "lotNo": "CTSTDOC-HT-01", "lotType": "COIL", "lotTypeLabel": "코일", "lotStatus": "SHIPPED", "lotStatusLabel": "출고", "isRoot": false, "depth": 4,
      "title": "SS275 · CL-SS275-4.5x1200x542000", "steelGradeCode": "SS275", "productSpecCode": "CL-SS275-4.5x1200x542000",
      "rawMaterialCode": null, "rawMaterialName": null, "rawMaterialType": null, "blastFurnaceNo": null, "converterNo": null, "heatLotNo": "TSTDOC-HT",
      "initialTon": null, "remainingTon": null, "weightTon": "22.975", "producedAt": "2026-09-30T11:23:43.943Z",
      "isPassed": null, "inspectionResult": "PENDING", "inspectionResultLabel": "검사 대기", "inspection": null,
      "salesOrderLinks": [ { "linkType": "SHIPPED", "salesOrderItemId": 78, "salesOrderId": 71, "salesOrderNo": "SO-TSTDOC", "lineNo": 2, "customerId": 1, "customerName": "한빛중공업", "dueDate": "2026-10-05T00:00:00.000Z" } ],
      "shipment": { "goodsIssueId": 18, "goodsIssueNo": "GI-TSTDOC", "issuedAt": "2026-09-30T11:23:43.968Z", "shipmentRequestId": 18, "shipmentRequestNo": "SHP-TSTDOC",
                    "customerId": 1, "customerCode": "CUS-01", "customerName": "한빛중공업", "salesOrderId": 71, "salesOrderNo": "SO-TSTDOC", "salesOrderItemId": 78, "lineNo": 2,
                    "millSheetIds": [18], "millSheetNos": ["MS-TSTDOC"] } }
  ],
  "edges": [
    { "id": 298, "parentId": 397, "childId": 398, "relationType": "RAW_TO_HOT_METAL", "evidenceType": "PERIOD", "evidenceLabel": "기간 기반", "isPeriodBased": true, "inputTon": null, "periodStart": "2026-09-30T03:23:43.943Z", "periodEnd": "2026-09-30T11:23:43.943Z" },
    { "id": 299, "parentId": 398, "childId": 399, "relationType": "HOT_METAL_TO_HEAT", "evidenceType": "DIRECT", "evidenceLabel": "직접 투입", "isPeriodBased": false, "inputTon": "10.000", "periodStart": null, "periodEnd": null },
    { "id": 300, "parentId": 399, "childId": 400, "relationType": "HEAT_TO_SLAB", "evidenceType": "DIRECT", "evidenceLabel": "직접 투입", "isPeriodBased": false, "inputTon": null, "periodStart": null, "periodEnd": null },
    { "id": 301, "parentId": 399, "childId": 401, "relationType": "HEAT_TO_SLAB", "evidenceType": "DIRECT", "evidenceLabel": "직접 투입", "isPeriodBased": false, "inputTon": null, "periodStart": null, "periodEnd": null },
    { "id": 302, "parentId": 400, "childId": 402, "relationType": "SLAB_TO_COIL", "evidenceType": "DIRECT", "evidenceLabel": "직접 투입", "isPeriodBased": false, "inputTon": null, "periodStart": null, "periodEnd": null }
  ],
  "impact": {
    "shippedProductLotCount": 2,
    "unshippedProductLotCount": 1,
    "shipments": [
      { "goodsIssueId": 18, "goodsIssueNo": "GI-TSTDOC", "issuedAt": "2026-09-30T11:23:43.968Z", "shipmentRequestNo": "SHP-TSTDOC", "customerId": 1, "customerName": "한빛중공업",
        "salesOrderId": 71, "salesOrderNo": "SO-TSTDOC", "millSheetNos": ["MS-TSTDOC"], "lotIds": [401, 402], "lotNos": ["TSTDOC-HT-02", "CTSTDOC-HT-01"] }
    ],
    "salesOrders": [ { "salesOrderId": 71, "salesOrderNo": "SO-TSTDOC", "customerName": "한빛중공업", "dueDate": "2026-10-05T00:00:00.000Z", "lotCount": 2, "hasShipped": true } ]
  }
}
```

화면 배치 힌트: `levels` 의 열을 왼쪽→오른쪽(정추적) 또는 오른쪽→왼쪽(역추적)으로 놓고 `edges` 의 `parentId → childId` 로 선을 긋는다. `isPeriodBased` 엣지는 점선 + "기간 기반 (yyyy-MM-dd HH:mm ~ HH:mm)" 로 표시한다.

### 오류

| 상황 | 응답 |
|---|---|
| 없는 LOT | `404 COM-004` `LOT을(를) 찾을 수 없습니다` |
| id가 숫자가 아님 | `400 COM-003` `ID는 숫자여야 합니다` |
| `direction`·`lotType` 등 값 오류 | `400 COM-003` (예: `direction은 backward 또는 forward여야 합니다`) |
| 토큰 없음 | `401 AUTH-002` |

---

## 통합 시 주의

- **`GET /lots/rejected` (품질 모듈) 경로 충돌 — `app.module.ts` 한 줄 변경이 필요하다.** Express 5는 경로 파라미터에 정규식(`:id(\d+)`)을 쓸 수 없어서, `GET /lots/:id` 가 `/lots/rejected` 도 먼저 받으면 `400 COM-003 ID는 숫자여야 합니다` 를 돌려준다. Nest는 모듈 import 순서대로 라우트를 등록하므로 `app.module.ts` imports에서 **`LotModule`을 `QualityModule` 뒤로** 옮겨야 한다 (지금은 앞이라 충돌한다). 임시 스텁 컨트롤러(`GET /lots/rejected`)로 두 순서를 모두 실행해 확인했다: LotModule이 먼저면 400, 스텁 모듈이 먼저면 정상 응답.
  (`business-event`는 컨트롤러 없는 `LotGraphModule`만 import 하므로 이 순서에 영향을 주지 않는다.)
- 작업 로그의 "상·하위 LOT 포함" 조회(`GET /business-events?lotId=&includeLineage=true`)는 `LotGraphModule`의 `LotGraphService`를 쓴다.
