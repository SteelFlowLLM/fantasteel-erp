// 시드: 역할·권한, 부서 계층·부서장, 테스트 계정, 강종 3종 × 슬래브 규격 3종과 코일 매핑, 라우팅, 배합 원단위,
// 고객사·공급업체·야드, 검사 항목, 초기 재고(원료 LOT, 합격 슬래브·코일). 반복 실행해도 결과가 같다 (코드 컨벤션 7-4).
// 원단위·수율·성분·검사 기준은 시연용 가정값이다 (기획안 가정).
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { calcTheoreticalWeightTon, DEFAULT_ROLE_PERMISSIONS, ROLE_CODE_LABEL, ROLE_CODES } from '@fantasteel/shared';
import { PrismaClient } from '../src/generated/prisma/client';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:54322/fantasteel' }) });

/** 테스트 계정 공통 비밀번호 (로컬 시연용). */
export const SEED_PASSWORD = 'heatline';

const DAY = 86_400_000;
const daysAgo = (n: number, hour = 9) => {
  const d = new Date(Date.now() - n * DAY);
  d.setHours(hour, 0, 0, 0);
  return d;
};
const yymmdd = (d: Date) => {
  const k = new Date(d.getTime() + 9 * 3600_000);
  return `${String(k.getUTCFullYear()).slice(2)}${String(k.getUTCMonth() + 1).padStart(2, '0')}${String(k.getUTCDate()).padStart(2, '0')}`;
};

async function seedRoles() {
  for (const code of ROLE_CODES) {
    const role = await prisma.role.upsert({ where: { roleCode: code }, create: { roleCode: code, roleName: ROLE_CODE_LABEL[code] }, update: { roleName: ROLE_CODE_LABEL[code] } });
    for (const [permissionCode, permissionLevel] of Object.entries(DEFAULT_ROLE_PERMISSIONS[code])) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionCode: { roleId: role.id, permissionCode } },
        create: { roleId: role.id, permissionCode, permissionLevel: permissionLevel! },
        update: {},
      });
    }
  }
}

const DEPARTMENTS: { code: string; name: string; parent?: string; order: number }[] = [
  { code: 'HQ', name: '포항제철소', order: 0 },
  { code: 'SALES', name: '영업부', parent: 'HQ', order: 1 },
  { code: 'PURCHASE', name: '구매부', parent: 'HQ', order: 2 },
  { code: 'PRODUCTION', name: '생산부', parent: 'HQ', order: 3 },
  { code: 'PRD-IRON', name: '제선파트', parent: 'PRODUCTION', order: 1 },
  { code: 'PRD-STEEL', name: '제강파트', parent: 'PRODUCTION', order: 2 },
  { code: 'PRD-CAST', name: '연주파트', parent: 'PRODUCTION', order: 3 },
  { code: 'PRD-ROLL', name: '열연파트', parent: 'PRODUCTION', order: 4 },
  { code: 'QUALITY', name: '품질부', parent: 'HQ', order: 4 },
  { code: 'LOGISTICS', name: '물류부', parent: 'HQ', order: 5 },
  { code: 'ADMIN', name: '경영지원부', parent: 'HQ', order: 6 },
];

