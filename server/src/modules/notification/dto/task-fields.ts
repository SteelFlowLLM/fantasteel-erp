import { Matches, registerDecorator, type ValidationOptions } from 'class-validator';

/** 달력에 있는 날짜만 (예: 2026-02-31은 거부). */
export function IsCalendarDate(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isCalendarDate',
      target: target.constructor,
      propertyName,
      options: { message: '날짜는 YYYY-MM-DD 형식의 실제 날짜여야 합니다', ...options },
      validator: {
        validate: (v: unknown) => {
          if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
          const d = new Date(`${v}T00:00:00Z`);
          // 2026-13-01은 Invalid Date, 2026-02-31은 3월로 넘어가므로 되돌려 비교한다
          return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
        },
      },
    });
}

/** 프론트 경로만 허용: "/"로 시작하고 "//"(외부 주소)나 공백이 없다. */
export const IsLinkPath = () => Matches(/^\/(?!\/)\S*$/, { message: '이동 경로는 "/"로 시작하는 화면 경로여야 합니다' });
