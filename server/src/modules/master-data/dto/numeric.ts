import { Transform } from 'class-transformer';

/** 숫자로 읽을 수 있는 문자열("250", "0.035")은 숫자로 바꿔 검증한다. 빈 문자열·null은 그대로 둔다. */
export const NumericInput = () =>
  Transform(({ value }) => (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : value));