// 부서장은 부서별 지정이다 (역할이 아니다). head = 그 부서의 부서장.
const EMPLOYEES: { no: string; name: string; dept: string; role: string; grade: string; head?: string[] }[] = [
  { no: '1001001', name: '한소장', dept: 'HQ', role: 'ADMIN', grade: '소장', head: ['HQ'] },
  { no: '1502003', name: '오영업', dept: 'SALES', role: 'SALES', grade: '부장', head: ['SALES'] },
  { no: '2104012', name: '김영업', dept: 'SALES', role: 'SALES', grade: '대리' },
  { no: '2203018', name: '신영업', dept: 'SALES', role: 'SALES', grade: '사원' },
  { no: '1604007', name: '남구매', dept: 'PURCHASE', role: 'PURCHASE', grade: '부장', head: ['PURCHASE'] },
  { no: '1907015', name: '서구매', dept: 'PURCHASE', role: 'PURCHASE', grade: '과장' },
  { no: '1402002', name: '강생산', dept: 'PRODUCTION', role: 'PRODUCTION', grade: '부장', head: ['PRODUCTION'] },
  { no: '1803021', name: '박생산', dept: 'PRODUCTION', role: 'PRODUCTION', grade: '과장' },
  { no: '2006027', name: '정제선', dept: 'PRD-IRON', role: 'PRODUCTION', grade: '대리', head: ['PRD-IRON'] },
  { no: '2001009', name: '최생산', dept: 'PRD-STEEL', role: 'PRODUCTION', grade: '대리', head: ['PRD-STEEL'] },
  { no: '2108031', name: '임연주', dept: 'PRD-CAST', role: 'PRODUCTION', grade: '대리', head: ['PRD-CAST'] },
  { no: '2110033', name: '조열연', dept: 'PRD-ROLL', role: 'PRODUCTION', grade: '대리', head: ['PRD-ROLL'] },
  { no: '1705011', name: '문품질', dept: 'QUALITY', role: 'QUALITY', grade: '부장', head: ['QUALITY'] },
  { no: '1911030', name: '정품질', dept: 'QUALITY', role: 'QUALITY', grade: '과장' },
  { no: '2207041', name: '한품질', dept: 'QUALITY', role: 'QUALITY', grade: '사원' },
  { no: '1806013', name: '배물류', dept: 'LOGISTICS', role: 'LOGISTICS', grade: '부장', head: ['LOGISTICS'] },
  { no: '2005024', name: '윤물류', dept: 'LOGISTICS', role: 'LOGISTICS', grade: '대리' },
  { no: '1704010', name: '이관리', dept: 'ADMIN', role: 'ADMIN', grade: '차장', head: ['ADMIN'] },
];

async function seedOrganization() {
  const deptId = new Map<string, number>();
  for (const d of DEPARTMENTS) {
    const row = await prisma.department.upsert({
      where: { departmentCode: d.code },
      create: { departmentCode: d.code, departmentName: d.name, sortOrder: d.order, parentId: d.parent ? deptId.get(d.parent)! : null },
      update: { departmentName: d.name, sortOrder: d.order, parentId: d.parent ? deptId.get(d.parent)! : null },
    });
    deptId.set(d.code, row.id);
  }
  const roles = new Map((await prisma.role.findMany()).map((r) => [r.roleCode, r.id]));
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);
  for (const e of EMPLOYEES) {
    const row = await prisma.employee.upsert({
      where: { employeeNo: e.no },
      create: { employeeNo: e.no, employeeName: e.name, passwordHash, email: `${e.no}@fantasteel.example`, departmentId: deptId.get(e.dept)!, roleId: roles.get(e.role)!, jobGrade: e.grade },
      update: {},
    });
    for (const h of e.head ?? []) await prisma.department.update({ where: { id: deptId.get(h)! }, data: { headEmployeeId: row.id } });
  }
}

const GRADES = [
  { code: 'SS275', name: '일반 구조용 압연 강재', std: 'KS D 3503', comp: { C: [null, 0.25], Si: [null, 0.45], Mn: [null, 1.4], P: [null, 0.04], S: [null, 0.04] } },
  { code: 'SM355', name: '용접 구조용 압연 강재', std: 'KS D 3515', comp: { C: [null, 0.2], Si: [null, 0.55], Mn: [null, 1.6], P: [null, 0.035], S: [null, 0.035] } },
  { code: 'SPHC', name: '열간 압연 연강판', std: 'KS D 3501', comp: { C: [null, 0.12], Si: [null, 0.3], Mn: [null, 0.6], P: [null, 0.045], S: [null, 0.035] } },
] as const;

