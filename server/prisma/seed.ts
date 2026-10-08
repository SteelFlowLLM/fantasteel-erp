// 시드: 조직·권한·기준정보·검사 기준 (코드 컨벤션 7-4). 거래 데이터(수주·LOT 등)는 넣지 않는다.
// 반복 실행해도 결과가 같다(unique 키로 upsert, unique가 없는 테이블은 찾아서 고치거나 만든다).
// 문서에 값이 없는 것은 가정값이며 근거는 docs/backend/seed.md에 있다.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from 'bcryptjs';
import {
  calcTheoreticalWeightTon,
  PERMISSION,
  ROLE_LABEL,
  type Permission,
  type PermissionLevel,
  type ProcessType,
  type RawMaterialType,
  type Role,
  type YardType,
} from '@fantasteel/shared';
import { PrismaClient } from '../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:54322/fantasteel' }),
});

/** 테스트 계정 비밀번호 (모든 사원 같음). 로컬·시연용 */
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'fantasteel';

// ── 조직 ────────────────────────────────────────────────

const JOB_GRADES = [
  { jobGradeName: '부장', sortOrder: 10 },
  { jobGradeName: '차장', sortOrder: 20 },
  { jobGradeName: '과장', sortOrder: 30 },
  { jobGradeName: '대리', sortOrder: 40 },
  { jobGradeName: '사원', sortOrder: 50 },
] as const;
type JobGradeName = (typeof JOB_GRADES)[number]['jobGradeName'];

/** 부서 계층 (REQ-ORG-001 예: 생산부 하위 제선·제강·연주·열연 파트) */
const DEPARTMENTS = [
  { departmentCode: 'SAL', departmentName: '영업부', parentCode: null },
  { departmentCode: 'PUR', departmentName: '구매부', parentCode: null },
  { departmentCode: 'PRD', departmentName: '생산부', parentCode: null },
  { departmentCode: 'PRD-IRON', departmentName: '제선파트', parentCode: 'PRD' },
  { departmentCode: 'PRD-STEEL', departmentName: '제강파트', parentCode: 'PRD' },
  { departmentCode: 'PRD-CAST', departmentName: '연주파트', parentCode: 'PRD' },
  { departmentCode: 'PRD-HR', departmentName: '열연파트', parentCode: 'PRD' },
  { departmentCode: 'QC', departmentName: '품질부', parentCode: null },
  { departmentCode: 'LOG', departmentName: '물류부', parentCode: null },
  { departmentCode: 'MGT', departmentName: '경영지원부', parentCode: null },
] as const;
type DepartmentCode = (typeof DEPARTMENTS)[number]['departmentCode'];

/** 역할마다 1명 이상, 부서마다 부서장 1명 (부서장은 역할이 아니다, REQ-AUTH-004) */
const EMPLOYEES: { employeeNo: string; employeeName: string; department: DepartmentCode; jobGrade: JobGradeName; role: Role; headOf?: DepartmentCode }[] = [
  { employeeNo: '1503001', employeeName: '이현정', department: 'MGT', jobGrade: '부장', role: 'ADMIN', headOf: 'MGT' },
  { employeeNo: '1608002', employeeName: '김도윤', department: 'SAL', jobGrade: '부장', role: 'SALES', headOf: 'SAL' },
  { employeeNo: '2103003', employeeName: '박서영', department: 'SAL', jobGrade: '대리', role: 'SALES' },
  { employeeNo: '1702004', employeeName: '최준혁', department: 'PUR', jobGrade: '부장', role: 'PURCHASE', headOf: 'PUR' },
  { employeeNo: '2207005', employeeName: '정다은', department: 'PUR', jobGrade: '사원', role: 'PURCHASE' },
  { employeeNo: '1401006', employeeName: '강민석', department: 'PRD', jobGrade: '부장', role: 'PRODUCTION', headOf: 'PRD' },
  { employeeNo: '1709007', employeeName: '윤성호', department: 'PRD-IRON', jobGrade: '차장', role: 'PRODUCTION', headOf: 'PRD-IRON' },
  { employeeNo: '1804008', employeeName: '장혜린', department: 'PRD-STEEL', jobGrade: '과장', role: 'PRODUCTION', headOf: 'PRD-STEEL' },
  { employeeNo: '1906009', employeeName: '임재원', department: 'PRD-CAST', jobGrade: '과장', role: 'PRODUCTION', headOf: 'PRD-CAST' },
  { employeeNo: '2001010', employeeName: '한승우', department: 'PRD-HR', jobGrade: '과장', role: 'PRODUCTION', headOf: 'PRD-HR' },
  { employeeNo: '2402011', employeeName: '조은서', department: 'PRD-STEEL', jobGrade: '사원', role: 'PRODUCTION' },
  { employeeNo: '1802012', employeeName: '오지훈', department: 'QC', jobGrade: '부장', role: 'QUALITY', headOf: 'QC' },
  { employeeNo: '2205013', employeeName: '서민지', department: 'QC', jobGrade: '대리', role: 'QUALITY' },
  { employeeNo: '1610014', employeeName: '신현우', department: 'LOG', jobGrade: '부장', role: 'LOGISTICS', headOf: 'LOG' },
  { employeeNo: '2304015', employeeName: '권예진', department: 'LOG', jobGrade: '사원', role: 'LOGISTICS' },
];

