# 확인이 필요한 이름 — master-data (Claude가 지은 것)

용어 사전과 업무 프로세스 정의서 11·12장 어디에도 없어 새로 지은 이름이다. 완성 후 검토해서 용어 사전에 추가하거나 바꾼다. 테이블·컬럼·공통코드는 새로 만들지 않았다 (스키마는 그대로).

## API 응답 필드
| 이름 | 어디에 쓰는지 | 왜 필요한가 |
|---|---|---|
| `hotRollingPlannedYieldRate` | 제품 규격·규격 매핑 응답 | 열연 계획 수율(코일 ÷ 슬래브)을 저장하지 않고 계산해 주는 값. 용어 사전의 `plannedYieldRate`에 "열연"을 붙여 저장값(라우팅)과 구분했다 |
| `isUsed` | 제품 규격·규격 매핑 응답 | "수주·재고·LOT가 참조하는 규격인가" (REQ-MST-003). 화면이 치수 입력을 잠그는 데 쓴다 |
| `mappedSpec` / `mappedSpecId` / `mappingId` | 제품 규격 응답 / lookups | 슬래브면 대응 코일 규격, 코일이면 대응 슬래브 규격. `spec_mapping`(용어 사전 `specMapping`)의 반대편 규격 |
| `yieldSource` (`INPUT` \| `MAPPING`) | 라우팅 공정 응답 | 계획 수율이 입력값인지(제강·연주) 규격 매핑에서 계산되는지(열연) 화면에 알려 준다 (REQ-MST-005) |
| `itemTypeName` · `rawMaterialTypeName` · `processName` · `consumptionUnitName` | 각 응답 | 공통코드의 한글 표시명 (shared `*_LABEL`)을 서버가 같이 내려 준다. 화면이 라벨 표를 따로 들지 않아도 된다 |
| `onHandTon` (원료 응답) | 원료 상세 | 원료 재고 톤(읽기 전용). 기준정보 화면에서 재고를 함께 보기 위해 |
| `area` (`MasterArea`) | `GET /master-data/validation` | 문제가 있는 기준정보 탭(`PRODUCT_SPEC`, `SPEC_MAPPING`, `ROUTING`, `SPECIFIC_CONSUMPTION`, `RAW_MATERIAL`, `STEEL_GRADE`, `INSPECTION_ITEM`, `PRODUCTION_SETTING`). 값은 이 모듈 안에서만 쓰는 분류라 shared 공통코드에 넣지 않았다 |
| `removeElementCodes` | `PATCH /steel-grades/:id/composition-specs` | 성분 규격 부분 수정에서 삭제할 성분 기호 목록 |

## API 경로
| 이름 | 쓰임 | 왜 필요한가 |
|---|---|---|
| `GET /master-data/lookups` | 수주·생산·구매 화면의 선택 목록 (로그인한 모든 사원) | 기준정보 관리 권한이 없는 역할도 규격·고객사를 골라야 한다 |
| `GET /master-data/validation` | 기준정보 준비 상태 점검 (`MST-001`) | BP-MST-01 "누락 표시" |
| `POST /product-specs/:id/activate` · `deactivate` | 규격 사용/사용 중지 | 규격은 삭제하지 않는다 (참조 무결성). 상태 변경은 `POST /:id/동작` 규칙 |
| `PUT /routings/:itemType` · `PATCH /routings/processes/:id` | 라우팅 순서·수율 저장 | 공정 변경을 데이터 수정으로 반영 (REQ-MST-005) |
| `PUT /specific-consumptions` | 배합 원단위 upsert | 원료 × 강종 조합당 값 1개 |

## 코드·클래스 (서버 내부)
| 이름 | 쓰임 | 왜 필요한가 |
|---|---|---|
| `MasterChangeRecorder` | 기준정보 변경 → 작업 로그 `MASTER_CHANGED` + `realtime.changed('master-data')` | 모든 변경 서비스가 같은 방식으로 기록하게 |
| `computeSpecWeight` · `buildSpecCode` · `assertMappable` (`product-spec.rules.ts`) | 이론중량 계산·규격 코드·매핑 규칙 | 단위 테스트가 가능한 순수 규칙 |
| `evaluateReadiness` · `ReadinessSnapshot` (`readiness.rules.ts`) | `validation` 계산 | 같은 이유 |
| `LookupService` · `ValidationService` | lookups·validation | — |

## 규격 코드 형식
`SL-<강종>-<두께>x<폭>x<길이>` (슬래브), `CL-…` (코일). 시드가 쓰는 형식(`SL-SS275-250x1200x10000`, `CL-SS275-4.5x1200x542000`)을 그대로 따른다. 서버가 만들고 치수를 고치면 다시 만든다.