// 슬래브 규격 3종과 대응 코일 규격 (두께 × 폭 × 길이 mm). 코일 이론중량 ≤ 슬래브 이론중량.
const SIZES = [
  { slab: [250, 1200, 10000], coil: [4.5, 1200, 542000] },
  { slab: [250, 1500, 10000], coil: [6.0, 1500, 407000] },
  { slab: [230, 1000, 9000], coil: [3.2, 1000, 632000] },
] as const;

const RAW_MATERIALS = [
  { code: 'IO', itemCode: 'RM-IO', name: '철광석', type: 'IRON_ORE', supplier: 'SUP-01', rate: { all: 1.6 } },
  { code: 'CL', itemCode: 'RM-CL', name: '석탄', type: 'COAL', supplier: 'SUP-01', rate: { all: 0.75 } },
  { code: 'LS', itemCode: 'RM-LS', name: '석회석', type: 'LIMESTONE', supplier: 'SUP-02', rate: { all: 0.25 } },
  { code: 'FM', itemCode: 'RM-FM', name: '합금철 FeMn', type: 'FERROALLOY', supplier: 'SUP-03', rate: { SS275: 6, SM355: 12, SPHC: 3 } },
  { code: 'FS', itemCode: 'RM-FS', name: '합금철 FeSi', type: 'FERROALLOY', supplier: 'SUP-03', rate: { SS275: 2.5, SM355: 4, SPHC: 0.5 } },
] as const;