/**
 * 역할별 기본 권한: docs/notion/roles-permissions/역할별 메뉴 (v2) 3장 표 그대로. ● = USE, ○ = VIEW, 빈칸 = 행 없음.
 * 열 순서: 영업 · 구매 · 생산 · 품질 · 물류 · 관리자
 */
const ROLE_ORDER: Role[] = ['SALES', 'PURCHASE', 'PRODUCTION', 'QUALITY', 'LOGISTICS', 'ADMIN'];
const ROLE_PERMISSION_TABLE: [Permission, string][] = [
  [PERMISSION.SALES_ORDER_CREATE, '● _ ○ _ ○ ○'],
  [PERMISSION.SALES_ORDER_CANCEL, '● _ _ _ _ ○'],
  [PERMISSION.SHIPMENT_REQUEST_MANAGE, '● _ _ _ ○ ○'],
  [PERMISSION.PURCHASE_REQUISITION_CREATE, '_ ● ○ _ _ ○'],
  [PERMISSION.PURCHASE_ORDER_CONFIRM, '_ ● _ _ _ ○'],
  [PERMISSION.GOODS_RECEIPT_CONFIRM, '_ ● _ _ ○ ○'],
  [PERMISSION.PRODUCTION_PLAN_CONFIRM, '○ ○ ● ○ _ ○'],
  [PERMISSION.PRODUCTION_RESULT_CONFIRM, '_ _ ● ○ _ ○'],
  [PERMISSION.HOT_ROLLING_ALLOCATE, '_ _ ● _ _ ○'],
  [PERMISSION.INSPECTION_REGISTER, '_ _ ○ ● _ ○'],
  [PERMISSION.INSPECTION_STANDARD_MANAGE, '_ _ ○ ● _ ○'],
  [PERMISSION.DISPOSITION_SET, '_ _ _ ● _ ○'],
  [PERMISSION.GOODS_ISSUE_CONFIRM, '○ _ _ ○ ● ○'],
  [PERMISSION.MILL_SHEET_READ, '○ _ _ ○ ● ○'],
  [PERMISSION.EMPLOYEE_MANAGE, '_ _ _ _ _ ●'],
  [PERMISSION.ORG_MANAGE, '_ _ _ _ _ ●'],
  [PERMISSION.MASTER_MANAGE, '○ ○ ○ ○ _ ●'],
];

// ── 기준정보 ─────────────────────────────────────────────

