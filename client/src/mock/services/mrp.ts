// MRP (REQ-PRD-005, BP-PRD-01, 업무 프로세스 4.4, 12.2 GET /mrp/requirements?from&to).
// - 실행 이력을 저장하지 않는다. 기간을 정해 바로 계산한다.
// - 대상: 계획·진행중 생산계획 중 아직 만들지 않은 히트가 있고 필요일이 기간 안인 것.
//   필요일(가정값) = 연결 수주 품목의 납기일 (리드타임 기준이 문서에 없다). 수주 연결이 없으면 계획 등록일.
// - 남은 히트 톤 → 필요 용선(÷ 제강 수율) → 철광석·석탄·석회석(× t/t), 합금철(히트 톤 × kg/t ÷ 1,000)
//   → 시점별로 원료 LOT 잔량·입고예정(필요일까지 도착하는 확정 발주의 미입고량)을 빼서 순소요. 같은 공급을 두 번 빼지 않는다.
// - 용선 잔량은 빼지 않는다(PLAN 7장). 예상 슬래브 여재를 함께 보여 준다(여재는 가용재고에 포함).
import type { RawMaterialType } from '@/codes';
import { decCmp, decMul, decSum, TON_DIGITS } from '@/lib/decimal';
import { ferroalloyTonFor, hotMetalTonFor, netRequirements, rawMaterialTonFor, type MrpRequirement, type MrpSupply } from '@/lib/mrp';
import type { MockTables, ProductionPlanRow } from '@/mock/schema';
import { findById, productionSettingOf, productItemTypeOf, routingYieldOf, seoulDateOf, steelGradeCodeOf } from '@/mock/services/context';
import { productionPlanView } from '@/mock/services/productionPlans';

type Tables = Readonly<MockTables>;

export interface MrpPlanRow {
  productionPlanId: number;
  productionPlanNo: string;
  productionPlanStatus: ProductionPlanRow['productionPlanStatus'];
  salesOrderNo: string | null;
  itemCode: string;
  itemName: string;
  steelGradeCode: string | null;
  needDate: string;
  remainingHeatCount: number;
  heatTon: string;
  requiredHotMetalTon: string;
  expectedSurplusSlabQty: number;
  materials: { itemId: number; itemCode: string; grossTon: string; netTon: string }[];
}

export interface MrpMaterialRow {
  itemId: number;
  itemCode: string;
  itemName: string;
  rawMaterialType: RawMaterialType | null;
  /** 원단위 단위: 합금철 kg/t(용강 1t당), 그 밖에 t/t(용선 1t당) */
  consumptionUnit: 'kg/t' | 't/t';
  grossTon: string;
  /** 원료 LOT 잔량 합계 (지금) */
  onHandTon: string;
  /** 확정 발주의 미입고량 합계 (전체) */
  scheduledReceiptTon: string;
  /** 소요를 채우는 데 쓴 잔량·입고예정 */
  coveredOnHandTon: string;
  coveredScheduledTon: string;
  netTon: string;
  /** 처음 부족이 생기는 필요일 */
  firstShortageDate: string | null;
}

export interface MrpRequisitionLine {
  productionPlanId: number;
  productionPlanNo: string;
  itemId: number;
  itemCode: string;
  itemName: string;
  netTon: string;
  needDate: string;
  /** 같은 계획·원료 구매요청이 이미 있으면 그 번호 (중복 생성 막기) */
  existingPurchaseRequisitionNo: string | null;
}

export interface MrpView {
  from: string;
  to: string;
  heatCapacityTon: string;
  plans: MrpPlanRow[];
  materials: MrpMaterialRow[];
  /** "구매요청 만들기" 미리 채움: 순소요 > 0인 계획·원료 줄 */
  requisitionLines: MrpRequisitionLine[];
}

/** 계획의 필요일 (가정값: 연결 수주 품목 납기, 없으면 계획 등록일) */
export function needDateOfPlan(tables: Tables, plan: ProductionPlanRow): string {
  return findById(tables, 'salesOrderItem', plan.salesOrderItemId)?.dueDate ?? seoulDateOf(plan.createdAt);
}

