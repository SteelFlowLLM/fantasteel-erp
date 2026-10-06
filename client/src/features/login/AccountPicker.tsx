'use client';

// 계정 선택 (옛 LoginPage의 B안 디자인). 사원번호·비밀번호 로그인은 나중에 넣는다 (SPEC 5장 결정 1).
// 계정을 고르면 이 탭의 sessionStorage에 사원 id를 두고 대시보드(또는 원래 가려던 화면)로 간다.
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { ROLE, ROLE_LABEL } from '@/codes';
import { Icon, type IconName } from '@/components/Icon';
import { QueryBoundary } from '@/components/QueryBoundary';
import { Tag } from '@/components/Tag';
import { Logo } from '@/features/shell/Logo';
import { useAccountList, useSelectAccount } from '@/hooks/useAccounts';
import { useSessionStore } from '@/stores/useSessionStore';
import { errorMessageOf } from '@/stores/useToastStore';

const FEATURES: readonly { icon: IconName; title: string; text: string }[] = [
  { icon: 'clipboard', title: '수주→출하 한 흐름', text: '예약·생산·검사·출하 매수를 수주 한 줄에서 확인' },
  { icon: 'approve', title: '추천은 시스템, 확정은 사람', text: 'LOT 배정은 추천 후 담당자가 확정, 구매요청은 부서장이 승인' },
  { icon: 'trace', title: '원료부터 코일까지 LOT 추적', text: '원료 → 용선 → 히트 → 슬래브 → 코일 정·역추적' },
];

/** 소개 그림 (옛 로그인 화면 SVG 그대로) */
const ILLUSTRATION_BARS: readonly (readonly [number, number, number, string])[] = [
  [300, 186, 48, '#23507F'],
  [330, 162, 72, '#5B86B5'],
  [360, 176, 58, '#23507F'],
  [390, 146, 88, '#5B86B5'],
  [420, 168, 66, '#23507F'],
  [450, 154, 80, '#5B86B5'],
  [480, 190, 44, '#23507F'],
  [510, 158, 76, '#5B86B5'],
  [540, 172, 62, '#23507F'],
  [570, 150, 84, '#5B86B5'],
  [600, 182, 52, '#23507F'],
];

/** 다른 사이트로 나가지 않도록 같은 앱 안의 경로만 받는다 */
function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/login')) return '/dashboard';
  return next;
}

function Illustration() {
  return (
    <svg viewBox="0 0 640 250" aria-hidden="true" className="block w-full max-w-[640px] flex-none">
      <rect x="0" y="40" width="260" height="210" fill="#223040" />
      <rect x="20" y="64" width="220" height="24" rx="2" fill="#23507F" />
      <rect x="20" y="94" width="220" height="24" rx="2" fill="#23507F" />
      <rect x="20" y="124" width="220" height="24" rx="2" fill="#5B86B5" />
      <rect x="20" y="154" width="176" height="24" rx="2" fill="#23507F" />
      <rect x="20" y="184" width="120" height="24" rx="2" fill="#5B86B5" />
      <rect x="20" y="214" width="64" height="24" rx="2" fill="#23507F" />
      <rect x="280" y="0" width="150" height="104" fill="#223040" />
      <rect x="296" y="16" width="118" height="32" rx="2" fill="#5B86B5" />
      <rect x="296" y="56" width="118" height="32" rx="2" fill="#23507F" />
      <rect x="446" y="0" width="194" height="104" fill="#23507F" />
      <rect x="462" y="18" width="160" height="12" rx="2" fill="#223040" />
      <rect x="462" y="38" width="112" height="12" rx="2" fill="#223040" />
      <rect x="462" y="58" width="136" height="12" rx="2" fill="#223040" />
      <rect x="280" y="120" width="360" height="130" fill="#223040" />
      {ILLUSTRATION_BARS.map(([x, y, height, color]) => (
        <rect key={x} x={x} y={y} width="18" height={height} rx="2" fill={color} />
      ))}
      <rect x="280" y="110" width="96" height="3" fill="#E0762E" />
    </svg>
  );
}

