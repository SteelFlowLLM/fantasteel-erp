// 1단계 시드: 조직·기준정보만 (거래 데이터는 다음 단계에서 더한다).
// 문서에 값이 없는 것은 모두 가정값이다. 목록과 근거는 docs/rework/seed-assumptions.md에 있다.
import {
  formatSpecCode,
  ITEM_TYPE_UNIT_TYPE,
  PERMISSION,
  PERMISSIONS,
  ROLE,
  ROLE_LABEL,
  STEEL_GRADE_LABEL,
  type Permission,
  type ProcessType,
  type ProductItemType,
  type RawMaterialType,
  type RoleCode,
  type SteelGradeCode,
  type YardType,
} from '@/codes';
import { calcTheoreticalWeightTon } from '@/lib/weight';
import { createEmptyTables, type MockTables } from '@/mock/schema';
import { findRow, insertRow, updateRow, type MockTx } from '@/mock/store';

/** 시드 행의 생성·수정 시각: 2026-09-01 09:00 (Asia/Seoul) */
export const SEED_AT = '2026-09-01T00:00:00.000Z';

export const SEED_JOB_GRADES = [
  { jobGradeCode: 'GENERAL_MANAGER', jobGradeName: '부장', sortOrder: 10 },
  { jobGradeCode: 'DEPUTY_GENERAL_MANAGER', jobGradeName: '차장', sortOrder: 20 },
  { jobGradeCode: 'MANAGER', jobGradeName: '과장', sortOrder: 30 },
  { jobGradeCode: 'ASSISTANT_MANAGER', jobGradeName: '대리', sortOrder: 40 },
  { jobGradeCode: 'STAFF', jobGradeName: '사원', sortOrder: 50 },
] as const;
type JobGradeCode = (typeof SEED_JOB_GRADES)[number]['jobGradeCode'];

/** 부서 계층 (REQ-ORG-001 예: 생산부 하위 제선·제강·연주·열연 파트) */
export const SEED_DEPARTMENTS = [
  { departmentCode: 'SAL', departmentName: '영업부', parentCode: null, sortOrder: 1 },
  { departmentCode: 'PUR', departmentName: '구매부', parentCode: null, sortOrder: 2 },
  { departmentCode: 'PRD', departmentName: '생산부', parentCode: null, sortOrder: 3 },
  { departmentCode: 'PRD-IRON', departmentName: '제선파트', parentCode: 'PRD', sortOrder: 1 },
  { departmentCode: 'PRD-STEEL', departmentName: '제강파트', parentCode: 'PRD', sortOrder: 2 },
  { departmentCode: 'PRD-CAST', departmentName: '연주파트', parentCode: 'PRD', sortOrder: 3 },
  { departmentCode: 'PRD-HR', departmentName: '열연파트', parentCode: 'PRD', sortOrder: 4 },
  { departmentCode: 'QC', departmentName: '품질부', parentCode: null, sortOrder: 4 },
  { departmentCode: 'LOG', departmentName: '물류부', parentCode: null, sortOrder: 5 },
  { departmentCode: 'MGT', departmentName: '경영지원부', parentCode: null, sortOrder: 6 },
] as const;
type DepartmentCode = (typeof SEED_DEPARTMENTS)[number]['departmentCode'];

interface SeedEmployee {
  employeeNo: string;
  employeeName: string;
  departmentCode: DepartmentCode;
  jobGradeCode: JobGradeCode;
  roleCode: RoleCode;
  /** 이 사원이 부서장인 부서 (부서장은 역할이 아니다) */
  headOf?: DepartmentCode;
}