async function seedMaster() {
  for (const [code, name] of [['CUS-01', '한빛중공업'], ['CUS-02', '대성건설'], ['CUS-03', '동해조선'], ['CUS-04', '미래자동차부품']] as const) {
    await prisma.customer.upsert({ where: { customerCode: code }, create: { customerCode: code, customerName: name }, update: {} });
  }
  const supplierId = new Map<string, number>();
  for (const [code, name] of [['SUP-01', '호주광업상사'], ['SUP-02', '강원석회'], ['SUP-03', '대한합금']] as const) {
    supplierId.set(code, (await prisma.supplier.upsert({ where: { supplierCode: code }, create: { supplierCode: code, supplierName: name }, update: {} })).id);
  }
  const yardId = new Map<string, number>();
  for (const [code, name, type] of [['RY-01', '원료 야드', 'RAW_MATERIAL'], ['SY-01', '슬래브 야드', 'SLAB'], ['CY-01', '코일 야드', 'COIL']] as const) {
    yardId.set(type, (await prisma.yard.upsert({ where: { yardCode: code }, create: { yardCode: code, yardName: name, yardType: type }, update: {} })).id);
  }
  await prisma.productionSetting.upsert({ where: { id: 1 }, create: { id: 1, heatCapacityTon: 250, deliveryRiskDays: 3 }, update: {} });

  const slabItem = await prisma.item.upsert({ where: { itemCode: 'SLAB' }, create: { itemCode: 'SLAB', itemName: '슬래브', itemType: 'SLAB', unitType: 'QTY' }, update: {} });
  const coilItem = await prisma.item.upsert({ where: { itemCode: 'COIL' }, create: { itemCode: 'COIL', itemName: '열연코일', itemType: 'COIL', unitType: 'QTY' }, update: {} });

  const gradeId = new Map<string, number>();
  for (const g of GRADES) {
    const row = await prisma.steelGrade.upsert({ where: { steelGradeCode: g.code }, create: { steelGradeCode: g.code, steelGradeName: g.name, standardNo: g.std }, update: {} });
    gradeId.set(g.code, row.id);
    let order = 0;
    for (const [el, [min, max]] of Object.entries(g.comp)) {
      await prisma.compositionSpec.upsert({
        where: { steelGradeId_elementCode: { steelGradeId: row.id, elementCode: el } },
        create: { steelGradeId: row.id, elementCode: el, minValue: min, maxValue: max, sortOrder: order++ },
        update: {},
      });
    }
    for (const size of SIZES) {
      const [st, sw, sl] = size.slab;
      const [ct, cw, cl] = size.coil;
      const slab = await prisma.productSpec.upsert({
        where: { specCode: `SL-${g.code}-${st}x${sw}x${sl}` },
        create: { specCode: `SL-${g.code}-${st}x${sw}x${sl}`, itemId: slabItem.id, steelGradeId: row.id, thicknessMm: st, widthMm: sw, lengthMm: sl, theoreticalWeightTon: calcTheoreticalWeightTon(st, sw, sl), yardId: yardId.get('SLAB') },
        update: {},
      });
      const coil = await prisma.productSpec.upsert({
        where: { specCode: `CL-${g.code}-${ct}x${cw}x${cl}` },
        create: { specCode: `CL-${g.code}-${ct}x${cw}x${cl}`, itemId: coilItem.id, steelGradeId: row.id, thicknessMm: ct, widthMm: cw, lengthMm: cl, theoreticalWeightTon: calcTheoreticalWeightTon(ct, cw, cl), yardId: yardId.get('COIL') },
        update: {},
      });
      await prisma.specMapping.upsert({ where: { slabSpecId: slab.id }, create: { slabSpecId: slab.id, coilSpecId: coil.id }, update: {} });
      for (const s of [slab, coil]) await prisma.inventory.upsert({ where: { productSpecId: s.id }, create: { productSpecId: s.id }, update: {} });
    }
  }

  // 라우팅: 열연 계획 수율은 입력하지 않는다(규격 매핑에서 계산). 제선은 원단위로 표현하므로 수율 없음.
  const routing: [string, string, number, number | null][] = [
    ['SLAB', 'IRONMAKING', 1, null], ['SLAB', 'STEELMAKING', 2, 0.95], ['SLAB', 'CASTING', 3, 0.96],
    ['COIL', 'IRONMAKING', 1, null], ['COIL', 'STEELMAKING', 2, 0.95], ['COIL', 'CASTING', 3, 0.96], ['COIL', 'HOT_ROLLING', 4, null],
  ];
  for (const [itemType, processCode, processSeq, plannedYieldRate] of routing) {
    await prisma.routing.upsert({ where: { itemType_processCode: { itemType, processCode } }, create: { itemType, processCode, processSeq, plannedYieldRate }, update: {} });
  }

  for (const m of RAW_MATERIALS) {
    const item = await prisma.item.upsert({
      where: { itemCode: m.itemCode },
      create: { itemCode: m.itemCode, itemName: m.name, itemType: 'RAW_MATERIAL', unitType: 'TON', defaultSupplierId: supplierId.get(m.supplier) },
      update: {},
    });
    const rm = await prisma.rawMaterial.upsert({
      where: { itemId: item.id },
      create: { itemId: item.id, materialCode: m.code, rawMaterialType: m.type, yardId: yardId.get('RAW_MATERIAL') },
      update: {},
    });
    await prisma.inventory.upsert({ where: { rawMaterialId: rm.id }, create: { rawMaterialId: rm.id }, update: {} });
    for (const [key, rate] of Object.entries(m.rate)) {
      const steelGradeId = key === 'all' ? null : gradeId.get(key)!;
      const found = await prisma.specificConsumption.findFirst({ where: { rawMaterialId: rm.id, steelGradeId } });
      if (!found) await prisma.specificConsumption.create({ data: { rawMaterialId: rm.id, steelGradeId, consumptionRate: rate, consumptionUnit: key === 'all' ? 'TON_PER_TON' : 'KG_PER_TON' } });
    }
  }

  // 검사 항목: KS 인증심사기준의 제품 검사 항목 참고 (REQ-QC-002). 무게 검사는 제외.
  type Insp = [string, string, string | null, number | null, number | null];
  const slabItems: Insp[] = [
    ['SURFACE_DEFECT_COUNT', '표면 결함 수', '개', null, 2],
    ['THICKNESS_DEVIATION', '두께 편차', 'mm', -5, 5],
    ['WIDTH_DEVIATION', '폭 편차', 'mm', -10, 10],
    ['LENGTH_DEVIATION', '길이 편차', 'mm', -50, 50],
  ];
  const upsertInsp = async (processCode: string, steelGradeId: number | null, list: Insp[]) => {
    let order = 0;
    for (const [code, name, unit, min, max] of list) {
      const found = await prisma.inspectionItem.findFirst({ where: { processCode, steelGradeId, inspectionItemCode: code } });
      if (!found) await prisma.inspectionItem.create({ data: { processCode, steelGradeId, inspectionItemCode: code, inspectionItemName: name, unit, minValue: min, maxValue: max, sortOrder: order } });
      order++;
    }
  };
  await upsertInsp('CASTING', null, slabItems);
  const coilCommon: Insp[] = [['THICKNESS_DEVIATION', '두께 편차', 'mm', -0.3, 0.3], ['WIDTH_DEVIATION', '폭 편차', 'mm', 0, 20]];
  await upsertInsp('HOT_ROLLING', gradeId.get('SS275')!, [['TENSILE_STRENGTH', '인장강도', 'MPa', 410, 550], ['YIELD_STRENGTH', '항복강도', 'MPa', 275, null], ['ELONGATION', '연신율', '%', 18, null], ...coilCommon]);
  await upsertInsp('HOT_ROLLING', gradeId.get('SM355')!, [
    ['TENSILE_STRENGTH', '인장강도', 'MPa', 490, 630], ['YIELD_STRENGTH', '항복강도', 'MPa', 355, null], ['ELONGATION', '연신율', '%', 17, null],
    ['CHARPY_IMPACT', '샤르피 충격', 'J', 27, null], ['CARBON_EQUIVALENT', '탄소당량', '%', null, 0.44], ...coilCommon,
  ]);
  await upsertInsp('HOT_ROLLING', gradeId.get('SPHC')!, [['TENSILE_STRENGTH', '인장강도', 'MPa', 270, null], ['ELONGATION', '연신율', '%', 27, null], ...coilCommon]);
}

