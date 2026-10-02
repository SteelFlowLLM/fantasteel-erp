# 업무 규칙 핵심 (core) — 검토 반영 기록

- API 문서는 `core-domain.md`에 있다. 이 파일에는 검토에서 확인된 문제를 고친 기록만 둔다.

## 검토 반영 (2026-10-02)

근거 문서는 항목마다 적었다. 테스트는 `client/src/mock/services/tests/review.test.ts`에 7개를 새로 두었고, 바뀐 동작에 맞춰 `scenario142.test.ts` 2개와 `api/scenario/demo142.test.ts` 1줄을 고쳤다.

| # | 문제 | 고친 내용 | 근거 |
|---|---|---|---|
| 1 | 코일 계획에서 만든 코일이 불합격이면 그 수주 품목을 더 채울 수 없었다. 열연은 '필요 0'으로 막히고, 재생산은 '재생산할 매수가 없어요'로 거부됐다 | 불합격 코일(히트 불합격 포함)은 '만든 코일'로 세지 않는다. 그래서 필요 매수와 COMPLETED 조건 모두 **합격 + 판정 대기 코일**로 계산한다(`planProgressOf.usableCoilQty`, `rollingPlanView.rolledQty`·`failedCoilQty`). 같은 계획에서 다시 열연할 수 있다. 이미 COMPLETED가 된 뒤 코일이 불합격되면, 완료 계획은 더 열연하지 않으므로 잔여 목표를 판정 대기 코일만으로 센다. 그래서 '추가 계획 필요'가 생기고 재생산할 수 있다. 완료 계획에서 나중에 합격한 슬래브는 합격할 때 여재가 된다 | 04 BP-QC-01, 4.5, 10장 · 02 REQ-PRD-004·006 |
| 2 | 코일 계획의 잔여 목표가 자기 적격 슬래브를 모두 셌다. 다른 수주가 그 슬래브를 재고 우선 예약으로 가져가도 재생산이 막혔다 | 잔여 목표에는 지금 배정할 수 있는 자기 슬래브만 센다. `ownAllocatableSlabQty` = 판정 대기 자기 슬래브 + min(적격 미배정 자기 슬래브, 슬래브 규격 예약 가용). 판정 대기 슬래브는 아직 합격해 열연할 수 있어서 센다. 다른 수주가 가져간 만큼 '추가 계획 필요'가 생긴다 | 04 4.5, BP-INV-01 · 02 REQ-INV-008, REQ-PRD-006 |
| 3 | 수주 취소로 연결이 끊긴 진행 계획이 완료 조건을 이미 채웠어도 IN_PROGRESS에 영원히 남았다 | `unlinkInProgressPlan` 끝에서 `refreshPlanStatus`를 부른다. 시드 SO-2609-003을 취소하면 PP-2609-0003(모두 연주함)은 COMPLETED가 되고, PP-2609-0004(연주 전)는 IN_PROGRESS로 남는다 | 04 10장, BP-SO-02 |
| 4 | MRP가 필요일이 기간 밖인 계획을 순소요 계산 전에 버렸다. 그래서 기간을 어떻게 고르느냐에 따라 같은 계획의 순소요가 달랐다(기간 앞의 못 만든 계획 몫 잔량이 빠지지 않음) | 남은 히트가 있는 모든 계획·진행중 계획을 필요일 순으로 차감한다. 기간은 결과를 보여 줄 때만 거른다(plans·materials·requisitionLines). 다른 계획 몫으로 남겨 둔 입고예정도 이제 전체 열린 계획을 기준으로 지킨다 | 04 BP-PRD-01, 4.4 · 02 REQ-PRD-005 |
| 5 | 완료 후 여재 계획을 연주하면 판정 전 슬래브에 바로 `surplus_at`을 넣고 SURPLUS_CONVERTED를 남겼다. 그래서 나중에 불합격된 슬래브도 '여재'로 보였다 | 연주 때는 여재로 표시하지 않는다. 검사로 적격이 될 때 `applyEligibilityChanges`가 표시하고 이벤트를 남긴다. 사유: '수주 연결이 해제된 계획의 합격 슬래브를 여재로 전환' | 04 BP-SO-02 · 02 REQ-INV-008 |
| 6 | 반려 후 재요청할 때 알림은 요청자의 지금 부서장에게 갔다. 그런데 승인권자는 옛 `department_id`의 부서장이었다 | 재요청할 때 `department_id`를 재요청 시점의 소속 부서로 바꾼다. 이제 알림 대상과 승인권자가 같다. 작업 로그 전후 값에 `departmentId`를 넣었다 | 04 2장 · 02 REQ-AUTH-004, REQ-PUR-002 |
| 7 | 라우팅 수율 누락 오류(MST-001)의 detail에 영문 코드 `CONTINUOUS_CASTING`이 그대로 보였다 | `라우팅 계획 수율(슬래브 연주)`로 바꿨다. `ITEM_TYPE_LABEL`·`PROCESS_TYPE_LABEL`을 쓴다 | PLAN §4, 06 공통 코드 |
| 8 | 협업 시드의 09-30 메시지가 없는 수주 `SO-2610-001`을 가리켰다 | 시드에 있는 `SO-2609-002, DR-2609-0002`(출하 요청일 10-05)를 가리킨다. 09-30(수)에서 10-05(월)는 다음 주라서 문구도 '다음 주 출하 예정 건'으로 바꿨다 | 04 9.1 |
| 9 | 히트 편성 함수·형식 이름이 용어 사전과 달랐다(`formHeats`) | `planHeats` / `planHeatsFor`, 형식 `HeatPlan` / `HeatPlanInput`으로 바꿨다. 화면용 결과 필드 `formation`은 그대로 둔다 | 03 TRM-046, 05 [강제] |
| 10 | LOT 번호 필드 이름이 `heatLotNo`·`slabLotNos`·`coilLotNos`였다. 용어 사전은 `heatNo`·`slabNo`·`coilNo`다 | core 안에서만 쓰는 **작업 로그 전후 값의 키**를 바꿨다(연주 `heatNo`, 열연 `slabNos`·`coilNos`, 밀시트 발행 `heatNos`). 화면이 읽는 조회 모델 필드는 화면 영역 파일(약 30개)과 함께 바꿔야 해서 남겼다(아래 '남은 일') | 03 TRM-016~018, 05 [강제] |
| 11 | `order`만 쓴 식별자가 있었다 | `salesOrders`·`salesOrderLines`(shipments), `salesOrderWork`(goodsIssues), `purchaseOrders`(purchasing)로 바꿨다 | 05 [강제] |

