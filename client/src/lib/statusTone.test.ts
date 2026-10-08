// 상태 배지 색: 같은 상태는 어느 화면에서든 같은 색이다. 공통 코드 그룹마다 색 맵은 lib/statusTone.ts 한 곳에만 있다.
// 화면마다 따로 맵을 두면 한 화면은 노랑, 다른 화면은 회색처럼 어긋났다 (생산계획 취소·계획, LOT 상태, 배정 소진, 불합격 상태).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ALLOCATION_STATUS_LABEL,
  DISPOSITION_STATUS_LABEL,
  INSPECTION_RESULT_LABEL,
  LOT_STATUS_LABEL,
  PRODUCTION_PLAN_STATUS_LABEL,
  PURCHASE_REQUISITION_STATUS_LABEL,
  SALES_ORDER_ITEM_STATUS_LABEL,
  SHIPMENT_REQUEST_STATUS_LABEL,
  type AllocationStatus,
  type DispositionStatus,
  type InspectionResult,
  type LotStatus,
  type ProductionPlanStatus,
  type PurchaseRequisitionStatus,
  type SalesOrderItemStatus,
  type ShipmentRequestStatus,
} from '@/codes';
import { Badge, type BadgeTone } from '@/components/Badge';
import { getRequisitionStatusDisplay } from '@/features/actionDrafts/lib/draftDisplay';
import { lotStatusTone } from '@/features/inventory/lib/inventoryDisplay';
import { InspectionBadge, LotStatusBadge, ShipmentStatusBadge } from '@/features/lotTrace/components/TraceBits';
import { PlanStatusBadge as ProductionPlanBadge } from '@/features/production/components/PlanBadges';
import { PlanStatusBadge as PurchasingPlanBadge, RequisitionStatusBadge } from '@/features/purchasing/components/PurchasingParts';
import { DispositionBadge, ResultBadge } from '@/features/quality/components/QualityBadges';
import { PlanStatusBadge as SalesPlanBadge, SalesOrderStatusBadge } from '@/features/sales/components/SalesOrderParts';
import { AllocationStatusBadge, InspectionResultBadge, SalesOrderItemStatusBadge, ShipmentRequestStatusBadge } from '@/features/shipment/components/ShipmentBadges';
import {
  ALLOCATION_STATUS_TONE,
  INSPECTION_RESULT_TONE,
  LOT_STATUS_TONE,
  PRODUCTION_PLAN_STATUS_TONE,
  PURCHASE_REQUISITION_STATUS_TONE,
  SALES_ORDER_ITEM_STATUS_TONE,
  SHIPMENT_REQUEST_STATUS_TONE,
} from '@/lib/statusTone';

const keysOf = <T extends string>(labels: Readonly<Record<T, string>>): T[] => Object.keys(labels) as T[];

/** 배지의 class 속성 (색은 class로 정해진다) */
const classOf = (element: ReactElement): string => /class="([^"]*)"/.exec(renderToStaticMarkup(element))?.[1] ?? '';
const toneClass = (tone: BadgeTone): string => classOf(createElement(Badge, { tone, children: '라벨' }));

describe('공통 상태 그룹의 배지 색', () => {
  it('상태마다 색이 있고, 정한 색은 이렇다', () => {
    expect(PRODUCTION_PLAN_STATUS_TONE).toEqual({ PLANNED: 'wait', IN_PROGRESS: 'run', COMPLETED: 'ok', CANCELLED: 'neutral' });
    expect(SALES_ORDER_ITEM_STATUS_TONE).toEqual({ OPEN: 'run', PARTIALLY_SHIPPED: 'wait', SHIPPED: 'ok', CANCELLED: 'danger' });
    expect(SHIPMENT_REQUEST_STATUS_TONE).toEqual({ REQUESTED: 'wait', ALLOCATED: 'run', ISSUED: 'ok', CANCELLED: 'neutral' });
    expect(ALLOCATION_STATUS_TONE).toEqual({ CONFIRMED: 'run', CONSUMED: 'ok', RELEASED: 'neutral' });
    expect(INSPECTION_RESULT_TONE).toEqual({ PENDING: 'wait', PASS: 'ok', FAIL: 'danger' });
    expect(LOT_STATUS_TONE).toEqual({ AVAILABLE: 'run', CONSUMED: 'neutral', SHIPPED: 'neutral' });
    expect(PURCHASE_REQUISITION_STATUS_TONE).toEqual({ WAITING_APPROVAL: 'wait', APPROVED: 'run', REJECTED: 'danger', ORDERED: 'ok' });
  });

  it('공통 코드가 늘어도 색이 빠지지 않는다 (맵 키 = 공통 코드 값)', () => {
    expect(Object.keys(PRODUCTION_PLAN_STATUS_TONE).sort()).toEqual(keysOf(PRODUCTION_PLAN_STATUS_LABEL).sort());
    expect(Object.keys(SALES_ORDER_ITEM_STATUS_TONE).sort()).toEqual(keysOf(SALES_ORDER_ITEM_STATUS_LABEL).sort());
    expect(Object.keys(SHIPMENT_REQUEST_STATUS_TONE).sort()).toEqual(keysOf(SHIPMENT_REQUEST_STATUS_LABEL).sort());
    expect(Object.keys(ALLOCATION_STATUS_TONE).sort()).toEqual(keysOf(ALLOCATION_STATUS_LABEL).sort());
    expect(Object.keys(INSPECTION_RESULT_TONE).sort()).toEqual(keysOf(INSPECTION_RESULT_LABEL).sort());
    expect(Object.keys(LOT_STATUS_TONE).sort()).toEqual(keysOf(LOT_STATUS_LABEL).sort());
    expect(Object.keys(PURCHASE_REQUISITION_STATUS_TONE).sort()).toEqual(keysOf(PURCHASE_REQUISITION_STATUS_LABEL).sort());
  });
});

