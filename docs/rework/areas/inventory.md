# 재고 — 제품·LOT 목록·원료·여재 (`/inventories`)

- 2026-10-01, 워크트리 브랜치(병합 전). 근거: stage4.md 5번 화면, 02 요구사항 REQ-INV-001·003·007·008·010, 04 업무 프로세스 4.2·4.3, 03 용어 사전(TRM-048 여재, TRM-051 입고예정, TRM-055 가용재고, TRM-062 정합성 보정), 06 공통 코드(LOT_TYPE·LOT_STATUS·INSPECTION_RESULT·ALLOCATION_PURPOSE·DISPOSITION_STATUS·RAW_MATERIAL_TYPE·ITEM_TYPE), PLAN 7장 재고, reports/3 A-4·C 항목.
- 조회 전용 화면이다. 계산은 모두 핵심 서비스 `inventoryViews.ts`(`productInventory`·`lotList`·`rawMaterialInventory`·`surplusSlabs`)를 그대로 쓴다. 이 영역은 규칙을 새로 만들지 않았다.

## 화면

| 탭 (`?tab=`) | 내용 | 요구사항 |
|---|---|---|
| 제품 (기본) | 유형(전체/슬래브/코일)·강종 필터(주소 `itemType`·`steelGrade`). 유형별 KPI(가용재고 · 규격 수, 합격 − 예약 − 열연 배정 · 재고). 규격별 표: 규격 · 유형 · 강종 · 치수 · 1매 이론중량 · **재고**(미소진 LOT 매수) · 재고 톤 · **합격**(4.3 적격) · 판정 대기 · 불합격(히트 불합격 포함) · **예약**(ACTIVE) · 열연 배정(CONFIRMED, 코일 —) · **가용재고**(4.2 = 합격 − 예약 − 예약 밖 열연 배정) · 가용재고 톤 · 기본 야드. 값이 모두 0인 규격은 흐리게 | INV-001·003·007, 4.2 |
| LOT 목록 | 유형(전체/원료/용선/히트/슬래브/코일)·상태(재고/투입 소진/출고) 필터(주소 `lotType`·`lotStatus`), LOT 번호 검색(화면 안 상태). 열: LOT 번호(→ LOT 추적) · 유형 · 규격 · 강종 · 히트 · **생산완료일(날짜)** · **품질 결과**(검사 결과: 합격/판정 대기/불합격/불합격(히트) + 처리 상태, 소진·출고 LOT 포함) · **배정 여부**(해제되지 않은 마지막 배정의 목적 · 배정 확정/소진, 재고 LOT은 미배정 + 여재 꼬리표) · 잔량(원료·용선) · 야드 · 생산계획(→ 생산계획) · 상태. 생산완료일 최근 순 | INV-001·003·007, LOT-001 |
| 원료 | 원료별: 원료 · 원료 코드 · 원료 유형 · **잔량**(LOT 잔량 합계) · **입고예정**(확정 발주 미입고량) · 잔량 있는 LOT 수 · 기본 야드. 줄을 고르면 아래에 그 원료의 LOT(입고일 오래된 순: LOT 번호 · 입고일 · 입고 번호 · 공급업체 · 입고량 · 잔량 · 야드 · 상태) | INV-001 |
| 여재 | 안내 띠 "여재는 가용재고에 포함돼요". 규격별 여재: 규격 · 강종 · 미배정 합격 · 예약 · 가용재고 · 가용재고 톤 · 여재(여재 전환 LOT 중 수주 예약에 쓰이지 않은 몫, ≤ 가용재고) · 여재 톤. 여재 슬래브(FIFO 순): LOT 번호 · 규격 · 강종 · 히트 · 생산완료일 · 여재 전환일(surplus_at) · 1매 이론중량 · 야드 · 생산계획. 강종 필터 | INV-008 |

- 탭 줄 오른쪽: "조회 전용 · 예약·출고·검사·작업 실적이 반영되면 바로 바뀌어요" + **정합성 보정 `SoonButton`(준비 중 (P2), REQ-INV-010)**.
- 불러오는 중·오류·권한 없음은 `QueryBoundary`, 빈 표는 `EmptyNote`("조건에 맞는 제품 규격이 없어요", "조건에 맞는 LOT이 없어요", "여재가 없어요" 등).
- 갱신: 다른 화면의 변경은 `useAction`이 모든 조회를 무효화하고, 다른 탭은 BroadcastChannel 동기화로 다시 불러온다. 이 화면에는 변경이 없다.

