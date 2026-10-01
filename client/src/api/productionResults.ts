// 작업 실적·실적 시뮬레이션 API (REQ-PRD-003·007, REQ-LOT-001~004, BP-PRD-02, 업무 프로세스 8장·9.2).
// 화면 이름은 '작업 실적'(용어 사전 TRM-047, PLAN 6-1). 작업 상태값은 없다: started_at / completed_at (null = 진행 중).
// 변경은 모두 PRODUCTION_RESULT_CONFIRM 사용 권한. LOT 채번·FIFO 차감·LOT 관계·작업 로그·계획 상태는 core 서비스가 처리한다.
// 열연 실적은 열연 투입 배정 화면(api/rolling.ts)에서 등록한다 (한 곳에서만).
import { PERMISSION, type ProcessType, type RawMaterialType } from '@/codes';
import { mockMutation, mockQuery } from '@/api/client';
import { requireActor } from '@/api/actor';
import { decSum } from '@/lib/decimal';
import { hotMetalTonFor } from '@/lib/mrp';
import type { MockTables } from '@/mock/schema';
import {
  findById,
  inputError,
  listProductionPlans,
  maxCastingQtyOf,
  mustGet,
  productionPlanView,
  productionSettingOf,
  productItemTypeOf,
  registerCasting,
  registerIronmaking,
  registerSteelmaking,
  routingYieldOf,
  simulatePlan,
  startWork,
  userActor,
  type ProductionPlanSummary,
  type ProductionPlanView,
  type SimulationResult,
} from '@/mock/services';

type Tables = Readonly<MockTables>;

export const productionResultKeys = {
  all: ['production-results'] as const,
  plans: () => ['production-results', 'plans'] as const,
  work: (planId: number) => ['production-results', 'work', planId] as const,
};

const RESULT_VIEW = [PERMISSION.PRODUCTION_RESULT_CONFIRM] as const;
const RESULT_USE = [PERMISSION.PRODUCTION_RESULT_CONFIRM] as const;

/** 실적 시뮬레이션의 고로·전로 코드 기본값 (core simulation.ts와 같은 값, 가정값) */
export const SIMULATION_DEFAULT_CODES = { blastFurnaceCode: 'BF2', converterCode: 'BOF1' } as const;

/** 난수 시드 범위 (32비트 양의 정수) */
export const MAX_RANDOM_SEED = 2_147_483_647;

export interface RawMaterialStock {
  itemId: number;
  itemCode: string;
  itemName: string;
  rawMaterialType: RawMaterialType;
  /** 배합 원단위: 철광석·석탄·석회석 = t/t(용선 1t당), 합금철 = kg/t(용강 1t당) */
  consumptionRate: string;
  /** 미소진 원료 LOT 잔량 합계 */
  remainingTon: string;
}

export interface UncastHeat {
  heatLotId: number;
  heatLotNo: string;
  heatTon: string;
  /** 연주 최대 매수 = floor(히트 톤 × 연주 수율 ÷ 슬래브 1매 이론중량) */
  maxSlabQty: number;
  inspectionResult: 'PENDING' | 'PASS' | 'FAIL';
}

/** 작업 실적 화면의 계획 하나: 편성·실적 + 입력에 필요한 기준값 */
export interface WorkContext {
  plan: ProductionPlanView;
  /** 실적을 등록할 수 있는 계획인지 (계획·진행중) */
  isOpen: boolean;
  steelmakingYieldRate: string;
  castingYieldRate: string;
  heatCapacityTon: string;
  /** 히트 1개에 필요한 용선 = 히트 용량 ÷ 제강 수율 (4.4) */
  hotMetalTonPerHeat: string;
  /** 사용 가능한 용선 LOT (생산 순 FIFO) */
  hotMetalLots: { lotNo: string; producedDate: string; remainingTon: string }[];
  hotMetalAvailableTon: string;
  /** 제선에 쓰는 공통 원료(철광석·석탄·석회석) */
  ironmakingMaterials: RawMaterialStock[];
  /** 이 계획 강종의 합금철 */
  ferroalloys: RawMaterialStock[];
  /** 아직 만들지 않은 히트 수 */
  heatsToMakeQty: number;
  uncastHeats: UncastHeat[];
  /** 이 계획에서 마지막으로 쓴 고로·전로 코드 (입력 기본값) */
  lastBlastFurnaceCode: string | null;
  lastConverterCode: string | null;
}

function remainingTonOf(tables: Tables, itemId: number): string {
  return decSum(tables.lot.filter((l) => l.lotType === 'RAW_MATERIAL' && l.itemId === itemId && l.lotStatus === 'AVAILABLE').map((l) => l.remainingTon ?? '0'));
}

