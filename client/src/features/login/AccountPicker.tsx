'use client';

// 계정 선택 (옛 LoginPage의 B안 디자인). 가짜 DB 모드는 계정 선택(SPEC 5장 결정 1), 서버 모드는 사원번호·비밀번호 로그인(LoginForm).
// 들어가면 이 탭의 sessionStorage에 사원 id를 두고 대시보드(또는 원래 가려던 화면)로 간다.
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { isServerDataSource } from '@/api/http';
import { ROLE, ROLE_LABEL } from '@/codes';
import { Icon, type IconName } from '@/components/Icon';
import { QueryBoundary } from '@/components/QueryBoundary';
import { Tag } from '@/components/Tag';
import { LoginForm } from '@/features/login/LoginForm';
import { Logo } from '@/features/shell/Logo';
import { useAccountList, useSelectAccount } from '@/hooks/useAccounts';
import { useSessionStore } from '@/stores/useSessionStore';
import { errorMessageOf } from '@/stores/useToastStore';

const FEATURES: readonly { icon: IconName; title: string; text: string }[] = [
  { icon: 'clipboard', title: '수주→출하 한 흐름', text: '예약·생산·검사·출하 매수를 수주 한 줄에서 확인' },
  { icon: 'approve', title: '추천은 시스템, 확정은 사람', text: 'LOT 배정은 추천 후 담당자가 확정, 구매요청은 부서장이 승인' },
  { icon: 'trace', title: '원료부터 코일까지 LOT 추적', text: '원료 → 용선 → 히트 → 슬래브 → 코일 정·역추적' },
];

/**
 * 로드맵 페이지는 폭이 좁으면 3D 화면 56% + 설명 카드 44%로 나뉘어, 로그인 화면 칸에서는 3D가 몇 줄 높이밖에 안 된다.
 * 노션에 올린 파일을 그대로 두려고 파일은 고치지 않고, 같은 출처 iframe에 설명 카드를 숨기는 스타일만 덧붙인다.
 * 3D 캔버스는 창 크기 변경 때 다시 재므로 resize를 한 번 보낸다.
 */
const ROADMAP_SRC = '/roadmap/erp-3d-roadmap.html';
const ROADMAP_STYLE_ID = 'login-roadmap-fit';
/** 로드맵의 기본 시점을 조작 UI 없이 찍어 둔 그림. 노션 로드맵을 고치면 함께 다시 찍는다 */
const ROADMAP_PREVIEW = '/roadmap/erp-3d-roadmap-preview.webp';

