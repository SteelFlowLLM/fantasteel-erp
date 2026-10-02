# quality — 검사 기준·검사·자동 판정·불합격 처리

> 근거 약어: [02] 요구사항 정의서 · [03] 용어 사전 · [04] 업무 프로세스 정의서 · [05] 코드 컨벤션 · [06] 공통 코드 정의서 · [07] KS 규격 정리 · [ERD] `docs/erd/fantasteel_erp_p1.dbml` · [CSV] API 목록 · [권한표] 역할별 메뉴 (v2) 3장. 🟡 = 확인 필요.
> 경로는 컨트롤러에 쓰는 모양(전역 prefix `/api/v1` 제외). 스켈레톤은 `@Controller()`이므로 메서드마다 전체 경로를 쓴다.

## 1. 담당 범위

| 항목 | 내용 |
| --- | --- |
| REQ | REQ-QC-001~004. 판정 결과로 REQ-INV-003·004·007(적격·자동 예약·불합격 제외)을 일으킨다. REQ-SHP-003 이후 측정값 수정 차단 |
| BP | BP-QC-01 검사·판정·불합격 처리·재생산([04] 6장). 재생산 계획 생성은 production 모듈 |
| 등급 | P1 (과거 사례 등록 REQ-CASE-002는 EX, 만들지 않음) |

## 2. 테이블

| 구분 | 테이블 | 핵심 규칙 |
| --- | --- | --- |
| 쓰기 | `inspection_standard` | `inspection_standard_code`(예: QS-SM355A-HR) + `version_no` unique, `process_type`, `steel_grade_id`. **수정하지 않고 새 버전으로 추가**. 제강 기준의 항목이 강종 성분 규격(TRM-020) |
| 쓰기 | `inspection_standard_item` | `inspection_item_code`(C·SI·MN·YIELD_STRENGTH·CHARPY 등), `unit`, `min_value`(이상)·`max_value`(이하, **경계 포함**), `thickness_over_mm`(초과)·`thickness_upto_mm`(이하), `is_required`(누락 시 PENDING) |
| 쓰기 | `quality_inspection` | `lot_id` **unique(LOT당 1건)**, `inspection_standard_id`(판정에 쓴 버전), `inspection_result`(PENDING·PASS·FAIL), `inspector_employee_id`, `inspected_at` |
| 쓰기 | `quality_inspection_value` | `(quality_inspection_id, inspection_standard_item_id)` unique, `measured_value`. 보완·오타 수정은 같은 행 수정, 전·후는 작업 로그 |
| 쓰기 | `lot` | `disposition_status`(DISPOSITION_STATUS)·`disposition_reason`만 |
| 읽기 | `lot`, `lot_relation`, `item`(두께·강종), `steel_grade`, `allocation`, `shipment_request_item`, `mill_sheet` | 대상·적격·밀시트 발행 여부 |

시드 검사 기준(버전 1, 14개): 제강 `QS-{강종}-ST` 6종(SM355C·D 포함), 연주 `QS-{강종}-CC` 4종(SS275·SM355A·SM355B·SPHC), 열연 `QS-{강종}-HR` 4종. 연주 표면·치수 값은 KS에 없어 가정값이다([07] 6장, `seed.ts` 주석). 시드의 모든 항목은 `is_required = true`이고 같은 항목 코드가 두께 구간별로 여러 행 있다(항복강도·연신율·두께 허용차).

## 3. API

| Method | Path | 이름 | 권한 | 비고 ([CSV]) |
| --- | --- | --- | --- | --- |
| GET | `inspection-standards` | 검사 기준 목록 | `INSPECTION_STANDARD_MANAGE` VIEW | |
| POST | `inspection-standards` | 검사 기준 등록(새 버전) | `INSPECTION_STANDARD_MANAGE` USE | 수정하지 않고 새 버전으로 추가 |
| GET | `quality-inspections` | 검사 목록 | `INSPECTION_REGISTER` VIEW | 판정 필터로 불합격 관리 목록에도 사용 |
| POST | `quality-inspections` | 검사 등록·자동 판정 | `INSPECTION_REGISTER` USE | LOT당 1건, 기준 버전 참조, 필수값 누락은 PENDING |
| PATCH | `quality-inspections/:id` | 검사 측정값 수정 | `INSPECTION_REGISTER` USE | |
| POST | `lots/:id/disposition` | 불합격 처리 상태 지정 | `DISPOSITION_SET` USE | 값은 DISPOSITION_STATUS |

