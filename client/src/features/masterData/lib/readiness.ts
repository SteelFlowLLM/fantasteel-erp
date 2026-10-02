// 기준정보 준비 상태 (BP-MST-01 구현 제안 "누락을 표시한다", 9.3 MST-001 "수율·배합·규격 매핑·검사 기준 누락").
// 생산·MRP 계산(업무 프로세스 4.4)에 필요한 기준정보가 모두 있는지 본다. 화면 위쪽 준비 상태 띠가 쓴다.
// - 수율: 라우팅의 제강·연주 계획 수율 (열연은 규격 매핑에서 계산, 제선은 4.4 계산에 쓰지 않아 보지 않는다)
// - 배합 원단위: 용선 1t당 철광석·석탄·석회석(공통), 규격이 있는 강종마다 용강 1t당 합금철
// - 규격 매핑: 슬래브 규격마다 대응 코일 1개, 코일 규격마다 대응 슬래브, 대응 코일 중복
// - 검사 기준: 규격이 있는 강종 × 그 품목 유형 라우팅의 검사 공정(제강·연주·열연)마다 지금 버전
// - 기본 공급업체: 원료 품목마다 1곳 (REQ-MST-007)
import { ITEM_TYPE_LABEL, PROCESS_TYPE_LABEL, RAW_MATERIAL_TYPE_LABEL, type ProcessType, type ProductItemType, type RawMaterialType } from '@/codes';
import { findCurrentStandard, isInspectedProcess } from '@/features/inspectionStandards/lib/standardItems';
import { withEunNeun, withIGa } from '@/lib/josa';
import { compareDecimal } from '@/lib/weight';
import type { ItemRow, MockTables } from '@/mock/schema';

export const READINESS_AREAS = ['ROUTING', 'SPECIFIC_CONSUMPTION', 'SPEC_MAPPING', 'INSPECTION_STANDARD', 'DEFAULT_SUPPLIER', 'PRODUCT_SPEC', 'PRODUCTION_SETTING'] as const;
export type ReadinessArea = (typeof READINESS_AREAS)[number];

export interface ReadinessProblem {
  area: ReadinessArea;
  /** 문제마다 다른 키 (목록 key) */
  key: string;
  message: string;
  /** 검사 기준 누락일 때 바로 가기용 */
  processType?: ProcessType;
  steelGradeId?: number;
}

export interface MasterReadiness {
  ready: boolean;
  problems: ReadinessProblem[];
}

/** 계획 수율을 꼭 넣어야 하는 공정 (4.4: 제강 수율로 필요 용선, 연주 수율로 누적 계획 수율) */
export const REQUIRED_YIELD_PROCESS_TYPES = ['STEELMAKING', 'CONTINUOUS_CASTING'] as const satisfies readonly ProcessType[];
/** 용선 1t당 공통 원단위가 있어야 하는 원료 유형 (REQ-MST-006) */
export const HOT_METAL_RAW_MATERIAL_TYPES = ['IRON_ORE', 'COAL', 'LIMESTONE'] as const satisfies readonly RawMaterialType[];

const PRODUCT_ITEM_TYPES: readonly ProductItemType[] = ['SLAB', 'COIL'];

const isProduct = (item: ItemRow): item is ItemRow & { itemType: ProductItemType } => item.itemType !== 'RAW_MATERIAL';