/** 강종 6종과 적용 규격 번호 (공통 코드 정의서 STEEL_GRADE, KS 규격 정리). SPHC는 판 연도 확인 전이라 번호만 */
const STEEL_GRADES = [
  { steelGradeCode: 'SS275', steelGradeName: 'SS275', standardNo: 'KS D 3503:2026' },
  { steelGradeCode: 'SM355A', steelGradeName: 'SM355A', standardNo: 'KS D 3515:2018' },
  { steelGradeCode: 'SM355B', steelGradeName: 'SM355B', standardNo: 'KS D 3515:2018' },
  { steelGradeCode: 'SM355C', steelGradeName: 'SM355C', standardNo: 'KS D 3515:2018' },
  { steelGradeCode: 'SM355D', steelGradeName: 'SM355D', standardNo: 'KS D 3515:2018' },
  { steelGradeCode: 'SPHC', steelGradeName: 'SPHC', standardNo: 'KS D 3501' },
] as const;
type SteelGradeCode = (typeof STEEL_GRADES)[number]['steelGradeCode'];

const CUSTOMERS = [
  { customerCode: 'CUS-01', customerName: '가람중공업' },
  { customerCode: 'CUS-02', customerName: '나래조선' },
  { customerCode: 'CUS-03', customerName: '다온건설' },
  { customerCode: 'CUS-04', customerName: '보람강관' },
];

const SUPPLIERS = [
  { supplierCode: 'SUP-01', supplierName: '가온광업' },
  { supplierCode: 'SUP-02', supplierName: '누리에너지' },
  { supplierCode: 'SUP-03', supplierName: '소담광물' },
  { supplierCode: 'SUP-04', supplierName: '하람합금철' },
];

const YARDS: { yardCode: string; yardName: string; yardType: YardType }[] = [
  { yardCode: 'YD-RM-01', yardName: '원료 1야드', yardType: 'RAW_MATERIAL' },
  { yardCode: 'YD-SL-01', yardName: '슬래브 1야드', yardType: 'SLAB' },
  { yardCode: 'YD-CL-01', yardName: '코일 1야드', yardType: 'COIL' },
];

/** 원료 4종 (컨벤션 7-4) */
const RAW_MATERIALS: { itemCode: string; itemName: string; rawMaterialType: RawMaterialType; supplierCode: string }[] = [
  { itemCode: 'ORE01', itemName: '철광석', rawMaterialType: 'IRON_ORE', supplierCode: 'SUP-01' },
  { itemCode: 'COL01', itemName: '석탄', rawMaterialType: 'COAL', supplierCode: 'SUP-02' },
  { itemCode: 'LIM01', itemName: '석회석', rawMaterialType: 'LIMESTONE', supplierCode: 'SUP-03' },
  { itemCode: 'SMN01', itemName: '실리코망가니즈', rawMaterialType: 'FERROALLOY', supplierCode: 'SUP-04' },
];

/** 규격을 만드는 강종 4종. SM355C·D는 강종만 등록 (REQ-MST-002) */
const SPEC_GRADES: SteelGradeCode[] = ['SS275', 'SM355A', 'SM355B', 'SPHC'];

interface Dimensions {
  thicknessMm: string;
  widthMm: string;
  lengthMm: string;
}
/**
 * 슬래브 규격 3종과 대응 코일 (ERD: 치수 decimal(8,2)).
 * 슬래브 250×1200×10000·250×1500×10000은 문서 예시, 220×1400×9500은 가정값.
 * 코일 폭은 슬래브와 같고 길이는 코일 이론중량이 슬래브보다 조금 작게(열연 계획 수율 약 0.98) 정했다.
 * 코일 길이는 decimal(8,2) 최대값(999,999.99mm) 안에 들게 했다.
 */
const SLAB_COIL_DIMENSIONS: { slab: Dimensions; coil: Dimensions }[] = [
  { slab: { thicknessMm: '250.00', widthMm: '1200.00', lengthMm: '10000.00' }, coil: { thicknessMm: '2.50', widthMm: '1200.00', lengthMm: '980000.00' } },
  { slab: { thicknessMm: '250.00', widthMm: '1500.00', lengthMm: '10000.00' }, coil: { thicknessMm: '4.50', widthMm: '1500.00', lengthMm: '544000.00' } },
  { slab: { thicknessMm: '220.00', widthMm: '1400.00', lengthMm: '9500.00' }, coil: { thicknessMm: '9.00', widthMm: '1400.00', lengthMm: '227500.00' } },
];