### 공유 파일 변경

- `client/src/api/scenario/demo142.test.ts` 1줄: 연주 직후 슬래브가 여재가 **아니다**로 기대값을 바꿨다(5번). 이어지는 검사 뒤 여재 10매 확인은 그대로 통과한다.
- `docs/rework/areas/core-domain.md`: 바뀐 이름(1·5장), COMPLETED·잔여 목표 정의(5장), 연주 여재(6장), 열연 필요 매수(8장), MRP 대상(10장), 재요청 부서(11장), 가정값 표의 COMPLETED 행을 고쳤다.

### 남은 일 (화면 영역 파일)

모두 처리했다. 3번만 문서에 기준이 없어 그대로 둔다.

1. ~~조회 모델의 LOT 번호 필드 이름(`heatLotNo`·`slabLotNo`·`heatLotNos`, `MillSheetSnapshot`, `RollingLotView` 등)을 `heatNo`·`slabNo`·`coilNo`로 바꾸는 일이 남았다. 화면·api 파일 약 30개를 함께 바꿔야 해서 병합 단계에서 한 번에 한다.~~ → **완료**(2026-10-02, 아래 '이름 맞추기')
2. ~~생산 화면의 공정 단계 표시는 `progress.coilQty`(불합격 포함)를 쓴다(`ProductionPlanScreen.tsx`·`ProductionResultScreen.tsx`의 `coilQty: plan.progress.coilQty`). 그래서 불합격 코일이 있으면 계획은 진행중인데 '열연 6/6 완료'로 보인다. `progress.usableCoilQty`를 쓰도록 바꿔야 한다. 열연 화면에 불합격 코일 수를 보이려면 `api/rolling.ts`가 `failedCoilQty`도 넘겨야 한다.~~ → **완료**(3c2a85d: 공정 단계·열연 화면이 `usableCoilQty`·`failedCoilQty`를 쓴다)
3. 같은 슬래브 규격을 쓰는 코일 계획이 여럿이면, 각 계획이 `min(자기 적격 슬래브, 예약 가용)`을 따로 센다. 그래서 같은 예약 가용이 두 번 셀 수 있다. 예약이 매수 단위라 어느 계획 몫인지 나눌 기준이 문서에 없어 그대로 두었다.
4. ~~시드 메시지 문구가 바뀌었다. 옛 브라우저 데이터를 버리려면 병합 단계에서 `MOCK_DB_VERSION`을 올려야 한다.~~ → **완료**(ba9e1ad에서 3 → 4, 지금은 6)

## 이름 맞추기·ext 서비스 합치기 (2026-10-02)

근거: 05 2장 [강제](도메인 변수명은 용어 사전, 동의어 금지, `order` 단독 금지, 단위 `Ton`), 03 TRM-015~018·022, 04 9.2(히트번호·슬래브번호).

