import { describe, expect, it } from 'vitest';
import { formatSpecCode, PERMISSIONS, RAW_MATERIAL_CODE_PATTERN, ROLE, ROLE_LABEL } from '@/codes';
import { calcTheoreticalWeightTon, compareDecimal } from '@/lib/weight';
import { createSeedTables, SEED_ROLE_PERMISSIONS } from '@/mock/seed';

const tables = createSeedTables();
const byId = <T extends { id: number }>(rows: readonly T[], id: number | null) => rows.find((r) => r.id === id);

describe('조직 시드', () => {
  it('역할 6개 (공통 코드 ROLE 값·표시명)', () => {
    expect(tables.role.map((r) => r.roleCode)).toEqual(Object.values(ROLE));
    for (const r of tables.role) expect(r.roleName).toBe(ROLE_LABEL[r.roleCode]);
  });

  it('USE 권한은 업무 프로세스 정의서 2장 그대로다', () => {
    const useOf = (roleCode: string) => {
      const role = tables.role.find((r) => r.roleCode === roleCode);
      return tables.rolePermission.filter((p) => p.roleId === role?.id && p.permissionLevel === 'USE').map((p) => p.permission).sort();
    };
    expect(useOf('ADMIN')).toEqual(['EMPLOYEE_MANAGE', 'MASTER_MANAGE', 'ORG_MANAGE']);
    expect(useOf('SALES')).toEqual(['SALES_ORDER_CANCEL', 'SALES_ORDER_CREATE', 'SHIPMENT_REQUEST_MANAGE']);
    expect(useOf('PURCHASE')).toEqual(['GOODS_RECEIPT_CONFIRM', 'PURCHASE_ORDER_CONFIRM', 'PURCHASE_REQUISITION_CREATE']);
    expect(useOf('PRODUCTION')).toEqual(['HOT_ROLLING_ALLOCATE', 'PRODUCTION_PLAN_CONFIRM', 'PRODUCTION_RESULT_CONFIRM']);
    expect(useOf('QUALITY')).toEqual(['DISPOSITION_SET', 'INSPECTION_REGISTER', 'INSPECTION_STANDARD_MANAGE']);
    expect(useOf('LOGISTICS')).toEqual(['GOODS_ISSUE_CONFIRM', 'MILL_SHEET_READ']);
  });

  it('권한 행은 역할×권한마다 하나뿐이고, 관리자는 17개 모두 가진다', () => {
    const keys = tables.rolePermission.map((p) => `${p.roleId}:${p.permission}`);
    expect(new Set(keys).size).toBe(keys.length);
    const admin = tables.role.find((r) => r.roleCode === 'ADMIN');
    expect(tables.rolePermission.filter((p) => p.roleId === admin?.id)).toHaveLength(PERMISSIONS.length);
    for (const { use, view } of Object.values(SEED_ROLE_PERMISSIONS)) expect(use.filter((p) => view.includes(p))).toEqual([]);
  });

  it('부서마다 부서장이 있고, 생산부 아래에 제선·제강·연주·열연 파트가 있다', () => {
    for (const d of tables.department) {
      const head = byId(tables.employee, d.headEmployeeId);
      expect(head?.isActive, d.departmentName).toBe(true);
    }
    const production = tables.department.find((d) => d.departmentName === '생산부');
    const parts = tables.department.filter((d) => d.parentId === production?.id).map((d) => d.departmentName);
    expect(parts).toEqual(['제선파트', '제강파트', '연주파트', '열연파트']);
  });

  it('역할마다 사원이 1명 이상이고 사원번호는 겹치지 않는다', () => {
    for (const role of tables.role) expect(tables.employee.some((e) => e.roleId === role.id), role.roleCode).toBe(true);
    const numbers = tables.employee.map((e) => e.employeeNo);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});

describe('기준정보 시드', () => {
  it('강종 6종과 적용 규격 번호', () => {
    expect(tables.steelGrade.map((g) => [g.steelGradeCode, g.standardNo])).toEqual([
      ['SS275', 'KS D 3503:2026'],
      ['SM355A', 'KS D 3515:2018'],
      ['SM355B', 'KS D 3515:2018'],
      ['SM355C', 'KS D 3515:2018'],
      ['SM355D', 'KS D 3515:2018'],
      ['SPHC', 'KS D 3501'],
    ]);
  });

  it('원료 4종: 코드 형식, 원료 유형, 기본 공급업체, 원료 야드', () => {
    const raws = tables.item.filter((i) => i.itemType === 'RAW_MATERIAL');
    expect(raws.map((i) => i.itemCode)).toEqual(['ORE01', 'COL01', 'LIM01', 'SMN01']);
    expect(raws.map((i) => i.rawMaterialType)).toEqual(['IRON_ORE', 'COAL', 'LIMESTONE', 'FERROALLOY']);
    for (const raw of raws) {
      expect(RAW_MATERIAL_CODE_PATTERN.test(raw.itemCode)).toBe(true);
      expect(raw.unitType).toBe('TON');
      expect(byId(tables.supplier, raw.defaultSupplierId)).toBeDefined();
      expect(byId(tables.yard, raw.defaultYardId)?.yardType).toBe('RAW_MATERIAL');
    }
  });

  it('규격: 강종 4종 × 슬래브 3종 = 슬래브 12·코일 12, SM355C·D는 규격 없음', () => {
    const slabs = tables.item.filter((i) => i.itemType === 'SLAB');
    const coils = tables.item.filter((i) => i.itemType === 'COIL');
    expect(slabs).toHaveLength(12);
    expect(coils).toHaveLength(12);
    const gradeCodes = new Set([...slabs, ...coils].map((i) => byId(tables.steelGrade, i.steelGradeId)?.steelGradeCode));
    expect([...gradeCodes].sort()).toEqual(['SM355A', 'SM355B', 'SPHC', 'SS275']);
  });

  it('규격 코드·이론중량·기본 야드가 규칙대로다', () => {
    for (const spec of tables.item.filter((i) => i.itemType !== 'RAW_MATERIAL')) {
      const grade = byId(tables.steelGrade, spec.steelGradeId)?.steelGradeCode ?? '';
      const [t, w, l] = [spec.thicknessMm ?? '', spec.widthMm ?? '', spec.lengthMm ?? ''];
      expect(spec.itemCode).toBe(formatSpecCode(spec.itemType === 'SLAB' ? 'SLAB' : 'COIL', grade, t, w, l));
      expect(spec.theoreticalWeightTon).toBe(calcTheoreticalWeightTon(t, w, l));
      expect(spec.unitType).toBe('QTY');
      expect(spec.defaultSupplierId).toBeNull();
      expect(byId(tables.yard, spec.defaultYardId)?.yardType).toBe(spec.itemType);
    }
    expect(tables.item.some((i) => i.itemCode === 'SL-SS275-250x1200x10000' && i.theoreticalWeightTon === '23.550')).toBe(true);
  });

  it('강종·두께·폭·길이 조합이 겹치지 않는다', () => {
    const products = tables.item.filter((i) => i.itemType !== 'RAW_MATERIAL');
    const keys = products.map((i) => [i.itemType, i.steelGradeId, i.thicknessMm, i.widthMm, i.lengthMm].join('|'));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('규격 매핑: 슬래브마다 코일 1개, 같은 강종·폭, 코일 이론중량 ≤ 슬래브 이론중량 (REQ-MST-004)', () => {
    const slabs = tables.item.filter((i) => i.itemType === 'SLAB');
    expect(tables.specMapping).toHaveLength(slabs.length);
    expect(new Set(tables.specMapping.map((m) => m.slabItemId)).size).toBe(slabs.length);
    for (const m of tables.specMapping) {
      const slab = byId(tables.item, m.slabItemId);
      const coil = byId(tables.item, m.coilItemId);
      expect(slab?.itemType).toBe('SLAB');
      expect(coil?.itemType).toBe('COIL');
      expect(coil?.steelGradeId).toBe(slab?.steelGradeId);
      expect(coil?.widthMm).toBe(slab?.widthMm);
      expect(compareDecimal(coil?.theoreticalWeightTon ?? '0', slab?.theoreticalWeightTon ?? '0')).toBe(-1);
    }
  });

  it('코일 두께는 KS 구간 경계를 피하고 6mm 이하·초과가 섞여 있다', () => {
    const boundaries = [1.2, 1.25, 1.6, 2, 2.5, 3.15, 3.2, 4, 5, 6, 6.3, 8, 10, 14, 16, 40];
    const thicknesses = [...new Set(tables.item.filter((i) => i.itemType === 'COIL').map((i) => Number(i.thicknessMm)))];
    for (const t of thicknesses) expect(boundaries).not.toContain(t);
    expect(thicknesses.some((t) => t <= 6)).toBe(true);
    expect(thicknesses.some((t) => t > 6)).toBe(true);
  });

  it('라우팅: 슬래브 제선→제강→연주, 코일은 열연까지. 열연 수율은 저장하지 않는다', () => {
    const route = (itemType: string) =>
      tables.routing
        .filter((r) => r.itemType === itemType)
        .sort((a, b) => a.processSeq - b.processSeq)
        .map((r) => r.processType);
    expect(route('SLAB')).toEqual(['IRONMAKING', 'STEELMAKING', 'CONTINUOUS_CASTING']);
    expect(route('COIL')).toEqual(['IRONMAKING', 'STEELMAKING', 'CONTINUOUS_CASTING', 'HOT_ROLLING']);
    expect(tables.routing.find((r) => r.processType === 'HOT_ROLLING')?.plannedYieldRate).toBeNull();
  });

  it('배합 원단위: 철광석·석탄·석회석은 공통, 합금철은 규격 있는 강종별', () => {
    const smn = tables.item.find((i) => i.itemCode === 'SMN01');
    const ferro = tables.specificConsumption.filter((c) => c.itemId === smn?.id);
    expect(ferro.map((c) => byId(tables.steelGrade, c.steelGradeId)?.steelGradeCode)).toEqual(['SS275', 'SM355A', 'SM355B', 'SPHC']);
    const common = tables.specificConsumption.filter((c) => c.itemId !== smn?.id);
    expect(common.every((c) => c.steelGradeId === null)).toBe(true);
    expect(common).toHaveLength(3);
  });

  it('생산 설정값: 히트 용량 250t, 납기 위험 기준일 3일', () => {
    expect(tables.productionSetting).toEqual([expect.objectContaining({ heatCapacityTon: '250.000', deliveryRiskDays: 3 })]);
  });

  it('거래 데이터는 아직 없다', () => {
    expect(tables.salesOrder).toHaveLength(0);
    expect(tables.lot).toHaveLength(0);
    expect(tables.businessEvent).toHaveLength(0);
  });
});