/** 라우팅과 공정별 계획 수율 (시연용 가정값, 기획안). 제선은 4.4 계산식에 쓰지 않아 비우고, 열연은 규격 매핑에서 계산 */
const ROUTINGS: { itemType: 'SLAB' | 'COIL'; processType: ProcessType; sequenceNo: number; plannedYieldRate: string | null }[] = [
  { itemType: 'SLAB', processType: 'IRONMAKING', sequenceNo: 1, plannedYieldRate: null },
  { itemType: 'SLAB', processType: 'STEELMAKING', sequenceNo: 2, plannedYieldRate: '0.9000' },
  { itemType: 'SLAB', processType: 'CONTINUOUS_CASTING', sequenceNo: 3, plannedYieldRate: '0.9800' },
  { itemType: 'COIL', processType: 'IRONMAKING', sequenceNo: 1, plannedYieldRate: null },
  { itemType: 'COIL', processType: 'STEELMAKING', sequenceNo: 2, plannedYieldRate: '0.9000' },
  { itemType: 'COIL', processType: 'CONTINUOUS_CASTING', sequenceNo: 3, plannedYieldRate: '0.9800' },
  { itemType: 'COIL', processType: 'HOT_ROLLING', sequenceNo: 4, plannedYieldRate: null },
];

/** 배합 원단위 (가정값). 철광석·석탄·석회석은 용선 1t당 t(공통), 합금철은 용강 1t당 kg(강종별) */
const SPECIFIC_CONSUMPTIONS: { itemCode: string; steelGradeCode: SteelGradeCode | null; consumptionRate: string }[] = [
  { itemCode: 'ORE01', steelGradeCode: null, consumptionRate: '1.6000' },
  { itemCode: 'COL01', steelGradeCode: null, consumptionRate: '0.6000' },
  { itemCode: 'LIM01', steelGradeCode: null, consumptionRate: '0.1500' },
  { itemCode: 'SMN01', steelGradeCode: 'SS275', consumptionRate: '10.0000' },
  { itemCode: 'SMN01', steelGradeCode: 'SM355A', consumptionRate: '20.0000' },
  { itemCode: 'SMN01', steelGradeCode: 'SM355B', consumptionRate: '20.0000' },
  { itemCode: 'SMN01', steelGradeCode: 'SPHC', consumptionRate: '4.0000' },
];

// ── 검사 기준 (REQ-QC-001·002, KS 규격 정리) ───────────────────

interface StandardItem {
  code: string;
  name: string;
  unit: string | null;
  min: string | null;
  max: string | null;
  /** 적용 두께 구간: 초과 */
  over?: string | null;
  /** 적용 두께 구간: 이하 */
  upto?: string | null;
}
const pct = (code: string, name: string, max: string): StandardItem => ({ code, name, unit: '%', min: null, max });
const N = 'N/mm²';

/** 제강 = 히트 성분 상한 (KS). SM355 C·Ceq는 50mm 이하 값. SPHC는 Si 없음 */
const STEELMAKING_ITEMS: Record<SteelGradeCode, StandardItem[]> = {
  SS275: [pct('C', '탄소(C)', '0.25'), pct('SI', '규소(Si)', '0.45'), pct('MN', '망간(Mn)', '1.40'), pct('P', '인(P)', '0.050'), pct('S', '황(S)', '0.050')],
  SM355A: [pct('C', '탄소(C)', '0.20'), pct('SI', '규소(Si)', '0.55'), pct('MN', '망간(Mn)', '1.60'), pct('P', '인(P)', '0.035'), pct('S', '황(S)', '0.035'), pct('CEQ', '탄소당량(Ceq)', '0.47')],
  SM355B: [pct('C', '탄소(C)', '0.18'), pct('SI', '규소(Si)', '0.55'), pct('MN', '망간(Mn)', '1.60'), pct('P', '인(P)', '0.030'), pct('S', '황(S)', '0.030'), pct('CEQ', '탄소당량(Ceq)', '0.47')],
  SM355C: [pct('C', '탄소(C)', '0.18'), pct('SI', '규소(Si)', '0.55'), pct('MN', '망간(Mn)', '1.60'), pct('P', '인(P)', '0.025'), pct('S', '황(S)', '0.025'), pct('CEQ', '탄소당량(Ceq)', '0.47')],
  SM355D: [pct('C', '탄소(C)', '0.18'), pct('SI', '규소(Si)', '0.55'), pct('MN', '망간(Mn)', '1.60'), pct('P', '인(P)', '0.020'), pct('S', '황(S)', '0.020'), pct('CEQ', '탄소당량(Ceq)', '0.47')],
  SPHC: [pct('C', '탄소(C)', '0.15'), pct('MN', '망간(Mn)', '0.60'), pct('P', '인(P)', '0.050'), pct('S', '황(S)', '0.050')],
};