/** 역할마다 1명 이상, 부서마다 부서장 1명 */
export const SEED_EMPLOYEES: readonly SeedEmployee[] = [
  { employeeNo: '1503001', employeeName: '이현정', departmentCode: 'MGT', jobGradeCode: 'GENERAL_MANAGER', roleCode: 'ADMIN', headOf: 'MGT' },
  { employeeNo: '1608002', employeeName: '김도윤', departmentCode: 'SAL', jobGradeCode: 'GENERAL_MANAGER', roleCode: 'SALES', headOf: 'SAL' },
  { employeeNo: '2103003', employeeName: '박서영', departmentCode: 'SAL', jobGradeCode: 'ASSISTANT_MANAGER', roleCode: 'SALES' },
  { employeeNo: '1702004', employeeName: '최준혁', departmentCode: 'PUR', jobGradeCode: 'GENERAL_MANAGER', roleCode: 'PURCHASE', headOf: 'PUR' },
  { employeeNo: '2207005', employeeName: '정다은', departmentCode: 'PUR', jobGradeCode: 'STAFF', roleCode: 'PURCHASE' },
  { employeeNo: '1401006', employeeName: '강민석', departmentCode: 'PRD', jobGradeCode: 'GENERAL_MANAGER', roleCode: 'PRODUCTION', headOf: 'PRD' },
  { employeeNo: '1709007', employeeName: '윤성호', departmentCode: 'PRD-IRON', jobGradeCode: 'DEPUTY_GENERAL_MANAGER', roleCode: 'PRODUCTION', headOf: 'PRD-IRON' },
  { employeeNo: '1804008', employeeName: '장혜린', departmentCode: 'PRD-STEEL', jobGradeCode: 'MANAGER', roleCode: 'PRODUCTION', headOf: 'PRD-STEEL' },
  { employeeNo: '1906009', employeeName: '임재원', departmentCode: 'PRD-CAST', jobGradeCode: 'MANAGER', roleCode: 'PRODUCTION', headOf: 'PRD-CAST' },
  { employeeNo: '2001010', employeeName: '한승우', departmentCode: 'PRD-HR', jobGradeCode: 'MANAGER', roleCode: 'PRODUCTION', headOf: 'PRD-HR' },
  { employeeNo: '2402011', employeeName: '조은서', departmentCode: 'PRD-STEEL', jobGradeCode: 'STAFF', roleCode: 'PRODUCTION' },
  { employeeNo: '1802012', employeeName: '오지훈', departmentCode: 'QC', jobGradeCode: 'GENERAL_MANAGER', roleCode: 'QUALITY', headOf: 'QC' },
  { employeeNo: '2205013', employeeName: '서민지', departmentCode: 'QC', jobGradeCode: 'ASSISTANT_MANAGER', roleCode: 'QUALITY' },
  { employeeNo: '1610014', employeeName: '신현우', departmentCode: 'LOG', jobGradeCode: 'GENERAL_MANAGER', roleCode: 'LOGISTICS', headOf: 'LOG' },
  { employeeNo: '2304015', employeeName: '권예진', departmentCode: 'LOG', jobGradeCode: 'STAFF', roleCode: 'LOGISTICS' },
];

/**
 * 역할별 기본 권한.
 * USE = 업무 프로세스 정의서 2장 그대로. VIEW = 업무 흐름을 따라가는 데 필요한 만큼 정한 가정값(확인 필요).
 */
export const SEED_ROLE_PERMISSIONS: Record<RoleCode, { use: readonly Permission[]; view: readonly Permission[] }> = {
  SALES: {
    use: [PERMISSION.SALES_ORDER_CREATE, PERMISSION.SALES_ORDER_CANCEL, PERMISSION.SHIPMENT_REQUEST_MANAGE],
    view: [PERMISSION.PRODUCTION_PLAN_CONFIRM, PERMISSION.GOODS_ISSUE_CONFIRM, PERMISSION.MILL_SHEET_READ],
  },
  PURCHASE: {
    use: [PERMISSION.PURCHASE_REQUISITION_CREATE, PERMISSION.PURCHASE_ORDER_CONFIRM, PERMISSION.GOODS_RECEIPT_CONFIRM],
    view: [PERMISSION.PRODUCTION_PLAN_CONFIRM],
  },
  PRODUCTION: {
    use: [PERMISSION.PRODUCTION_PLAN_CONFIRM, PERMISSION.PRODUCTION_RESULT_CONFIRM, PERMISSION.HOT_ROLLING_ALLOCATE],
    view: [PERMISSION.SALES_ORDER_CREATE, PERMISSION.PURCHASE_REQUISITION_CREATE, PERMISSION.INSPECTION_REGISTER],
  },
  QUALITY: {
    use: [PERMISSION.INSPECTION_REGISTER, PERMISSION.DISPOSITION_SET, PERMISSION.INSPECTION_STANDARD_MANAGE],
    view: [PERMISSION.PRODUCTION_RESULT_CONFIRM, PERMISSION.MILL_SHEET_READ],
  },
  LOGISTICS: {
    use: [PERMISSION.GOODS_ISSUE_CONFIRM, PERMISSION.MILL_SHEET_READ],
    view: [PERMISSION.SHIPMENT_REQUEST_MANAGE],
  },
  ADMIN: {
    use: [PERMISSION.EMPLOYEE_MANAGE, PERMISSION.ORG_MANAGE, PERMISSION.MASTER_MANAGE],
    view: PERMISSIONS.filter((p) => p !== PERMISSION.EMPLOYEE_MANAGE && p !== PERMISSION.ORG_MANAGE && p !== PERMISSION.MASTER_MANAGE),
  },
};

