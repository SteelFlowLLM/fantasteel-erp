# master-data API

기준정보 (REQ-MST-001~009, REQ-QC-002, BP-MST-01). 품목·원료, 강종·성분 규격, 제품 규격, 슬래브↔코일 규격 매핑, 라우팅, 배합 원단위, 고객사·공급업체·야드, 생산 설정값, 검사 항목, 그리고 화면 선택 목록(lookups)과 준비 상태 점검(validation).

- 기본 경로 `/api/v1`, 모든 API는 `Authorization: Bearer <accessToken>` 필요.
- 응답은 `{ success: true, data }` / `{ success: false, error: { code, message } }`. 아래 타입은 `data`의 모양이다. 날짜는 ISO 8601 문자열.
- **Decimal은 문자열로 온다.** 이름이 `…Ton`이면 소수 3자리(`"23.550"`), 그 밖은 후행 0을 뺀 값(`"1200"`, `"4.5"`, `"0.25"`). 계산 수율(`hotRollingPlannedYieldRate`)만 항상 소수 4자리(`"0.9756"`).
- **숫자 요청값**은 JSON 숫자로 보내는 것이 원칙이고, `"250"`처럼 숫자 문자열도 받는다. DTO에 없는 필드를 보내면 `400 COM-003 property xxx should not exist` (예: 이론중량을 보내면 거부 — 서버가 계산한다).
- **권한**: 조회는 `MASTER_MANAGE` VIEW 이상, 변경(POST·PUT·PATCH·DELETE)은 `MASTER_MANAGE` USE. 기본 역할에서는 관리자만 USE, 영업·구매·생산·품질은 VIEW, 물류는 권한 없음. 예외로 `GET /master-data/lookups`는 **로그인한 모든 사원**이 쓸 수 있다.
- 모든 변경은 작업 로그(`MASTER_CHANGED`, targetType `MASTER`, targetNo = 코드, 변경 전·후 값)를 남기고 실시간 신호 `changed { topics: ['master-data'] }`를 보낸다 (변경 실패 시에는 나가지 않는다).
- 아래 예시는 실제 서버 응답에서 가져왔다 (시드 DB + 시험 데이터).

## 오류 코드 (이 모듈에서 쓰는 것)

| HTTP | code | 언제 |
|---|---|---|
| 400 | `MST-002` | 사용된 규격의 강종·치수를 바꾸려 할 때 — `사용된 규격은 치수·이론중량을 수정할 수 없습니다. 새 규격을 추가해 주세요` |
| 400 | `COM-003` | 입력 검증 실패, 매핑 규칙 위반(코일 > 슬래브 중량, 강종 다름), 수율 범위, min > max, 성분·공정 중복 |
| 409 | `COM-003` | 이미 있는 값과 겹침 — 코드 중복, (강종·두께·폭·길이) 조합 중복, 이미 매핑된 규격, 검사 항목 코드 중복 |
| 409 | `COM-005` | 다른 데이터가 참조 중이라 삭제·변경 불가 (고객사·공급업체·야드·강종 삭제, 사용된 규격의 매핑 변경) — 사용 중지로 안내 |
| 409 | `COM-001` | 같은 값을 동시에 등록해 DB unique에 걸린 경우 (먼저 처리한 요청만 성공) |
| 404 | `COM-004` | 대상 없음 |
| 401 / 403 | `AUTH-002` / `COM-002` | 토큰 없음 / 권한 없음 |

`MST-001`은 요청을 거부하는 오류가 아니라 `GET /master-data/validation`이 알려 주는 "업무 계산을 막는 기준정보 누락"의 코드다 (생산·MRP 모듈은 계산 중 누락을 만나면 이 코드로 오류를 낸다).

## 공통 타입

```ts
type ItemType = 'RAW_MATERIAL' | 'SLAB' | 'COIL';                       // shared ITEM_TYPE
type UnitType = 'QTY' | 'TON';                                         // 제품 QTY(매수·개), 원료 TON
type RawMaterialType = 'IRON_ORE' | 'COAL' | 'LIMESTONE' | 'FERROALLOY'; // 철광석·석탄·석회석·합금철
type YardType = 'RAW_MATERIAL' | 'SLAB' | 'COIL';
type ProcessCode = 'IRONMAKING' | 'STEELMAKING' | 'CASTING' | 'HOT_ROLLING'; // 제선·제강·연주·열연
type ConsumptionUnit = 'TON_PER_TON' | 'KG_PER_TON';

/** 목록 조회 공통 쿼리 (강종·고객사·공급업체·야드·품목·원료) */
interface ListMasterQuery { active?: 'true' | 'false'; q?: string }   // q = 코드·이름 부분 일치(대소문자 무시)

interface DeleteResult { id: number; deleted: true }
```

