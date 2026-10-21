// 작업 로그 번호(업무 프로세스 9.1)·규격 코드(REQ-MST-003) 형식.
// 공통 코드가 아니다 (공통 코드 정의서 4장). 업무 번호·LOT 번호는 서버가 채번한다(server/src/common/numbering).

import type { ProductItemType } from '@/codes/masterData';

const pad = (n: number, width: number) => String(n).padStart(width, '0');

function assertSequence(seq: number): void {
  if (!Number.isInteger(seq) || seq < 1) throw new RangeError(`일련번호는 1 이상의 정수여야 해요: ${seq}`);
}

/** EV-YYMMDD-NNN (예: EV-261004-023) */
export function formatEventNo(yymmdd: string, seq: number): string {
  assertSequence(seq);
  return `EV-${yymmdd}-${pad(seq, 3)}`;
}

const trimDecimal = (value: string) => (value.includes('.') ? value.replace(/\.?0+$/, '') : value);

/** 규격 코드: 유형(SL 슬래브 / CL 코일)-강종-두께x폭x길이 (REQ-MST-003, 예: SL-SS275-250x1500x10000) */
export function formatSpecCode(
  itemType: ProductItemType,
  steelGradeCode: string,
  thicknessMm: string,
  widthMm: string,
  lengthMm: string,
): string {
  const prefix = itemType === 'SLAB' ? 'SL' : 'CL';
  return `${prefix}-${steelGradeCode}-${trimDecimal(thicknessMm)}x${trimDecimal(widthMm)}x${trimDecimal(lengthMm)}`;
}