describe('같은 상태는 화면이 달라도 같은 색으로 그려진다', () => {
  it('생산계획 상태: 생산·수주·구매 화면 (취소 = 회색, 계획 = 노랑)', () => {
    for (const status of keysOf<ProductionPlanStatus>(PRODUCTION_PLAN_STATUS_LABEL)) {
      const expected = toneClass(PRODUCTION_PLAN_STATUS_TONE[status]);
      expect(classOf(createElement(ProductionPlanBadge, { status }))).toBe(expected);
      expect(classOf(createElement(SalesPlanBadge, { status }))).toBe(expected);
      expect(classOf(createElement(PurchasingPlanBadge, { status }))).toBe(expected);
    }
  });

  it('수주 품목 상태: 수주·출하 화면', () => {
    for (const status of keysOf<SalesOrderItemStatus>(SALES_ORDER_ITEM_STATUS_LABEL)) {
      const expected = toneClass(SALES_ORDER_ITEM_STATUS_TONE[status]);
      expect(classOf(createElement(SalesOrderStatusBadge, { status }))).toBe(expected);
      expect(classOf(createElement(SalesOrderItemStatusBadge, { status }))).toBe(expected);
    }
  });

  it('출하요청 상태: 출하·LOT 추적 화면', () => {
    for (const status of keysOf<ShipmentRequestStatus>(SHIPMENT_REQUEST_STATUS_LABEL)) {
      const expected = toneClass(SHIPMENT_REQUEST_STATUS_TONE[status]);
      expect(classOf(createElement(ShipmentRequestStatusBadge, { status }))).toBe(expected);
      expect(classOf(createElement(ShipmentStatusBadge, { status }))).toBe(expected);
    }
  });

  it('배정 상태: 출하·재고 화면 (소진 = 초록)', () => {
    for (const status of keysOf<AllocationStatus>(ALLOCATION_STATUS_LABEL)) {
      expect(classOf(createElement(AllocationStatusBadge, { status }))).toBe(toneClass(ALLOCATION_STATUS_TONE[status]));
    }
    expect(ALLOCATION_STATUS_TONE.CONSUMED).toBe('ok');
  });

  it('검사 판정: 품질·출하·LOT 추적 화면', () => {
    for (const result of keysOf<InspectionResult>(INSPECTION_RESULT_LABEL)) {
      const expected = toneClass(INSPECTION_RESULT_TONE[result]);
      expect(classOf(createElement(ResultBadge, { result }))).toBe(expected);
      expect(classOf(createElement(InspectionResultBadge, { result }))).toBe(expected);
      expect(classOf(createElement(InspectionBadge, { result }))).toBe(expected);
    }
  });

  it('LOT 상태: 재고·LOT 추적 화면 (재고 = 파랑, 소진·출고 = 회색)', () => {
    for (const status of keysOf<LotStatus>(LOT_STATUS_LABEL)) {
      expect(lotStatusTone(status)).toBe(LOT_STATUS_TONE[status]);
      expect(classOf(createElement(LotStatusBadge, { status }))).toBe(toneClass(LOT_STATUS_TONE[status]));
    }
  });

  it('구매요청 상태: 구매·메시지 초안 화면', () => {
    for (const status of keysOf<PurchaseRequisitionStatus>(PURCHASE_REQUISITION_STATUS_LABEL)) {
      const expected = toneClass(PURCHASE_REQUISITION_STATUS_TONE[status]);
      expect(classOf(createElement(RequisitionStatusBadge, { status }))).toBe(expected);
      expect(getRequisitionStatusDisplay(status).tone).toBe(PURCHASE_REQUISITION_STATUS_TONE[status]);
    }
  });

  it('불합격 처리 상태: 품질 화면의 배지 색(보류 = 노랑, 격하 = 파랑, 폐기 = 빨강)을 재고 화면도 같이 쓴다', () => {
    const tones: Record<DispositionStatus, BadgeTone> = { HOLD: 'wait', DOWNGRADED: 'run', SCRAPPED: 'danger' };
    for (const status of keysOf<DispositionStatus>(DISPOSITION_STATUS_LABEL)) {
      expect(classOf(createElement(DispositionBadge, { status }))).toBe(toneClass(tones[status]));
    }
  });
});

describe('색 맵은 한 곳에만 둔다', () => {
  const SRC = fileURLToPath(new URL('../', import.meta.url));
  const files = ['features', 'components'].flatMap((dir) =>
    readdirSync(join(SRC, dir), { recursive: true })
      .map(String)
      .filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name))
      .map((name) => join(dir, name)),
  );

  it('여러 화면에 나오는 공통 상태 그룹의 `Record<상태, BadgeTone>` 맵을 화면 폴더에 따로 만들지 않는다', () => {
    const groups = ['ProductionPlanStatus', 'SalesOrderItemStatus', 'ShipmentRequestStatus', 'AllocationStatus', 'InspectionResult', 'LotStatus', 'PurchaseRequisitionStatus'];
    const offenders = files.flatMap((file) => {
      const text = readFileSync(join(SRC, file), 'utf8');
      return groups.filter((group) => new RegExp(`Record<${group},\\s*BadgeTone>`).test(text)).map((group) => `${file}: ${group}`);
    });
    expect(offenders).toEqual([]);
    expect(files.length).toBeGreaterThan(100);
  });
});