---

## 1. 선택 목록 · 준비 상태

### GET `/master-data/lookups` — 로그인한 모든 사원

수주·생산·구매 화면의 선택 목록. **사용 중(active)인 것만**, 필요한 값만 담은 가벼운 목록이다.

```ts
interface Lookups {
  steelGrades: { id: number; steelGradeCode: string; steelGradeName: string }[];
  productSpecs: {
    id: number; specCode: string; itemType: 'SLAB' | 'COIL';
    steelGradeId: number; steelGradeCode: string;
    thicknessMm: string; widthMm: string; lengthMm: string;
    theoreticalWeightTon: string;             // "23.550" (소수 3자리 확정값)
    mappedSpecId: number | null;              // 슬래브면 매핑된 코일 규격 id, 코일이면 매핑된 슬래브 규격 id
  }[];
  rawMaterials: { id: number; materialCode: string; name: string; rawMaterialType: RawMaterialType; defaultSupplierId: number | null; yardId: number | null }[];
  customers: { id: number; customerCode: string; customerName: string }[];
  suppliers: { id: number; supplierCode: string; supplierName: string }[];
  yards: { id: number; yardCode: string; yardName: string; yardType: YardType }[];
  productionSetting: { heatCapacityTon: string; deliveryRiskDays: number } | null;
}
```
```json
{ "id": 1, "specCode": "SL-SS275-250x1200x10000", "itemType": "SLAB", "steelGradeId": 1, "steelGradeCode": "SS275",
  "thicknessMm": "250", "widthMm": "1200", "lengthMm": "10000", "theoreticalWeightTon": "23.550", "mappedSpecId": 2 }
{ "id": 1, "materialCode": "IO", "name": "철광석", "rawMaterialType": "IRON_ORE", "defaultSupplierId": 1, "yardId": 1 }
"productionSetting": { "heatCapacityTon": "250.000", "deliveryRiskDays": 3 }
```
확인: 김영업(영업)·윤물류(물류, `MASTER_MANAGE` 권한 없음) 모두 200. 토큰이 없으면 401.

### GET `/master-data/validation` — `MASTER_MANAGE` VIEW

업무 계산을 막는 누락·오류를 모두 찾아 준다 (읽기만 한다). 사용 중지된 강종·규격·원료는 검사하지 않는다.

```ts
type MasterArea = 'PRODUCT_SPEC' | 'SPEC_MAPPING' | 'ROUTING' | 'SPECIFIC_CONSUMPTION' | 'RAW_MATERIAL' | 'STEEL_GRADE' | 'INSPECTION_ITEM' | 'PRODUCTION_SETTING';
interface ReadinessProblem {
  code: 'MST-001';
  area: MasterArea;            // 화면이 이동할 기준정보 탭
  targetId: number | null;     // area에 따라 규격·매핑·원료·강종 id (라우팅은 null)
  targetNo: string | null;     // 규격 코드·원료 코드·강종 코드·"SLAB"|"COIL" 등
  message: string;             // 한국어 한 줄
}
interface ValidationResult { ready: boolean; checkedAt: string; problemCount: number; problems: ReadinessProblem[] }
```
점검 항목: 슬래브·코일 규격의 매핑 누락 / 매핑의 코일 > 슬래브 중량 / 슬래브·코일 라우팅 없음 / 제강·연주 수율 누락·범위 밖 / 코일 라우팅에 열연 없음 / 강종별 성분 규격 없음 / 강종별 연주·열연 검사 항목 없음(강종 전용 또는 공통 항목이 하나도 없을 때) / 원료 기본 공급업체 없음·사용 중지 / 철광석·석탄·석회석 공통 원단위 없음 / 합금철의 강종별 원단위 없음 / 철광석·석탄·석회석 원료 미등록 / 생산 설정값 없음·범위 밖.