/** 강종 6종과 적용 규격 번호 (공통 코드 STEEL_GRADE, docs/rework/ks-values.md 1장). SPHC는 연도 없이. */
export const SEED_STEEL_GRADES: readonly { steelGradeCode: SteelGradeCode; standardNo: string }[] = [
  { steelGradeCode: 'SS275', standardNo: 'KS D 3503:2026' },
  { steelGradeCode: 'SM355A', standardNo: 'KS D 3515:2018' },
  { steelGradeCode: 'SM355B', standardNo: 'KS D 3515:2018' },
  { steelGradeCode: 'SM355C', standardNo: 'KS D 3515:2018' },
  { steelGradeCode: 'SM355D', standardNo: 'KS D 3515:2018' },
  { steelGradeCode: 'SPHC', standardNo: 'KS D 3501' },
];

export const SEED_CUSTOMERS = [
  { customerCode: 'CUS-01', customerName: '가람중공업' },
  { customerCode: 'CUS-02', customerName: '나래조선' },
  { customerCode: 'CUS-03', customerName: '다온건설' },
  { customerCode: 'CUS-04', customerName: '보람강관' },
] as const;

export const SEED_SUPPLIERS = [
  { supplierCode: 'SUP-01', supplierName: '가온광업' },
  { supplierCode: 'SUP-02', supplierName: '누리에너지' },
  { supplierCode: 'SUP-03', supplierName: '소담광물' },
  { supplierCode: 'SUP-04', supplierName: '하람합금철' },
] as const;
type SupplierCode = (typeof SEED_SUPPLIERS)[number]['supplierCode'];

export const SEED_YARDS: readonly { yardCode: string; yardName: string; yardType: YardType }[] = [
  { yardCode: 'YD-RM-01', yardName: '원료 1야드', yardType: 'RAW_MATERIAL' },
  { yardCode: 'YD-SL-01', yardName: '슬래브 1야드', yardType: 'SLAB' },
  { yardCode: 'YD-CL-01', yardName: '코일 1야드', yardType: 'COIL' },
];

/** 원료 4종 (REQ-MST-001 원료 코드 예, 컨벤션 7-4) */
export const SEED_RAW_MATERIALS: readonly {
  itemCode: string;
  itemName: string;
  rawMaterialType: RawMaterialType;
  supplierCode: SupplierCode;
}[] = [
  { itemCode: 'ORE01', itemName: '철광석', rawMaterialType: 'IRON_ORE', supplierCode: 'SUP-01' },
  { itemCode: 'COL01', itemName: '석탄', rawMaterialType: 'COAL', supplierCode: 'SUP-02' },
  { itemCode: 'LIM01', itemName: '석회석', rawMaterialType: 'LIMESTONE', supplierCode: 'SUP-03' },
  { itemCode: 'SMN01', itemName: '실리코망가니즈', rawMaterialType: 'FERROALLOY', supplierCode: 'SUP-04' },
];

/** 규격을 만드는 강종 4종 (SM355C·D는 강종만 등록, REQ-MST-002) */
export const SEED_SPEC_GRADES: readonly SteelGradeCode[] = ['SS275', 'SM355A', 'SM355B', 'SPHC'];

interface Dimensions {
  thicknessMm: string;
  widthMm: string;
  lengthMm: string;
}

/**
 * 슬래브 규격 3종과 대응 코일 (decimal(8,2)·(10,2) 자리수로 저장).
 * 슬래브 250×1200×10000·250×1500×10000은 문서 예시, 220×1400×9500은 가정값.
 * 코일: 폭은 슬래브와 같고, 두께는 KS 구간 경계를 피하면서 6mm 이하·초과를 섞고,
 * 길이는 코일 이론중량이 슬래브보다 조금 작게(열연 계획 수율 약 0.98) 정했다.
 */
export const SEED_SLAB_COIL_DIMENSIONS: readonly { slab: Dimensions; coil: Dimensions }[] = [
  {
    slab: { thicknessMm: '250.00', widthMm: '1200.00', lengthMm: '10000.00' },
    coil: { thicknessMm: '2.30', widthMm: '1200.00', lengthMm: '1065000.00' },
  },
  {
    slab: { thicknessMm: '250.00', widthMm: '1500.00', lengthMm: '10000.00' },
    coil: { thicknessMm: '4.50', widthMm: '1500.00', lengthMm: '544000.00' },
  },
  {
    slab: { thicknessMm: '220.00', widthMm: '1400.00', lengthMm: '9500.00' },
    coil: { thicknessMm: '9.00', widthMm: '1400.00', lengthMm: '227500.00' },
  },
];