/** 연주 = 슬래브 표면·치수. KS에 없어 사내 규격 가정값 (규격 대비 편차) */
const CASTING_ITEMS: StandardItem[] = [
  { code: 'THICKNESS_DEV', name: '두께 편차', unit: 'mm', min: '-5.00', max: '5.00' },
  { code: 'WIDTH_DEV', name: '폭 편차', unit: 'mm', min: '-10.00', max: '10.00' },
  { code: 'LENGTH_DEV', name: '길이 편차', unit: 'mm', min: '-10.00', max: '30.00' },
  { code: 'SURFACE_DEFECT_DEPTH', name: '표면 결함 깊이', unit: 'mm', min: '0.00', max: '2.00' },
];

const bands = (code: string, name: string, unit: string, rows: [string | null, string | null, string][]): StandardItem[] =>
  rows.map(([over, upto, min]) => ({ code, name, unit, min, max: null, over, upto }));

/** 시드 코일 두께의 두께 허용차 (KS D 3500 표 5, 폭 1200~1600 칸), 너비 허용차, 캠버 */
const COIL_DIMENSION_ITEMS: StandardItem[] = [
  { code: 'THICKNESS_TOL', name: '두께 허용차', unit: 'mm', min: '-0.20', max: '0.20', over: '2.00', upto: '2.50' },
  { code: 'THICKNESS_TOL', name: '두께 허용차', unit: 'mm', min: '-0.28', max: '0.28', over: '4.00', upto: '5.00' },
  { code: 'THICKNESS_TOL', name: '두께 허용차', unit: 'mm', min: '-0.42', max: '0.42', over: '8.00', upto: '10.00' },
  { code: 'WIDTH_TOL', name: '너비 허용차', unit: 'mm', min: '0.00', max: '25.00' },
  { code: 'CAMBER', name: '캠버(길이 2000mm당)', unit: 'mm', min: null, max: '5.00' },
];

const SM_MECHANICAL: StandardItem[] = [
  ...bands('YIELD_STRENGTH', '항복강도', N, [[null, '16.00', '355'], ['16.00', '40.00', '345'], ['40.00', '75.00', '335'], ['75.00', '100.00', '325'], ['100.00', '200.00', '305']]),
  { code: 'TENSILE_STRENGTH', name: '인장강도', unit: N, min: '490', max: '630' },
  ...bands('ELONGATION', '연신율', '%', [[null, '5.00', '22'], ['5.00', '16.00', '17'], ['16.00', '40.00', '19'], ['40.00', null, '23']]),
];
/** 샤르피 충격은 SM 계열, 두께 6mm 초과만 (REQ-QC-002) */
const charpy = (temperature: string): StandardItem => ({ code: 'CHARPY', name: `샤르피 흡수 에너지(${temperature})`, unit: 'J', min: '27', max: null, over: '6.00', upto: null });

