// 재고 화면 공통 조각: 매수 칸, 캡션, 강종 선택, 링크
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { Select } from '@/components/Input';
import { useSteelGradeList } from '@/hooks/useLookups';
import { cn } from '@/lib/cn';
import { fmtInt } from '@/lib/format';

type QtyTone = 'ok' | 'wait' | 'danger' | 'run';
const QTY_TONE: Record<QtyTone, string> = { ok: 'text-ok', wait: 'text-wait', danger: 'text-danger', run: 'text-run' };

/** 매수 표시: 0이면 흐리게, 아니면 숫자 + 작은 단위 */
export function Qty({ value, unit, tone, strong }: { value: number; unit: string; tone?: QtyTone; strong?: boolean }) {
  if (value === 0) {
    return (
      <span className="text-ink-3">
        0<small className="ml-0.5 text-cap">{unit}</small>
      </span>
    );
  }
  return (
    <span className={cn(strong && 'font-semibold', tone && QTY_TONE[tone])}>
      {fmtInt(value)}
      <small className="ml-0.5 text-cap font-normal text-ink-3">{unit}</small>
    </span>
  );
}

/** 표 아래 안내 글 */
export function TableCaption({ children }: { children: ReactNode }) {
  return (
    <span className="flex items-start gap-1.5 text-cap leading-4 text-ink-3">
      <Icon name="info" size="sm" className="mt-px flex-none" />
      <span>{children}</span>
    </span>
  );
}

/** 강종 선택 ('전체' + 기준정보 강종) */
export function SteelGradeSelect({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const grades = useSteelGradeList();
  const list = grades.data ?? [];
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-xs font-medium text-ink-2">강종</span>
      <Select aria-label="강종" className="w-[130px] font-mono text-mono" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">전체</option>
        {list.map((g) => (
          <option key={g.id} value={g.steelGradeCode}>
            {g.steelGradeCode}
          </option>
        ))}
        {value && !list.some((g) => g.steelGradeCode === value) ? <option value={value}>{value}</option> : null}
      </Select>
    </label>
  );
}

export const lotTraceHref = (lotNo: string) => `/lots/trace?lot=${encodeURIComponent(lotNo)}`;
export const productionPlanHref = (planId: number) => `/production/plans?plan=${planId}`;

/** LOT 번호 링크 (LOT 추적으로) */
export function LotNoLink({ lotNo, className }: { lotNo: string; className?: string }) {
  return (
    <Link href={lotTraceHref(lotNo)} className={cn('font-mono text-mono text-run hover:underline', className)}>
      {lotNo}
    </Link>
  );
}

/** 생산계획 번호 링크 */
export function PlanLink({ planId, planNo }: { planId: number | null; planNo: string | null }) {
  if (!planNo) return <span className="text-ink-3">—</span>;
  if (planId === null) return <span className="font-mono text-mono">{planNo}</span>;
  return (
    <Link href={productionPlanHref(planId)} className="font-mono text-mono text-run hover:underline">
      {planNo}
    </Link>
  );
}