/** 라우팅과 공정별 계획 수율 (기획안: 시연용 가정값). 제선은 4.4 계산식에 쓰지 않아 비우고, 열연은 규격 매핑에서 계산한다. */
export const SEED_ROUTINGS: readonly { itemType: ProductItemType; processType: ProcessType; processSeq: number; plannedYieldRate: string | null }[] = [
  { itemType: 'SLAB', processType: 'IRONMAKING', processSeq: 1, plannedYieldRate: null },
  { itemType: 'SLAB', processType: 'STEELMAKING', processSeq: 2, plannedYieldRate: '0.9000' },
  { itemType: 'SLAB', processType: 'CONTINUOUS_CASTING', processSeq: 3, plannedYieldRate: '0.9800' },
  { itemType: 'COIL', processType: 'IRONMAKING', processSeq: 1, plannedYieldRate: null },
  { itemType: 'COIL', processType: 'STEELMAKING', processSeq: 2, plannedYieldRate: '0.9000' },
  { itemType: 'COIL', processType: 'CONTINUOUS_CASTING', processSeq: 3, plannedYieldRate: '0.9800' },
  { itemType: 'COIL', processType: 'HOT_ROLLING', processSeq: 4, plannedYieldRate: null },
];

/** 배합 원단위 (가정값). 철광석·석탄·석회석은 용선 1t당 t(공통), 합금철은 용강 1t당 kg(강종별). */
export const SEED_SPECIFIC_CONSUMPTIONS: readonly { itemCode: string; steelGradeCode: SteelGradeCode | null; consumptionRate: string }[] = [
  { itemCode: 'ORE01', steelGradeCode: null, consumptionRate: '1.600' },
  { itemCode: 'COL01', steelGradeCode: null, consumptionRate: '0.600' },
  { itemCode: 'LIM01', steelGradeCode: null, consumptionRate: '0.150' },
  { itemCode: 'SMN01', steelGradeCode: 'SS275', consumptionRate: '10.000' },
  { itemCode: 'SMN01', steelGradeCode: 'SM355A', consumptionRate: '20.000' },
  { itemCode: 'SMN01', steelGradeCode: 'SM355B', consumptionRate: '20.000' },
  { itemCode: 'SMN01', steelGradeCode: 'SPHC', consumptionRate: '4.000' },
];

/** 생산 설정값 (REQ-MST-009 초기값) */
export const SEED_PRODUCTION_SETTING = { heatCapacityTon: '250.000', deliveryRiskDays: 3 } as const;

const trimDecimal = (value: string) => (value.includes('.') ? value.replace(/\.?0+$/, '') : value);
const specItemName = (itemType: ProductItemType, steelGradeCode: string, d: Dimensions) =>
  `${steelGradeCode} ${itemType === 'SLAB' ? '슬래브' : '코일'} ${trimDecimal(d.thicknessMm)}×${trimDecimal(d.widthMm)}×${trimDecimal(d.lengthMm)}`;

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`시드 참조를 찾지 못했어요: ${what}`);
  return value;
}