/** 열연 = 코일 치수·기계적 성질 */
const HOT_ROLLING_ITEMS: Partial<Record<SteelGradeCode, StandardItem[]>> = {
  SS275: [
    ...bands('YIELD_STRENGTH', '항복강도', N, [[null, '16.00', '275'], ['16.00', '40.00', '265'], ['40.00', '100.00', '245'], ['100.00', null, '235']]),
    { code: 'TENSILE_STRENGTH', name: '인장강도', unit: N, min: '410', max: '550' },
    ...bands('ELONGATION', '연신율', '%', [[null, '5.00', '21'], ['5.00', '16.00', '18'], ['16.00', '40.00', '21'], ['40.00', null, '23']]),
    ...COIL_DIMENSION_ITEMS,
  ],
  SM355A: [...SM_MECHANICAL, charpy('20℃'), ...COIL_DIMENSION_ITEMS],
  SM355B: [...SM_MECHANICAL, charpy('0℃'), ...COIL_DIMENSION_ITEMS],
  SPHC: [
    { code: 'TENSILE_STRENGTH', name: '인장강도', unit: N, min: '270', max: null },
    ...bands('ELONGATION', '연신율', '%', [['1.20', '1.60', '27'], ['1.60', '3.20', '29'], ['3.20', '14.00', '31']]),
    ...COIL_DIMENSION_ITEMS,
  ],
};

/** 검사 기준 코드: QS-{강종}-{공정 약어}. 용어 사전 예(QS-SM355A-HR)를 따르고 ST·CC는 가정값 */
const PROCESS_SUFFIX = { STEELMAKING: 'ST', CONTINUOUS_CASTING: 'CC', HOT_ROLLING: 'HR' } as const;

// ── 실행 ────────────────────────────────────────────────

const trim = (v: string) => (v.includes('.') ? v.replace(/\.?0+$/, '') : v);
const specCode = (type: 'SLAB' | 'COIL', grade: string, d: Dimensions) => `${type === 'SLAB' ? 'SL' : 'CL'}-${grade}-${trim(d.thicknessMm)}x${trim(d.widthMm)}x${trim(d.lengthMm)}`;
const specName = (type: 'SLAB' | 'COIL', grade: string, d: Dimensions) => `${grade} ${type === 'SLAB' ? '슬래브' : '코일'} ${trim(d.thicknessMm)}×${trim(d.widthMm)}×${trim(d.lengthMm)}`;

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`시드 참조를 찾지 못했습니다: ${what}`);
  return value;
}

async function seedOrganization() {
  const jobGradeId = new Map<string, number>();
  for (const g of JOB_GRADES) {
    const found = await prisma.jobGrade.findFirst({ where: { jobGradeName: g.jobGradeName } });
    const row = found ? await prisma.jobGrade.update({ where: { id: found.id }, data: g }) : await prisma.jobGrade.create({ data: g });
    jobGradeId.set(g.jobGradeName, row.id);
  }

  const roleId = new Map<Role, number>();
  for (const roleCode of ROLE_ORDER) {
    const row = await prisma.role.upsert({ where: { roleCode }, create: { roleCode, roleName: ROLE_LABEL[roleCode] }, update: { roleName: ROLE_LABEL[roleCode] } });
    roleId.set(roleCode, row.id);
  }
  for (const [permission, marks] of ROLE_PERMISSION_TABLE) {
    const cells = marks.split(' ');
    if (cells.length !== ROLE_ORDER.length) throw new Error(`권한 표 칸 수가 맞지 않습니다: ${permission}`);
    for (const [index, roleCode] of ROLE_ORDER.entries()) {
      const id = must(roleId.get(roleCode), roleCode);
      const level: PermissionLevel | null = cells[index] === '●' ? 'USE' : cells[index] === '○' ? 'VIEW' : null;
      if (level) {
        await prisma.rolePermission.upsert({ where: { roleId_permission: { roleId: id, permission } }, create: { roleId: id, permission, permissionLevel: level }, update: { permissionLevel: level } });
      } else {
        await prisma.rolePermission.deleteMany({ where: { roleId: id, permission } });
      }
    }
  }

  const departmentId = new Map<string, number>();
  for (const d of DEPARTMENTS) {
    const parentId = d.parentCode ? must(departmentId.get(d.parentCode), d.parentCode) : null;
    const row = await prisma.department.upsert({
      where: { departmentCode: d.departmentCode },
      create: { departmentCode: d.departmentCode, departmentName: d.departmentName, parentId },
      update: { departmentName: d.departmentName, parentId },
    });
    departmentId.set(d.departmentCode, row.id);
  }

  const passwordHash = await hash(SEED_PASSWORD, 10);
  for (const e of EMPLOYEES) {
    const data = {
      employeeName: e.employeeName,
      departmentId: must(departmentId.get(e.department), e.department),
      jobGradeId: must(jobGradeId.get(e.jobGrade), e.jobGrade),
      roleId: must(roleId.get(e.role), e.role),
      isActive: true,
    };
    const row = await prisma.employee.upsert({ where: { employeeNo: e.employeeNo }, create: { employeeNo: e.employeeNo, passwordHash, ...data }, update: data });
    if (e.headOf) await prisma.department.update({ where: { id: must(departmentId.get(e.headOf), e.headOf) }, data: { headEmployeeId: row.id } });
  }
}