export function computeMasterReadiness(tables: Readonly<MockTables>): MasterReadiness {
  const problems: ReadinessProblem[] = [];
  const products = tables.item.filter(isProduct);
  const findGradeCode = (id: number | null) => tables.steelGrade.find((g) => g.id === id)?.steelGradeCode ?? '-';

  // 수율 (라우팅)
  for (const itemType of PRODUCT_ITEM_TYPES) {
    if (!products.some((p) => p.itemType === itemType)) continue;
    const label = `${ITEM_TYPE_LABEL[itemType]} 라우팅`;
    const steps = tables.routing.filter((r) => r.itemType === itemType);
    const required: ProcessType[] = itemType === 'COIL' ? [...REQUIRED_YIELD_PROCESS_TYPES, 'HOT_ROLLING'] : [...REQUIRED_YIELD_PROCESS_TYPES];
    for (const processType of required) {
      const step = steps.find((s) => s.processType === processType);
      if (!step) {
        problems.push({ area: 'ROUTING', key: `routing-${itemType}-${processType}`, message: `${label}에 ${PROCESS_TYPE_LABEL[processType]} 공정이 없어요` });
      } else if (processType !== 'HOT_ROLLING') {
        const rate = step.plannedYieldRate;
        if (rate === null) {
          problems.push({ area: 'ROUTING', key: `routing-${itemType}-${processType}`, message: `${label}의 ${PROCESS_TYPE_LABEL[processType]} 계획 수율이 없어요` });
        } else if (compareDecimal(rate, '0') <= 0 || compareDecimal(rate, '1') > 0) {
          problems.push({ area: 'ROUTING', key: `routing-${itemType}-${processType}`, message: `${label}의 ${PROCESS_TYPE_LABEL[processType]} 계획 수율 ${withEunNeun(rate)} 0보다 크고 1 이하여야 해요` });
        }
      }
    }
  }

  // 배합 원단위
  const rawMaterials = tables.item.filter((i) => i.itemType === 'RAW_MATERIAL');
  for (const rawMaterialType of HOT_METAL_RAW_MATERIAL_TYPES) {
    const ids = new Set(rawMaterials.filter((m) => m.rawMaterialType === rawMaterialType).map((m) => m.id));
    if (!tables.specificConsumption.some((c) => ids.has(c.itemId) && c.steelGradeId === null)) {
      problems.push({
        area: 'SPECIFIC_CONSUMPTION',
        key: `consumption-${rawMaterialType}`,
        message: `${RAW_MATERIAL_TYPE_LABEL[rawMaterialType]} 원단위(용선 1t당)가 없어요`,
      });
    }
  }
  const ferroalloyIds = new Set(rawMaterials.filter((m) => m.rawMaterialType === 'FERROALLOY').map((m) => m.id));
  const specGradeIds = [...new Set(products.map((p) => p.steelGradeId).filter((id): id is number => id !== null))].sort((a, b) => a - b);
  for (const steelGradeId of specGradeIds) {
    if (!tables.specificConsumption.some((c) => ferroalloyIds.has(c.itemId) && c.steelGradeId === steelGradeId)) {
      problems.push({ area: 'SPECIFIC_CONSUMPTION', key: `consumption-ferroalloy-${steelGradeId}`, message: `${findGradeCode(steelGradeId)} 합금철 원단위(용강 1t당)가 없어요` });
    }
  }

  // 규격 매핑
  for (const product of products) {
    if (product.itemType === 'SLAB') {
      if (!tables.specMapping.some((m) => m.slabItemId === product.id)) {
        problems.push({ area: 'SPEC_MAPPING', key: `mapping-slab-${product.id}`, message: `${product.itemCode}의 대응 코일 규격이 없어요` });
      }
    } else {
      const count = tables.specMapping.filter((m) => m.coilItemId === product.id).length;
      if (count === 0) problems.push({ area: 'SPEC_MAPPING', key: `mapping-coil-${product.id}`, message: `${product.itemCode}의 대응 슬래브 규격이 없어요` });
      if (count > 1) problems.push({ area: 'SPEC_MAPPING', key: `mapping-coil-dup-${product.id}`, message: `${withIGa(product.itemCode)} 슬래브 규격 ${count}개에 대응 코일로 중복 지정됐어요` });
    }
  }

  // 0 이하 중량 (BP-MST-01)
  for (const product of products) {
    if (product.theoreticalWeightTon === null || compareDecimal(product.theoreticalWeightTon, '0') <= 0) {
      problems.push({ area: 'PRODUCT_SPEC', key: `weight-${product.id}`, message: `${product.itemCode}의 1매 이론중량이 0 이하예요` });
    }
  }

  // 검사 기준
  for (const steelGradeId of specGradeIds) {
    const itemTypes = PRODUCT_ITEM_TYPES.filter((t) => products.some((p) => p.itemType === t && p.steelGradeId === steelGradeId));
    const processTypes = new Set<ProcessType>();
    for (const itemType of itemTypes) {
      for (const step of tables.routing.filter((r) => r.itemType === itemType)) if (isInspectedProcess(step.processType)) processTypes.add(step.processType);
    }
    for (const processType of ['STEELMAKING', 'CONTINUOUS_CASTING', 'HOT_ROLLING'] as const) {
      if (!processTypes.has(processType)) continue;
      const standard = findCurrentStandard(tables.inspectionStandard, processType, steelGradeId);
      const hasItems = standard ? tables.inspectionStandardItem.some((i) => i.inspectionStandardId === standard.id) : false;
      if (!standard || !hasItems) {
        problems.push({
          area: 'INSPECTION_STANDARD',
          key: `standard-${steelGradeId}-${processType}`,
          message: standard ? `${findGradeCode(steelGradeId)} ${PROCESS_TYPE_LABEL[processType]} 검사 기준에 검사 항목이 없어요` : `${findGradeCode(steelGradeId)} ${PROCESS_TYPE_LABEL[processType]} 검사 기준이 없어요`,
          processType,
          steelGradeId,
        });
      }
    }
  }

  // 기본 공급업체
  for (const material of rawMaterials) {
    if (material.defaultSupplierId === null) {
      problems.push({ area: 'DEFAULT_SUPPLIER', key: `supplier-${material.id}`, message: `${material.itemCode} ${material.itemName}의 기본 공급업체가 없어요` });
    }
  }

  if (tables.productionSetting.length === 0) {
    problems.push({ area: 'PRODUCTION_SETTING', key: 'production-setting', message: '생산 설정값(히트 용량·납기 위험 기준일)이 없어요' });
  }

  return { ready: problems.length === 0, problems };
}