export function computeMrp(tables: Tables, period: { from: string; to: string }): MrpView {
  const setting = productionSettingOf(tables);
  const materials = tables.item.filter((i) => i.itemType === 'RAW_MATERIAL').sort((a, b) => a.id - b.id);
  const planRows: (MrpPlanRow & { requirements: MrpRequirement[] })[] = [];
  for (const plan of tables.productionPlan) {
    if (plan.productionPlanStatus !== 'PLANNED' && plan.productionPlanStatus !== 'IN_PROGRESS') continue;
    const needDate = needDateOfPlan(tables, plan);
    if (needDate < period.from || needDate > period.to) continue;
    const heatsMade = tables.lot.filter((l) => l.productionPlanId === plan.id && l.lotType === 'HEAT').length;
    const remainingHeatCount = Math.max(0, plan.heatCount - heatsMade);
    if (remainingHeatCount === 0) continue;
    const item = findById(tables, 'item', plan.itemId);
    if (!item) continue;
    const heatTon = decMul(setting.heatCapacityTon, remainingHeatCount, TON_DIGITS);
    const hotMetalTon = hotMetalTonFor(heatTon, routingYieldOf(tables, productItemTypeOf(item), 'STEELMAKING'));
    const requirements: MrpRequirement[] = materials.map((material) => {
      const isAlloy = material.rawMaterialType === 'FERROALLOY';
      const rate = tables.specificConsumption.find((c) => c.itemId === material.id && (isAlloy ? c.steelGradeId === item.steelGradeId : c.steelGradeId === null))?.consumptionRate;
      const grossTon = rate ? (isAlloy ? ferroalloyTonFor(heatTon, rate) : rawMaterialTonFor(hotMetalTon, rate)) : '0.000';
      return { planId: plan.id, materialId: material.id, needDate, grossTon };
    });
    const view = productionPlanView(tables, plan.id);
    planRows.push({
      productionPlanId: plan.id,
      productionPlanNo: plan.productionPlanNo,
      productionPlanStatus: plan.productionPlanStatus,
      salesOrderNo: view.salesOrder?.salesOrderNo ?? null,
      itemCode: item.itemCode,
      itemName: item.itemName,
      steelGradeCode: steelGradeCodeOf(tables, item.steelGradeId),
      needDate,
      remainingHeatCount,
      heatTon,
      requiredHotMetalTon: hotMetalTon,
      expectedSurplusSlabQty: view.formation?.expectedSurplusSlabQty ?? 0,
      materials: [],
      requirements,
    });
  }

  const supplies: MrpSupply[] = [
    ...tables.lot
      .filter((l) => l.lotType === 'RAW_MATERIAL' && l.lotStatus === 'AVAILABLE' && l.itemId !== null && l.remainingTon !== null && decCmp(l.remainingTon, 0) > 0)
      .map((l): MrpSupply => ({ kind: 'ON_HAND', materialId: l.itemId ?? 0, availableDate: null, ton: l.remainingTon ?? '0', reservedForPlanId: null, sourceId: l.id })),
    ...tables.purchaseOrderItem
      .filter((line) => decCmp(line.scheduledReceiptTon, 0) > 0)
      .flatMap((line): MrpSupply[] => {
        const po = findById(tables, 'purchaseOrder', line.purchaseOrderId);
        if (!po || po.purchaseOrderStatus === 'RECEIVED') return [];
        const planId = findById(tables, 'purchaseRequisitionItem', line.purchaseRequisitionItemId)?.productionPlanId ?? null;
        return [{ kind: 'SCHEDULED', materialId: line.itemId, availableDate: po.dueDate, ton: line.scheduledReceiptTon, reservedForPlanId: planId, sourceId: line.id }];
      }),
  ];
  const { lines } = netRequirements(
    planRows.flatMap((p) => p.requirements),
    supplies,
  );

  const plans: MrpPlanRow[] = planRows
    .sort((a, b) => a.needDate.localeCompare(b.needDate) || a.productionPlanId - b.productionPlanId)
    .map(({ requirements: _requirements, ...row }) => ({
      ...row,
      materials: lines
        .filter((l) => l.planId === row.productionPlanId)
        .map((l) => ({ itemId: l.materialId, itemCode: findById(tables, 'item', l.materialId)?.itemCode ?? '', grossTon: l.grossTon, netTon: l.netTon })),
    }));

  const materialRows: MrpMaterialRow[] = materials.map((material) => {
    const mine = lines.filter((l) => l.materialId === material.id);
    const shortageDates = mine.filter((l) => decCmp(l.netTon, 0) > 0).map((l) => l.needDate).sort();
    return {
      itemId: material.id,
      itemCode: material.itemCode,
      itemName: material.itemName,
      rawMaterialType: material.rawMaterialType,
      consumptionUnit: material.rawMaterialType === 'FERROALLOY' ? 'kg/t' : 't/t',
      grossTon: decSum(mine.map((l) => l.grossTon)),
      onHandTon: decSum(supplies.filter((s) => s.kind === 'ON_HAND' && s.materialId === material.id).map((s) => s.ton)),
      scheduledReceiptTon: decSum(supplies.filter((s) => s.kind === 'SCHEDULED' && s.materialId === material.id).map((s) => s.ton)),
      coveredOnHandTon: decSum(mine.map((l) => l.coveredOnHandTon)),
      coveredScheduledTon: decSum(mine.map((l) => l.coveredScheduledTon)),
      netTon: decSum(mine.map((l) => l.netTon)),
      firstShortageDate: shortageDates[0] ?? null,
    };
  });

  const requisitionLines: MrpRequisitionLine[] = lines
    .filter((l) => decCmp(l.netTon, 0) > 0)
    .map((l) => {
      const plan = findById(tables, 'productionPlan', l.planId);
      const material = findById(tables, 'item', l.materialId);
      const existing = tables.purchaseRequisitionItem.find((i) => i.productionPlanId === l.planId && i.itemId === l.materialId);
      return {
        productionPlanId: l.planId,
        productionPlanNo: plan?.productionPlanNo ?? '',
        itemId: l.materialId,
        itemCode: material?.itemCode ?? '',
        itemName: material?.itemName ?? '',
        netTon: l.netTon,
        needDate: l.needDate,
        existingPurchaseRequisitionNo: existing ? (findById(tables, 'purchaseRequisition', existing.purchaseRequisitionId)?.purchaseRequisitionNo ?? null) : null,
      };
    });

  return { from: period.from, to: period.to, heatCapacityTon: setting.heatCapacityTon, plans, materials: materialRows, requisitionLines };
}
