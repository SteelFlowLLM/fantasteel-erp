'use client';

// 기준정보 준비 상태 띠 (BP-MST-01 "누락 표시", 9.3 MST-001). 누르면 해당 탭(검사 기준은 품질의 검사 기준 화면)으로 간다.
import Link from 'next/link';
import { useState } from 'react';
import { ERROR_MESSAGE } from '@/codes';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import type { MasterTabKey } from '@/features/masterData/components/MasterParts';
import type { ReadinessArea, ReadinessProblem } from '@/features/masterData/lib/readiness';
import { useMasterReadiness } from '@/hooks/useMasterData';
import { fmtHM } from '@/lib/format';

/** 문제 영역 칩 이름과 이동할 탭 (검사 기준은 다른 화면) */
const AREA: Record<ReadinessArea, { label: string; tab: MasterTabKey | null }> = {
  ROUTING: { label: '수율', tab: 'routing' },
  SPECIFIC_CONSUMPTION: { label: '배합', tab: 'consumption' },
  SPEC_MAPPING: { label: '규격 매핑', tab: 'mapping' },
  INSPECTION_STANDARD: { label: '검사 기준', tab: null },
  DEFAULT_SUPPLIER: { label: '기본 공급업체', tab: 'items' },
  PRODUCT_SPEC: { label: '제품 규격', tab: 'specs' },
  PRODUCTION_SETTING: { label: '생산 설정값', tab: 'settings' },
};
const FOLD = 4;
const CHIP = 'inline-flex h-5 flex-none items-center rounded-xs bg-surface px-1.5 text-cap font-semibold text-danger shadow-[inset_0_0_0_1px_#f2c3be] hover:bg-[#fff3f2]';

function standardHref(problem: ReadinessProblem): string {
  const params = new URLSearchParams();
  if (problem.processType) params.set('process', problem.processType);
  if (problem.steelGradeId !== undefined) params.set('grade', String(problem.steelGradeId));
  return `/quality/standards?${params.toString()}`;
}

export function ReadinessBanner({ onGoTab }: { onGoTab: (tab: MasterTabKey) => void }) {
  const query = useMasterReadiness();
  const [open, setOpen] = useState(false);
  const readiness = query.data;

  if (!readiness) {
    if (query.error) {
      return (
        <Banner
          tone="wait"
          actions={
            <Button size="sm" onClick={() => void query.refetch()}>
              다시 시도
            </Button>
          }
        >
          준비 상태를 확인하지 못했어요.
        </Banner>
      );
    }
    return (
      <Banner icon="refresh" className="flex-none">
        준비 상태를 확인하는 중이에요…
      </Banner>
    );
  }

  const refresh = (
    <span className="flex items-center gap-2">
      <span className="text-cap opacity-80">{fmtHM(readiness.checkedAt)} 확인</span>
      <Button size="sm" icon="refresh" onClick={() => void query.refetch()} disabled={query.isFetching} aria-label="준비 상태 다시 확인">
        다시 확인
      </Button>
    </span>
  );

  if (readiness.ready) {
    return (
      <Banner tone="ok" actions={refresh} className="flex-none items-center">
        <b>기준정보 준비 완료</b> <span className="opacity-80">· 생산·MRP 계산에 필요한 수율·배합·규격 매핑·검사 기준이 모두 있어요</span>
      </Banner>
    );
  }

  const shown = open ? readiness.problems : readiness.problems.slice(0, FOLD);
  return (
    <Banner tone="danger" actions={refresh} className="flex-none">
      <div className="flex flex-col gap-1.5">
        <div>
          <b>기준정보 준비가 덜 됐어요 ({readiness.problems.length}건)</b>{' '}
          <span className="opacity-80">
            · {ERROR_MESSAGE['MST-001']} <span className="font-mono text-cap">MST-001</span> · 아래를 채워야 생산·MRP 계산이 돼요
          </span>
        </div>
        <ul className="flex flex-col gap-1">
          {shown.map((problem) => {
            const area = AREA[problem.area];
            return (
              <li key={problem.key} className="flex items-center gap-2">
                {area.tab ? (
                  <button type="button" className={CHIP} onClick={() => area.tab && onGoTab(area.tab)} title={`${area.label} 탭으로 이동`}>
                    {area.label}
                  </button>
                ) : (
                  <Link href={standardHref(problem)} className={CHIP} title="품질의 검사 기준 화면으로 이동">
                    {area.label}
                  </Link>
                )}
                <span>{problem.message}</span>
              </li>
            );
          })}
        </ul>
        {readiness.problems.length > FOLD ? (
          <button type="button" className="self-start text-cap font-semibold underline" onClick={() => setOpen(!open)}>
            {open ? '접기' : `${readiness.problems.length - FOLD}건 더 보기`}
          </button>
        ) : null}
      </div>
    </Banner>
  );
}
