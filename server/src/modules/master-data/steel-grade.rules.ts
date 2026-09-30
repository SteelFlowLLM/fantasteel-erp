import { badInput } from '../../common/errors/app.exception';
import type { CompositionSpecInputDto } from './dto/composition-spec-input.dto';

/** 성분 규격 입력 검증: 성분 기호 중복 금지, min·max 중 하나는 필수, min ≤ max (경계 포함). */
export function validateCompositionInputs(list: CompositionSpecInputDto[]): void {
  const seen = new Set<string>();
  for (const c of list) {
    const key = c.elementCode.toLowerCase();
    if (seen.has(key)) throw badInput(`성분 ${c.elementCode}이(가) 중복되었습니다`);
    seen.add(key);
    const min = c.minValue ?? null;
    const max = c.maxValue ?? null;
    if (min === null && max === null) throw badInput(`성분 ${c.elementCode}의 최소값·최대값 중 하나는 입력해 주세요`);
    if (min !== null && max !== null && min > max) throw badInput(`성분 ${c.elementCode}의 최소값이 최대값보다 클 수 없습니다`);
  }
}