function workContextOf(tables: Tables, planId: number): WorkContext {
  const plan = productionPlanView(tables, planId);
  const planRow = mustGet(tables, 'productionPlan', planId, '생산계획');
  const item = mustGet(tables, 'item', planRow.itemId, '규격');
  const productType = productItemTypeOf(item);
  const steelmakingYieldRate = routingYieldOf(tables, productType, 'STEELMAKING');
  const castingYieldRate = routingYieldOf(tables, productType, 'CONTINUOUS_CASTING');
  const { heatCapacityTon } = productionSettingOf(tables);
  const hotMetalLots = tables.lot
    .filter((l) => l.lotType === 'HOT_METAL' && l.lotStatus === 'AVAILABLE')
    .sort((a, b) => a.producedDate.localeCompare(b.producedDate) || a.lotNo.localeCompare(b.lotNo))
    .map((l) => ({ lotNo: l.lotNo, producedDate: l.producedDate, remainingTon: l.remainingTon ?? '0.000' }));
  const stockOf = (consumption: MockTables['specificConsumption'][number]): RawMaterialStock | null => {
    const material = findById(tables, 'item', consumption.itemId);
    if (!material || !material.rawMaterialType) return null;
    return {
      itemId: material.id,
      itemCode: material.itemCode,
      itemName: material.itemName,
      rawMaterialType: material.rawMaterialType,
      consumptionRate: consumption.consumptionRate,
      remainingTon: remainingTonOf(tables, material.id),
    };
  };
  const common = tables.specificConsumption.filter((c) => c.steelGradeId === null).map(stockOf);
  const alloys = tables.specificConsumption.filter((c) => c.steelGradeId !== null && c.steelGradeId === item.steelGradeId).map(stockOf);
  const heats = tables.lot.filter((l) => l.productionPlanId === planId && l.lotType === 'HEAT').sort((a, b) => a.id - b.id);
  const uncastHeats = heats
    .filter((h) => !tables.lot.some((l) => l.heatLotId === h.id && l.lotType === 'SLAB'))
    .map((h) => ({
      heatLotId: h.id,
      heatLotNo: h.lotNo,
      heatTon: h.initialTon ?? '0.000',
      maxSlabQty: maxCastingQtyOf({ tables: tables as MockTables }, planRow, h),
      inspectionResult: h.isPassed === true ? ('PASS' as const) : h.isPassed === false ? ('FAIL' as const) : ('PENDING' as const),
    }));
  const results = tables.productionResult.filter((r) => r.productionPlanId === planId).sort((a, b) => b.id - a.id);
  return {
    plan,
    isOpen: plan.productionPlanStatus === 'PLANNED' || plan.productionPlanStatus === 'IN_PROGRESS',
    steelmakingYieldRate,
    castingYieldRate,
    heatCapacityTon,
    hotMetalTonPerHeat: hotMetalTonFor(heatCapacityTon, steelmakingYieldRate),
    hotMetalLots,
    hotMetalAvailableTon: decSum(hotMetalLots.map((l) => l.remainingTon)),
    ironmakingMaterials: common.filter((m): m is RawMaterialStock => m !== null && m.rawMaterialType !== 'FERROALLOY'),
    ferroalloys: alloys.filter((m): m is RawMaterialStock => m !== null && m.rawMaterialType === 'FERROALLOY'),
    heatsToMakeQty: Math.max(0, plan.progress.heatCount - plan.progress.heatsMadeQty),
    uncastHeats,
    lastBlastFurnaceCode: results.find((r) => r.blastFurnaceCode)?.blastFurnaceCode ?? null,
    lastConverterCode: results.find((r) => r.converterCode)?.converterCode ?? null,
  };
}

export interface StartWorkInput {
  productionPlanId: number;
  processType: Exclude<ProcessType, 'HOT_ROLLING'>;
  startedAt: string;
  blastFurnaceCode?: string | null;
  converterCode?: string | null;
  heatLotId?: number | null;
}

export interface IronmakingResultInput {
  productionPlanId: number;
  blastFurnaceCode: string;
  startedAt: string;
  completedAt: string;
  /** 용선량(t) */
  outputTon: string;
  /** 작업 시작만 기록한 실적을 완료할 때 */
  productionResultId?: number | null;
}

export interface SteelmakingResultInput {
  productionPlanId: number;
  converterCode: string;
  startedAt: string;
  completedAt: string;
  /** 투입 용선량(t). 용선 LOT은 생산 순 FIFO로 자동 선택 */
  inputHotMetalTon: string;
  productionResultId?: number | null;
}

export interface CastingResultInput {
  productionPlanId: number;
  heatLotId: number;
  /** 슬래브 생산 매수 (정수) */
  outputQty: number;
  startedAt: string;
  completedAt: string;
  productionResultId?: number | null;
}

export interface RegisteredResult {
  productionResultId: number;
  outputLotNos: string[];
}

export interface SimulateInput {
  productionPlanId: number;
  /** 난수 시드 (비우면 실행 시각으로 정하고 결과에 보여 준다) */
  randomSeed?: number | null;
}