다른 초안 행(`/api/v1`, 긴 비고): `GET quality-inspections/:id`, `GET inspection-standards/:id`, `POST inspection-standards/:id/versions`(새 버전), `GET lots/rejected`(권한 DISPOSITION_SET 또는 INSPECTION_REGISTER VIEW, 대안 경로 `quality-inspections/rejected-lots`). "또는" 권한은 service에서 `hasPermission`으로 확인한다.
[권한표]: 품질 USE(3종), 생산은 INSPECTION_REGISTER·INSPECTION_STANDARD_MANAGE VIEW, 관리자 VIEW.

## 4. 업무 규칙·판정

**기준 고르기**: LOT 유형 → 공정(HEAT → STEELMAKING, SLAB → CONTINUOUS_CASTING, COIL → HOT_ROLLING, REQ-QC-001). 강종은 히트 `lot.steel_grade_id`, 슬래브·코일 `item.steel_grade_id`. 그 공정·강종의 **최신 버전**을 쓰고 `inspection_standard_id`에 남긴다(REQ-QC-002).

**적용 항목**: 두께 구간이 있는 항목은 제품 두께가 `thickness_over_mm 초과 ~ thickness_upto_mm 이하`일 때만 적용(빈 쪽은 열린 구간, [07] 8장 "16–40 = 16 초과 40 이하"). 샤르피 충격은 두께 6mm 초과 제품만(REQ-QC-002). 히트는 두께가 없으므로 구간 없는 항목만 적용된다(시드 SM355 Ceq는 50mm 이하 값).

**자동 판정**(REQ-QC-003, [04] 10장)

```
적용되는 필수 항목 중 측정값이 없음        → PENDING (항목·기준 누락은 합격 처리하지 않음)
측정값 < min 또는 측정값 > max (경계 포함)  → FAIL
그 밖                                     → PASS
```

판정 결과가 바로 결과다(제안 단계 없음, TRM-076). min/max·측정값 비교는 Decimal로 한다.

**판정 뒤 재고 반영**(REQ-INV-003·004·007, BP-QC-01): 같은 tx에서 inventory 서비스 `onLotsEligibilityChanged(tx, lotIds, actor)`를 부른다.
- 슬래브·코일 PASS + 상위 히트 PASS → 적격이 됨(`on_hand +1`) → 원래 수주 품목의 미확보 매수 안에서 자동 예약(SYSTEM).
- 히트 PASS → 이미 PASS인 하위 슬래브·코일이 함께 적격이 됨.
- 히트 FAIL·적격 LOT이 FAIL로 바뀜 → 하위 LOT을 적격 집계에서 빼고, 배정은 RELEASED, 초과 예약 축소([ERD] inventory 갱신 규칙). 이후 출고·투입 차단.

**측정값 수정**(PATCH): 같은 검사 행·값 행을 수정하고 변경 전·후를 작업 로그에 남긴다. 그 LOT(히트면 하위 제품)이 출고돼 **밀시트가 발행된 뒤에는 수정 차단**([ERD] quality_inspection Note). 판정이 바뀌면 위 재고 반영을 다시 한다.

**불합격 처리 상태**(REQ-QC-004): 불합격 LOT(자기 FAIL 또는 불합격 히트의 하위, TRM-078)에만 HOLD·DOWNGRADED·SCRAPPED 중 하나와 사유를 기록한다. 판정 때는 값 없이 둔다. **재고·예약·배정은 바꾸지 않는다**(후속 로직 없음, 불합격 LOT은 이미 제외돼 있음).

**검사 기준 새 버전**: 기존 기준·항목을 수정·삭제하지 않고 `version_no + 1`로 새 행을 만든다([05] 7-2). 기존 검사 기록은 당시 버전을 유지한다([07] 5장). 항목은 KS 인증심사기준 참고(화학성분·인장·항복·연신율, SM 계열은 탄소당량·샤르피), 무게 검사는 제외.

## 5. 오류 코드·작업 로그

| 코드 | 언제 |
| --- | --- |
| COM-003 | LOT·검사·기준 없음 |
| COM-004 | DTO 검증 실패 |
| COM-001 | 같은 LOT 두 번째 검사 등록(`lot_id` unique, P2002) 🟡 |
| MST-001 | 그 공정·강종의 검사 기준이 없음(🟡 PENDING으로 둘지 거부할지) |