/** 초기 재고: 원료 LOT, 과거에 생산·검사 합격한 히트와 슬래브·코일. LOT이 하나도 없을 때만 넣는다. */
async function seedStock() {
  if (await prisma.lot.count()) return;
  const yards = new Map((await prisma.yard.findMany()).map((y) => [y.yardType, y.id]));
  const raws = await prisma.rawMaterial.findMany({ include: { item: true } });
  const rawTon: Record<string, number> = { IO: 900, CL: 300, LS: 150, FM: 2, FS: 1.5 };
  const rawLots = new Map<string, number>();
  for (const rm of raws) {
    const at = daysAgo(12);
    const ton = rawTon[rm.materialCode];
    const lot = await prisma.lot.create({
      data: { lotNo: `RM-${rm.materialCode}-${yymmdd(at)}-001`, lotType: 'RAW_MATERIAL', rawMaterialId: rm.id, initialTon: ton, remainingTon: ton, yardId: yards.get('RAW_MATERIAL'), supplierId: rm.item.defaultSupplierId, producedAt: at },
    });
    rawLots.set(rm.materialCode, lot.id);
    await prisma.inventory.update({ where: { rawMaterialId: rm.id }, data: { onHandTon: ton } });
    await prisma.numberSequence.upsert({ where: { sequenceKey: `RM-${rm.materialCode}-${yymmdd(at)}` }, create: { sequenceKey: `RM-${rm.materialCode}-${yymmdd(at)}`, lastValue: 1 }, update: {} });
  }

  const specs = await prisma.productSpec.findMany({ include: { steelGrade: { include: { compositionSpecs: true } }, item: true, slabMapping: { include: { coilSpec: true } } } });
  const spec = (code: string) => specs.find((s) => s.specCode === code)!;
  const slabInsp = await prisma.inspectionItem.findMany({ where: { processCode: 'CASTING' }, orderBy: { sortOrder: 'asc' } });
  let qiSeq = 0;
  const inspectionNo = (at: Date) => `QI-20${yymmdd(at)}-${String(++qiSeq).padStart(4, '0')}`;
  const mid = (min: number | null, max: number | null) => (min !== null && max !== null ? (min + max) / 2 : max !== null ? max * 0.6 : min !== null ? min * 1.12 : 0);

  // 과거 히트: [슬래브 규격, 전로, 며칠 전, 일련번호, 슬래브 매수, 그중 코일로 압연한 매수]
  const heats: [string, string, number, number, number, number][] = [
    ['SL-SS275-250x1200x10000', '1', 9, 1, 10, 4], // 슬래브 6매 재고 + 코일 4개 재고
    ['SL-SM355-250x1500x10000', '2', 8, 1, 8, 4],
    ['SL-SPHC-230x1000x9000', '1', 7, 1, 14, 9],
  ];
  let hmSeq = 0;
  for (const [slabCode, converterNo, ago, seq, slabQty, rolledQty] of heats) {
    const slabSpec = spec(slabCode);
    const coilSpec = slabSpec.slabMapping!.coilSpec;
    const at = daysAgo(ago);
    const heatNo = `HT-${converterNo}-${yymmdd(at)}-${String(seq).padStart(3, '0')}`;
    await prisma.numberSequence.upsert({ where: { sequenceKey: `HT-${converterNo}-${yymmdd(at)}` }, create: { sequenceKey: `HT-${converterNo}-${yymmdd(at)}`, lastValue: seq }, update: {} });

    const hmAt = new Date(at.getTime() - 6 * 3600_000);
    const hotMetal = await prisma.lot.create({
      data: { lotNo: `HM-1-${yymmdd(hmAt)}-${String(++hmSeq).padStart(2, '0')}`, lotType: 'HOT_METAL', initialTon: 263.158, remainingTon: 0, blastFurnaceNo: '1', lotStatus: 'CONSUMED', producedAt: hmAt, consumedAt: at },
    });
    await prisma.numberSequence.upsert({ where: { sequenceKey: `HM-1-${yymmdd(hmAt)}` }, create: { sequenceKey: `HM-1-${yymmdd(hmAt)}`, lastValue: hmSeq }, update: { lastValue: hmSeq } });
    for (const code of ['IO', 'CL', 'LS']) {
      await prisma.lotRelation.create({
        data: { parentLotId: rawLots.get(code)!, childLotId: hotMetal.id, relationType: 'RAW_TO_HOT_METAL', evidenceType: 'PERIOD', periodStart: new Date(hmAt.getTime() - 8 * 3600_000), periodEnd: hmAt },
      });
    }
    const heat = await prisma.lot.create({
      data: { lotNo: heatNo, lotType: 'HEAT', steelGradeId: slabSpec.steelGradeId, initialTon: 250, converterNo, isPassed: true, lotStatus: 'CONSUMED', producedAt: at, consumedAt: new Date(at.getTime() + 3 * 3600_000) },
    });
    await prisma.lotRelation.create({ data: { parentLotId: hotMetal.id, childLotId: heat.id, relationType: 'HOT_METAL_TO_HEAT', evidenceType: 'DIRECT', inputTon: 263.158 } });
    for (const code of ['FM', 'FS']) await prisma.lotRelation.create({ data: { parentLotId: rawLots.get(code)!, childLotId: heat.id, relationType: 'ALLOY_TO_HEAT', evidenceType: 'DIRECT' } });
    await prisma.qualityInspection.create({
      data: {
        qualityInspectionNo: inspectionNo(at), lotId: heat.id, processCode: 'STEELMAKING', inspectionResult: 'PASS', inspectedAt: new Date(at.getTime() + 3600_000),
        values: { create: slabSpec.steelGrade.compositionSpecs.map((c) => ({ inspectionItemCode: c.elementCode, inspectionItemName: c.elementCode, unit: '%', minValue: c.minValue, maxValue: c.maxValue, measuredValue: Number(c.maxValue) * 0.7, isPassed: true, sortOrder: c.sortOrder })) },
      },
    });

    const coilInsp = await prisma.inspectionItem.findMany({ where: { processCode: 'HOT_ROLLING', steelGradeId: slabSpec.steelGradeId }, orderBy: { sortOrder: 'asc' } });
    for (let i = 1; i <= slabQty; i++) {
      const slabAt = new Date(at.getTime() + 4 * 3600_000 + i * 60_000);
      const rolled = i <= rolledQty;
      const slab = await prisma.lot.create({
        data: {
          lotNo: `${heatNo}-${String(i).padStart(2, '0')}`, lotType: 'SLAB', productSpecId: slabSpec.id, steelGradeId: slabSpec.steelGradeId, heatLotId: heat.id,
          yardId: yards.get('SLAB'), isPassed: true, lotStatus: rolled ? 'CONSUMED' : 'IN_STOCK', producedAt: slabAt, consumedAt: rolled ? new Date(slabAt.getTime() + DAY) : null,
        },
      });
      await prisma.lotRelation.create({ data: { parentLotId: heat.id, childLotId: slab.id, relationType: 'HEAT_TO_SLAB', evidenceType: 'DIRECT' } });
      await prisma.qualityInspection.create({
        data: {
          qualityInspectionNo: inspectionNo(slabAt), lotId: slab.id, processCode: 'CASTING', inspectionResult: 'PASS', inspectedAt: new Date(slabAt.getTime() + 3600_000),
          values: { create: slabInsp.map((it) => ({ inspectionItemCode: it.inspectionItemCode, inspectionItemName: it.inspectionItemName, unit: it.unit, minValue: it.minValue, maxValue: it.maxValue, measuredValue: it.inspectionItemCode === 'SURFACE_DEFECT_COUNT' ? 0 : 1, isPassed: true, sortOrder: it.sortOrder })) },
        },
      });
      if (!rolled) continue;
      const coilAt = new Date(slabAt.getTime() + DAY);
      const coil = await prisma.lot.create({
        data: {
          lotNo: `C${slab.lotNo.replace(/^HT-/, '')}`, lotType: 'COIL', productSpecId: coilSpec.id, steelGradeId: slabSpec.steelGradeId, heatLotId: heat.id,
          yardId: yards.get('COIL'), isPassed: true, lotStatus: 'IN_STOCK', producedAt: coilAt,
        },
      });
      await prisma.lotRelation.create({ data: { parentLotId: slab.id, childLotId: coil.id, relationType: 'SLAB_TO_COIL', evidenceType: 'DIRECT' } });
      await prisma.qualityInspection.create({
        data: {
          qualityInspectionNo: inspectionNo(coilAt), lotId: coil.id, processCode: 'HOT_ROLLING', inspectionResult: 'PASS', inspectedAt: new Date(coilAt.getTime() + 3600_000),
          values: {
            create: coilInsp.map((it) => ({
              inspectionItemCode: it.inspectionItemCode, inspectionItemName: it.inspectionItemName, unit: it.unit, minValue: it.minValue, maxValue: it.maxValue,
              measuredValue: mid(it.minValue === null ? null : Number(it.minValue), it.maxValue === null ? null : Number(it.maxValue)), isPassed: true, sortOrder: it.sortOrder,
            })),
          },
        },
      });
    }
    await prisma.inventory.update({ where: { productSpecId: slabSpec.id }, data: { onHandQty: slabQty - rolledQty } });
    await prisma.inventory.update({ where: { productSpecId: coilSpec.id }, data: { onHandQty: rolledQty } });
  }
  const today = new Date();
  await prisma.numberSequence.upsert({ where: { sequenceKey: `QI-20${yymmdd(today)}` }, create: { sequenceKey: `QI-20${yymmdd(today)}`, lastValue: 0 }, update: {} });
}

async function main() {
  await seedRoles();
  await seedOrganization();
  await seedMaster();
  await seedStock();
  const counts = { employee: await prisma.employee.count(), productSpec: await prisma.productSpec.count(), lot: await prisma.lot.count() };
  process.stdout.write(`seed 완료 ${JSON.stringify(counts)}\n`);
}

main()
  .catch((e) => {
    process.stderr.write(`${e?.stack ?? e}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
