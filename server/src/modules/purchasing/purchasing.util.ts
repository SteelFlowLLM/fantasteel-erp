import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { Matches } from 'class-validator';
import { Prisma } from '../../generated/prisma/client';
import { badInput } from '../../common/errors/app.exception';

export const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);
export const ZERO = D(0);

const TON_PATTERN = /^\d{1,9}(\.\d{1,3})?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 톤 입력: 소수 3자리 이하 문자열. 숫자로 와도 문자열로 바꿔 Decimal 계산에만 쓴다 (JS number 계산 금지). */
export const IsTonString = () =>
  applyDecorators(
    Transform(({ value }) => (typeof value === 'number' ? String(value) : value)),
    Matches(TON_PATTERN, { message: '톤은 소수 3자리 이하의 숫자로 입력해 주세요' }),
  );

export const IsDateOnly = () => applyDecorators(Matches(DATE_PATTERN, { message: '날짜는 YYYY-MM-DD 형식으로 입력해 주세요' }));

/** 0보다 큰 톤 값인지 확인하고 Decimal로 돌려준다. */
export function parsePositiveTon(value: string, label: string): Prisma.Decimal {
  if (!TON_PATTERN.test(value)) throw badInput(`${label}은(는) 소수 3자리 이하의 숫자로 입력해 주세요`);
  const ton = D(value);
  if (ton.lte(0)) throw badInput(`${label}은(는) 0보다 커야 합니다`);
  return ton;
}

export function isTonText(value: unknown): value is string {
  return typeof value === 'string' && TON_PATTERN.test(value);
}

/** 오늘 날짜 (Asia/Seoul) `YYYY-MM-DD`. */
export function todayKst(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** 실제 달력에 있는 `YYYY-MM-DD` 인지. */
export function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** `YYYY-MM-DD` → DATE 컬럼에 넣을 값. 달력에 없는 날짜는 COM-003. */
export function toDateOnly(value: string, label: string): Date {
  if (!isDateOnly(value)) throw badInput(`${label}이(가) 올바른 날짜가 아닙니다`);
  return new Date(`${value}T00:00:00.000Z`);
}

export function dateOnlyText(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** 응답에 넣는 사원 요약 */
export const EMPLOYEE_BRIEF = {
  select: { id: true, employeeNo: true, employeeName: true, jobGrade: true, department: { select: { id: true, departmentName: true } } },
} as const;

/** 응답에 넣는 원료 요약 */
export const RAW_MATERIAL_BRIEF = {
  select: { id: true, materialCode: true, rawMaterialType: true, item: { select: { itemName: true, defaultSupplierId: true } } },
} as const;

export interface RawMaterialView {
  id: number;
  materialCode: string;
  rawMaterialType: string;
  itemName: string;
}

export function rawMaterialView(rm: { id: number; materialCode: string; rawMaterialType: string; item: { itemName: string } }): RawMaterialView {
  return { id: rm.id, materialCode: rm.materialCode, rawMaterialType: rm.rawMaterialType, itemName: rm.item.itemName };
}

/** `철광석 100.000t 외 1건` */
export function itemsSummary(items: { rawMaterial: { item: { itemName: string } }; ton: Prisma.Decimal }[]): string {
  if (!items.length) return '품목 없음';
  const first = `${items[0].rawMaterial.item.itemName} ${items[0].ton.toFixed(3)}t`;
  return items.length > 1 ? `${first} 외 ${items.length - 1}건` : first;
}