```json
{ "ready": false, "checkedAt": "2026-09-30T11:22:26.849Z", "problemCount": 6, "problems": [
  { "code": "MST-001", "area": "SPECIFIC_CONSUMPTION", "targetId": 5, "targetNo": "FS-TEST1", "message": "원료 합금철 FeSi(FS)의 TEST1 원단위(kg/t)가 없습니다" },
  { "code": "MST-001", "area": "RAW_MATERIAL", "targetId": 6, "targetNo": "MN", "message": "원료 망간광(MN)에 기본 공급업체가 없습니다" } ] }
```
시드 DB 그대로는 `{ "ready": true, "problemCount": 0, "problems": [] }`. 새 강종·규격을 넣은 직후에는 아래처럼 나온다 (실제 응답):
`강종 TEST1에 열연(코일) 검사 항목이 없습니다` · `슬래브 규격 SL-TEST1-250x1200x10000에 대응 코일 규격 매핑이 없습니다` · `코일 규격 CL-TEST1-4.5x1200x542000에 대응 슬래브 규격 매핑이 없습니다` · `원료 합금철 FeMn(FM)의 TEST1 원단위(kg/t)가 없습니다`.

---

## 2. 품목 · 원료 (REQ-MST-001, MST-007)

```ts
interface ItemView {
  id: number; itemCode: string; itemName: string;
  itemType: ItemType; itemTypeName: string;     // "원료" | "슬래브" | "코일"
  unitType: UnitType;                            // RAW_MATERIAL → TON, SLAB·COIL → QTY (서버가 정함)
  defaultSupplierId: number | null; defaultSupplierName: string | null;
  rawMaterialId: number | null;                  // 원료 품목이면 raw_material.id
  isActive: boolean; createdAt: string; updatedAt: string;
}
```
- `GET /items?itemType=&active=&q=` → `ItemView[]` (id 순)
- `GET /items/:id` → `ItemView`
- `POST /items` — **슬래브·코일 품목만**. 원료 품목은 `POST /raw-materials`(품목+원료 상세+재고 행을 한 트랜잭션에 만든다)에서 만든다.
  ```ts
  { itemCode: string /* /^[A-Z0-9][A-Z0-9_-]{0,29}$/ */; itemName: string; itemType: 'SLAB' | 'COIL' | 'RAW_MATERIAL';
    unitType?: UnitType /* 생략 가능, 유형과 안 맞으면 400 */; defaultSupplierId?: number | null }
  ```
  → 201 `ItemView`. `itemType: 'RAW_MATERIAL'` → 400 `원료 품목은 원료 등록(/raw-materials)에서 만들어 주세요`. 코드 중복 → 409.
- `PATCH /items/:id` `{ itemName?: string; defaultSupplierId?: number | null; isActive?: boolean }` → `ItemView`. 품목 유형·코드는 바꿀 수 없다. 삭제 API 없음(사용 중지로 처리).

```ts
interface RawMaterialView {
  id: number; itemId: number; itemCode: string;            // itemCode = "RM-" + materialCode
  itemName: string; materialCode: string;                  // materialCode: LOT 번호(RM-원료코드-…)에 쓰이는 코드
  rawMaterialType: RawMaterialType; rawMaterialTypeName: string;
  unitType: 'TON';
  yardId: number | null; yardName: string | null;
  defaultSupplierId: number | null; defaultSupplierName: string | null;
  onHandTon: string;                                       // 원료 재고 톤 (읽기 전용, 소수 3자리)
  isActive: boolean; createdAt: string; updatedAt: string;
}
```
- `GET /raw-materials?rawMaterialType=&active=&q=` → `RawMaterialView[]`, `GET /raw-materials/:id`
- `POST /raw-materials` `{ materialCode: string /* /^[A-Z0-9]{1,10}$/ */; itemName: string; rawMaterialType: RawMaterialType; yardId?: number | null /* 원료 야드만 */; defaultSupplierId?: number | null /* 사용 중 공급업체 */ }` → 201 `RawMaterialView` (재고 행 0톤 생성). 원료 코드·품목 코드 중복 409, 원료 야드가 아니면 400.
  ```json
  { "id": 6, "itemId": 8, "itemCode": "RM-MN", "itemName": "망간광", "materialCode": "MN", "rawMaterialType": "FERROALLOY", "rawMaterialTypeName": "합금철",
    "unitType": "TON", "yardId": 1, "yardName": "원료 야드", "defaultSupplierId": 3, "defaultSupplierName": "대한합금", "onHandTon": "0.000", "isActive": true,
    "createdAt": "2026-09-30T11:22:26.363Z", "updatedAt": "2026-09-30T11:22:26.363Z" }
  ```
- `PATCH /raw-materials/:id` `{ itemName?; yardId?: number | null; defaultSupplierId?: number | null; isActive?: boolean }`. **원료 코드·원료 종류는 바꿀 수 없다** (LOT 채번·원단위가 참조). 기본 공급업체를 `null`로 비우면 validation에서 `MST-001`로 잡힌다.