| 이벤트 | actor | target | salesOrderId | lotIds | 비고 |
| --- | --- | --- | --- | --- | --- |
| INSPECTION_REGISTERED | USER(검사 입력자) | `quality_inspection` | LOT의 계획이 수주에 연결돼 있으면 | 검사 LOT | `after`에 판정. 불합격 판정은 이 이벤트의 판정 결과로 구분([06]) |
| DISPOSITION_SET | USER | `lot` | 〃 | 해당 LOT | `reason` = 사유 |
| RESERVATION_CREATED(자동 예약) | SYSTEM | `reservation` | 채움 | 해당 LOT | inventory가 기록 |
| ALLOCATION_RELEASED·RESERVATION_RELEASED(불합격) | SYSTEM | | | | inventory가 기록, 사유 QUALITY_FAILURE |

## 6. 다른 모듈과의 경계

| 방향 | 상대 | 내용 |
| --- | --- | --- |
| 호출 | inventory | `onLotsEligibilityChanged(tx, lotIds, actor)` — 판정·수정 tx 안에서 |
| 호출 | lot(또는 공용) | 적격 계산 쿼리, 하위 LOT 찾기(`lot_relation`) |
| 읽힘 | shipment | 밀시트 스냅샷에 히트 성분·슬래브·코일 검사값과 기준을 복사 |
| 읽힘 | production(재생산) | 합격 매수 부족 판단 |

## 7. 테스트

[04] 14.3 관련 행:

| 검증 | 기대 결과 |
| --- | --- |
| 미합격 히트 하위 제품 | 예약·배정·출고 차단 (INV-003·007, SHP-002) |
| 합격 생산분 | 원래 수주 부족분만 자동 예약 (INV-004) |
| 불합격 처리 상태 지정 | 상태·사유 기록, 재고 처리 없음 (QC-004) |
| 경계값 | min·max와 같은 값은 PASS |
| 두께 구간 | 16.00mm는 "16 이하" 구간, 16.01mm는 "16 초과 40 이하" 구간 |
| 필수 측정값 누락 | PENDING, 자동 예약 없음 |
| 코일 9mm SM355A | 샤르피 적용, 4.5mm는 미적용 |
| 밀시트 발행 후 측정값 수정 | 차단 |

실행: `npm test -w @fantasteel/server -- quality`(묶음 DB `fs_prod`).

## 8. 확인 필요 🟡

| 항목 | 내용 | 근거 |
| --- | --- | --- |
| 처리 상태 개수 | 불합격 관리 화면 명세는 6개, REQ-QC-004·[06]은 3개(보류·격하·폐기). [06]을 따른다 | [CSV] 불합격 처리 상태 지정 비고 |
| 검사 기준 API 모양 | v1 행은 `POST inspection-standards`(새 버전), 초안 행은 `POST inspection-standards/:id/versions`와 상세 GET. 하나로 정해야 한다 | [CSV] |
| 수정 후 재판정 범위 | 측정값 수정 뒤 재판정·재고 반영 범위를 확정해야 한다 | [CSV] 측정값 보완 비고 |
| 오류 코드 | 밀시트 발행 후 수정 차단, 불합격이 아닌 LOT에 처리 상태 지정, 두 번째 검사 등록에 쓸 코드가 없다 | [04] 9.3 |
| 판정 우선순위 | 필수 값 누락과 범위 이탈이 함께 있으면 PENDING인지 FAIL인지 | [04] BP-QC-01, 10장 |
| 자동 판정의 주체 | [06] ACTOR_TYPE은 자동 판정을 SYSTEM 예로 들지만 INSPECTION_REGISTERED 한 이벤트에 입력(USER)과 판정이 같이 있다 | [06] ACTOR_TYPE·BUSINESS_EVENT_TYPE |
| 탄소당량 | Ceq는 계산식(C + Mn/6 + …)이 있는데 시드는 측정값 항목(CEQ)으로 둔다. 입력할지 계산할지 | [07] 8-1, `seed.ts` |
| SM355 Ceq 두께 | 히트 판정에 50mm 이하 값만 쓴다(제품 두께를 모름) | `seed.ts` 주석, [07] 8-1 |
| 연주 검사 기준 | 슬래브 표면·치수 min/max는 사내 가정값 | [07] 10장, `SPEC.md` 6장 |
| 히트 미판정 연주 | 진행은 허용, 미합격 하위 제품 사용 차단(16장 제안) | [04] 16장 |
| `/lots/rejected` 경로 | lot 모듈의 `GET lots/:id`와 충돌 가능(lot.md 8장) | `app.module.ts` |
| 측정값 수정 이벤트 | 수정 전용 이벤트 유형이 없다. INSPECTION_REGISTERED에 before/after로 남길지 확인 | [06] BUSINESS_EVENT_TYPE |
