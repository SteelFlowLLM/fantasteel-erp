import { HttpStatus } from '@nestjs/common';
import { ERROR_CODE } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import { AppException } from '../../common/errors/app.exception';

export const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);

/** 이미 있는 값과 겹칠 때 (409). 메시지에 겹치는 대상을 적는다. */
export const duplicate = (message: string) => new AppException(ERROR_CODE.COM_003, message, HttpStatus.CONFLICT);

/** 다른 데이터가 참조 중이라 지울 수 없을 때 (409). */
export const referenced = (message: string) => new AppException(ERROR_CODE.COM_005, message, HttpStatus.CONFLICT);

/** `?active=true|false` 쿼리 → boolean. */
export function parseActive(v?: string): boolean | undefined {
  return v === 'true' ? true : v === 'false' ? false : undefined;
}

/** 열연 계획 수율 = 코일 1개 이론중량 ÷ 슬래브 1매 이론중량 (소수 4자리, 저장하지 않는다). REQ-MST-004 */
export function hotRollingYieldRate(coilWeightTon: Prisma.Decimal, slabWeightTon: Prisma.Decimal): Prisma.Decimal {
  return coilWeightTon.div(slabWeightTon).toDecimalPlaces(4);
}
export const yieldText = (coilWeightTon: Prisma.Decimal, slabWeightTon: Prisma.Decimal): string => hotRollingYieldRate(coilWeightTon, slabWeightTon).toFixed(4);