---

## 3. 강종 · 성분 규격 (REQ-MST-002)

```ts
interface CompositionSpecView { id: number; elementCode: string; minValue: string | null; maxValue: string | null; sortOrder: number }  // % 단위
interface SteelGradeView {
  id: number; steelGradeCode: string; steelGradeName: string; standardNo: string | null; isActive: boolean;
  compositionSpecs: CompositionSpecView[];    // sortOrder 순
  createdAt: string; updatedAt: string;
}
interface CompositionSpecInput { elementCode: string /* /^[A-Za-z][A-Za-z0-9]{0,9}$/ */; minValue?: number | null; maxValue?: number | null /* 0~100, 소수 4자리, 하나는 필수, min ≤ max */; sortOrder?: number }
```
- `GET /steel-grades?active=&q=` → `SteelGradeView[]`, `GET /steel-grades/:id`
- `POST /steel-grades` `{ steelGradeCode: string /* /^[A-Z0-9][A-Z0-9-]{0,19}$/ */; steelGradeName: string; standardNo?: string | null; compositionSpecs?: CompositionSpecInput[] }` → 201
  ```json
  { "id": 4, "steelGradeCode": "TEST1", "steelGradeName": "시험 강종", "standardNo": "KS TEST", "isActive": true,
    "compositionSpecs": [ { "id": 16, "elementCode": "C", "minValue": null, "maxValue": "0.25", "sortOrder": 0 },
                          { "id": 17, "elementCode": "Si", "minValue": "0.05", "maxValue": "0.45", "sortOrder": 1 } ],
    "createdAt": "2026-09-30T11:22:25.901Z", "updatedAt": "2026-09-30T11:22:25.901Z" }
  ```
  코드 중복 → 409 `이미 등록된 강종입니다 (TEST1)`, `min > max` → 400 `성분 C의 최소값이 최대값보다 클 수 없습니다`.
- `PATCH /steel-grades/:id` `{ steelGradeName?; standardNo?: string | null; isActive?: boolean }` (강종 코드는 바꿀 수 없다)
- `DELETE /steel-grades/:id` → `DeleteResult`. 규격·LOT·생산계획·검사 항목·배합 원단위가 참조하면 409 `COM-005 … (규격 3, LOT 0, 생산계획 0, 검사 항목 1, 배합 원단위 1). 사용 중지로 바꿔 주세요`.
- `PUT /steel-grades/:id/composition-specs` `{ compositionSpecs: CompositionSpecInput[] /* 1개 이상 */ }` — **전체 교체** (목록에 없는 성분은 삭제, 배열 순서가 sortOrder) → `SteelGradeView`
- `PATCH /steel-grades/:id/composition-specs` `{ compositionSpecs?: CompositionSpecInput[]; removeElementCodes?: string[] }` — 보낸 성분만 추가·수정(각 항목은 min·max를 통째로 다시 지정), `removeElementCodes`는 삭제. 없는 성분을 지우면 404, 같은 성분을 수정하면서 지우면 409.

---

## 4. 제품 규격 (REQ-MST-003)

이론중량은 **서버가 `calcTheoreticalWeightTon(두께, 폭, 길이)`로 계산해 소수 3자리로 저장**한다 (250 × 1200 × 10000 → `23.550`). 규격 코드(`specCode`)도 서버가 만든다 (`SL-강종-두께x폭x길이`, 코일은 `CL-…`).

