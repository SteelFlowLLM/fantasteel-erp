import { calcTheoreticalWeightTon, ERROR_CODE } from '@fantasteel/shared';
import type { Prisma } from '../../generated/prisma/client';
import { AppException, badInput } from '../../common/errors/app.exception';
import { D, duplicate } from './master-data.util';

export const USED_SPEC_MESSAGE = '사용된 규격은 치수·이론중량을 수정할 수 없습니다. 새 규격을 추가해 주세요';

/** 1매 이론중량(t, 소수 3자리). 서버가 계산하며 클라이언트 값은 받지 않는다 (REQ-MST-003). */
export function computeSpecWeight(thicknessMm: Prisma.Decimal | number | string, widthMm: Prisma.Decimal | number | string, lengthMm: Prisma.Decimal | number | string): Prisma.Decimal {
  let text: string;
  try {
    text = calcTheoreticalWeightTon(String(thicknessMm), String(widthMm), String(lengthMm));
  } catch {
    throw badInput('두께·폭·길이는 숫자로 입력해 주세요');
  }
  const weight = D(text);
  if (weight.lte(0)) throw badInput('이론중량이 0 이하가 되는 치수는 등록할 수 없습니다');
  return weight;
}

const trim = (v: Prisma.Decimal | number | string) => D(v).toString();

/** 규격 코드: 슬래브 SL-강종-두께x폭x길이, 코일 CL-… (예: SL-SS275-250x1200x10000) */
export function buildSpecCode(itemType: string, steelGradeCode: string, thicknessMm: Prisma.Decimal | number | string, widthMm: Prisma.Decimal | number | string, lengthMm: Prisma.Decimal | number | string): string {
  return `${itemType === 'COIL' ? 'CL' : 'SL'}-${steelGradeCode}-${trim(thicknessMm)}x${trim(widthMm)}x${trim(lengthMm)}`;
}

export interface MappableSpec {
  id: number;
  specCode: string;
  itemType: string;
  steelGradeId: number;
  theoreticalWeightTon: Prisma.Decimal;
}

/**
 * 슬래브·코일 규격 매핑 규칙 (REQ-MST-004).
 * 슬래브 1 : 코일 1, 같은 강종, 코일 이론중량 ≤ 슬래브 이론중량. 이미 매핑된 규격은 다른 매핑에 쓸 수 없다.
 * existing = 각 규격이 이미 걸려 있는 상대 규격 코드 (수정 중인 매핑 자신은 넘기지 않는다).
 */
export function assertMappable(slab: MappableSpec, coil: MappableSpec, existing: { slabMappedCoilCode?: string | null; coilMappedSlabCode?: string | null }): void {
  if (slab.itemType !== 'SLAB') throw badInput(`${slab.specCode}은(는) 슬래브 규격이 아닙니다`);
  if (coil.itemType !== 'COIL') throw badInput(`${coil.specCode}은(는) 코일 규격이 아닙니다`);
  if (slab.steelGradeId !== coil.steelGradeId) throw badInput('강종이 다른 슬래브·코일 규격은 매핑할 수 없습니다');
  if (coil.theoreticalWeightTon.gt(slab.theoreticalWeightTon)) {
    throw badInput(`코일 이론중량(${coil.theoreticalWeightTon.toFixed(3)}t)이 슬래브 이론중량(${slab.theoreticalWeightTon.toFixed(3)}t)보다 클 수 없습니다`);
  }
  if (existing.slabMappedCoilCode) throw duplicate(`슬래브 규격 ${slab.specCode}은(는) 이미 코일 규격 ${existing.slabMappedCoilCode}와 매핑되어 있습니다`);
  if (existing.coilMappedSlabCode) throw duplicate(`코일 규격 ${coil.specCode}은(는) 이미 슬래브 규격 ${existing.coilMappedSlabCode}와 매핑되어 있습니다`);
}

export const usedSpecError = (message: string = USED_SPEC_MESSAGE) => new AppException(ERROR_CODE.MST_002, message);