async function seedMasterData() {
  const steelGradeId = new Map<string, number>();
  for (const g of STEEL_GRADES) {
    const row = await prisma.steelGrade.upsert({ where: { steelGradeCode: g.steelGradeCode }, create: g, update: g });
    steelGradeId.set(g.steelGradeCode, row.id);
  }
  for (const c of CUSTOMERS) await prisma.customer.upsert({ where: { customerCode: c.customerCode }, create: c, update: c });
  const supplierId = new Map<string, number>();
  for (const s of SUPPLIERS) supplierId.set(s.supplierCode, (await prisma.supplier.upsert({ where: { supplierCode: s.supplierCode }, create: s, update: s })).id);
  const yardId = new Map<YardType, number>();
  for (const y of YARDS) yardId.set(y.yardType, (await prisma.yard.upsert({ where: { yardCode: y.yardCode }, create: y, update: y })).id);

  const itemId = new Map<string, number>();
  for (const m of RAW_MATERIALS) {
    const data = {
      itemName: m.itemName,
      itemType: 'RAW_MATERIAL',
      unitType: 'TON',
      rawMaterialType: m.rawMaterialType,
      defaultYardId: must(yardId.get('RAW_MATERIAL'), 'RAW_MATERIAL yard'),
      defaultSupplierId: must(supplierId.get(m.supplierCode), m.supplierCode),
    };
    itemId.set(m.itemCode, (await prisma.item.upsert({ where: { itemCode: m.itemCode }, create: { itemCode: m.itemCode, ...data }, update: data })).id);
  }

  const upsertSpec = async (itemType: 'SLAB' | 'COIL', grade: SteelGradeCode, d: Dimensions) => {
    const code = specCode(itemType, grade, d);
    const data = {
      itemName: specName(itemType, grade, d),
      itemType,
      unitType: 'QTY',
      steelGradeId: must(steelGradeId.get(grade), grade),
      thicknessMm: d.thicknessMm,
      widthMm: d.widthMm,
      lengthMm: d.lengthMm,
      theoreticalWeightTon: calcTheoreticalWeightTon(d.thicknessMm, d.widthMm, d.lengthMm),
      defaultYardId: must(yardId.get(itemType), `${itemType} yard`),
    };
    return (await prisma.item.upsert({ where: { itemCode: code }, create: { itemCode: code, ...data }, update: data })).id;
  };
  for (const grade of SPEC_GRADES) {
    for (const pair of SLAB_COIL_DIMENSIONS) {
      const slabItemId = await upsertSpec('SLAB', grade, pair.slab);
      const coilItemId = await upsertSpec('COIL', grade, pair.coil);
      await prisma.specMapping.upsert({ where: { slabItemId }, create: { slabItemId, coilItemId }, update: { coilItemId } });
    }
  }

  for (const r of ROUTINGS) {
    await prisma.routing.upsert({ where: { itemType_sequenceNo: { itemType: r.itemType, sequenceNo: r.sequenceNo } }, create: r, update: r });
  }

  for (const c of SPECIFIC_CONSUMPTIONS) {
    const rawMaterialItemId = must(itemId.get(c.itemCode), c.itemCode);
    const steelGrade = c.steelGradeCode ? must(steelGradeId.get(c.steelGradeCode), c.steelGradeCode) : null;
    const found = await prisma.specificConsumption.findFirst({ where: { rawMaterialItemId, steelGradeId: steelGrade } });
    if (found) await prisma.specificConsumption.update({ where: { id: found.id }, data: { consumptionRate: c.consumptionRate } });
    else await prisma.specificConsumption.create({ data: { rawMaterialItemId, steelGradeId: steelGrade, consumptionRate: c.consumptionRate } });
  }

  // 생산 설정값은 1행만 둔다 (REQ-MST-009 초기값)
  const setting = await prisma.productionSetting.findFirst();
  if (!setting) await prisma.productionSetting.create({ data: { heatCapacityTon: '250.000', deliveryRiskDays: 3 } });

  return steelGradeId;
}