```ts
interface MappedSpecView {
  id: number; specCode: string; itemType: 'SLAB' | 'COIL';
  thicknessMm: string; widthMm: string; lengthMm: string; theoreticalWeightTon: string; isActive: boolean;
}
interface ProductSpecView {
  id: number; specCode: string;
  itemId: number; itemType: 'SLAB' | 'COIL'; itemTypeName: string; itemName: string;
  steelGradeId: number; steelGradeCode: string;
  thicknessMm: string; widthMm: string; lengthMm: string;
  theoreticalWeightTon: string;                    // 소수 3자리
  yardId: number | null; yardName: string | null;
  isActive: boolean;
  isUsed: boolean;                                 // 수주 품목·예약·생산계획·LOT가 참조하거나 재고 수량(보유·예약)이 있으면 true → 강종·치수 수정 불가
  mappingId: number | null;
  mappedSpec: MappedSpecView | null;               // 슬래브면 매핑된 코일 규격, 코일이면 매핑된 슬래브 규격
  hotRollingPlannedYieldRate: string | null;       // 매핑이 있으면 코일 ÷ 슬래브, 소수 4자리 (저장하지 않는 계산값)
  createdAt: string; updatedAt: string;
}
```
- `GET /product-specs?itemType=SLAB|COIL&steelGradeId=&active=&q=` → `ProductSpecView[]`
- `GET /product-specs/:id` → `ProductSpecView`
  ```json
  { "id": 20, "specCode": "CL-TEST1-4.5x1200x542000", "itemId": 2, "itemType": "COIL", "itemTypeName": "코일", "itemName": "열연코일",
    "steelGradeId": 4, "steelGradeCode": "TEST1", "thicknessMm": "4.5", "widthMm": "1200", "lengthMm": "542000", "theoreticalWeightTon": "22.975",
    "yardId": null, "yardName": null, "isActive": true, "isUsed": false, "mappingId": 10,
    "mappedSpec": { "id": 19, "specCode": "SL-TEST1-250x1200x10000", "itemType": "SLAB", "thicknessMm": "250", "widthMm": "1200", "lengthMm": "10000", "theoreticalWeightTon": "23.550", "isActive": true },
    "hotRollingPlannedYieldRate": "0.9756", "createdAt": "2026-09-30T11:22:26.021Z", "updatedAt": "2026-09-30T11:22:26.021Z" }
  ```
- `POST /product-specs` → 201 `ProductSpecView`
  ```ts
  { itemId?: number; itemType?: 'SLAB' | 'COIL';   // 둘 중 하나 필수 (itemType이면 사용 중인 그 유형 품목 중 id가 가장 작은 것)
    steelGradeId: number;                            // 사용 중인 강종
    thicknessMm: number; widthMm: number; lengthMm: number;  // 소수 2자리까지, 두께 ≤ 2000·폭 ≤ 5000·길이 ≤ 5,000,000 mm
    yardId?: number | null }                         // 슬래브 규격은 슬래브 야드, 코일 규격은 코일 야드
  ```
  실제 응답(250 × 1200 × 10000): `"specCode": "SL-TEST1-250x1200x10000", "theoreticalWeightTon": "23.550", "isUsed": false, "mappedSpec": null, "hotRollingPlannedYieldRate": null`.
  - 강종·두께·폭·길이 조합 중복 → 409 `이미 등록된 강종·두께·폭·길이 조합입니다 (SL-TEST1-250x1200x10000)`
  - 재고 행(0매)도 함께 만든다.
- `PATCH /product-specs/:id` `{ steelGradeId?: number; thicknessMm?: number; widthMm?: number; lengthMm?: number; yardId?: number | null }` → `ProductSpecView`
  - **사용된 규격**(`isUsed: true`)의 강종·치수를 **현재 값과 다르게** 바꾸면 → 400 `MST-002` `사용된 규격은 치수·이론중량을 수정할 수 없습니다. 새 규격을 추가해 주세요`. 값이 그대로면 바꾼 것으로 보지 않는다(야드만 고칠 수 있다).
  - 쓰이지 않은 규격은 치수를 고칠 수 있고, 이론중량과 규격 코드를 다시 계산한다 (250 → 260 mm: `24.492`, `SL-TEST1-260x1200x10000`).
  - 매핑된 규격이면 바뀐 중량으로도 매핑 규칙이 지켜져야 한다 → 아니면 400 `코일 이론중량(22.975t)이 슬래브 이론중량(18.840t)보다 클 수 없습니다`.
  - 품목(슬래브/코일)은 바꿀 수 없다.
- `POST /product-specs/:id/activate` · `POST /product-specs/:id/deactivate` (본문 없음, 200) → `ProductSpecView`. 사용 중지된 규격은 lookups에서 빠진다.

---

## 5. 규격 매핑 (REQ-MST-004)

슬래브 규격 1개 ↔ 코일 규격 1개. **열연 계획 수율 = 코일 이론중량 ÷ 슬래브 이론중량 (소수 4자리)** 은 저장하지 않고 응답에 계산해 넣는다.

