// 작업 실적·실적 시뮬레이션 API (REQ-PRD-003·007, REQ-LOT-001~004, BP-PRD-02, 업무 프로세스 8장·9.2).
// 화면 이름은 '작업 실적'(용어 사전 TRM-047, PLAN 6-1). 작업 상태값은 없다: started_at / completed_at (null = 진행 중).
// 변경은 모두 PRODUCTION_RESULT_CONFIRM 사용 권한. LOT 채번·FIFO 차감·LOT 관계·작업 로그·계획 상태·진행 중 작업 확인은 서버가 처리한다.
// 열연 실적은 열연 투입 배정 화면(api/rolling.ts)에서 등록한다 (한 곳에서만).
// 서버를 부른다 (api/server/production.ts).
import { type InspectionResult, type ProcessType, type RawMaterialType } from '@/codes';
import { serverProductionResultApi } from '@/api/server/production';
import { type ProductionPlanListRow, type ProductionPlanView } from '@/api/production';

export interface SimulationStep {
  processType: 'IRONMAKING' | 'STEELMAKING' | 'CONTINUOUS_CASTING' | 'HOT_ROLLING';
  productionResultId: number;
  outputLotNos: string[];
  /** 연주: 계획 슬래브·샘플 손실률·손실 매수·실적 매수 */
  plannedQty?: number;
  sampleLossRate?: string;
  lossQty?: number;
  outputQty?: number;
}

export interface SimulationResult {
  productionPlanId: number;
  randomSeed: number;
  steps: SimulationStep[];
  skippedRolling: string | null;
}

export const productionResultKeys = {
  all: ['production-results'] as const,
  plans: () => ['production-results', 'plans'] as const,
  work: (planId: number) => ['production-results', 'work', planId] as const,
};

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
  heatNo: string;
  heatTon: string;
  /** 연주 최대 매수 = floor(히트 톤 × 연주 수율 ÷ 슬래브 1매 이론중량) */
  maxSlabQty: number;
  inspectionResult: InspectionResult;
}

/** 작업 시작만 기록한(완료 일시 없는) 실적. 연주는 시작 때 기록한 히트를 함께 (PRODUCTION_STARTED) */
export interface OpenWork {
  productionResultId: number;
  processType: ProcessType;
  startedAt: string;
  heatLotId: number | null;
  heatNo: string | null;
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
  /** 진행 중(작업 시작만 한) 실적. 있으면 같은 공정은 '작업 완료'로만 진행하고, 시뮬레이션은 막는다 */
  openWork: OpenWork[];
  /** 이 계획에서 마지막으로 쓴 고로·전로 코드 (입력 기본값) */
  lastBlastFurnaceCode: string | null;
  lastConverterCode: string | null;
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

export const productionResultApi = {
  /** 작업 실적 화면의 계획 목록 (취소 제외, 최근 것 먼저, 고객사 포함) */
  plans: (): Promise<ProductionPlanListRow[]> => serverProductionResultApi.plans(),

  /** 계획 하나의 실적·입력 기준값 */
  work: (productionPlanId: number): Promise<WorkContext> => serverProductionResultApi.work(productionPlanId),

  /** 작업 시작만 기록 (completed_at = null, PRODUCTION_STARTED). 첫 실적이면 계획이 진행중이 된다. */
  startWork: (input: StartWorkInput): Promise<{ productionResultId: number }> => serverProductionResultApi.startWork(input),

  /** 제선 실적 → 용선 LOT HM-고로-YYMMDD-NN, 원료 FIFO 차감(입고일 순), 원료→용선 기간 기반 LOT 관계 */
  registerIronmaking: (input: IronmakingResultInput): Promise<RegisteredResult> => serverProductionResultApi.registerIronmaking(input),

  /** 제강 실적 → 히트 HT-전로-YYMMDD-NNN (성분 검사 대상), 용선·합금철 FIFO 투입 */
  registerSteelmaking: (input: SteelmakingResultInput): Promise<RegisteredResult> => serverProductionResultApi.registerSteelmaking(input),

  /** 연주 실적 → 슬래브 LOT 히트번호-SS (표면·치수 검사 대상). 히트에서 나올 수 있는 매수를 넘으면 거부 */
  registerCasting: (input: CastingResultInput): Promise<RegisteredResult> => serverProductionResultApi.registerCasting(input),

  /**
   * 실적 시뮬레이션 (REQ-PRD-007, BP-SEED-01): 남은 공정의 실적을 고정 계획 수율로 만들고, 연주에서만 0~5% 손실.
   * 같은 시드·같은 상태 → 같은 결과. 검사값은 넣지 않는다. 작업 시작만 한 실적이 있으면 먼저 완료해야 한다.
   */
  simulate: (input: SimulateInput): Promise<SimulationResult> => serverProductionResultApi.simulate(input),
};