async function seedInspectionStandards(steelGradeId: Map<string, number>) {
  const add = async (grade: SteelGradeCode, processType: keyof typeof PROCESS_SUFFIX, items: StandardItem[]) => {
    const inspectionStandardCode = `QS-${grade}-${PROCESS_SUFFIX[processType]}`;
    const standard = await prisma.inspectionStandard.upsert({
      where: { inspectionStandardCode_versionNo: { inspectionStandardCode, versionNo: 1 } },
      create: { inspectionStandardCode, versionNo: 1, processType, steelGradeId: must(steelGradeId.get(grade), grade) },
      update: {},
    });
    // 버전 1 항목을 다시 만든다. 이미 검사에 쓴 버전이면 건드리지 않는다 (기준은 수정하지 않고 새 버전으로, 컨벤션 7-2)
    const used = await prisma.qualityInspection.count({ where: { inspectionStandardId: standard.id } });
    if (used > 0) return;
    await prisma.inspectionStandardItem.deleteMany({ where: { inspectionStandardId: standard.id } });
    await prisma.inspectionStandardItem.createMany({
      data: items.map((i) => ({
        inspectionStandardId: standard.id,
        inspectionItemCode: i.code,
        inspectionItemName: i.name,
        unit: i.unit,
        minValue: i.min,
        maxValue: i.max,
        thicknessOverMm: i.over ?? null,
        thicknessUptoMm: i.upto ?? null,
        isRequired: true,
      })),
    });
  };
  // SM355C·D는 규격 시드가 없지만 KS 성분 값이 있어 제강 기준만 넣는다
  for (const grade of Object.keys(STEELMAKING_ITEMS) as SteelGradeCode[]) await add(grade, 'STEELMAKING', STEELMAKING_ITEMS[grade]);
  for (const grade of SPEC_GRADES) await add(grade, 'CONTINUOUS_CASTING', CASTING_ITEMS);
  for (const grade of SPEC_GRADES) await add(grade, 'HOT_ROLLING', must(HOT_ROLLING_ITEMS[grade], grade));
}

/** --organization-only: 조직(직급·역할·권한·부서·사원)만 넣는다. 공용 DB는 기준정보를 화면에서 등록한다 (2026-10-08 결정) */
const organizationOnly = process.argv.includes('--organization-only');

async function main() {
  await seedOrganization();
  if (!organizationOnly) {
    const steelGradeId = await seedMasterData();
    await seedInspectionStandards(steelGradeId);
  }
  const counts = {
    employee: await prisma.employee.count(),
    rolePermission: await prisma.rolePermission.count(),
    item: await prisma.item.count(),
    specMapping: await prisma.specMapping.count(),
    inspectionStandard: await prisma.inspectionStandard.count(),
    inspectionStandardItem: await prisma.inspectionStandardItem.count(),
  };
  process.stdout.write(`[seed] ${JSON.stringify(counts)}\n`);
}

main()
  .catch((e: unknown) => {
    process.stderr.write(`[seed] 실패: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