```ts
interface SpecMappingSpecView {
  id: number; specCode: string; steelGradeId: number; steelGradeCode: string;
  thicknessMm: string; widthMm: string; lengthMm: string; theoreticalWeightTon: string; isActive: boolean;
}
interface SpecMappingView {
  id: number; steelGradeId: number; steelGradeCode: string;
  slabSpec: SpecMappingSpecView; coilSpec: SpecMappingSpecView;
  hotRollingPlannedYieldRate: string;   // "0.9756"
  isUsed: boolean;                       // 두 규격 중 하나라도 사용된 규격이면 true
  createdAt: string; updatedAt: string;
}
```
- `GET /spec-mappings?steelGradeId=` → `SpecMappingView[]`, `GET /spec-mappings/:id`
- `POST /spec-mappings` `{ slabSpecId: number; coilSpecId: number }` → 201 `SpecMappingView`
  ```json
  { "id": 10, "steelGradeId": 4, "steelGradeCode": "TEST1",
    "slabSpec": { "id": 19, "specCode": "SL-TEST1-250x1200x10000", "steelGradeId": 4, "steelGradeCode": "TEST1", "thicknessMm": "250", "widthMm": "1200", "lengthMm": "10000", "theoreticalWeightTon": "23.550", "isActive": true },
    "coilSpec": { "id": 20, "specCode": "CL-TEST1-4.5x1200x542000", "steelGradeId": 4, "steelGradeCode": "TEST1", "thicknessMm": "4.5", "widthMm": "1200", "lengthMm": "542000", "theoreticalWeightTon": "22.975", "isActive": true },
    "hotRollingPlannedYieldRate": "0.9756", "isUsed": false, "createdAt": "2026-09-30T11:22:26.124Z", "updatedAt": "2026-09-30T11:22:26.124Z" }
  ```
  거부: 코일 이론중량 > 슬래브 → 400 `코일 이론중량(28.260t)이 슬래브 이론중량(23.550t)보다 클 수 없습니다` (같으면 허용, 수율 1.0000) · 강종이 다름 → 400 `강종이 다른 슬래브·코일 규격은 매핑할 수 없습니다` · 유형이 틀림 → 400 · 슬래브나 코일이 이미 매핑됨 → 409 `슬래브 규격 SL-…은(는) 이미 코일 규격 CL-…와 매핑되어 있습니다`.
- `PATCH /spec-mappings/:id` `{ coilSpecId: number }` — 대응 코일 규격 교체 (같은 규칙 검증)
- `DELETE /spec-mappings/:id` → `DeleteResult`
- PATCH·DELETE는 **두 규격 중 하나라도 사용된 규격이면 409 `COM-005`** `수주·재고·LOT에 사용된 규격의 매핑은 바꾸거나 삭제할 수 없습니다. 새 규격을 추가해 매핑해 주세요` (시드의 매핑 9개는 재고가 있어 모두 해당). 이 규칙은 문서에 명시되지 않은 v2의 가정이다.

---

## 6. 라우팅 (REQ-MST-005)

공정 순서는 코드가 아니라 DB에서 읽는다. 열연의 계획 수율은 입력하지 않는다(`null`, `yieldSource: 'MAPPING'`) — 규격 매핑에서 계산.

```ts
interface RoutingProcessView {
  id: number; processCode: ProcessCode; processName: string;   // "제선" | "제강" | "연주" | "열연"
  processSeq: number;                                           // 1부터
  plannedYieldRate: string | null;                              // "0.95" (0 초과 1 이하). 제선·열연은 null
  yieldSource: 'INPUT' | 'MAPPING';
}
interface RoutingView { itemType: 'SLAB' | 'COIL'; processes: RoutingProcessView[] }  // processSeq 순
```
- `GET /routings` → `RoutingView[]` (SLAB, COIL 순), `GET /routings/:itemType` → `RoutingView`
  ```json
  [ { "itemType": "SLAB", "processes": [
      { "id": 1, "processCode": "IRONMAKING", "processName": "제선", "processSeq": 1, "plannedYieldRate": null, "yieldSource": "INPUT" },
      { "id": 2, "processCode": "STEELMAKING", "processName": "제강", "processSeq": 2, "plannedYieldRate": "0.95", "yieldSource": "INPUT" },
      { "id": 3, "processCode": "CASTING", "processName": "연주", "processSeq": 3, "plannedYieldRate": "0.96", "yieldSource": "INPUT" } ] },
    { "itemType": "COIL", "processes": [ …, { "id": 7, "processCode": "HOT_ROLLING", "processName": "열연", "processSeq": 4, "plannedYieldRate": null, "yieldSource": "MAPPING" } ] } ]
  ```
- `PUT /routings/:itemType` `{ processes: { processCode: ProcessCode; plannedYieldRate?: number | null }[] }` — 공정 순서(배열 순서 = processSeq 1부터)와 수율을 통째로 저장 (공정 추가·삭제·순서 변경). 같은 공정의 행 id는 유지된다 → `RoutingView`.
  거부(400): 수율 ≤ 0 또는 > 1 `계획 수율은 0보다 크고 1 이하여야 합니다` · 열연에 수율 입력 `열연 계획 수율은 입력하지 않습니다. 규격 매핑에서 계산됩니다` · 공정 중복 · `itemType`이 SLAB/COIL이 아님.
