# master-data — 기준정보

> 근거 약어: [02] 요구사항 정의서 · [03] 용어 사전 · [04] 업무 프로세스 정의서 · [05] 코드 컨벤션 · [06] 공통 코드 정의서 · [ERD] `docs/erd/fantasteel_erp_p1.dbml` · [CSV] API 목록 · [권한표] 역할별 메뉴 (v2) 3장. 🟡 = 확인 필요.
> 경로는 컨트롤러에 쓰는 모양(전역 prefix `/api/v1` 제외). 스켈레톤은 `@Controller()`이므로 메서드마다 전체 경로를 쓴다.

## 1. 담당 범위

| 항목 | 내용 |
| --- | --- |
| REQ | REQ-MST-001~009 |
| BP | BP-MST-01 기준정보 준비([04] 6장), 4.1 이론중량, 13.1 `updateItem` |
| 등급 | P1 |
| 제외 | 검사 기준(`inspection_standard`)은 [04] BP-MST-01 입력 목록에 있지만 권한이 `INSPECTION_STANDARD_MANAGE`(품질)라 quality 모듈이 만든다([06] PERMISSION, [02] REQ-QC-002) |

## 2. 테이블

| 구분 | 테이블 | 핵심 규칙 ([ERD] Note·마이그레이션) |
| --- | --- | --- |
| 쓰기 | `item` | 원료·슬래브·코일 단일 테이블. CHECK `item_type_columns_check`: RAW_MATERIAL은 `unit_type=TON`·`raw_material_type` 필수·치수·이론중량·강종 null / SLAB·COIL은 `unit_type=QTY`·강종·치수·`theoretical_weight_ton` 필수. unique `(item_type, steel_grade_id, thickness_mm, width_mm, length_mm)`. `default_yard_id` not null, `default_supplier_id`는 원료만 |
| 쓰기 | `steel_grade` | `steel_grade_code` unique, `standard_no`(KS 번호, 밀시트 표시) |
| 쓰기 | `spec_mapping` | `slab_item_id` unique, `coil_item_id` unique(1:1). service: 코일 이론중량 ≤ 슬래브 이론중량. 열연 수율은 저장하지 않음 |
| 쓰기 | `routing` | unique `(item_type, sequence_no)`, `(item_type, process_type)`. 열연 `planned_yield_rate` = null |
| 쓰기 | `specific_consumption` | 부분 unique `specific_consumption_common_key`(강종 null이면 원료당 1행), `specific_consumption_grade_key`(원료·강종당 1행). service: `steel_grade_id`는 FERROALLOY 원료에만 |
| 쓰기 | `customer`, `supplier`, `yard` | 코드 unique. `yard_type` = YARD_TYPE |
| 쓰기 | `production_setting` | 1행만. `heat_capacity_ton`(초기 250, 용강 기준), `delivery_risk_days`(초기 3) |
| 읽기 | `sales_order_item`, `lot`, `inventory` | MST-002 판단(사용된 규격인지) |

시드: 강종 6, 원료 4(ORE01·COL01·LIM01·SMN01), 슬래브 12·코일 12와 매핑 12, 라우팅(SLAB 3행·COIL 4행), 배합 원단위 7행, 고객사·공급업체 4개씩, 야드 3, 생산 설정 1행. 수율·원단위·규격 치수 일부는 가정값(`seed.ts` 주석).

## 3. API