## reports/3 C 항목 반영

- '귀속' 열·문구 삭제(C4-5, C5-7). 열연 배정은 CONFIRMED 배정만 '열연 배정'으로 보이고 가용재고에서 뺀다(4.2).
- '가용' → **'가용재고'**(TRM-055, C2-4). '검사 대기' → **'판정 대기'**(C3-10).
- 여재 탭의 '여재 중 예약/가용'을 화면에서 계산하던 것(C4-9) → api 값(`reservedQty`, `availableQty` = 그 규격의 가용재고, `surplusQty` = 여재)을 그대로 보인다(검토 반영 1·3번).
- 생산완료일은 시각 없이 날짜만(C6, 5장 date).
- 공통 코드 표시명은 `@/codes`의 `*_LABEL`만 쓴다(C6-5). 하드코딩 색·style 객체 없음(Tailwind 토큰).
- LOT 목록 탭 추가(stage4.md 5번: lot_no·유형·규격·생산완료일·품질 결과·배정 여부·야드·상태).

## api · 훅 · 화면 파일

- `client/src/api/inventories.ts`
  - `inventoryKeys` (`['inventories', …]`) — 공유 `queryKeys.ts`는 건드리지 않았다.
  - `inventoryApi.listProducts()` → `ProductInventoryView[]` (서비스 행 + 치수·기본 야드·단위(매/개)·예약 톤)
  - `inventoryApi.listLots({ lotType?, lotStatus?, itemId? })` → `LotListView[]` (서비스 행 + `productionPlanId`)
  - `inventoryApi.listRawMaterials()` → `RawMaterialInventoryView[]` (+ 기본 야드, 잔량 있는 LOT 수)
  - `inventoryApi.listSurplus()` → `SurplusSpecView[]` (+ 1매 이론중량, 여재 톤·가용재고 톤, LOT의 야드·생산계획 id)
  - 모든 조회는 `mockQuery` 안에서 `requireActor(tables)`로 요청 사원을 확인한다(계정 선택 없음·없는 사원·사용 안 함 → COM-002). 재고는 권한 코드가 없고 `screens.ts`에서 EVERYONE이라 역할 권한은 보지 않는다.
  - 순수 조합 함수 `readProductInventory`·`readLotList`·`readRawMaterialInventory`·`readSurplusSlabs(tables)`도 내보낸다(대시보드 등 다른 영역이 같은 값을 쓸 때).
- `client/src/hooks/useInventories.ts`: `useProductInventory`, `useLotList(filter)`, `useRawMaterialInventory`, `useSurplusSlabs`.
- `client/src/features/inventory/`: `components/InventoryScreen.tsx`(탭), `ProductInventoryTab.tsx`, `LotListTab.tsx`, `RawMaterialTab.tsx`, `SurplusTab.tsx`, `InventoryParts.tsx`(매수 칸·캡션·강종 선택·LOT/계획 링크), `useInventoryParams.ts`(탭·필터 ↔ 주소), `lib/inventoryDisplay.ts`(품질·배정·처리 상태 표시, 유형별 합계, LOT 번호 검색 — 순수 함수).
- `client/src/app/(main)/inventories/page.tsx`: 자리표시를 바꿨다. `useSearchParams` 때문에 `Suspense`로 감쌌다(정적 빌드 요건).

## 작업 로그 · 권한

- 변경이 없으므로 작업 로그를 남기지 않는다.
- 사용 권한이 필요한 버튼이 없다(정합성 보정은 준비 중이라 늘 막힘). 그래서 읽기 전용 안내(`ReadOnlyHint`)도 두지 않았다.

## 시드

- 새 시드 없음. core 시드(14.1 SS275 여재 6매, SM355A 여재, 코일 계획의 판정 대기 슬래브·열연 대상, SPHC 히트 불합격 10매, 원료 LOT·실리코망가니즈 입고예정 3.5t)로 네 탭이 모두 채워진다. `seeds/index.ts` 등록할 것 없음.

## 테스트 (Vitest, 37개)