- `PATCH /routings/processes/:id` `{ plannedYieldRate?: number | null }` → `RoutingProcessView` (수율만 수정, 같은 검증)

---

## 7. 배합 원단위 (REQ-MST-006)

철광석·석탄·석회석은 **강종 없는 공통값**(용선 1t당 t, `TON_PER_TON`), 합금철은 **강종별**(용강 1t당 kg, `KG_PER_TON`). 단위는 원료 종류로 서버가 정한다.

```ts
interface SpecificConsumptionView {
  id: number; rawMaterialId: number; materialCode: string; rawMaterialName: string;
  rawMaterialType: RawMaterialType; rawMaterialTypeName: string;
  steelGradeId: number | null; steelGradeCode: string | null;   // 공통값이면 null
  consumptionRate: string;                                       // "1.6", "7.5" (0 초과)
  consumptionUnit: ConsumptionUnit; consumptionUnitName: string; // "t/t (용선 1t당)" | "kg/t (용강 1t당)"
  updatedAt: string;
}
```
- `GET /specific-consumptions?rawMaterialId=&steelGradeId=` → `SpecificConsumptionView[]` (원료 id, 공통값 먼저)
- `PUT /specific-consumptions` `{ rawMaterialId: number; steelGradeId?: number | null; consumptionRate: number }` — **있으면 수정, 없으면 등록**(upsert). 200 `SpecificConsumptionView`
  ```json
  { "id": 10, "rawMaterialId": 4, "materialCode": "FM", "rawMaterialName": "합금철 FeMn", "rawMaterialType": "FERROALLOY", "rawMaterialTypeName": "합금철",
    "steelGradeId": 4, "steelGradeCode": "TEST1", "consumptionRate": "7.5", "consumptionUnit": "KG_PER_TON", "consumptionUnitName": "kg/t (용강 1t당)", "updatedAt": "2026-09-30T11:22:26.481Z" }
  ```
  거부(400): 값 ≤ 0 `원단위는 0보다 커야 합니다` · 합금철에 강종 없음 `합금철 원단위는 강종을 지정해야 합니다` · 철광석·석탄·석회석에 강종 지정 `… 공통값입니다 (강종을 지정하지 마세요)` · 사용 중지된 강종.
- `DELETE /specific-consumptions/:id` → `DeleteResult` (지우면 validation에 `MST-001`로 잡힌다)

---

## 8. 고객사 · 공급업체 · 야드 (REQ-MST-007, MST-008)

```ts
interface CustomerView { id: number; customerCode: string; customerName: string; isActive: boolean; createdAt: string; updatedAt: string }
interface SupplierView { id: number; supplierCode: string; supplierName: string; isActive: boolean; createdAt: string; updatedAt: string }
interface YardView { id: number; yardCode: string; yardName: string; yardType: YardType; isActive: boolean; createdAt: string; updatedAt: string }
```
| API | 본문 | 응답 |
|---|---|---|
| `GET /customers?active=&q=` · `GET /customers/:id` | | `CustomerView[]` / `CustomerView` |
| `POST /customers` | `{ customerCode: string /* /^[A-Z0-9][A-Z0-9_-]{0,29}$/ */; customerName: string }` | 201 `CustomerView` |
| `PATCH /customers/:id` | `{ customerName?: string; isActive?: boolean }` | `CustomerView` |
| `DELETE /customers/:id` | | `DeleteResult` |
| `GET /suppliers` · `GET /suppliers/:id` · `POST /suppliers` `{ supplierCode; supplierName }` · `PATCH /suppliers/:id` `{ supplierName?; isActive? }` · `DELETE /suppliers/:id` | 고객사와 같은 규칙 | `SupplierView` |
| `GET /yards?yardType=&active=&q=` · `GET /yards/:id` · `POST /yards` `{ yardCode; yardName; yardType }` · `PATCH /yards/:id` `{ yardName?; isActive? }` · `DELETE /yards/:id` | 야드 종류는 등록 뒤 바꿀 수 없다. 야드 내 위치는 관리하지 않는다 | `YardView` |