| Method | Path | 이름 | 권한 | 비고 ([CSV]) |
| --- | --- | --- | --- | --- |
| GET | `items` | 품목·규격 목록 | `MASTER_MANAGE` VIEW | 수주 등록 규격 선택에도 사용. 톤은 문자열 |
| POST | `items` | 품목·규격 등록 | `MASTER_MANAGE` USE | 조합 중복 금지, 참조 없으면 COM-003 |
| PATCH | `items/:id` | 품목·규격 수정 | `MASTER_MANAGE` USE | 사용된 규격 치수·이론중량 수정 시 MST-002. `expectedUpdatedAt`이 다르면 COM-001(이슈 #498, 아래 "동시 수정 방지") |
| GET | `steel-grades` | 강종 목록 | `MASTER_MANAGE` VIEW | |
| POST | `steel-grades` | 강종 등록 | `MASTER_MANAGE` USE | 성분 min/max는 제강 검사 기준에서 관리 |
| PATCH | `steel-grades/:id` | 강종 수정 | `MASTER_MANAGE` USE | API-280(2026-10-21 추가, 이슈 #477). 등록과 같은 칸을 모두 받는다. 이름·적용 규격 번호는 언제든, **코드는 쓰는 곳이 없을 때만**(COM-004). `expectedUpdatedAt`이 다르면 COM-001 |
| GET | `spec-mappings` | 규격 매핑 조회 | `MASTER_MANAGE` VIEW | |
| POST | `spec-mappings` | 규격 매핑 등록 | `MASTER_MANAGE` USE | 대응 코일 중복·중량 초과 차단 |
| PATCH | `spec-mappings/:id` | 규격 매핑 수정 | `MASTER_MANAGE` USE | API-281(2026-10-21 추가). 슬래브·코일 짝을 바꾼다(등록과 같은 검사, 자기 자신은 중복 아님). 쓰는 곳이 있으면 COM-004, `expectedUpdatedAt`이 다르면 COM-001 |
| DELETE | `spec-mappings/:id` | 규격 매핑 삭제 | `MASTER_MANAGE` USE | API-282(2026-10-21 추가). 쓰는 곳이 없을 때만. 지운 매핑을 돌려준다 |
| GET | `routings` | 라우팅 조회 | `MASTER_MANAGE` VIEW | |
| POST | `routings` | 라우팅 등록 | `MASTER_MANAGE` USE | 수율 0 이하·1 초과 차단 |
| PATCH | `routings/:id` | 라우팅 수정 | `MASTER_MANAGE` USE | `expectedUpdatedAt`이 다르면 COM-001 |
| GET·POST | `specific-consumptions` | 배합 원단위 조회·등록 | VIEW / USE | |
| PATCH | `specific-consumptions/:id` | 배합 원단위 수정 | `MASTER_MANAGE` USE | |
| GET·POST | `customers` · PATCH `customers/:id` | 고객사 | VIEW / USE | PATCH는 `expectedUpdatedAt`이 다르면 COM-001 |
| GET·POST | `suppliers` · PATCH `suppliers/:id` | 공급업체 | VIEW / USE | 품목별 기본 공급업체는 품목 수정에서 지정. PATCH는 `expectedUpdatedAt`이 다르면 COM-001 |
| GET·POST | `yards` · PATCH `yards/:id` | 야드 | VIEW / USE | YARD_TYPE. PATCH는 `expectedUpdatedAt`이 다르면 COM-001 |
| GET | `production-settings` | 생산 설정값 조회 | `MASTER_MANAGE` VIEW | 단건 리소스라 `:id` 없음 |
| PATCH | `production-settings` | 생산 설정값 변경 | `MASTER_MANAGE` USE | `expectedUpdatedAt`이 다르면 COM-001 |
| DELETE | `customers/:id` · `suppliers/:id` · `yards/:id` · `steel-grades/:id` · `items/:id` | 기준정보 삭제 | `MASTER_MANAGE` USE | API-275~279(2026-10-14 명세서에 추가). SPEC 5장 결정 4·[05] 7-2 "참조가 없을 때만 삭제". 아래 4장 |

[권한표]: 관리자 USE, 나머지 역할은 모두 VIEW(2026-10-15 업무 조회는 모든 역할, 그 전에는 물류에 권한이 없었다). 관리자가 기준정보 조회 권한을 뺀 사원도 품목명을 보도록 출하 화면에 필요한 품목 값은 shipment 모듈 응답에 넣어 준다.

## 4. 업무 규칙·계산

- **이론중량**([04] 4.1, REQ-MST-003): `1매 이론중량(t) = 두께(mm) × 폭(mm) × 길이(mm) × 7.85 / 10^9` → 소수 3자리 확정값. 서버가 `calcTheoreticalWeightTon(t, w, l)`(`@fantasteel/shared`)로 계산해 저장하고, 요청으로 받지 않는다. 예: 250 × 1,200 × 10,000 → `23.550`.
- **품목 코드**(REQ-MST-001·003): 원료는 영문 3자 + 숫자 2자리(예: `ORE01`). 규격은 `SL|CL-강종-두께x폭x길이`(예: `SL-SS275-250x1500x10000`). 시드는 치수 끝의 `.00`을 떼고 만든다(`seed.ts` `specCode`).
- `unit_type`은 `item_type`에서 정한다(원료 TON, 제품 QTY). 단위 혼동을 막으려고 요청으로 받지 않는 것을 권장.
- **사용된 규격 수정 금지**(MST-002, [04] 13.1): 치수·이론중량을 바꾸는 PATCH에서 그 품목을 참조하는 `sales_order_item`·`lot`(또는 재고)가 있으면 `MST-002`. 아직 안 쓰인 규격은 수정을 허용하고 이론중량을 다시 계산한다(오타 수정, BP-MST-01).
- **규격 매핑**(REQ-MST-004): `slab_item`은 SLAB, `coil_item`은 COIL, 코일 이론중량 ≤ 슬래브 이론중량. `열연 계획 수율 = 코일 1개 이론중량 ÷ 대응 슬래브 1매 이론중량`(저장하지 않음, 응답에 계산값으로 줄 수 있다).
- **라우팅**(REQ-MST-005): 0 < 수율 ≤ 1. 열연은 null. 공정 순서는 DB에서 읽고 코드에 강종·규격별 경로를 고정하지 않는다(BP-MST-01).
- **배합 원단위**(REQ-MST-006): 철광석·석탄·석회석 = 용선 1t당 t(강종 null), 합금철 = 용강 1t당 kg(강종별). `steel_grade_id`는 `raw_material_type = FERROALLOY`일 때만.
- **기본 야드·공급업체**(REQ-MST-007·008): LOT 생성 시 `default_yard_id`를 자동 지정한다(production·purchasing이 읽음). 원료는 기본 공급업체 1곳.
- **생산 설정값**(REQ-MST-009): 1행만 두고 PATCH로 바꾼다. `heat_capacity_ton > 0`.
- **동시 수정 방지**(이슈 #498): 강종·규격 매핑(API-280·281)과 같은 방식으로 품목·라우팅·고객사·공급업체·야드·생산 설정값의 조회 응답에도 `updatedAt`(ISO 8601)을 주고, 수정 요청이 `expectedUpdatedAt`(선택)을 보내면 그 시각 그대로일 때만 바꾼다(`updateMany`의 `where updatedAt`, 한 문장이라 그 사이 다른 저장과 겹치지 않는다). 다르면 `COM-001`이고 아무것도 바꾸지 않는다. 보내지 않으면 비교하지 않는다(마지막 저장이 이긴다). 배합 원단위는 화면이 가진 시각이 없어 이번에 하지 않았다.
- 0 이하 중량, 0 이하·1 초과 수율, 대응 코일 중복, 기본 공급업체 누락, 검사 기준 누락을 표시한다(BP-MST-01 구현 제안 → "기준정보 준비 상태"로 응답 가능).
- **삭제**([05] 7-2, SPEC 5장 결정 4 "사용 안 함 토글 대신 삭제만, 참조가 있으면 거부"): 쓰는 곳이 하나라도 있으면 `COM-004` "쓰는 곳이 있어 삭제할 수 없어요: 수주·출하요청"처럼 쓰는 곳 이름을 붙여 거부한다(조직의 부서·직급 삭제와 같은 방식). 쓰는 곳은 고객사 = 수주·출하요청, 공급업체 = 원료 기본 공급업체·발주, 야드 = 품목 기본 야드·LOT, 강종 = 품목·배합 원단위·검사 기준·LOT, 품목 = 규격 매핑·배합 원단위·수주·재고(수량 > 0)·예약·생산계획·LOT·구매요청·발주. 수량이 모두 0인 재고 행은 품목과 함께 지운다. 지운 행을 응답으로 돌려준다. 라우팅·배합 원단위 삭제는 아직 없다(진행 중 계획 기준을 정한 뒤).
- **강종 수정**(API-280, REQ-MST-002): 이름·적용 규격 번호는 언제든 고친다. 코드는 규격 코드(`SL-코드-…`)와 품목명에 쓰이고 검사 기준·LOT·배합 원단위가 가리키므로, 쓰는 곳(품목·배합 원단위·검사 기준·LOT)이 하나라도 있으면 바꿀 수 없다 — `COM-004` "쓰는 곳이 있어 강종 코드는 바꿀 수 없어요: 품목·…". 쓰는 곳이 없으면 코드도 바꾸되 다른 강종의 코드와 겹치면 COM-004. 읽은 뒤 아무도 고치지 않았을 때(`updated_at`이 같을 때)만 바꾸고 아니면 COM-001. 강종 응답의 `codeLockedBy`(쓰는 곳 이름 목록)로 화면도 같은 기준으로 코드 칸을 잠근다. 수정하면 서버 로그에 바꾼 값을 남긴다(8장).
- **규격 매핑 수정·삭제**(API-281·282, REQ-MST-004): 매핑을 바꾸거나 지우면 열연 계획 수율(코일 ÷ 슬래브)이 달라지므로 두 규격(슬래브·코일) 중 하나라도 수주·재고(수량 > 0)·예약·생산계획·LOT에 쓰이면 `COM-004` "쓰는 곳이 있어 매핑을 바꿀/지울 수 없어요: 수주·…"로 막는다. 수정은 등록과 같은 검사(슬래브·코일 유형, 같은 강종, 대응 중복 금지, 코일 ≤ 슬래브)를 새 짝에 다시 하고, 읽은 뒤 바뀌었으면 COM-001(`expectedUpdatedAt`).
- 응답: Decimal은 문자열. Prisma Decimal의 `toString()`은 뒤쪽 0을 뺄 수 있으므로(`23.550` → `"23.55"`) 톤은 매퍼에서 `toFixed(3)`으로 맞추는 것을 권장.

## 5. 오류 코드·작업 로그

| 코드 | 언제 |
| --- | --- |
| MST-002 | 사용된 규격의 치수·이론중량 수정 |
| MST-001 | (이 모듈이 던지지는 않음) production·mrp가 수율·배합·매핑 누락 시 사용 |
| COM-003 | `steelGradeId`·`defaultYardId`·`defaultSupplierId`·매핑 품목이 없음 |
| COM-004 | DTO 검증 실패, 쓰는 곳이 있는 기준정보 삭제 |
| COM-001 | 코드·규격 조합 중복 → P2002 변환 🟡 |

작업 로그: 없음. BUSINESS_EVENT_TYPE([06])에 기준정보 이벤트가 없다.

## 6. 다른 모듈과의 경계

모든 업무 모듈이 기준정보를 읽는다. `MasterDataService`를 export하고(`exports: [MasterDataService]`) 아래 조회 함수를 `tx` 첫 인자로 제공하는 것을 권장한다.

| 쓰는 모듈 | 필요한 것 |
| --- | --- |
| sales-order | 품목이 SLAB·COIL인지(아니면 SO-001), 이론중량 |
| production·mrp | 라우팅 수율, 규격 매핑(열연 수율), 배합 원단위, 히트 용량 |
| purchasing | 원료 품목, 기본 공급업체, 기본 야드(원료 LOT) |
| production | 제품 기본 야드(슬래브·코일 LOT) |
| quality | 제품 두께(검사 항목 두께 구간), 강종 |
| inventory | 제품 품목 목록(재고 행) |

`inventory` 행: 시드가 재고 행을 만들지 않는다(거래 데이터 없음). 제품 품목을 등록할 때 같은 트랜잭션에서 `inventory`(0, 0, 0) 행을 만들지, inventory 모듈이 필요할 때 upsert할지 정해야 한다 🟡(inventory.md 8장).

## 7. 테스트

[05] 11장: **이론중량 계산은 서버 단위 테스트 필수**(`shared/src/weight.ts` 함수 + 품목 등록 경로). [04] 14.3 관련 행:

| 검증 | 기대 결과 |
| --- | --- |
| 250 × 1,200 × 10,000mm 규격 등록 | `theoreticalWeightTon = "23.550"` |
| 사용된 규격의 치수 수정 | 거부, MST-002, 새 규격 추가 안내 (REQ-MST-003) |
| 코일 규격 중량이 슬래브보다 큼 | 매핑 등록 거부 (REQ-MST-004) |
| 같은 강종·두께·폭·길이 재등록 | 거부 |
| 쓰는 곳이 있는 기준정보 삭제 | 거부, COM-004와 쓰는 곳 이름. 쓰는 곳이 없으면 삭제 ([05] 7-2) |
| 강종 수정 | 이름·적용 규격 번호는 언제든, 코드는 쓰는 곳이 없을 때만. 불러온 뒤 바뀌었으면 COM-001 |
| 규격 매핑 수정·삭제 | 새 짝도 등록과 같은 검사, 두 규격 중 하나라도 수주 등에 쓰이면 COM-004와 쓰는 곳 이름 |

실행: `npm test -w @fantasteel/server -- master-data`(묶음 DB `fs_master`).

## 8. 확인 필요 🟡

| 항목 | 내용 | 근거 |
| --- | --- | --- |
| 오류 코드 | 매핑 중량 초과, 수율 범위, 규격 중복, FERROALLOY 외 강종 원단위에 쓸 코드가 9.3에 없다. MST-001은 "누락"이다 | [04] 9.3, 14.3 |
| "재고에 사용된 규격" | 재고 행 존재로 볼지, 수량 > 0으로 볼지 정해야 한다(재고 행을 미리 만들면 모든 규격이 "사용됨"이 된다) | [02] REQ-MST-003, [04] 13.1 |
| 매핑 수정·삭제 | ~~[CSV]에 GET·POST만 있어 잘못 등록한 매핑을 고칠 방법이 없다~~ → 2026-10-21 API-281·282로 추가(8-1) | [CSV] |
| 강종 수정 | ~~[CSV]에 PATCH가 없다~~ → 2026-10-21 API-280으로 추가(8-1) | [CSV] |
| 강종 적용 규격 번호 수정의 효과 | 검사 기준 상세(`quality/inspection-standard.service.ts`)가 `steel_grade.standard_no`를 그때그때 읽어 보여서, 번호를 고치면 이미 검사가 있는 옛 버전 검사 기준에도 새 번호가 보인다. 밀시트는 출고 확정 때 번호를 스냅샷으로 저장해 그대로다. 기준정보 수정(강종 포함)에는 맞는 작업 로그 유형이 없어(정의서 BUSINESS_EVENT_TYPE에 기준정보 이벤트 없음) 서버 로그(Nest `Logger`)에 누가 무엇을 바꿨는지(`강종 수정 코드 (사원 id): 이름 a → b …`)만 남긴다. 검사 기준 버전마다 적용 규격 번호를 따로 두거나 수정 작업 로그 유형을 정하려면 정의서·ERD 결정이 필요하다 | 이슈 #477 |
| 매핑 강종 일치 | 슬래브·코일 규격의 강종이 같아야 한다는 규칙은 문서에 명시돼 있지 않다 | [02] REQ-MST-004 |
| 제선 수율 | 시드는 IRONMAKING 수율을 null로 둔다. 4.4 계산식은 제강·연주·열연 수율만 쓴다. 라우팅 검증에서 null 허용 공정을 열연·제선 둘로 볼지 확인 | `seed.ts` ROUTINGS, [04] 4.4 |
| 기본 야드 유형 | 품목 유형과 야드 유형(RAW_MATERIAL·SLAB·COIL)이 같아야 하는지 규칙이 없다 | [02] REQ-MST-008 |
| 삭제 API | [05] 7-2는 "참조가 없을 때만 삭제"를 허용하지만 [CSV]에 DELETE가 없었다. 2026-10-14 사용자 결정으로 [CSV]에 API-275~279를 더하고 고객사·공급업체·야드·강종·품목만 만들었다(4장). 규격 매핑·라우팅·배합 원단위는 FK 참조가 없어 "진행 중 계획이 쓰는지" 기준을 정해야 한다 | [05] 7-2, [CSV], SPEC 5장 |

### 8-1. 임시 결정 (2026-10-07, 서버 API 구현)

위 🟡 중 구현에 필요한 것을 아래처럼 임시로 정했다. 문서가 정해지면 바꾼다.

| 항목 | 임시 결정 |
| --- | --- |
| 오류 코드 | 9.3에 코드가 없는 거부(매핑 중량 초과, 수율 범위, FERROALLOY 외 강종 원단위, 코드·규격 중복, 야드 유형 불일치, 매핑 강종 불일치)는 `COM-004`에 구체 문구를 붙인다. 중복은 서비스가 먼저 확인하고, 동시 등록으로 생기는 P2002는 전역 필터대로 `COM-001` |
| "재고에 사용된 규격" | `sales_order_item` 또는 `lot`이 있거나 `inventory`의 `on_hand_qty`·`reserved_qty`가 0보다 크면 사용됨. 재고 행은 inventory 모듈이 필요할 때 upsert하므로 행이 있다는 것만으로는 보지 않는다 |
| MST-002 범위 | 치수와 함께 **강종** 변경도 막는다(규격 코드가 바뀐다). 기본 야드는 쓰인 규격도 바꿀 수 있다 |
| 매핑 수정·삭제, 강종 수정 | 2026-10-21(이슈 #477)에 추가: 강종 수정 API-280, 규격 매핑 수정·삭제 API-281·282. 쓰는 곳 기준은 4장 (지난 수주·LOT도 쓰는 곳으로 센다: 이력이 그 규격을 가리켜서). 기준정보 삭제는 2026-10-14에 일부 만들었다(8장 "삭제 API") |
| 매핑 강종 일치 | 슬래브·코일 규격의 강종이 같아야 매핑한다. 매핑된 규격의 강종·치수를 고칠 때도 같은 강종·코일 ≤ 슬래브를 다시 확인한다 |
| 제선 수율 | 열연·제선 모두 계획 수율 null을 허용한다 |
| 기본 야드 유형 | 품목 유형과 같은 유형의 야드만 기본 야드로 지정한다 |
| 재고 행 생성 | 품목 등록 때 `inventory` 행을 만들지 않는다(inventory 모듈이 upsert) |
| 강종 적용 규격 번호 | ERD가 not null이라 등록 때 필수 |
| 품목 수정 범위 | 원료: 이름·기본 야드·기본 공급업체(null이면 비움). 규격: 강종·치수·기본 야드(규격 코드·품목명·이론중량은 서버가 다시 만든다). 품목 유형·원료 코드·원료 유형은 바꾸지 않는다 |