- `client/src/api/inventories.test.ts` (28): 권한(계정 없음·없는 사원 COM-002, 12개 시드 역할 모두 조회 가능), 제품(14.1 시작 재고 6매 = 141.300t, 모든 규격에서 4.2 식·재고 = 합격 + 판정 대기 + 불합격·톤 3자리, 히트 불합격 제외, 새 수주의 재고 우선 예약 → 예약 4·가용재고 2 즉시 반영 + 불변조건), LOT 목록(전체·날짜 형식·정렬·필터, 출고/여재 LOT, HEAT_FAILED, 확정 배정 목적), 원료(잔량 합계·입고예정 1.000 + 3.500, 입고일 순, 철광석 633.330t), 여재(SS275 6매·FIFO·surplus_at, 여재 = 제품 가용재고, 예약 후 여재는 그대로·가용재고 0, 슬래브만).
- `client/src/features/inventory/lib/inventoryDisplay.test.ts` (9): 표시명·색, 옛 문구('검사 대기'·'귀속') 없음, 합계, 빈 줄, 검색.
- 9.3 코드 중 이 영역이 낼 수 있는 것은 COM-002뿐이다(조회 전용).

## 가정값

| 항목 | 값 | 이유 |
|---|---|---|
| 히트 불합격 하위 LOT 품질 표시 | '불합격(히트)' (INSPECTION_RESULT '불합격' + 원인) | 공통 코드에 별도 값이 없고, 예약·배정 제외 이유(INV-007)를 구분해 보여야 함 |
| 배정 여부 표시 | 해제되지 않은 마지막 배정(CONFIRMED·CONSUMED)의 'ALLOCATION_PURPOSE 표시명 + 배정 · ALLOCATION_STATUS 표시명'(예: 출하 배정 · 소진). 재고 LOT에 배정이 없으면 '미배정', 소진·출고 LOT에 배정 기록이 없으면 '—' | 배정 여부 코드가 따로 없음 (검토 반영 2번) |
| 여재 매수·여재 LOT | 규격별 여재 = min(여재 전환(surplus_at) 미배정 합격 슬래브 수, 가용재고). 여재 LOT은 그중 최근 것부터 여재 매수만큼. LOT 목록 '여재' 꼬리표도 같은 LOT | 검토 반영 1번 |
| 1매 이론중량·톤 칸 | 규격 이론중량 그대로(`theoreticalWeightTon`), 톤 = 매수 × 이론중량(소수 3자리) | REQ-INV-001, TRM-022 이론중량 |
| 링크 주소 | LOT → `/lots/trace?lot=<LOT 번호>`, 생산계획 → `/production/plans?plan=<id>` | reports/3 A-0의 옛 화면 간 이동 규칙. 다른 영역이 다른 파라미터를 쓰면 병합 때 맞춘다 |

## 공유 파일 변경

- 없음. (`screens.ts`·`routeTitles.ts`에 `/inventories`가 이미 있다.)

## 확인이 필요한 것 / 남은 일

1. 재고 화면 접근: stage4.md는 "VIEW per role table"이지만 재고용 PERMISSION 코드가 공통 코드에 없고 `screens.ts`가 EVERYONE이다. 그대로 두고 조회 API는 로그인한 사용 중 사원만 확인한다.
2. 정합성 보정(REQ-INV-010, P2)은 버튼만(준비 중). core에 `checkInvariants`가 있어 나중에 그대로 쓸 수 있다.
3. LOT 추적·생산계획 화면의 쿼리 파라미터(`lot`, `plan`) 이름이 그 영역과 다르면 `InventoryParts.tsx`의 `lotTraceHref`·`productionPlanHref` 두 줄만 고친다.
4. 원료 탭의 '잔량 있는 LOT' 수와 LOT 목록의 LOT 번호 검색은 화면 편의 기능이다(새 데이터 없음).

## 검토 반영 (2026-10-02)

근거: 03 TRM-022·TRM-048·TRM-055, 02 REQ-INV-006·008, 04 4.3 구현 제안, 06 LOT_STATUS·ALLOCATION_STATUS·INSPECTION_RESULT, 05 2장 [강제] 도메인 변수명.