- 코드 중복 → 409 `이미 등록된 고객사 코드입니다 (CUS-99)`.
- **DELETE는 참조가 없을 때만** 지운다. 참조가 있으면 409 `COM-005` 로 사용 중지(`PATCH { isActive: false }`)를 안내한다.
  - 고객사: 수주·출하요청·밀시트가 참조 → `수주 등에서 사용 중인 고객사는 삭제할 수 없습니다 (CUS-04). 사용 중지로 바꿔 주세요`
  - 공급업체: 품목의 기본 공급업체·발주·LOT → `품목·발주·LOT에서 사용 중인 공급업체는 삭제할 수 없습니다 (SUP-01). …`
  - 야드: 원료·규격·LOT·입고 → `원료·규격·LOT에서 사용 중인 야드는 삭제할 수 없습니다 (SY-01). …`
- 사용 중지된 고객사·공급업체·야드는 `lookups`에서 빠진다 (`?active=false`로 목록에서는 볼 수 있다).
- 품목별 기본 공급업체는 `PATCH /items/:id` · `PATCH /raw-materials/:id`의 `defaultSupplierId`로 지정한다 (사용 중인 공급업체만).

---

## 9. 생산 설정값 (REQ-MST-009)

```ts
interface ProductionSettingView { heatCapacityTon: string; deliveryRiskDays: number; updatedAt: string }
```
- `GET /production-settings` → `{ "heatCapacityTon": "250.000", "deliveryRiskDays": 3, "updatedAt": "2026-09-30T11:21:51.861Z" }`
- `PUT /production-settings` `{ heatCapacityTon: number /* > 0, 소수 3자리까지 */; deliveryRiskDays: number /* 0 이상의 정수 */ }` → `ProductionSettingView` (행 1개를 통째로 저장)
  ```json
  { "heatCapacityTon": "260.000", "deliveryRiskDays": 5, "updatedAt": "2026-09-30T11:22:26.743Z" }
  ```
  0 이하 → 400 `히트 용량은 0보다 커야 합니다`, 음수·소수 일수 → 400 `납기 위험 기준일은 0 이상의 정수로 입력해 주세요`.

---

## 10. 검사 항목 (REQ-QC-002)

연주(CASTING, 슬래브)·열연(HOT_ROLLING, 코일) 검사 항목과 min/max(경계 포함). 성분(제강·히트) 검사는 강종 성분 규격을 쓴다.

```ts
interface InspectionItemView {
  id: number;
  processCode: 'CASTING' | 'HOT_ROLLING'; processName: string;
  steelGradeId: number | null; steelGradeCode: string | null;   // null = 모든 강종 공통
  inspectionItemCode: string;                                    // 예: TENSILE_STRENGTH
  inspectionItemName: string; unit: string | null;
  minValue: string | null; maxValue: string | null;
  isRequired: boolean; sortOrder: number; updatedAt: string;
}
```
- `GET /inspection-items?processCode=&steelGradeId=` → `InspectionItemView[]` (`steelGradeId`를 주면 그 강종 전용 항목과 공통 항목을 함께 준다), `GET /inspection-items/:id`
- `POST /inspection-items` `{ processCode: 'CASTING' | 'HOT_ROLLING'; steelGradeId?: number | null; inspectionItemCode: string /* /^[A-Z][A-Z0-9_]{0,49}$/ */; inspectionItemName: string; unit?: string | null; minValue?: number | null; maxValue?: number | null; isRequired?: boolean /* 기본 true */; sortOrder?: number }` → 201
  ```json
  { "id": 21, "processCode": "HOT_ROLLING", "processName": "열연", "steelGradeId": 4, "steelGradeCode": "TEST1", "inspectionItemCode": "TENSILE_STRENGTH",
    "inspectionItemName": "인장강도", "unit": "MPa", "minValue": "410", "maxValue": "550", "isRequired": true, "sortOrder": 0, "updatedAt": "2026-09-30T11:22:26.778Z" }
  ```
  거부: min·max 둘 다 없음 `최소값·최대값 중 하나는 입력해 주세요` · `min > max` `최소값이 최대값보다 클 수 없습니다` · 같은 공정·강종에 같은 코드 → 409.
- `PATCH /inspection-items/:id` `{ inspectionItemName?; unit?: string | null; minValue?: number | null; maxValue?: number | null; isRequired?; sortOrder? }` (합쳐진 값으로 min ≤ max 검증). 공정·강종·항목 코드는 바꿀 수 없다.
- `DELETE /inspection-items/:id` → `DeleteResult` (검사 결과는 판정 시점의 기준값을 복사해 두므로 지워도 과거 결과는 그대로다)