/** 고로·전로 코드는 대문자로 받는다 (예: bf2 → BF2) */
const codeOf = (value: string | null | undefined): string => (value ?? '').trim().toUpperCase();

export const productionResultApi = {
  /** 작업 실적 화면의 계획 목록 (취소 제외, 최근 것 먼저) */
  plans: (): Promise<ProductionPlanSummary[]> =>
    mockQuery((tables) => {
      requireActor(tables, { view: RESULT_VIEW });
      return listProductionPlans(tables).filter((p) => p.productionPlanStatus !== 'CANCELLED');
    }),

  /** 계획 하나의 실적·입력 기준값 */
  work: (productionPlanId: number): Promise<WorkContext> =>
    mockQuery((tables) => {
      requireActor(tables, { view: RESULT_VIEW });
      return workContextOf(tables, productionPlanId);
    }),

  /** 작업 시작만 기록 (completed_at = null, PRODUCTION_STARTED). 첫 실적이면 계획이 진행중이 된다. */
  startWork: (input: StartWorkInput): Promise<{ productionResultId: number }> =>
    mockMutation((tx) => {
      const actor = requireActor(tx.tables, { use: RESULT_USE });
      const result = startWork(tx, userActor(actor.employee.id), {
        productionPlanId: input.productionPlanId,
        processType: input.processType,
        startedAt: input.startedAt,
        blastFurnaceCode: input.processType === 'IRONMAKING' ? codeOf(input.blastFurnaceCode) : null,
        converterCode: input.processType === 'STEELMAKING' ? codeOf(input.converterCode) : null,
        heatLotId: input.processType === 'CONTINUOUS_CASTING' ? (input.heatLotId ?? null) : null,
      });
      return { productionResultId: result.id };
    }),

  /** 제선 실적 → 용선 LOT HM-고로-YYMMDD-NN, 원료 FIFO 차감(입고일 순), 원료→용선 기간 기반 LOT 관계 */
  registerIronmaking: (input: IronmakingResultInput): Promise<RegisteredResult> =>
    mockMutation((tx) => {
      const actor = requireActor(tx.tables, { use: RESULT_USE });
      const { result, hotMetalLot } = registerIronmaking(tx, userActor(actor.employee.id), { ...input, blastFurnaceCode: codeOf(input.blastFurnaceCode) });
      return { productionResultId: result.id, outputLotNos: [hotMetalLot.lotNo] };
    }),

  /** 제강 실적 → 히트 HT-전로-YYMMDD-NNN (성분 검사 대상), 용선·합금철 FIFO 투입 */
  registerSteelmaking: (input: SteelmakingResultInput): Promise<RegisteredResult> =>
    mockMutation((tx) => {
      const actor = requireActor(tx.tables, { use: RESULT_USE });
      const { result, heatLot } = registerSteelmaking(tx, userActor(actor.employee.id), { ...input, converterCode: codeOf(input.converterCode) });
      return { productionResultId: result.id, outputLotNos: [heatLot.lotNo] };
    }),

  /** 연주 실적 → 슬래브 LOT 히트번호-SS (표면·치수 검사 대상). 히트에서 나올 수 있는 매수를 넘으면 거부 */
  registerCasting: (input: CastingResultInput): Promise<RegisteredResult> =>
    mockMutation((tx) => {
      const actor = requireActor(tx.tables, { use: RESULT_USE });
      if (!Number.isInteger(input.outputQty)) inputError('outputQty', '슬래브 생산 매수는 1 이상의 정수로 입력해 주세요');
      const { result, slabLots } = registerCasting(tx, userActor(actor.employee.id), input);
      return { productionResultId: result.id, outputLotNos: slabLots.map((s) => s.lotNo) };
    }),

  /**
   * 실적 시뮬레이션 (REQ-PRD-007, BP-SEED-01): 남은 공정의 실적을 고정 계획 수율로 만들고, 연주에서만 0~5% 손실.
   * 같은 시드·같은 상태 → 같은 결과. 검사값은 넣지 않는다.
   */
  simulate: (input: SimulateInput): Promise<SimulationResult> =>
    mockMutation((tx) => {
      const actor = requireActor(tx.tables, { use: RESULT_USE });
      const seed = input.randomSeed ?? null;
      if (seed !== null && (!Number.isInteger(seed) || seed < 0 || seed > MAX_RANDOM_SEED)) {
        inputError('randomSeed', `난수 시드는 0 ~ ${MAX_RANDOM_SEED.toLocaleString('en-US')} 사이의 정수로 입력해 주세요`);
      }
      return simulatePlan(tx, userActor(actor.employee.id), { productionPlanId: input.productionPlanId, randomSeed: seed, ...SIMULATION_DEFAULT_CODES });
    }),
};

export type { SimulationResult };
