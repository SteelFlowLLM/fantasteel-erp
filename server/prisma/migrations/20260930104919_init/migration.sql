-- CreateTable
CREATE TABLE "role" (
    "id" SERIAL NOT NULL,
    "role_code" TEXT NOT NULL,
    "role_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "id" SERIAL NOT NULL,
    "role_id" INTEGER NOT NULL,
    "permission_code" TEXT NOT NULL,
    "permission_level" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department" (
    "id" SERIAL NOT NULL,
    "department_code" TEXT NOT NULL,
    "department_name" TEXT NOT NULL,
    "parent_id" INTEGER,
    "head_employee_id" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee" (
    "id" SERIAL NOT NULL,
    "employee_no" TEXT NOT NULL,
    "employee_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "email" TEXT,
    "department_id" INTEGER NOT NULL,
    "role_id" INTEGER NOT NULL,
    "job_grade" TEXT NOT NULL,
    "employee_status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item" (
    "id" SERIAL NOT NULL,
    "item_code" TEXT NOT NULL,
    "item_name" TEXT NOT NULL,
    "item_type" TEXT NOT NULL,
    "unit_type" TEXT NOT NULL,
    "default_supplier_id" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_material" (
    "id" SERIAL NOT NULL,
    "item_id" INTEGER NOT NULL,
    "material_code" TEXT NOT NULL,
    "raw_material_type" TEXT NOT NULL,
    "yard_id" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "raw_material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "steel_grade" (
    "id" SERIAL NOT NULL,
    "steel_grade_code" TEXT NOT NULL,
    "steel_grade_name" TEXT NOT NULL,
    "standard_no" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "steel_grade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "composition_spec" (
    "id" SERIAL NOT NULL,
    "steel_grade_id" INTEGER NOT NULL,
    "element_code" TEXT NOT NULL,
    "min_value" DECIMAL(8,4),
    "max_value" DECIMAL(8,4),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "composition_spec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_spec" (
    "id" SERIAL NOT NULL,
    "spec_code" TEXT NOT NULL,
    "item_id" INTEGER NOT NULL,
    "steel_grade_id" INTEGER NOT NULL,
    "thickness_mm" DECIMAL(8,2) NOT NULL,
    "width_mm" DECIMAL(8,2) NOT NULL,
    "length_mm" DECIMAL(12,2) NOT NULL,
    "theoretical_weight_ton" DECIMAL(12,3) NOT NULL,
    "yard_id" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "product_spec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spec_mapping" (
    "id" SERIAL NOT NULL,
    "slab_spec_id" INTEGER NOT NULL,
    "coil_spec_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "spec_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing" (
    "id" SERIAL NOT NULL,
    "item_type" TEXT NOT NULL,
    "process_code" TEXT NOT NULL,
    "process_seq" INTEGER NOT NULL,
    "planned_yield_rate" DECIMAL(6,4),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "routing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "specific_consumption" (
    "id" SERIAL NOT NULL,
    "raw_material_id" INTEGER NOT NULL,
    "steel_grade_id" INTEGER,
    "consumption_rate" DECIMAL(12,4) NOT NULL,
    "consumption_unit" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "specific_consumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer" (
    "id" SERIAL NOT NULL,
    "customer_code" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier" (
    "id" SERIAL NOT NULL,
    "supplier_code" TEXT NOT NULL,
    "supplier_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "yard" (
    "id" SERIAL NOT NULL,
    "yard_code" TEXT NOT NULL,
    "yard_name" TEXT NOT NULL,
    "yard_type" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "yard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_setting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "heat_capacity_ton" DECIMAL(12,3) NOT NULL,
    "delivery_risk_days" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "production_setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_item" (
    "id" SERIAL NOT NULL,
    "process_code" TEXT NOT NULL,
    "steel_grade_id" INTEGER,
    "inspection_item_code" TEXT NOT NULL,
    "inspection_item_name" TEXT NOT NULL,
    "unit" TEXT,
    "min_value" DECIMAL(12,4),
    "max_value" DECIMAL(12,4),
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "inspection_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order" (
    "id" SERIAL NOT NULL,
    "sales_order_no" TEXT NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "owner_employee_id" INTEGER NOT NULL,
    "note" TEXT,
    "is_cancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelled_at" TIMESTAMPTZ,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sales_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_item" (
    "id" SERIAL NOT NULL,
    "sales_order_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "product_spec_id" INTEGER NOT NULL,
    "ordered_qty" INTEGER NOT NULL,
    "shipped_qty" INTEGER NOT NULL DEFAULT 0,
    "sales_order_item_status" TEXT NOT NULL DEFAULT 'REGISTERED',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sales_order_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory" (
    "id" SERIAL NOT NULL,
    "product_spec_id" INTEGER,
    "raw_material_id" INTEGER,
    "on_hand_qty" INTEGER NOT NULL DEFAULT 0,
    "reserved_qty" INTEGER NOT NULL DEFAULT 0,
    "on_hand_ton" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservation" (
    "id" SERIAL NOT NULL,
    "sales_order_item_id" INTEGER NOT NULL,
    "product_spec_id" INTEGER NOT NULL,
    "reserved_qty" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "is_auto_reserved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation" (
    "id" SERIAL NOT NULL,
    "lot_id" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "sales_order_item_id" INTEGER,
    "production_plan_id" INTEGER,
    "shipment_request_item_id" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "confirmed_employee_id" INTEGER,
    "confirmed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumed_at" TIMESTAMPTZ,
    "released_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_plan" (
    "id" SERIAL NOT NULL,
    "production_plan_no" TEXT NOT NULL,
    "sales_order_item_id" INTEGER,
    "product_spec_id" INTEGER NOT NULL,
    "steel_grade_id" INTEGER NOT NULL,
    "shortage_qty" INTEGER NOT NULL,
    "heat_count" INTEGER NOT NULL DEFAULT 0,
    "required_input_ton" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "cumulative_yield_rate" DECIMAL(6,4),
    "production_plan_status" TEXT NOT NULL DEFAULT 'PLANNED',
    "is_reproduction" BOOLEAN NOT NULL DEFAULT false,
    "confirmed_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "created_employee_id" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "production_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_result" (
    "id" SERIAL NOT NULL,
    "production_plan_id" INTEGER,
    "process_code" TEXT NOT NULL,
    "heat_seq" INTEGER,
    "production_result_status" TEXT NOT NULL DEFAULT 'READY',
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "blast_furnace_no" TEXT,
    "converter_no" TEXT,
    "input_ton" DECIMAL(12,3),
    "output_ton" DECIMAL(12,3),
    "planned_qty" INTEGER,
    "output_qty" INTEGER,
    "loss_qty" INTEGER,
    "sampled_loss_rate" DECIMAL(6,4),
    "is_simulated" BOOLEAN NOT NULL DEFAULT false,
    "operator_employee_id" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "production_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mrp_run" (
    "id" SERIAL NOT NULL,
    "mrp_run_no" TEXT NOT NULL,
    "run_employee_id" INTEGER,
    "hot_metal_ton" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "heat_ton" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "heat_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "mrp_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mrp_requirement" (
    "id" SERIAL NOT NULL,
    "mrp_run_id" INTEGER NOT NULL,
    "raw_material_id" INTEGER NOT NULL,
    "required_ton" DECIMAL(12,3) NOT NULL,
    "remaining_ton" DECIMAL(12,3) NOT NULL,
    "scheduled_receipt_ton" DECIMAL(12,3) NOT NULL,
    "net_required_ton" DECIMAL(12,3) NOT NULL,
    "required_date" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "mrp_requirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requisition" (
    "id" SERIAL NOT NULL,
    "purchase_requisition_no" TEXT NOT NULL,
    "requester_id" INTEGER NOT NULL,
    "department_id" INTEGER NOT NULL,
    "approver_id" INTEGER,
    "purchase_requisition_status" TEXT NOT NULL DEFAULT 'DRAFT',
    "desired_receipt_date" DATE,
    "request_reason" TEXT,
    "reject_reason" TEXT,
    "source_type" TEXT NOT NULL DEFAULT 'DIRECT',
    "source_draft_id" INTEGER,
    "submitted_at" TIMESTAMPTZ,
    "approved_at" TIMESTAMPTZ,
    "rejected_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "purchase_requisition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requisition_item" (
    "id" SERIAL NOT NULL,
    "purchase_requisition_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "raw_material_id" INTEGER NOT NULL,
    "required_ton" DECIMAL(12,3) NOT NULL,
    "ordered_ton" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "purchase_requisition_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order" (
    "id" SERIAL NOT NULL,
    "purchase_order_no" TEXT NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "purchase_order_status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "due_date" DATE,
    "ordered_employee_id" INTEGER,
    "confirmed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "purchase_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_item" (
    "id" SERIAL NOT NULL,
    "purchase_order_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "raw_material_id" INTEGER NOT NULL,
    "purchase_requisition_item_id" INTEGER,
    "ordered_ton" DECIMAL(12,3) NOT NULL,
    "received_ton" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "purchase_order_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt" (
    "id" SERIAL NOT NULL,
    "goods_receipt_no" TEXT NOT NULL,
    "purchase_order_item_id" INTEGER NOT NULL,
    "received_ton" DECIMAL(12,3) NOT NULL,
    "receipt_date" DATE NOT NULL,
    "yard_id" INTEGER,
    "goods_receipt_status" TEXT NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "confirmed_employee_id" INTEGER,
    "confirmed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "goods_receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lot" (
    "id" SERIAL NOT NULL,
    "lot_no" TEXT NOT NULL,
    "lot_type" TEXT NOT NULL,
    "raw_material_id" INTEGER,
    "product_spec_id" INTEGER,
    "steel_grade_id" INTEGER,
    "heat_lot_id" INTEGER,
    "initial_ton" DECIMAL(12,3),
    "remaining_ton" DECIMAL(12,3),
    "blast_furnace_no" TEXT,
    "converter_no" TEXT,
    "yard_id" INTEGER,
    "supplier_id" INTEGER,
    "goods_receipt_id" INTEGER,
    "production_plan_id" INTEGER,
    "production_result_id" INTEGER,
    "sales_order_item_id" INTEGER,
    "is_passed" BOOLEAN,
    "disposition_status" TEXT,
    "disposition_reason" TEXT,
    "lot_status" TEXT NOT NULL DEFAULT 'IN_STOCK',
    "produced_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lot_relation" (
    "id" SERIAL NOT NULL,
    "parent_lot_id" INTEGER NOT NULL,
    "child_lot_id" INTEGER NOT NULL,
    "relation_type" TEXT NOT NULL,
    "evidence_type" TEXT NOT NULL,
    "input_ton" DECIMAL(12,3),
    "period_start" TIMESTAMPTZ,
    "period_end" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "lot_relation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_inspection" (
    "id" SERIAL NOT NULL,
    "quality_inspection_no" TEXT NOT NULL,
    "lot_id" INTEGER NOT NULL,
    "process_code" TEXT NOT NULL,
    "inspection_result" TEXT NOT NULL DEFAULT 'PENDING',
    "inspector_employee_id" INTEGER,
    "inspected_at" TIMESTAMPTZ,
    "memo" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "quality_inspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_inspection_value" (
    "id" SERIAL NOT NULL,
    "quality_inspection_id" INTEGER NOT NULL,
    "inspection_item_code" TEXT NOT NULL,
    "inspection_item_name" TEXT NOT NULL,
    "unit" TEXT,
    "min_value" DECIMAL(12,4),
    "max_value" DECIMAL(12,4),
    "measured_value" DECIMAL(12,4),
    "is_passed" BOOLEAN,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "quality_inspection_value_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_request" (
    "id" SERIAL NOT NULL,
    "shipment_request_no" TEXT NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "requested_ship_date" DATE NOT NULL,
    "shipment_request_status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "requester_id" INTEGER NOT NULL,
    "memo" TEXT,
    "cancelled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "shipment_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_request_item" (
    "id" SERIAL NOT NULL,
    "shipment_request_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "sales_order_item_id" INTEGER NOT NULL,
    "request_qty" INTEGER NOT NULL,
    "shipment_request_item_status" TEXT NOT NULL DEFAULT 'WAITING_ALLOCATION',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "shipment_request_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_issue" (
    "id" SERIAL NOT NULL,
    "goods_issue_no" TEXT NOT NULL,
    "shipment_request_id" INTEGER NOT NULL,
    "goods_issue_status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "confirmed_employee_id" INTEGER,
    "confirmed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "goods_issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_issue_item" (
    "id" SERIAL NOT NULL,
    "goods_issue_id" INTEGER NOT NULL,
    "shipment_request_item_id" INTEGER NOT NULL,
    "lot_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "goods_issue_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mill_sheet" (
    "id" SERIAL NOT NULL,
    "mill_sheet_no" TEXT NOT NULL,
    "goods_issue_id" INTEGER NOT NULL,
    "sales_order_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "issued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pdf_status" TEXT NOT NULL DEFAULT 'PENDING',
    "pdf_path" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "mill_sheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_event" (
    "id" SERIAL NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_employee_id" INTEGER,
    "event_type" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" INTEGER,
    "target_no" TEXT,
    "sales_order_id" INTEGER,
    "lot_ids" INTEGER[],
    "summary" TEXT NOT NULL,
    "before_data" JSONB,
    "after_data" JSONB,
    "reason_code" TEXT,
    "reason" TEXT,
    "is_ai_assisted" BOOLEAN NOT NULL DEFAULT false,
    "message_id" INTEGER,
    "action_draft_id" INTEGER,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "business_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assignee_id" INTEGER NOT NULL,
    "creator_id" INTEGER NOT NULL,
    "due_date" DATE,
    "task_status" TEXT NOT NULL DEFAULT 'TODO',
    "link_path" TEXT,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" SERIAL NOT NULL,
    "recipient_id" INTEGER NOT NULL,
    "department_id" INTEGER,
    "notification_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link_path" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMPTZ,
    "dedupe_key" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_room" (
    "id" SERIAL NOT NULL,
    "chat_room_type" TEXT NOT NULL,
    "chat_room_name" TEXT,
    "sales_order_id" INTEGER,
    "created_employee_id" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "chat_room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_room_member" (
    "id" SERIAL NOT NULL,
    "chat_room_id" INTEGER NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "last_read_message_id" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "chat_room_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message" (
    "id" SERIAL NOT NULL,
    "chat_room_id" INTEGER NOT NULL,
    "sender_id" INTEGER,
    "message_type" TEXT NOT NULL DEFAULT 'TEXT',
    "content" TEXT NOT NULL,
    "mention_employee_ids" INTEGER[],
    "file_name" TEXT,
    "file_path" TEXT,
    "file_size" INTEGER,
    "mime_type" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_draft" (
    "id" SERIAL NOT NULL,
    "action_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "draft_status" TEXT NOT NULL DEFAULT 'AI_GENERATED',
    "requester_id" INTEGER NOT NULL,
    "message_id" INTEGER,
    "execution_result" JSONB,
    "reject_reason" TEXT,
    "confirmed_at" TIMESTAMPTZ,
    "executed_at" TIMESTAMPTZ,
    "rejected_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "action_draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_widget_layout" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "layout" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "dashboard_widget_layout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_sequence" (
    "id" SERIAL NOT NULL,
    "sequence_key" TEXT NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "number_sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_key" (
    "id" SERIAL NOT NULL,
    "request_key" TEXT NOT NULL,
    "employee_id" INTEGER,
    "response" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "idempotency_key_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "role_role_code_key" ON "role"("role_code");

-- CreateIndex
CREATE UNIQUE INDEX "role_permission_role_id_permission_code_key" ON "role_permission"("role_id", "permission_code");

-- CreateIndex
CREATE UNIQUE INDEX "department_department_code_key" ON "department"("department_code");

-- CreateIndex
CREATE UNIQUE INDEX "employee_employee_no_key" ON "employee"("employee_no");

-- CreateIndex
CREATE INDEX "employee_department_id_idx" ON "employee"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "item_item_code_key" ON "item"("item_code");

-- CreateIndex
CREATE UNIQUE INDEX "raw_material_item_id_key" ON "raw_material"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "raw_material_material_code_key" ON "raw_material"("material_code");

-- CreateIndex
CREATE UNIQUE INDEX "steel_grade_steel_grade_code_key" ON "steel_grade"("steel_grade_code");

-- CreateIndex
CREATE UNIQUE INDEX "composition_spec_steel_grade_id_element_code_key" ON "composition_spec"("steel_grade_id", "element_code");

-- CreateIndex
CREATE UNIQUE INDEX "product_spec_spec_code_key" ON "product_spec"("spec_code");

-- CreateIndex
CREATE UNIQUE INDEX "product_spec_steel_grade_id_thickness_mm_width_mm_length_mm_key" ON "product_spec"("steel_grade_id", "thickness_mm", "width_mm", "length_mm");

-- CreateIndex
CREATE UNIQUE INDEX "spec_mapping_slab_spec_id_key" ON "spec_mapping"("slab_spec_id");

-- CreateIndex
CREATE UNIQUE INDEX "spec_mapping_coil_spec_id_key" ON "spec_mapping"("coil_spec_id");

-- CreateIndex
CREATE UNIQUE INDEX "routing_item_type_process_seq_key" ON "routing"("item_type", "process_seq");

-- CreateIndex
CREATE UNIQUE INDEX "routing_item_type_process_code_key" ON "routing"("item_type", "process_code");

-- CreateIndex
CREATE UNIQUE INDEX "specific_consumption_raw_material_id_steel_grade_id_key" ON "specific_consumption"("raw_material_id", "steel_grade_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_customer_code_key" ON "customer"("customer_code");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_supplier_code_key" ON "supplier"("supplier_code");

-- CreateIndex
CREATE UNIQUE INDEX "yard_yard_code_key" ON "yard"("yard_code");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_item_process_code_steel_grade_id_inspection_item_key" ON "inspection_item"("process_code", "steel_grade_id", "inspection_item_code");

-- CreateIndex
CREATE UNIQUE INDEX "sales_order_sales_order_no_key" ON "sales_order"("sales_order_no");

-- CreateIndex
CREATE INDEX "sales_order_customer_id_idx" ON "sales_order"("customer_id");

-- CreateIndex
CREATE INDEX "sales_order_item_product_spec_id_idx" ON "sales_order_item"("product_spec_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_order_item_sales_order_id_line_no_key" ON "sales_order_item"("sales_order_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_product_spec_id_key" ON "inventory"("product_spec_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_raw_material_id_key" ON "inventory"("raw_material_id");

-- CreateIndex
CREATE INDEX "reservation_sales_order_item_id_idx" ON "reservation"("sales_order_item_id");

-- CreateIndex
CREATE INDEX "reservation_product_spec_id_status_idx" ON "reservation"("product_spec_id", "status");

-- CreateIndex
CREATE INDEX "allocation_lot_id_status_idx" ON "allocation"("lot_id", "status");

-- CreateIndex
CREATE INDEX "allocation_shipment_request_item_id_idx" ON "allocation"("shipment_request_item_id");

-- CreateIndex
CREATE INDEX "allocation_production_plan_id_idx" ON "allocation"("production_plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_plan_production_plan_no_key" ON "production_plan"("production_plan_no");

-- CreateIndex
CREATE INDEX "production_plan_sales_order_item_id_idx" ON "production_plan"("sales_order_item_id");

-- CreateIndex
CREATE INDEX "production_plan_production_plan_status_idx" ON "production_plan"("production_plan_status");

-- CreateIndex
CREATE INDEX "production_result_production_plan_id_process_code_idx" ON "production_result"("production_plan_id", "process_code");

-- CreateIndex
CREATE UNIQUE INDEX "mrp_run_mrp_run_no_key" ON "mrp_run"("mrp_run_no");

-- CreateIndex
CREATE INDEX "mrp_requirement_mrp_run_id_idx" ON "mrp_requirement"("mrp_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requisition_purchase_requisition_no_key" ON "purchase_requisition"("purchase_requisition_no");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requisition_source_draft_id_key" ON "purchase_requisition"("source_draft_id");

-- CreateIndex
CREATE INDEX "purchase_requisition_purchase_requisition_status_idx" ON "purchase_requisition"("purchase_requisition_status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requisition_item_purchase_requisition_id_line_no_key" ON "purchase_requisition_item"("purchase_requisition_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_purchase_order_no_key" ON "purchase_order"("purchase_order_no");

-- CreateIndex
CREATE INDEX "purchase_order_supplier_id_idx" ON "purchase_order"("supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_item_purchase_order_id_line_no_key" ON "purchase_order_item"("purchase_order_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipt_goods_receipt_no_key" ON "goods_receipt"("goods_receipt_no");

-- CreateIndex
CREATE INDEX "goods_receipt_purchase_order_item_id_idx" ON "goods_receipt"("purchase_order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "lot_lot_no_key" ON "lot"("lot_no");

-- CreateIndex
CREATE UNIQUE INDEX "lot_goods_receipt_id_key" ON "lot"("goods_receipt_id");

-- CreateIndex
CREATE INDEX "lot_lot_type_lot_status_idx" ON "lot"("lot_type", "lot_status");

-- CreateIndex
CREATE INDEX "lot_product_spec_id_lot_status_idx" ON "lot"("product_spec_id", "lot_status");

-- CreateIndex
CREATE INDEX "lot_heat_lot_id_idx" ON "lot"("heat_lot_id");

-- CreateIndex
CREATE INDEX "lot_production_plan_id_idx" ON "lot"("production_plan_id");

-- CreateIndex
CREATE INDEX "lot_relation_child_lot_id_idx" ON "lot_relation"("child_lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "lot_relation_parent_lot_id_child_lot_id_key" ON "lot_relation"("parent_lot_id", "child_lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "quality_inspection_quality_inspection_no_key" ON "quality_inspection"("quality_inspection_no");

-- CreateIndex
CREATE INDEX "quality_inspection_lot_id_idx" ON "quality_inspection"("lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "quality_inspection_value_quality_inspection_id_inspection_i_key" ON "quality_inspection_value"("quality_inspection_id", "inspection_item_code");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_request_shipment_request_no_key" ON "shipment_request"("shipment_request_no");

-- CreateIndex
CREATE INDEX "shipment_request_shipment_request_status_idx" ON "shipment_request"("shipment_request_status");

-- CreateIndex
CREATE INDEX "shipment_request_item_sales_order_item_id_idx" ON "shipment_request_item"("sales_order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_request_item_shipment_request_id_line_no_key" ON "shipment_request_item"("shipment_request_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "goods_issue_goods_issue_no_key" ON "goods_issue"("goods_issue_no");

-- CreateIndex
CREATE INDEX "goods_issue_shipment_request_id_idx" ON "goods_issue"("shipment_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_issue_item_lot_id_key" ON "goods_issue_item"("lot_id");

-- CreateIndex
CREATE INDEX "goods_issue_item_goods_issue_id_idx" ON "goods_issue_item"("goods_issue_id");

-- CreateIndex
CREATE UNIQUE INDEX "mill_sheet_mill_sheet_no_key" ON "mill_sheet"("mill_sheet_no");

-- CreateIndex
CREATE INDEX "mill_sheet_goods_issue_id_idx" ON "mill_sheet"("goods_issue_id");

-- CreateIndex
CREATE INDEX "business_event_sales_order_id_occurred_at_idx" ON "business_event"("sales_order_id", "occurred_at");

-- CreateIndex
CREATE INDEX "business_event_target_type_target_id_idx" ON "business_event"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "business_event_occurred_at_idx" ON "business_event"("occurred_at");

-- CreateIndex
CREATE INDEX "task_assignee_id_task_status_idx" ON "task"("assignee_id", "task_status");

-- CreateIndex
CREATE INDEX "notification_recipient_id_is_read_created_at_idx" ON "notification"("recipient_id", "is_read", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_recipient_id_dedupe_key_key" ON "notification"("recipient_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "chat_room_sales_order_id_idx" ON "chat_room"("sales_order_id");

-- CreateIndex
CREATE INDEX "chat_room_member_employee_id_idx" ON "chat_room_member"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_room_member_chat_room_id_employee_id_key" ON "chat_room_member"("chat_room_id", "employee_id");

-- CreateIndex
CREATE INDEX "message_chat_room_id_id_idx" ON "message"("chat_room_id", "id");

-- CreateIndex
CREATE INDEX "action_draft_message_id_action_type_idx" ON "action_draft"("message_id", "action_type");

-- CreateIndex
CREATE INDEX "action_draft_requester_id_draft_status_idx" ON "action_draft"("requester_id", "draft_status");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_widget_layout_employee_id_key" ON "dashboard_widget_layout"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "number_sequence_sequence_key_key" ON "number_sequence"("sequence_key");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_key_request_key_key" ON "idempotency_key"("request_key");

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department" ADD CONSTRAINT "department_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department" ADD CONSTRAINT "department_head_employee_id_fkey" FOREIGN KEY ("head_employee_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_default_supplier_id_fkey" FOREIGN KEY ("default_supplier_id") REFERENCES "supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_material" ADD CONSTRAINT "raw_material_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_material" ADD CONSTRAINT "raw_material_yard_id_fkey" FOREIGN KEY ("yard_id") REFERENCES "yard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "composition_spec" ADD CONSTRAINT "composition_spec_steel_grade_id_fkey" FOREIGN KEY ("steel_grade_id") REFERENCES "steel_grade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_spec" ADD CONSTRAINT "product_spec_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_spec" ADD CONSTRAINT "product_spec_steel_grade_id_fkey" FOREIGN KEY ("steel_grade_id") REFERENCES "steel_grade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_spec" ADD CONSTRAINT "product_spec_yard_id_fkey" FOREIGN KEY ("yard_id") REFERENCES "yard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spec_mapping" ADD CONSTRAINT "spec_mapping_slab_spec_id_fkey" FOREIGN KEY ("slab_spec_id") REFERENCES "product_spec"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spec_mapping" ADD CONSTRAINT "spec_mapping_coil_spec_id_fkey" FOREIGN KEY ("coil_spec_id") REFERENCES "product_spec"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "specific_consumption" ADD CONSTRAINT "specific_consumption_raw_material_id_fkey" FOREIGN KEY ("raw_material_id") REFERENCES "raw_material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "specific_consumption" ADD CONSTRAINT "specific_consumption_steel_grade_id_fkey" FOREIGN KEY ("steel_grade_id") REFERENCES "steel_grade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_item" ADD CONSTRAINT "inspection_item_steel_grade_id_fkey" FOREIGN KEY ("steel_grade_id") REFERENCES "steel_grade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_owner_employee_id_fkey" FOREIGN KEY ("owner_employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_item" ADD CONSTRAINT "sales_order_item_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_item" ADD CONSTRAINT "sales_order_item_product_spec_id_fkey" FOREIGN KEY ("product_spec_id") REFERENCES "product_spec"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_product_spec_id_fkey" FOREIGN KEY ("product_spec_id") REFERENCES "product_spec"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_raw_material_id_fkey" FOREIGN KEY ("raw_material_id") REFERENCES "raw_material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_sales_order_item_id_fkey" FOREIGN KEY ("sales_order_item_id") REFERENCES "sales_order_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_product_spec_id_fkey" FOREIGN KEY ("product_spec_id") REFERENCES "product_spec"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation" ADD CONSTRAINT "allocation_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation" ADD CONSTRAINT "allocation_sales_order_item_id_fkey" FOREIGN KEY ("sales_order_item_id") REFERENCES "sales_order_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation" ADD CONSTRAINT "allocation_production_plan_id_fkey" FOREIGN KEY ("production_plan_id") REFERENCES "production_plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation" ADD CONSTRAINT "allocation_shipment_request_item_id_fkey" FOREIGN KEY ("shipment_request_item_id") REFERENCES "shipment_request_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_plan" ADD CONSTRAINT "production_plan_sales_order_item_id_fkey" FOREIGN KEY ("sales_order_item_id") REFERENCES "sales_order_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_plan" ADD CONSTRAINT "production_plan_product_spec_id_fkey" FOREIGN KEY ("product_spec_id") REFERENCES "product_spec"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_plan" ADD CONSTRAINT "production_plan_steel_grade_id_fkey" FOREIGN KEY ("steel_grade_id") REFERENCES "steel_grade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_result" ADD CONSTRAINT "production_result_production_plan_id_fkey" FOREIGN KEY ("production_plan_id") REFERENCES "production_plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mrp_requirement" ADD CONSTRAINT "mrp_requirement_mrp_run_id_fkey" FOREIGN KEY ("mrp_run_id") REFERENCES "mrp_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mrp_requirement" ADD CONSTRAINT "mrp_requirement_raw_material_id_fkey" FOREIGN KEY ("raw_material_id") REFERENCES "raw_material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisition" ADD CONSTRAINT "purchase_requisition_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisition" ADD CONSTRAINT "purchase_requisition_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisition" ADD CONSTRAINT "purchase_requisition_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisition" ADD CONSTRAINT "purchase_requisition_source_draft_id_fkey" FOREIGN KEY ("source_draft_id") REFERENCES "action_draft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisition_item" ADD CONSTRAINT "purchase_requisition_item_purchase_requisition_id_fkey" FOREIGN KEY ("purchase_requisition_id") REFERENCES "purchase_requisition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisition_item" ADD CONSTRAINT "purchase_requisition_item_raw_material_id_fkey" FOREIGN KEY ("raw_material_id") REFERENCES "raw_material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_item" ADD CONSTRAINT "purchase_order_item_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_item" ADD CONSTRAINT "purchase_order_item_raw_material_id_fkey" FOREIGN KEY ("raw_material_id") REFERENCES "raw_material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_item" ADD CONSTRAINT "purchase_order_item_purchase_requisition_item_id_fkey" FOREIGN KEY ("purchase_requisition_item_id") REFERENCES "purchase_requisition_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_purchase_order_item_id_fkey" FOREIGN KEY ("purchase_order_item_id") REFERENCES "purchase_order_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_yard_id_fkey" FOREIGN KEY ("yard_id") REFERENCES "yard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot" ADD CONSTRAINT "lot_raw_material_id_fkey" FOREIGN KEY ("raw_material_id") REFERENCES "raw_material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot" ADD CONSTRAINT "lot_product_spec_id_fkey" FOREIGN KEY ("product_spec_id") REFERENCES "product_spec"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot" ADD CONSTRAINT "lot_steel_grade_id_fkey" FOREIGN KEY ("steel_grade_id") REFERENCES "steel_grade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot" ADD CONSTRAINT "lot_heat_lot_id_fkey" FOREIGN KEY ("heat_lot_id") REFERENCES "lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot" ADD CONSTRAINT "lot_yard_id_fkey" FOREIGN KEY ("yard_id") REFERENCES "yard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot" ADD CONSTRAINT "lot_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot" ADD CONSTRAINT "lot_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot" ADD CONSTRAINT "lot_production_plan_id_fkey" FOREIGN KEY ("production_plan_id") REFERENCES "production_plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot" ADD CONSTRAINT "lot_production_result_id_fkey" FOREIGN KEY ("production_result_id") REFERENCES "production_result"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot" ADD CONSTRAINT "lot_sales_order_item_id_fkey" FOREIGN KEY ("sales_order_item_id") REFERENCES "sales_order_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_relation" ADD CONSTRAINT "lot_relation_parent_lot_id_fkey" FOREIGN KEY ("parent_lot_id") REFERENCES "lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_relation" ADD CONSTRAINT "lot_relation_child_lot_id_fkey" FOREIGN KEY ("child_lot_id") REFERENCES "lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspection" ADD CONSTRAINT "quality_inspection_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspection_value" ADD CONSTRAINT "quality_inspection_value_quality_inspection_id_fkey" FOREIGN KEY ("quality_inspection_id") REFERENCES "quality_inspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_request" ADD CONSTRAINT "shipment_request_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_request_item" ADD CONSTRAINT "shipment_request_item_shipment_request_id_fkey" FOREIGN KEY ("shipment_request_id") REFERENCES "shipment_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_request_item" ADD CONSTRAINT "shipment_request_item_sales_order_item_id_fkey" FOREIGN KEY ("sales_order_item_id") REFERENCES "sales_order_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_issue" ADD CONSTRAINT "goods_issue_shipment_request_id_fkey" FOREIGN KEY ("shipment_request_id") REFERENCES "shipment_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_issue_item" ADD CONSTRAINT "goods_issue_item_goods_issue_id_fkey" FOREIGN KEY ("goods_issue_id") REFERENCES "goods_issue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_issue_item" ADD CONSTRAINT "goods_issue_item_shipment_request_item_id_fkey" FOREIGN KEY ("shipment_request_item_id") REFERENCES "shipment_request_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_issue_item" ADD CONSTRAINT "goods_issue_item_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mill_sheet" ADD CONSTRAINT "mill_sheet_goods_issue_id_fkey" FOREIGN KEY ("goods_issue_id") REFERENCES "goods_issue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mill_sheet" ADD CONSTRAINT "mill_sheet_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mill_sheet" ADD CONSTRAINT "mill_sheet_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_event" ADD CONSTRAINT "business_event_actor_employee_id_fkey" FOREIGN KEY ("actor_employee_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_event" ADD CONSTRAINT "business_event_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room" ADD CONSTRAINT "chat_room_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_member" ADD CONSTRAINT "chat_room_member_chat_room_id_fkey" FOREIGN KEY ("chat_room_id") REFERENCES "chat_room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_member" ADD CONSTRAINT "chat_room_member_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_chat_room_id_fkey" FOREIGN KEY ("chat_room_id") REFERENCES "chat_room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_draft" ADD CONSTRAINT "action_draft_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_draft" ADD CONSTRAINT "action_draft_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_widget_layout" ADD CONSTRAINT "dashboard_widget_layout_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