1. **여재를 문서 정의 하나로 맞춤** (TRM-048 "수주에 쓰이지 않고 남은 미배정 합격 슬래브", 4.3 "ACTIVE 예약된 매수를 자유 재고로 노출하지 않는다")
   - 전에는 여재 탭이 규격의 미배정 합격 슬래브 전부(core `surplusSlabs`)를 여재로 셌다(시드 '3개 규격 · 24매'). 그래서 SM355A 250×1500은 여재 15·가용재고 0으로 보였다. LOT 목록 꼬리표는 surplus_at 기준이라 9매였다.
   - 이제 여재 LOT = 적격(ELIGIBLE) + CONFIRMED 배정 없음 + 여재 전환(surplus_at)이다. 규격별 여재 매수 = min(그 LOT 수, 가용재고)로, 여재로 수주를 예약하면 그만큼 빠진다. 그래서 늘 여재 ≤ 가용재고다.
   - 예약은 매수 단위라 어느 LOT이 예약 몫인지 정해지지 않는다. 배정은 선입선출로 오래된 LOT부터 쓰이므로, 여재로 남는 LOT은 여재 전환 LOT 중 최근 것부터 여재 매수만큼으로 본다(가정값).
   - 규칙은 순수 함수 `features/inventory/lib/inventoryRules.ts`의 `pickSurplusLots`에 있다. api `readSurplusSlabs`가 core `surplusSlabs`(미배정 합격·예약·예약 가용) 위에서 부르고, `readLotList`의 `isSurplus`도 같은 결과를 쓴다. 여재 탭 머리말·'여재' 열·여재 슬래브 목록·LOT 목록 꼬리표가 같은 값이다.
   - 여재 탭 표: 규격 · 강종 · **미배정 합격**(예약 몫·열연 대기 포함, 별도 표시) · 예약 · 가용재고 · 가용재고 톤 · **여재** · 여재 톤. 여재 0인 규격은 흐리게 보인다. 머리말은 여재가 있는 규격 수 · 여재 매수다.
   - 시드 결과: SS275 250×1200 여재 6(14.1), SM355A 250×1500 미배정 합격 15 · 예약 15 · 가용재고 0 · 여재 0, SM355B 250×1500 미배정 합격 3 · 가용재고 3 · 여재 0(코일 계획 열연 대기). 여재 합계는 6매다.
   - 꼬리표가 적격 여부를 보지 않던 문제도 함께 고쳤다. 재판정으로 불합격이 된 LOT은 후보(ELIGIBLE)에서 빠진다.
2. **LOT 목록 배정 여부·품질 결과** (REQ-INV-006, 06 LOT_STATUS "품질은 INSPECTION_RESULT, 배정 여부는 allocation으로 따로")
   - 배정 여부는 RELEASED가 아닌 마지막 배정(`currentAllocationOf`)을 본다. 표시는 '출하 배정 · 소진', '열연 투입 배정 · 배정 확정'처럼 목적과 ALLOCATION_STATUS 표시명이다. 출고·열연 투입된 LOT이 '미배정'으로 보이던 문제를 고쳤다.
   - 품질 결과는 새 `inspectionResult`로 보인다(`productInspectionResult` = 4.3 판정에서 LOT 상태만 뺀 것, 히트는 성분 판정). 출고·소진 LOT도 합격·불합격이 그대로 보인다. core의 `quality`(적격 = 예약·배정 가능 여부)는 그대로 두고 따로 준다.
   - `LotListView`에 `inspectionResult`·`allocationStatus`·`isSurplus`를 더했다. `allocationPurpose`의 뜻은 '해제되지 않은 마지막 배정의 목적'으로 바뀌었다.
3. **이름 (05 2장 [강제])**
   - `SurplusSpecView`의 가용재고는 `availableQty`·`availableTon`이다(TRM-055). 이제 `surplusQty`·`surplusTon`은 여재 매수·여재 톤만 뜻한다. core 작업 로그 afterData의 `surplusQty`와 같은 뜻이다.
   - 1매 이론중량은 `theoreticalWeightTon`이다(TRM-022). `SurplusSpecView`와 `ProductInventoryView`(core 행의 `unitWeightTon`을 빼고 다시 이름 붙임) 둘 다 바꿨다.
4. 테스트: `inventoryRules.test.ts`(8개)를 새로 넣었다. `inventories.test.ts`는 여재 정의, SM355A·SM355B, 여재 합계 = 꼬리표 수, 부분 예약 → 여재 2(-09·-10), 소진 배정·검사 결과 기대값을 고쳤다. `inventoryDisplay.test.ts`는 품질·배정 표시를 맞췄다. 전체 552개가 통과한다.
5. 공유 파일 변경 없음. 확인 필요: core `surplusSlabs`의 `surplusQty`는 여전히 '예약 가용'을 뜻하고, `ProductInventoryRow.unitWeightTon`도 남아 있다(이 영역은 api에서 이름을 바꿔 쓴다). 병합 단계에서 core 이름을 맞출지 정해야 한다. 대시보드의 여재 보유일(seed-assumptions 448)은 '예약 가용 > 0인 규격' 기준이라 이 정의와 다를 수 있다.
