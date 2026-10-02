-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "employee" (
    "id" SERIAL NOT NULL,
    "employee_no" VARCHAR NOT NULL,
    "employee_name" VARCHAR NOT NULL,
    "password_hash" VARCHAR NOT NULL,
    "department_id" INTEGER NOT NULL,
    "job_grade_id" INTEGER NOT NULL,
    "role_id" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department" (
    "id" SERIAL NOT NULL,
    "department_code" VARCHAR NOT NULL,
    "department_name" VARCHAR NOT NULL,
    "parent_id" INTEGER,
    "head_employee_id" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_grade" (
    "id" SERIAL NOT NULL,
    "job_grade_name" VARCHAR NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_grade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role" (
    "id" SERIAL NOT NULL,
    "role_code" VARCHAR NOT NULL,
    "role_name" VARCHAR NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "id" SERIAL NOT NULL,
    "role_id" INTEGER NOT NULL,
    "permission" VARCHAR NOT NULL,
    "permission_level" VARCHAR NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "steel_grade" (
    "id" SERIAL NOT NULL,
    "steel_grade_code" VARCHAR NOT NULL,
    "steel_grade_name" VARCHAR NOT NULL,
    "standard_no" VARCHAR NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "steel_grade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item" (
    "id" SERIAL NOT NULL,
    "item_code" VARCHAR NOT NULL,
    "item_name" VARCHAR NOT NULL,
    "item_type" VARCHAR NOT NULL,
    "unit_type" VARCHAR NOT NULL,
    "raw_material_type" VARCHAR,
    "steel_grade_id" INTEGER,
    "thickness_mm" DECIMAL(8,2),
    "width_mm" DECIMAL(8,2),
    "length_mm" DECIMAL(8,2),
    "theoretical_weight_ton" DECIMAL(12,3),
    "default_yard_id" INTEGER NOT NULL,
    "default_supplier_id" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spec_mapping" (
    "id" SERIAL NOT NULL,
    "slab_item_id" INTEGER NOT NULL,
    "coil_item_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "spec_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing" (
    "id" SERIAL NOT NULL,
    "item_type" VARCHAR NOT NULL,
    "process_type" VARCHAR NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "planned_yield_rate" DECIMAL(5,4),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "routing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "specific_consumption" (
    "id" SERIAL NOT NULL,
    "raw_material_item_id" INTEGER NOT NULL,
    "steel_grade_id" INTEGER,
    "consumption_rate" DECIMAL(12,4) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "specific_consumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer" (
    "id" SERIAL NOT NULL,
    "customer_code" VARCHAR NOT NULL,
    "customer_name" VARCHAR NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier" (
    "id" SERIAL NOT NULL,
    "supplier_code" VARCHAR NOT NULL,
    "supplier_name" VARCHAR NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "yard" (
    "id" SERIAL NOT NULL,
    "yard_code" VARCHAR NOT NULL,
    "yard_name" VARCHAR NOT NULL,
    "yard_type" VARCHAR NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "yard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_setting" (
    "id" SERIAL NOT NULL,
    "heat_capacity_ton" DECIMAL(12,3) NOT NULL DEFAULT 250,
    "delivery_risk_days" INTEGER NOT NULL DEFAULT 3,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "production_setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order" (
    "id" SERIAL NOT NULL,
    "sales_order_no" VARCHAR NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "owner_employee_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_item" (
    "id" SERIAL NOT NULL,
    "sales_order_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "ordered_qty" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "sales_order_item_status" VARCHAR NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_order_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory" (
    "id" SERIAL NOT NULL,
    "item_id" INTEGER NOT NULL,
    "on_hand_qty" INTEGER NOT NULL DEFAULT 0,
    "reserved_qty" INTEGER NOT NULL DEFAULT 0,
    "rolling_allocated_qty" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservation" (
    "id" SERIAL NOT NULL,
    "sales_order_item_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "reserved_qty" INTEGER NOT NULL,
    "reservation_status" VARCHAR NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation" (
    "id" SERIAL NOT NULL,
    "lot_id" INTEGER NOT NULL,
    "allocation_purpose" VARCHAR NOT NULL,
    "shipment_request_item_id" INTEGER,
    "production_plan_id" INTEGER,
    "allocation_status" VARCHAR NOT NULL DEFAULT 'CONFIRMED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_request" (
    "id" SERIAL NOT NULL,
    "shipment_request_no" VARCHAR NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "ship_date" DATE,
    "shipment_request_status" VARCHAR NOT NULL DEFAULT 'REQUESTED',
    "issued_at" TIMESTAMPTZ(3),
    "issued_employee_id" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shipment_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_request_item" (
    "id" SERIAL NOT NULL,
    "shipment_request_id" INTEGER NOT NULL,
    "sales_order_item_id" INTEGER NOT NULL,
    "request_qty" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shipment_request_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mill_sheet" (
    "id" SERIAL NOT NULL,
    "mill_sheet_no" VARCHAR NOT NULL,
    "shipment_request_id" INTEGER NOT NULL,
    "sales_order_id" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "pdf_path" VARCHAR,
    "issued_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "mill_sheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_plan" (
    "id" SERIAL NOT NULL,
    "production_plan_no" VARCHAR NOT NULL,
    "sales_order_item_id" INTEGER,
    "item_id" INTEGER NOT NULL,
    "shortage_qty" INTEGER NOT NULL,
    "heat_count" INTEGER NOT NULL,
    "is_reproduction" BOOLEAN NOT NULL DEFAULT false,
    "production_plan_status" VARCHAR NOT NULL DEFAULT 'PLANNED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "production_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_result" (
    "id" SERIAL NOT NULL,
    "production_plan_id" INTEGER,
    "process_type" VARCHAR NOT NULL,
    "blast_furnace_code" VARCHAR,
    "converter_code" VARCHAR,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "simulated_loss_rate" DECIMAL(5,4),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "production_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lot" (
    "id" SERIAL NOT NULL,
    "lot_no" VARCHAR NOT NULL,
    "lot_type" VARCHAR NOT NULL,
    "item_id" INTEGER,
    "steel_grade_id" INTEGER,
    "production_result_id" INTEGER,
    "goods_receipt_id" INTEGER,
    "yard_id" INTEGER,
    "lot_status" VARCHAR NOT NULL DEFAULT 'AVAILABLE',
    "initial_ton" DECIMAL(12,3),
    "remaining_ton" DECIMAL(12,3),
    "produced_date" DATE,
    "disposition_status" VARCHAR,
    "disposition_reason" VARCHAR,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lot_relation" (
    "id" SERIAL NOT NULL,
    "parent_lot_id" INTEGER NOT NULL,
    "child_lot_id" INTEGER NOT NULL,
    "lot_relation_evidence" VARCHAR NOT NULL,
    "input_ton" DECIMAL(12,3),
    "input_started_at" TIMESTAMPTZ(3),
    "input_ended_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lot_relation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_standard" (
    "id" SERIAL NOT NULL,
    "inspection_standard_code" VARCHAR NOT NULL,
    "version_no" INTEGER NOT NULL,
    "process_type" VARCHAR NOT NULL,
    "steel_grade_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inspection_standard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_standard_item" (
    "id" SERIAL NOT NULL,
    "inspection_standard_id" INTEGER NOT NULL,
    "inspection_item_code" VARCHAR NOT NULL,
    "inspection_item_name" VARCHAR NOT NULL,
    "unit" VARCHAR,
    "min_value" DECIMAL(12,4),
    "max_value" DECIMAL(12,4),
    "thickness_over_mm" DECIMAL(8,2),
    "thickness_upto_mm" DECIMAL(8,2),
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inspection_standard_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_inspection" (
    "id" SERIAL NOT NULL,
    "lot_id" INTEGER NOT NULL,
    "inspection_standard_id" INTEGER NOT NULL,
    "inspection_result" VARCHAR NOT NULL DEFAULT 'PENDING',
    "inspector_employee_id" INTEGER NOT NULL,
    "inspected_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quality_inspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_inspection_value" (
    "id" SERIAL NOT NULL,
    "quality_inspection_id" INTEGER NOT NULL,
    "inspection_standard_item_id" INTEGER NOT NULL,
    "measured_value" DECIMAL(12,4) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quality_inspection_value_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requisition" (
    "id" SERIAL NOT NULL,
    "purchase_requisition_no" VARCHAR NOT NULL,
    "item_id" INTEGER NOT NULL,
    "requested_ton" DECIMAL(12,3) NOT NULL,
    "desired_receipt_date" DATE NOT NULL,
    "requester_id" INTEGER NOT NULL,
    "approver_id" INTEGER,
    "approved_at" TIMESTAMPTZ(3),
    "reject_reason" VARCHAR,
    "request_reason" VARCHAR,
    "production_plan_id" INTEGER,
    "action_draft_id" INTEGER,
    "purchase_requisition_status" VARCHAR NOT NULL DEFAULT 'WAITING_APPROVAL',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "purchase_requisition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order" (
    "id" SERIAL NOT NULL,
    "purchase_order_no" VARCHAR NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "purchase_order_status" VARCHAR NOT NULL DEFAULT 'CONFIRMED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "purchase_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_item" (
    "id" SERIAL NOT NULL,
    "purchase_order_id" INTEGER NOT NULL,
    "purchase_requisition_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "ordered_ton" DECIMAL(12,3) NOT NULL,
    "expected_receipt_date" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "purchase_order_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt" (
    "id" SERIAL NOT NULL,
    "goods_receipt_no" VARCHAR NOT NULL,
    "purchase_order_item_id" INTEGER NOT NULL,
    "received_ton" DECIMAL(12,3) NOT NULL,
    "received_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "goods_receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_event" (
    "id" SERIAL NOT NULL,
    "business_event_no" VARCHAR NOT NULL,
    "business_event_type" VARCHAR NOT NULL,
    "actor_type" VARCHAR NOT NULL,
    "actor_employee_id" INTEGER,
    "target_type" VARCHAR NOT NULL,
    "target_id" INTEGER NOT NULL,
    "sales_order_id" INTEGER,
    "before_data" JSONB,
    "after_data" JSONB,
    "reason" VARCHAR,
    "is_ai_assisted" BOOLEAN NOT NULL DEFAULT false,
    "action_draft_id" INTEGER,
    "message_id" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "business_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_event_lot" (
    "id" SERIAL NOT NULL,
    "business_event_id" INTEGER NOT NULL,
    "lot_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "business_event_lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task" (
    "id" SERIAL NOT NULL,
    "task_title" VARCHAR NOT NULL,
    "task_description" TEXT,
    "assignee_id" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "task_status" VARCHAR NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" SERIAL NOT NULL,
    "notification_type" VARCHAR NOT NULL,
    "recipient_id" INTEGER NOT NULL,
    "notification_content" VARCHAR NOT NULL,
    "link_path" VARCHAR,
    "message_id" INTEGER,
    "business_event_id" INTEGER,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_room" (
    "id" SERIAL NOT NULL,
    "chat_room_type" VARCHAR NOT NULL,
    "chat_room_name" VARCHAR,
    "sales_order_id" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "chat_room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_room_member" (
    "id" SERIAL NOT NULL,
    "chat_room_id" INTEGER NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "last_read_message_id" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "chat_room_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message" (
    "id" SERIAL NOT NULL,
    "chat_room_id" INTEGER NOT NULL,
    "sender_id" INTEGER NOT NULL,
    "content" TEXT,
    "attachment_path" VARCHAR,
    "attachment_name" VARCHAR,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_draft" (
    "id" SERIAL NOT NULL,
    "action_type" VARCHAR NOT NULL,
    "draft_status" VARCHAR NOT NULL DEFAULT 'AI_GENERATED',
    "payload" JSONB NOT NULL,
    "message_id" INTEGER,
    "requester_id" INTEGER,
    "confirmed_at" TIMESTAMPTZ(3),
    "reject_reason" VARCHAR,
    "execution_error_code" VARCHAR,
    "execution_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "action_draft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_employee_no_key" ON "employee"("employee_no");

-- CreateIndex
CREATE INDEX "employee_department_id_idx" ON "employee"("department_id");

-- CreateIndex
CREATE INDEX "employee_job_grade_id_idx" ON "employee"("job_grade_id");

-- CreateIndex
CREATE INDEX "employee_role_id_idx" ON "employee"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "department_department_code_key" ON "department"("department_code");

-- CreateIndex
CREATE INDEX "department_parent_id_idx" ON "department"("parent_id");

-- CreateIndex
CREATE INDEX "department_head_employee_id_idx" ON "department"("head_employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_role_code_key" ON "role"("role_code");

-- CreateIndex
CREATE UNIQUE INDEX "role_permission_role_id_permission_key" ON "role_permission"("role_id", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "steel_grade_steel_grade_code_key" ON "steel_grade"("steel_grade_code");

-- CreateIndex
CREATE UNIQUE INDEX "item_item_code_key" ON "item"("item_code");

-- CreateIndex
CREATE INDEX "item_steel_grade_id_idx" ON "item"("steel_grade_id");

-- CreateIndex
CREATE INDEX "item_default_yard_id_idx" ON "item"("default_yard_id");

-- CreateIndex
CREATE INDEX "item_default_supplier_id_idx" ON "item"("default_supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "item_item_type_steel_grade_id_thickness_mm_width_mm_length__key" ON "item"("item_type", "steel_grade_id", "thickness_mm", "width_mm", "length_mm");

-- CreateIndex
CREATE UNIQUE INDEX "spec_mapping_slab_item_id_key" ON "spec_mapping"("slab_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "spec_mapping_coil_item_id_key" ON "spec_mapping"("coil_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "routing_item_type_sequence_no_key" ON "routing"("item_type", "sequence_no");

-- CreateIndex
CREATE UNIQUE INDEX "routing_item_type_process_type_key" ON "routing"("item_type", "process_type");

-- CreateIndex
CREATE INDEX "specific_consumption_raw_material_item_id_idx" ON "specific_consumption"("raw_material_item_id");

-- CreateIndex
CREATE INDEX "specific_consumption_steel_grade_id_idx" ON "specific_consumption"("steel_grade_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_customer_code_key" ON "customer"("customer_code");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_supplier_code_key" ON "supplier"("supplier_code");

-- CreateIndex
CREATE UNIQUE INDEX "yard_yard_code_key" ON "yard"("yard_code");

-- CreateIndex
CREATE UNIQUE INDEX "sales_order_sales_order_no_key" ON "sales_order"("sales_order_no");

-- CreateIndex
CREATE INDEX "sales_order_customer_id_idx" ON "sales_order"("customer_id");

-- CreateIndex
CREATE INDEX "sales_order_owner_employee_id_idx" ON "sales_order"("owner_employee_id");

-- CreateIndex
CREATE INDEX "sales_order_item_sales_order_id_idx" ON "sales_order_item"("sales_order_id");

-- CreateIndex
CREATE INDEX "sales_order_item_item_id_idx" ON "sales_order_item"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_item_id_key" ON "inventory"("item_id");

-- CreateIndex
CREATE INDEX "reservation_sales_order_item_id_idx" ON "reservation"("sales_order_item_id");

-- CreateIndex
CREATE INDEX "reservation_item_id_idx" ON "reservation"("item_id");

-- CreateIndex
CREATE INDEX "allocation_lot_id_idx" ON "allocation"("lot_id");

-- CreateIndex
CREATE INDEX "allocation_shipment_request_item_id_idx" ON "allocation"("shipment_request_item_id");

-- CreateIndex
CREATE INDEX "allocation_production_plan_id_idx" ON "allocation"("production_plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_request_shipment_request_no_key" ON "shipment_request"("shipment_request_no");

-- CreateIndex
CREATE INDEX "shipment_request_customer_id_idx" ON "shipment_request"("customer_id");

-- CreateIndex
CREATE INDEX "shipment_request_issued_employee_id_idx" ON "shipment_request"("issued_employee_id");

-- CreateIndex
CREATE INDEX "shipment_request_item_sales_order_item_id_idx" ON "shipment_request_item"("sales_order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_request_item_shipment_request_id_sales_order_item__key" ON "shipment_request_item"("shipment_request_id", "sales_order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "mill_sheet_mill_sheet_no_key" ON "mill_sheet"("mill_sheet_no");

-- CreateIndex
CREATE INDEX "mill_sheet_sales_order_id_idx" ON "mill_sheet"("sales_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "mill_sheet_shipment_request_id_sales_order_id_key" ON "mill_sheet"("shipment_request_id", "sales_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_plan_production_plan_no_key" ON "production_plan"("production_plan_no");

-- CreateIndex
CREATE INDEX "production_plan_sales_order_item_id_idx" ON "production_plan"("sales_order_item_id");

-- CreateIndex
CREATE INDEX "production_plan_item_id_idx" ON "production_plan"("item_id");

-- CreateIndex
CREATE INDEX "production_result_production_plan_id_idx" ON "production_result"("production_plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "lot_lot_no_key" ON "lot"("lot_no");

-- CreateIndex
CREATE UNIQUE INDEX "lot_goods_receipt_id_key" ON "lot"("goods_receipt_id");

-- CreateIndex
CREATE INDEX "lot_item_id_idx" ON "lot"("item_id");

-- CreateIndex
CREATE INDEX "lot_steel_grade_id_idx" ON "lot"("steel_grade_id");

-- CreateIndex
CREATE INDEX "lot_production_result_id_idx" ON "lot"("production_result_id");

-- CreateIndex
CREATE INDEX "lot_yard_id_idx" ON "lot"("yard_id");

-- CreateIndex
CREATE INDEX "lot_relation_child_lot_id_idx" ON "lot_relation"("child_lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "lot_relation_parent_lot_id_child_lot_id_key" ON "lot_relation"("parent_lot_id", "child_lot_id");

-- CreateIndex
CREATE INDEX "inspection_standard_steel_grade_id_idx" ON "inspection_standard"("steel_grade_id");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_standard_inspection_standard_code_version_no_key" ON "inspection_standard"("inspection_standard_code", "version_no");

-- CreateIndex
CREATE INDEX "inspection_standard_item_inspection_standard_id_idx" ON "inspection_standard_item"("inspection_standard_id");

-- CreateIndex
CREATE UNIQUE INDEX "quality_inspection_lot_id_key" ON "quality_inspection"("lot_id");

-- CreateIndex
CREATE INDEX "quality_inspection_inspection_standard_id_idx" ON "quality_inspection"("inspection_standard_id");

-- CreateIndex
CREATE INDEX "quality_inspection_inspector_employee_id_idx" ON "quality_inspection"("inspector_employee_id");

-- CreateIndex
CREATE INDEX "quality_inspection_value_inspection_standard_item_id_idx" ON "quality_inspection_value"("inspection_standard_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "quality_inspection_value_quality_inspection_id_inspection_s_key" ON "quality_inspection_value"("quality_inspection_id", "inspection_standard_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requisition_purchase_requisition_no_key" ON "purchase_requisition"("purchase_requisition_no");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requisition_action_draft_id_key" ON "purchase_requisition"("action_draft_id");

-- CreateIndex
CREATE INDEX "purchase_requisition_item_id_idx" ON "purchase_requisition"("item_id");

-- CreateIndex
CREATE INDEX "purchase_requisition_requester_id_idx" ON "purchase_requisition"("requester_id");

-- CreateIndex
CREATE INDEX "purchase_requisition_approver_id_idx" ON "purchase_requisition"("approver_id");

-- CreateIndex
CREATE INDEX "purchase_requisition_production_plan_id_idx" ON "purchase_requisition"("production_plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_purchase_order_no_key" ON "purchase_order"("purchase_order_no");

-- CreateIndex
CREATE INDEX "purchase_order_supplier_id_idx" ON "purchase_order"("supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_item_purchase_requisition_id_key" ON "purchase_order_item"("purchase_requisition_id");

-- CreateIndex
CREATE INDEX "purchase_order_item_purchase_order_id_idx" ON "purchase_order_item"("purchase_order_id");

-- CreateIndex
CREATE INDEX "purchase_order_item_item_id_idx" ON "purchase_order_item"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipt_goods_receipt_no_key" ON "goods_receipt"("goods_receipt_no");

-- CreateIndex
CREATE INDEX "goods_receipt_purchase_order_item_id_idx" ON "goods_receipt"("purchase_order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "business_event_business_event_no_key" ON "business_event"("business_event_no");

-- CreateIndex
CREATE INDEX "business_event_target_type_target_id_idx" ON "business_event"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "business_event_sales_order_id_idx" ON "business_event"("sales_order_id");

-- CreateIndex
CREATE INDEX "business_event_actor_employee_id_idx" ON "business_event"("actor_employee_id");

-- CreateIndex
CREATE INDEX "business_event_action_draft_id_idx" ON "business_event"("action_draft_id");

-- CreateIndex
CREATE INDEX "business_event_message_id_idx" ON "business_event"("message_id");

-- CreateIndex
CREATE INDEX "business_event_lot_lot_id_idx" ON "business_event_lot"("lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "business_event_lot_business_event_id_lot_id_key" ON "business_event_lot"("business_event_id", "lot_id");

-- CreateIndex
CREATE INDEX "task_assignee_id_idx" ON "task"("assignee_id");

-- CreateIndex
CREATE INDEX "notification_recipient_id_idx" ON "notification"("recipient_id");

-- CreateIndex
CREATE INDEX "notification_message_id_idx" ON "notification"("message_id");

-- CreateIndex
CREATE INDEX "notification_business_event_id_idx" ON "notification"("business_event_id");

-- CreateIndex
CREATE INDEX "chat_room_sales_order_id_idx" ON "chat_room"("sales_order_id");

-- CreateIndex
CREATE INDEX "chat_room_member_employee_id_idx" ON "chat_room_member"("employee_id");

-- CreateIndex
CREATE INDEX "chat_room_member_last_read_message_id_idx" ON "chat_room_member"("last_read_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_room_member_chat_room_id_employee_id_key" ON "chat_room_member"("chat_room_id", "employee_id");

-- CreateIndex
CREATE INDEX "message_chat_room_id_idx" ON "message"("chat_room_id");

-- CreateIndex
CREATE INDEX "message_sender_id_idx" ON "message"("sender_id");

-- CreateIndex
CREATE INDEX "action_draft_message_id_idx" ON "action_draft"("message_id");

-- CreateIndex
CREATE INDEX "action_draft_requester_id_idx" ON "action_draft"("requester_id");


-- ─────────────────────────────────────────────────────────────
-- ERD Note의 CHECK·부분 unique (Prisma 스키마로 표현할 수 없어 직접 둔다)
-- 값 목록은 공통 코드 정의서(shared/src/codes)와 같다. 코드를 바꾸면 새 마이그레이션으로 고친다.
-- ─────────────────────────────────────────────────────────────

-- item: 유형별 필수 컬럼 (컨벤션 7-2)
ALTER TABLE "item" ADD CONSTRAINT "item_type_columns_check" CHECK (
  ("item_type" = 'RAW_MATERIAL' AND "unit_type" = 'TON' AND "raw_material_type" IS NOT NULL
    AND "steel_grade_id" IS NULL AND "thickness_mm" IS NULL AND "width_mm" IS NULL AND "length_mm" IS NULL AND "theoretical_weight_ton" IS NULL)
  OR
  ("item_type" IN ('SLAB', 'COIL') AND "unit_type" = 'QTY' AND "raw_material_type" IS NULL
    AND "steel_grade_id" IS NOT NULL AND "thickness_mm" IS NOT NULL AND "width_mm" IS NOT NULL AND "length_mm" IS NOT NULL AND "theoretical_weight_ton" IS NOT NULL)
);

-- specific_consumption: 공통 원단위는 원료당 1행, 합금철은 원료·강종당 1행
CREATE UNIQUE INDEX "specific_consumption_common_key" ON "specific_consumption" ("raw_material_item_id") WHERE "steel_grade_id" IS NULL;
CREATE UNIQUE INDEX "specific_consumption_grade_key" ON "specific_consumption" ("raw_material_item_id", "steel_grade_id") WHERE "steel_grade_id" IS NOT NULL;

-- sales_order_item: 1 이상 정수 (REQ-SO-002)
ALTER TABLE "sales_order_item" ADD CONSTRAINT "sales_order_item_ordered_qty_check" CHECK ("ordered_qty" >= 1);

-- inventory: 가용 매수는 0 이상 (조건부 UPDATE와 함께, 컨벤션 8장)
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_available_qty_check" CHECK ("on_hand_qty" - "reserved_qty" - "rolling_allocated_qty" >= 0);

-- reservation
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_reserved_qty_check" CHECK ("reserved_qty" >= 1);
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_status_check" CHECK ("reservation_status" IN ('ACTIVE', 'CONVERTED', 'RELEASED'));

-- allocation: LOT당 CONFIRMED 1건, 목적별 연결 컬럼
CREATE UNIQUE INDEX "allocation_confirmed_lot_key" ON "allocation" ("lot_id") WHERE "allocation_status" = 'CONFIRMED';
ALTER TABLE "allocation" ADD CONSTRAINT "allocation_status_check" CHECK ("allocation_status" IN ('CONFIRMED', 'CONSUMED', 'RELEASED'));
ALTER TABLE "allocation" ADD CONSTRAINT "allocation_purpose_columns_check" CHECK (
  ("allocation_purpose" = 'SHIPMENT' AND "shipment_request_item_id" IS NOT NULL AND "production_plan_id" IS NULL)
  OR
  ("allocation_purpose" = 'HOT_ROLLING' AND "production_plan_id" IS NOT NULL AND "shipment_request_item_id" IS NULL)
);

-- production_result: 제선은 고로, 제강은 전로 코드 필수
ALTER TABLE "production_result" ADD CONSTRAINT "production_result_equipment_code_check" CHECK (
  ("process_type" <> 'IRONMAKING' OR "blast_furnace_code" IS NOT NULL)
  AND ("process_type" <> 'STEELMAKING' OR "converter_code" IS NOT NULL)
);

-- lot: 잔량 0 이상, 유형별 필수값
ALTER TABLE "lot" ADD CONSTRAINT "lot_remaining_ton_check" CHECK ("remaining_ton" IS NULL OR "remaining_ton" >= 0);
ALTER TABLE "lot" ADD CONSTRAINT "lot_type_columns_check" CHECK (
  ("lot_type" = 'RAW_MATERIAL' AND "item_id" IS NOT NULL AND "goods_receipt_id" IS NOT NULL AND "remaining_ton" IS NOT NULL)
  OR ("lot_type" = 'HOT_METAL' AND "production_result_id" IS NOT NULL AND "remaining_ton" IS NOT NULL)
  OR ("lot_type" = 'HEAT' AND "steel_grade_id" IS NOT NULL AND "production_result_id" IS NOT NULL)
  OR ("lot_type" IN ('SLAB', 'COIL') AND "item_id" IS NOT NULL AND "production_result_id" IS NOT NULL AND "produced_date" IS NOT NULL)
);

-- lot_relation: 자기 연결 금지
ALTER TABLE "lot_relation" ADD CONSTRAINT "lot_relation_self_check" CHECK ("parent_lot_id" <> "child_lot_id");

-- 구매: 수량은 0보다 큼
ALTER TABLE "purchase_requisition" ADD CONSTRAINT "purchase_requisition_requested_ton_check" CHECK ("requested_ton" > 0);
ALTER TABLE "purchase_order_item" ADD CONSTRAINT "purchase_order_item_ordered_ton_check" CHECK ("ordered_ton" > 0);
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_received_ton_check" CHECK ("received_ton" > 0);

-- notification: 같은 메시지·작업 로그로 같은 사람에게 알림 중복 금지
CREATE UNIQUE INDEX "notification_message_recipient_key" ON "notification" ("message_id", "recipient_id") WHERE "message_id" IS NOT NULL;
CREATE UNIQUE INDEX "notification_business_event_recipient_key" ON "notification" ("business_event_id", "recipient_id") WHERE "business_event_id" IS NOT NULL;

-- chat_room: 업무방은 수주 필수
ALTER TABLE "chat_room" ADD CONSTRAINT "chat_room_work_sales_order_check" CHECK ("chat_room_type" <> 'WORK' OR "sales_order_id" IS NOT NULL);

-- action_draft: 같은 메시지·유형의 미처리 초안 1건, 상태값
CREATE UNIQUE INDEX "action_draft_open_message_type_key" ON "action_draft" ("message_id", "action_type")
  WHERE "draft_status" IN ('AI_GENERATED', 'WAITING_APPROVAL', 'APPROVED');
ALTER TABLE "action_draft" ADD CONSTRAINT "action_draft_status_check" CHECK ("draft_status" IN ('AI_GENERATED', 'WAITING_APPROVAL', 'APPROVED', 'EXECUTED', 'REJECTED'));