- **이론중량(TRM-022)**: 1매(1개) 이론중량을 뜻하는 `unitWeightTon` → `theoreticalWeightTon`, `slabUnitWeightTon` → `slabTheoreticalWeightTon`, `unitWeightOf` → `theoreticalWeightOf`(context.ts). 지역 변수 `unitWeight`도 바꿨다. 재고 api의 `ProductInventoryView`는 이제 core 행의 이름을 그대로 쓴다(다시 이름 붙이기 없음).
- **LOT 번호(TRM-016~018)**: 조회 모델·api 뷰·밀시트 스냅샷·화면·테스트의 `heatLotNo` → `heatNo`, `heatLotNos` → `heatNos`, `slabLotNo` → `slabNo`, `slabLotNos` → `slabNos`, `coilLotNos` → `coilNos`. 작업 로그 전후 값 키는 core가 이미 쓰던 `heatNo`·`heatNos`·`slabNos`·`coilNos`와 같다. 채번 도우미도 9.2 이름에 맞췄다: `formatHeatNo`·`formatSlabNo`·`formatCoilNo`·`formatHotMetalNo`(codes/numbering.ts), `issueHeatNo`·`issueSlabNo`·`issueHotMetalNo`·`coilNoOf`(mock/sequence.ts). 원료 LOT(TRM-070, 변수명 없음)의 `formatRawMaterialLotNo`·`issueRawMaterialLotNo`와 ERD 컬럼 `lot.heat_lot_id`에서 온 `heatLotId`·`heatLot`은 그대로 둔다.
- **`order` 단독**: `orderLine` → `purchaseOrderLine`(salesOrders.ts), 테스트의 `const order = createSalesOrder(…)` → `created`, 수주 상세 `orderCancelled` → `salesOrderCancelled`.
- 밀시트 스냅샷(저장된 JSON)의 키가 바뀌어 `MOCK_DB_VERSION`을 5 → 6으로 올렸다(옛 브라우저 데이터는 시드로 다시 만든다).
- **ext 서비스 합치기**: `mock/services/ext/`를 지웠다.
  - `ext/production.ts` → `productionResults.ts`의 '진행 중 작업' 함수(`openResultsOf`, `startedHeatLotIdOf`, `assertNoOpenWorkOnCompletion`, `assertNoOpenWorkForSimulation`, 내부 `assertNoOpenWorkOfProcess`·`assertStartedHeat`). 확인은 이제 api가 아니라 core가 한다: `startWork`·`registerIronmaking`·`registerSteelmaking`·`registerCasting`(시작한 히트 확인 포함)·`registerHotRolling`(rolling.ts)·`simulatePlan`(simulation.ts). api `productionResults.ts`·`rolling.ts`는 core를 부르기만 한다. 동작(완료로 이어지는 실적 거부, 트랜잭션 취소)은 그대로다.
  - `ext/purchasing.ts` → `mrp.ts`의 `computeMrpForPeriod`·`MrpPeriodView`·`MrpPeriodPlanRow`. `computeMrp`와 계산 한 벌(`mrpViewOf`)을 같이 쓰고 보일 범위만 다르다(computeMrp: 필요일 from~to, computeMrpForPeriod: 필요일 ≤ to + `beforePeriod`). 전에는 ext가 core를 전체 기간으로 한 번 더 부르고 원료 행 차감을 다시 돌렸다. 결과는 같다(`mrpPeriod.test.ts`·`review.test.ts` 그대로 통과).
- 바꾸지 않은 것: `heatLotId`·`heatLot`(ERD `lot.heat_lot_id`), `formatRawMaterialLotNo`·`issueRawMaterialLotNo`(TRM-070 원료 LOT은 변수명이 없고 한글명이 'LOT'을 포함), `orderDepartments`(정렬하다 뜻의 동사), 이론중량을 뜻하지만 '1매 중량'이 아닌 이름(`api/masterData.ts`의 `slabWeight`·`coilWeight`, lib `calcHotRollingYieldRate(coilWeightTon, slabWeightTon)`). 열연 화면·서비스의 영문 `rolling`(TRM-008 영문명 Hot Rolling, 변수명 없음, 금지어는 공정명 '압연')은 파일·경로까지 바뀌는 큰 이름 바꾸기라 그대로 두었다 — 팀 확인 필요.
- 테스트는 더하거나 지우지 않았다(672개 통과, 테스트 파일은 이름·import만 바꿈). 브라우저에서 밀시트·열연 투입 배정 화면의 히트·슬래브 번호와 1매 이론중량 표시를 확인했다.
