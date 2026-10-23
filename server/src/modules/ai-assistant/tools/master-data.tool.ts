import { PERMISSION, type CustomerView, type SpecMappingItemView, type SpecMappingView, type SteelGradeView, type SupplierView } from '@fantasteel/shared';
import type { MasterDataService } from '../../master-data/master-data.service';
import { limitRows, looseIncludes, optionalString, requiredString, ToolArgumentError, type AssistantTool } from './assistant-tool';

export const MASTER_DATA_KINDS = ['customers', 'suppliers', 'steel_grades', 'spec_mappings'] as const;
export type MasterDataKind = (typeof MASTER_DATA_KINDS)[number];

const KIND_LABEL: Record<MasterDataKind, string> = { customers: '고객사', suppliers: '공급업체', steel_grades: '강종', spec_mappings: '규격 매핑' };

/** 치수는 두께×너비×길이(mm). 소수점 뒤 불필요한 0은 지운다 */
const dimensions = (i: SpecMappingItemView): string => [i.thicknessMm, i.widthMm, i.lengthMm].map((v) => String(Number(v))).join('×');

const customerRow = (c: CustomerView) => ({ 고객사코드: c.customerCode, 고객사: c.customerName });
const supplierRow = (s: SupplierView) => ({ 공급업체코드: s.supplierCode, 공급업체: s.supplierName });
const steelGradeRow = (g: SteelGradeView) => ({ 강종코드: g.steelGradeCode, 강종: g.steelGradeName, '적용 규격 번호': g.standardNo });
const specMappingRow = (m: SpecMappingView) => ({
  강종: m.steelGradeCode,
  '슬래브 규격': m.slabItem.itemCode,
  '슬래브 치수(두께×너비×길이 mm)': dimensions(m.slabItem),
  '슬래브 1매 이론중량 톤': m.slabItem.theoreticalWeightTon,
  '코일 규격': m.coilItem.itemCode,
  '코일 치수(두께×너비×길이 mm)': dimensions(m.coilItem),
  '코일 1개 이론중량 톤': m.coilItem.theoreticalWeightTon,
  '열연 계획 수율': m.hotRollingYieldRate ? `${(Number(m.hotRollingYieldRate) * 100).toFixed(1)}%` : null,
});

/**
 * 기준정보 조회 (GET customers·suppliers·steel-grades·spec-mappings, 기준정보 관리 VIEW, 문서에 없는 기능 이슈 #506).
 * 기준정보 화면과 같은 목록이라 권한이 없으면 아무것도 돌려주지 않는다. 목록 API에 쪽이 없어 전체를 읽은 뒤 코드·이름으로 거른다.
 */
export function masterDataTool(masterData: MasterDataService): AssistantTool {
  return {
    access: { checkedBy: 'TOOLBOX', permissions: [PERMISSION.MASTER_MANAGE] },
    definition: {
      name: 'get_master_data',
      description: `기준정보를 조회한다. kind: customers(고객사), suppliers(공급업체), steel_grades(강종과 KS 적용 규격 번호), spec_mappings(슬래브-코일 규격 매핑: 치수·1매 이론중량·열연 계획 수율). keyword로 코드·이름(규격 매핑은 강종·규격 코드)을 거른다.`,
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: [...MASTER_DATA_KINDS], description: '기준정보 종류' },
          keyword: { type: 'string', description: '코드나 이름 일부' },
        },
        required: ['kind'],
      },
    },
    async run(args) {
      const kind = requiredString(args, 'kind');
      if (!(MASTER_DATA_KINDS as readonly string[]).includes(kind)) throw new ToolArgumentError(`kind는 ${MASTER_DATA_KINDS.join(', ')} 중 하나예요`);
      const keyword = optionalString(args, 'keyword');
      const found = await read(masterData, kind as MasterDataKind, keyword);
      const limited = limitRows(found);
      return {
        label: `기준정보 · ${KIND_LABEL[kind as MasterDataKind]}${keyword ? ` · ${keyword}` : ''}`,
        data: { [`${KIND_LABEL[kind as MasterDataKind]} 수`]: found.length, 목록: limited.rows, '생략 줄 수': limited.omitted },
      };
    },
  };
}

async function read(masterData: MasterDataService, kind: MasterDataKind, keyword: string | undefined): Promise<Record<string, unknown>[]> {
  const keep = (...texts: (string | null)[]) => keyword === undefined || looseIncludes(texts, keyword);
  switch (kind) {
    case 'customers':
      return (await masterData.listCustomers()).filter((c) => keep(c.customerCode, c.customerName)).map(customerRow);
    case 'suppliers':
      return (await masterData.listSuppliers()).filter((s) => keep(s.supplierCode, s.supplierName)).map(supplierRow);
    case 'steel_grades':
      return (await masterData.listSteelGrades()).filter((g) => keep(g.steelGradeCode, g.steelGradeName, g.standardNo)).map(steelGradeRow);
    case 'spec_mappings':
      return (await masterData.listSpecMappings()).filter((m) => keep(m.steelGradeCode, m.slabItem.itemCode, m.coilItem.itemCode)).map(specMappingRow);
  }
}