export function AccountPicker() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const hydrated = useSessionStore((state) => state.hydrated);
  const employeeId = useSessionStore((state) => state.employeeId);
  const accounts = useAccountList();
  const select = useSelectAccount();

  // 이미 계정을 골랐으면(또는 방금 골랐으면) 가려던 화면으로 보낸다
  useEffect(() => {
    if (hydrated && employeeId !== null) router.replace(next);
  }, [hydrated, employeeId, next, router]);

  const admin = accounts.data?.find((account) => account.roleCode === ROLE.ADMIN);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg">
      <section aria-label="FantaSteel 소개" className="flex w-[min(760px,52vw)] flex-none flex-col gap-7 overflow-hidden bg-nav-dark px-15 pt-11 pb-10 text-white">
        <div className="flex items-center gap-3">
          <Logo size={36} />
          <span className="flex flex-col gap-0.5">
            <span className="text-lg leading-snug font-bold tracking-[0.08em]">FANTASTEEL</span>
            <span className="text-xs text-nav-ink">철강 제조 AI 협업 ERP</span>
          </span>
        </div>
        <div className="mt-2 flex flex-col gap-2.5">
          <h1 className="text-5xl font-semibold tracking-[-0.01em]">
            수주에서 출하까지,
            <br />한 흐름으로 일해요.
          </h1>
          <p className="max-w-[560px] text-base leading-relaxed text-nav-ink">
            영업·구매·생산·품질·물류가 같은 수주와 LOT를 보고 일해요. 재고는 시스템이 먼저 예약하고, LOT 배정은 시스템이 추천한 뒤 담당자가 확정해요.
          </p>
        </div>
        <Illustration />
        <ul className="mt-auto flex flex-col gap-3.5 border-t border-nav-dark-2 pt-5.5">
          {FEATURES.map((feature) => (
            <li key={feature.title} className="flex items-center gap-3.5">
              <span className="inline-flex size-9 flex-none items-center justify-center rounded-md bg-nav-dark-2 text-chart-3">
                <Icon name={feature.icon} />
              </span>
              <span className="flex flex-col">
                <b className="text-base font-semibold">{feature.title}</b>
                <span className="text-xs text-nav-ink">{feature.text}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="계정 선택" className="flex min-w-0 flex-1 flex-col overflow-auto bg-surface">
        <div className="flex flex-1 justify-center px-6 pt-14 pb-6">
          <div className="flex w-[400px] max-w-full flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-3xl font-semibold">계정 선택</h2>
              <p className="text-sm text-ink-3">시연용이에요. 계정을 누르면 그 사원으로 바로 들어가요.</p>
            </div>
            <QueryBoundary query={accounts} loadingLabel="계정을 불러오는 중…">
              {(list) => (
                <ul className="flex flex-col rounded-md border border-line">
                  {list.map((account) => (
                    <li key={account.employeeId} className="border-b border-line last:border-b-0">
                      <button
                        type="button"
                        disabled={select.isPending}
                        onClick={() => select.mutate(account.employeeId)}
                        className="flex h-11 w-full items-center gap-2.5 px-3 text-left text-sm text-ink enabled:hover:bg-surface-2 disabled:opacity-55"
                      >
                        <Tag tone="brand" className="w-[52px] flex-none justify-center">
                          {ROLE_LABEL[account.roleCode]}
                        </Tag>
                        <b className="w-14 flex-none font-semibold">{account.employeeName}</b>
                        <span className="min-w-0 truncate text-cap text-ink-3">
                          {account.departmentName} · {account.jobGradeName}
                        </span>
                        {account.headDepartmentNames.length ? (
                          <Tag tone="outline" size="sm" title={`${account.headDepartmentNames.join('·')} 부서장 · 구매요청 승인권자`} className="flex-none">
                            부서장
                          </Tag>
                        ) : null}
                        <Icon name="chevron-right" size="sm" className="ml-auto flex-none text-ink-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </QueryBoundary>
            {select.isPending ? <span className="text-cap text-ink-3">들어가는 중…</span> : null}
            {select.error ? (
              <span role="alert" className="flex items-center gap-1.5 text-xs text-danger">
                <Icon name="alert" size="sm" />
                {errorMessageOf(select.error)}
              </span>
            ) : null}
          </div>
        </div>
        <footer className="flex h-12 flex-none items-center gap-2 border-t border-line px-10 text-cap text-ink-3">
          <Icon name="shield" size="sm" />
          <span>인가된 사원만 접속해요{admin ? ` · 계정 문의 ${admin.departmentName} ${admin.employeeName}` : ''}</span>
        </footer>
      </section>
    </div>
  );
}