export function createSeedTables(): MockTables {
  const tx: MockTx = { tables: createEmptyTables(), now: new Date(SEED_AT), nowIso: SEED_AT };

  const jobGradeId = new Map(SEED_JOB_GRADES.map((g) => [g.jobGradeCode, insertRow(tx, 'jobGrade', { ...g }).id]));

  const roleId = new Map(
    Object.values(ROLE).map((roleCode) => [roleCode, insertRow(tx, 'role', { roleCode, roleName: ROLE_LABEL[roleCode] }).id]),
  );
  for (const roleCode of Object.values(ROLE)) {
    const { use, view } = SEED_ROLE_PERMISSIONS[roleCode];
    const id = required(roleId.get(roleCode), roleCode);
    for (const permission of PERMISSIONS) {
      if (use.includes(permission)) insertRow(tx, 'rolePermission', { roleId: id, permission, permissionLevel: 'USE' });
      else if (view.includes(permission)) insertRow(tx, 'rolePermission', { roleId: id, permission, permissionLevel: 'VIEW' });
    }
  }

  const departmentId = new Map<string, number>();
  for (const d of SEED_DEPARTMENTS) {
    const parentId = d.parentCode ? required(departmentId.get(d.parentCode), d.parentCode) : null;
    const row = insertRow(tx, 'department', {
      departmentCode: d.departmentCode,
      departmentName: d.departmentName,
      parentId,
      headEmployeeId: null,
      sortOrder: d.sortOrder,
    });
    departmentId.set(d.departmentCode, row.id);
  }

  for (const e of SEED_EMPLOYEES) {
    const row = insertRow(tx, 'employee', {
      employeeNo: e.employeeNo,
      employeeName: e.employeeName,
      passwordHash: '',
      departmentId: required(departmentId.get(e.departmentCode), e.departmentCode),
      jobGradeId: required(jobGradeId.get(e.jobGradeCode), e.jobGradeCode),
      roleId: required(roleId.get(e.roleCode), e.roleCode),
      isActive: true,
      lastLoginAt: null,
    });
    if (e.headOf) updateRow(tx, 'department', required(departmentId.get(e.headOf), e.headOf), { headEmployeeId: row.id });
  }

  const steelGradeId = new Map(
    SEED_STEEL_GRADES.map((g) => [
      g.steelGradeCode,
      insertRow(tx, 'steelGrade', { steelGradeCode: g.steelGradeCode, steelGradeName: STEEL_GRADE_LABEL[g.steelGradeCode], standardNo: g.standardNo }).id,
    ]),
  );

  for (const c of SEED_CUSTOMERS) insertRow(tx, 'customer', { ...c });
  const supplierId = new Map(SEED_SUPPLIERS.map((s) => [s.supplierCode, insertRow(tx, 'supplier', { ...s }).id]));
  const yardIdByType = new Map(SEED_YARDS.map((y) => [y.yardType, insertRow(tx, 'yard', { ...y }).id]));
  const yardOf = (yardType: YardType) => required(yardIdByType.get(yardType), yardType);

  const itemId = new Map<string, number>();
  for (const m of SEED_RAW_MATERIALS) {
    const row = insertRow(tx, 'item', {
      itemCode: m.itemCode,
      itemName: m.itemName,
      itemType: 'RAW_MATERIAL',
      unitType: ITEM_TYPE_UNIT_TYPE.RAW_MATERIAL,
      rawMaterialType: m.rawMaterialType,
      steelGradeId: null,
      thicknessMm: null,
      widthMm: null,
      lengthMm: null,
      theoreticalWeightTon: null,
      defaultYardId: yardOf('RAW_MATERIAL'),
      defaultSupplierId: required(supplierId.get(m.supplierCode), m.supplierCode),
    });
    itemId.set(m.itemCode, row.id);
  }

  const addProductSpec = (itemType: ProductItemType, steelGradeCode: SteelGradeCode, d: Dimensions) =>
    insertRow(tx, 'item', {
      itemCode: formatSpecCode(itemType, steelGradeCode, d.thicknessMm, d.widthMm, d.lengthMm),
      itemName: specItemName(itemType, steelGradeCode, d),
      itemType,
      unitType: ITEM_TYPE_UNIT_TYPE[itemType],
      rawMaterialType: null,
      steelGradeId: required(steelGradeId.get(steelGradeCode), steelGradeCode),
      thicknessMm: d.thicknessMm,
      widthMm: d.widthMm,
      lengthMm: d.lengthMm,
      theoreticalWeightTon: calcTheoreticalWeightTon(d.thicknessMm, d.widthMm, d.lengthMm),
      defaultYardId: yardOf(itemType),
      defaultSupplierId: null,
    }).id;

  const slabIds: number[] = [];
  for (const grade of SEED_SPEC_GRADES) for (const pair of SEED_SLAB_COIL_DIMENSIONS) slabIds.push(addProductSpec('SLAB', grade, pair.slab));
  const coilIds: number[] = [];
  for (const grade of SEED_SPEC_GRADES) for (const pair of SEED_SLAB_COIL_DIMENSIONS) coilIds.push(addProductSpec('COIL', grade, pair.coil));
  slabIds.forEach((slabItemId, index) => {
    insertRow(tx, 'specMapping', { slabItemId, coilItemId: required(coilIds[index], `coil ${index}`) });
  });

  for (const r of SEED_ROUTINGS) insertRow(tx, 'routing', { ...r });

  for (const c of SEED_SPECIFIC_CONSUMPTIONS) {
    insertRow(tx, 'specificConsumption', {
      itemId: required(itemId.get(c.itemCode), c.itemCode),
      steelGradeId: c.steelGradeCode ? required(steelGradeId.get(c.steelGradeCode), c.steelGradeCode) : null,
      consumptionRate: c.consumptionRate,
    });
  }

  insertRow(tx, 'productionSetting', { ...SEED_PRODUCTION_SETTING });

  // 부서장 지정이 빠진 부서가 없는지 시드를 만들 때 확인한다
  for (const d of tx.tables.department) {
    if (!findRow(tx.tables, 'employee', d.headEmployeeId)) throw new Error(`부서장이 없는 부서: ${d.departmentName}`);
  }
  return tx.tables;
}