function fitRoadmapToStage(frame: HTMLIFrameElement) {
  const doc = frame.contentDocument;
  // 아직 불러오는 중이면(head가 비어 있을 수 있다) load 이벤트 때 다시 불린다
  if (!doc || doc.readyState !== 'complete' || !doc.URL.endsWith(ROADMAP_SRC) || doc.getElementById(ROADMAP_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = ROADMAP_STYLE_ID;
  style.textContent = 'body{grid-template-columns:minmax(0,1fr)!important;grid-template-rows:minmax(0,1fr)!important}#panel{display:none!important}';
  doc.head.append(style);
  frame.contentWindow?.dispatchEvent(new Event('resize'));
}

/** 다른 사이트로 나가지 않도록 같은 앱 안의 경로만 받는다 */
function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/login')) return '/dashboard';
  return next;
}

export function AccountPicker() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const hydrated = useSessionStore((state) => state.hydrated);
  const employeeId = useSessionStore((state) => state.employeeId);
  const server = isServerDataSource();

  // 이미 계정을 골랐으면(또는 방금 골랐으면) 가려던 화면으로 보낸다
  useEffect(() => {
    if (hydrated && employeeId !== null) router.replace(next);
  }, [hydrated, employeeId, next, router]);

  // 3D 로드맵은 정점 65만 개가 넘는 WebGL(파일 2.8MB)이라 로그인 화면이 열릴 때마다 돌리지 않는다. 그림을 먼저 보이고 누르면 켠다
  const [roadmapOn, setRoadmapOn] = useState(false);
  // 화면이 붙기 전에 iframe이 먼저 다 열렸을 수도 있어서 onLoad 대신 지금 상태도 확인한다
  const roadmapRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const frame = roadmapRef.current;
    if (!roadmapOn || !frame) return;
    const fit = () => fitRoadmapToStage(frame);
    fit();
    frame.addEventListener('load', fit);
    return () => frame.removeEventListener('load', fit);
  }, [roadmapOn]);

  return (
    <div className="flex h-viewport w-viewport overflow-hidden bg-bg">
      <section aria-label="FantaSteel 소개" className="flex w-[min(760px,52vw)] flex-none flex-col gap-7 overflow-hidden bg-nav-dark px-15 pt-11 pb-10 text-white">
        <div className="flex items-center gap-3">
          <Logo scale={2} />
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
        </div>
        {/* 노션 「로드맵」 페이지의 3D 기능 로드맵에 헌정 동상을 더한 파일(public/roadmap). 자체 WebGL·조작 UI를 가진 한 장짜리 페이지라 iframe으로 따로 띄운다 */}
        {roadmapOn ? (
          <iframe
            ref={roadmapRef}
            src={ROADMAP_SRC}
            title="철강제조 ERP 3D 기능 로드맵"
            className="block min-h-[280px] w-full flex-1 rounded-md border-0 bg-nav-dark-2"
          />
        ) : (
          <button
            type="button"
            onClick={() => setRoadmapOn(true)}
            className="group relative block min-h-[280px] w-full flex-1 overflow-hidden rounded-md bg-nav-dark-2 text-left"
          >
            <img
              src={ROADMAP_PREVIEW}
              alt=""
              className="absolute inset-0 size-full object-cover motion-safe:transition-transform motion-safe:duration-300 group-hover:scale-[1.02]"
            />
            <span className="absolute inset-x-0 top-0 flex flex-col gap-0.5 bg-linear-to-b from-nav-dark/90 to-transparent px-4 pt-3 pb-10">
              <b className="text-base font-semibold">철강제조 ERP 기능 로드맵</b>
              <span className="text-xs text-nav-ink">수주에서 밀시트까지, P1 16단계</span>
            </span>
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="inline-flex h-10 flex-none items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-nav-dark shadow-lg group-hover:bg-brand-tint">
                <Icon name="eye" />
                3D로 돌려 보기
              </span>
            </span>
          </button>
        )}
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

      <section aria-label={server ? '로그인' : '계정 선택'} className="flex min-w-0 flex-1 flex-col overflow-auto bg-surface">
        <div className="flex flex-1 justify-center px-6 py-6">
          {/* 세로 가운데. 계정 목록이 화면보다 길면 my-auto가 0이 되어 위부터 스크롤된다 */}
          <div className="my-auto flex w-[400px] max-w-full flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-3xl font-semibold">{server ? '로그인' : '계정 선택'}</h2>
              <p className="text-sm text-ink-3">{server ? '사원번호와 비밀번호로 로그인해요.' : '시연용이에요. 계정을 누르면 그 사원으로 바로 들어가요.'}</p>
            </div>
            {server ? <LoginForm /> : <AccountList />}
          </div>
        </div>
        <footer className="flex h-12 flex-none items-center gap-2 border-t border-line px-10 text-cap text-ink-3">
          <Icon name="shield" size="sm" />
          <span>
            인가된 사원만 접속해요
            {server ? null : <AdminContact />}
          </span>
        </footer>
      </section>
    </div>
  );
}

/** 가짜 DB 모드: 사용 중인 사원 목록에서 고른다 */
function AccountList() {
  const accounts = useAccountList();
  const select = useSelectAccount();
  return (
    <>
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
    </>
  );
}

function AdminContact() {
  const admin = useAccountList().data?.find((account) => account.roleCode === ROLE.ADMIN);
  return admin ? <> · 계정 문의 {admin.departmentName} {admin.employeeName}</> : null;
}
