# 확인이 필요한 이름 — 공통·스키마 (Claude가 지은 것)

용어 사전과 업무 프로세스 정의서 11·12장 어디에도 없어 새로 지은 이름이다. 완성 후 검토해서 용어 사전에 추가하거나 바꾼다.

## 테이블
| 이름 | 쓰임 | 왜 필요한가 |
|---|---|---|
| `role_permission` (`permission_code`, `permission_level`) | 역할별 기능 권한(USE/VIEW) | REQ-AUTH-003. 문서에는 `employee_role`만 제안돼 있고 권한 저장 구조가 없다 |
| `purchase_requisition_item`, `purchase_order_item` | 구매요청·발주의 품목 행 | 문서에 "각 `_item`"으로만 언급 |
| `shipment_request_item` | 출하요청 품목 (배정 대기 상태를 가짐) | REQ-INV-006 "배정 대기는 출하요청 품목의 미배정 상태" |
| `goods_issue_item` | 출고한 LOT 1개 = 1행 | 출고 품목 (BP-LOT-01에 "출고 품목"으로 언급) |
| `quality_inspection_value` | 검사 1건의 항목별 측정값·판정 기준 | 검사 시점의 min/max를 같이 남기기 위해 |
| `chat_room_member` (`last_read_message_id`) | 채팅방 멤버와 읽음 위치 | 문서에 "읽음 위치"로만 언급 |
| `dashboard_widget_layout` | 사원별 위젯 위치·크기 | SPEC 5-3 |
| `number_sequence` (`sequence_key`, `last_value`) | 업무번호·LOT 채번 카운터 | BP 9.2 "DB 카운터로 채번" |
| `idempotency_key` (`request_key`) | 변경 요청 고유키 | BP 12.2 "요청 고유키" |

## 컬럼 (용어 사전·프로세스 정의서에 없는 것)
| 테이블.컬럼 | 쓰임 |
|---|---|
| `employee.employee_no` | 사원번호(로그인 ID). 용어 사전은 사원을 `employee_id`로 적었지만 PK와 구분하려고 분리 |
| `employee.password_hash`, `employee_status`, `failed_login_count`, `last_login_at` | 로그인 |
| `department.department_code`, `department_name`, `sort_order` | 부서 |
| `item.item_name`, `item_type`, `default_supplier_id`, `is_active` | 품목 |
| `raw_material.raw_material_type` | 철광석·석탄·석회석·합금철 구분 |
| `steel_grade.steel_grade_code`, `steel_grade_name`, `standard_no` | 강종 |
| `composition_spec.element_code`, `min_value`, `max_value` | 성분 min/max |
| `product_spec.spec_code`, `thickness_mm`, `width_mm`, `length_mm` | 규격 코드·치수 |
| `routing.process_code`, `process_seq` | 공정 순서 |
| `specific_consumption.consumption_rate`, `consumption_unit` | 원단위 값·단위 |
| `production_setting.delivery_risk_days` | 납기 위험 기준일 |
| `inspection_item.inspection_item_code`, `inspection_item_name`, `is_required` | 검사 항목 |
| `sales_order.owner_employee_id`, `is_cancelled`, `cancel_reason` | 수주 담당·취소 |
| `sales_order_item.line_no`, `shipped_qty`, `sales_order_item_status` | 수주 품목 |
| `reservation.is_auto_reserved` | 자동 예약 여부 |
| `allocation.shipment_request_item_id`, `confirmed_employee_id` | 배정 연결 |
| `production_plan.surplus_use_qty`, `planned_slab_qty`, `heat_count`, `required_input_ton`, `is_reproduction` | 히트 편성 결과 |
| `production_result.heat_seq`, `planned_qty`, `output_qty`, `loss_qty`, `sampled_loss_rate`, `is_simulated` | 실적·시뮬레이션 |
| `mrp_requirement.net_required_ton`, `required_date` | 순소요·필요일 |
| `purchase_requisition.request_reason`, `reject_reason`, `source_type`, `source_draft_id`, `desired_receipt_date` | 구매요청 |
| `lot.heat_lot_id`, `initial_ton`, `lot_status`, `produced_at`, `disposition_reason`, `disposition_at` | LOT |
| `lot_relation.input_ton`, `period_start`, `period_end` | 계보 |
| `mill_sheet.snapshot`, `pdf_status`, `pdf_path` | 밀시트 |
| `business_event.summary`, `target_no`, `lot_ids`, `reason_code`, `message_id`, `action_draft_id` | 작업 로그 |
| `notification.dedupe_key`, `link_path` / `task.link_path` | 알림·업무 |
| `message.mention_employee_ids`, `file_*`, `message_type` | 메시지 |
| `action_draft.execution_result`, `requester_id`(확정자) | 초안 |

## 코드 값 (공통코드 정의서에 접근할 수 없어 임시)
`shared/src/codes/index.ts` 참고. 요구사항에 없는 값: `ITEM_TYPE`, `RAW_MATERIAL_TYPE`, `CONSUMPTION_UNIT`, `YARD_TYPE`, `PROCESS_CODE`, `ROLE_CODE`, `EMPLOYEE_STATUS`, `PERMISSION_LEVEL`, `LOT_TYPE`, `LOT_STATUS`, `LOT_RELATION_TYPE`, `LOT_EVIDENCE_TYPE`, `ALLOCATION_PURPOSE`, `CHAT_ROOM_TYPE`, `MESSAGE_TYPE`, `NOTIFICATION_TYPE`, `ACTION_TYPE`, `BUSINESS_EVENT_TYPE`, `EVENT_TARGET_TYPE`, `REQUISITION_SOURCE_TYPE`, `SHIPMENT_REQUEST_STATUS`, `WIDGET_CODE`, 에러 코드 `COM-003~005`·`AUTH-001~003`. 나머지 상태값은 업무 프로세스 정의서 10장 제안 값.

## 그 밖에 임시로 정한 것
- 제품 이름 "FantaSteel" (기획안은 정식 명칭 TBD).
- 시드의 원단위·수율·성분·검사 기준·규격 치수는 시연용 가정값.
- 메뉴에 "재고" 화면을 추가했다 (REQ-INV-001·008 조회용. v1 B안에는 별도 화면이 없었다).
