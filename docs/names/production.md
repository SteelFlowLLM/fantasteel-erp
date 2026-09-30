# 새로 지은 이름 — production · quality

용어 사전과 업무 프로세스 정의서 11·12장에 없어 이 모듈에서 새로 지은 이름이다. DB 테이블·컬럼은 새로 만들지 않았다 (모두 API 응답·코드 안의 이름).

## API 경로

| 이름 | 어디에 쓰는지 | 왜 필요한지 |
|---|---|---|
| `GET /production-plans/reproduction-preview` | 재생산 전 확인 | REQ-PRD-006: 재생산 계획을 만들기 전에 필요 매수·가용 재고·여재를 보여 줘야 한다 |
| `GET /quality-inspections/rejected-lots` | `GET /lots/rejected`와 같은 응답 | lot 모듈의 `/lots/:id`와 경로가 겹쳐 가려질 수 있어 둔 같은 내용의 경로. 경로 충돌이 정리되면 없애도 된다 |

## 응답 필드 (계획·실적)

| 이름 | 어디에 쓰는지 | 왜 필요한지 |
|---|---|---|
| `needsAction` | 계획 목록·상세, 목록 필터 | 생산 담당이 할 일이 남은 계획(편성 전 / 대기·작업 중 실적 있음)을 골라 보기 위해 |
| `progress[].totalCount·startedCount·completedCount` | 계획 목록·상세 | 공정별 진행 표시 |
| `shortageTon`, `weightTon`, `targetTon`, `heatTon`, `hotMetalTon` | 계획·LOT·미리보기 | 톤은 저장하지 않고 계산해 보여 주는 값 (`hotMetalTon`·`heatTon`은 mrp_run 컬럼 이름과 같다) |
| `slabSpec` | 계획 | 코일 계획이 연주에서 만들 슬래브 규격 (규격 매핑) |
| `targetQty` | 히트 미리보기 | 새로 생산할 매수 = 부족 매수 − 여재 사용 매수 (YieldCalculator의 이름) |
| `slabQtyPerHeat`, `expectedSurplusQty`, `steelmakingYieldRate`·`castingYieldRate`·`hotRollingYieldRate` | 히트 미리보기 | YieldCalculator 계산 결과 그대로 |
| `surplus.availableQty`·`maxUseQty`·`lots` | 히트 미리보기·재생산 미리보기 | 코일 계획에 쓸 수 있는 여재 슬래브 |
| `surplus.expectedQty`·`actualQty` | 계획 상세 | 예상 여재와 실제 여재 비교 |
| `rawMaterials[].requiredTon·remainingTon·shortageTon·isShort`, `hasRawShortage` | 히트 미리보기 | 편성 전에 원료 부족을 보이기 위해 (`requiredTon`·`remainingTon`은 mrp_requirement 컬럼 이름과 같다) |
| `isEligible` | LOT | 적격(자기 검사 + 상위 히트 합격 + 미소진) 여부 |
| `isEarmarked`, `earmarkedSlabs`, `earmarkedSlabQty` | LOT·계획 상세 | 귀속 슬래브(코일 수주의 열연 투입용으로 잡아 둔 슬래브) 표시. StockService의 `earmarkForRolling`과 같은 말 |
| `heatIsPassed`, `heatLotNo` | LOT | 상위 히트 성분 검사 결과와 번호 |
| `confirmedAllocationId`, `rollingAllocations`, `confirmedAllocationQty` | LOT·계획 상세 | 열연 배정 상태 |
| `rolling.rolledQty`·`remainingQty`·`rollingNeedQty` | 계획 상세 | 열연 진행과 남은 필요 매수 (`rollingNeedQty`는 StockService 함수 이름) |
| `remainingTargetQty`, `openPlanRemainingQty` | 계획 상세·재생산 미리보기 | 프로세스 정의서 4.5 "진행 계획 잔여 목표 매수" |
| `unsecuredQty`, `additionalQty`, `stockAvailableQty`, `planQty`, `reservedFromStockQty` | 재생산 | 4.5 "현재 미확보 매수"·"추가 계획 필요 매수", 재고 먼저 예약한 매수, 새 계획 목표 매수 |
| `defaultHotMetalTon` | 실적 | 제선 완료 입력의 용선량 기본값 (계획에 아직 필요한 용선) |
| `hotMetalTon`, `outputQty`, `allocationIds` (요청) | 실적 완료 입력 | 공정별 입력값. `blastFurnaceNo`·`converterNo`는 스키마 컬럼 이름 |

## 실적 시뮬레이션

| 이름 | 어디에 쓰는지 | 왜 필요한지 |
|---|---|---|
| `seed` | 요청·응답 | 재현 가능한 난수 시드 (BP-SEED-01) |
| `includeInspection`, `untilProcess` | 요청 | 검사 포함 여부, 어느 공정까지 진행할지 |
| `steps[].kind` = `RESULT` \| `INSPECTION` \| `ALLOCATION` | 응답 | 시뮬레이션이 한 일의 종류. 공통코드가 아니라 이 응답에서만 쓰는 값 |
| `notes` | 응답 | 건너뛴 일과 이유 |

## 품질

| 이름 | 어디에 쓰는지 | 왜 필요한지 |
|---|---|---|
| `inspectionName` | 검사 대기·검사 | 공정별 검사 이름 표시 (성분 검사·슬래브 검사·코일 검사) |
| `items` (`isRequired` 등은 inspection_item 컬럼 이름) | 검사 대기 | 측정할 항목과 기준 |
| `status=pending\|done` (쿼리) | 검사 목록 | 검사 대기 LOT과 등록된 검사를 나눠 조회 |
| `lotTypeName`, `inspectorEmployeeName` | 검사 | 화면 표시용 이름 |
| `rejectedBy` = `OWN` \| `HEAT` | 불합격 LOT | 자기 검사 불합격인지, 상위 히트 불합격 때문에 못 쓰는지 구분. 공통코드가 아니라 이 응답에서만 쓰는 값 |
| `failedInspection`, `failedItems` | 불합격 LOT | 불합격 근거 검사와 벗어난 항목 |
| `affectedSalesOrderItem`, `hasReproductionPlan`, `reproductionPlan` | 불합격 LOT | 영향받는 수주 품목과 재생산 계획 유무 |
| `reason` (요청) | 처리 상태 지정 | `lot.disposition_reason`에 저장 |

## 코드 (클래스·파일)

| 이름 | 어디에 쓰는지 |
|---|---|
| `ProductionPlanProgressService` | 계획 상태 전이(IN_PROGRESS·COMPLETED)와 잔여 목표 매수 계산. 품질 모듈도 검사 판정 뒤에 부른다 |
| `ProductionMaterialService` | 용선·원료·합금철 투입량 계산과 원료 LOT FIFO 차감 |
| `ProductionRepository`, `QualityRepository` | DB 접근 |
| `ResultSimulationService` | 실적 시뮬레이션 (프로세스 정의서 BP-PRD-02의 이름) |
| `RejectedLotService`, `RejectedLotController` | 불합격 LOT 조회·처리 상태 지정 |
| `judgeInspection`, `isWithinLimits`, `passingValue` (`inspection-judge.ts`) | 자동 판정과 시뮬레이션 합격값 |
| `seededRandom`, `sampleLossRate`, `lossQtyOf`, `distributeLoss` (`simulation-random.ts`) | 시드 난수와 연주 손실 계산 |

## 알림 dedupeKey

`INSPECTION_WAITING:<lotId>`, `REJECTED:<lotId>`, `ROLLING_READY:<planId>`, `PLAN_COMPLETED:<planId>`
