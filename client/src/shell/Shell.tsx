// B안 셸: 어두운 아이콘 레일 + 상단 바(제목·검색·알림·메신저·AI·사용자) + 본문.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { ROLE_CODE_LABEL, type RoleCode } from '@fantasteel/shared';
import { authApi } from '@/api/auth';
import { disconnectRealtime } from '@/api/realtime';
import { queryClient } from '@/api/queryClient';
import { Icon } from '@/components/ui';
import { fmtHM, fmtMDdow, relTime } from '@/lib/format';
import { useAuthStore, useMe } from '@/stores/auth';
import { AiPanel } from './AiPanel';
import { activeNavPath, navFor } from './nav';
import { useGlobalSearch, useNavBadges, useRecentChatRooms, useRecentNotifications, useShellLive } from './shellData';
import { ShellTitleContext, type ShellTitle } from './shellTitle';
import { titleFor } from './titles';

function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="4" fill="#FFFFFF" />
      <rect x="6" y="5" width="3" height="14" fill="#173A5E" />
      <rect x="15" y="5" width="3" height="14" fill="#173A5E" />
      <rect x="3" y="10.5" width="18" height="3" fill="#E0762E" />
    </svg>
  );
}

function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** 바깥을 누르거나 Esc를 누르면 닫히는 팝업 상태. */
function usePopover<T extends HTMLElement>() {
  const [open, setOpen] = useState(false);
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

/** 상단 알림 버튼: 누르면 최근 알림 드롭다운. 항목·전체 보기는 왼쪽 메뉴 '업무·알림'과 같은 화면으로 간다 (SPEC 5-1). */
function NotificationButton({ count }: { count: number }) {
  const pop = usePopover<HTMLDivElement>();
  const navigate = useNavigate();
  const recent = useRecentNotifications(pop.open);
  const go = (to: string) => {
    pop.setOpen(false);
    navigate(to);
  };
  return (
    <div className="app-pop-anchor" ref={pop.ref}>
      <button type="button" className="hl-iconbtn" aria-label={`알림 ${count}건`} aria-haspopup="dialog" aria-expanded={pop.open} onClick={() => pop.setOpen(!pop.open)}>
        <Icon name="bell" size="lg" />{count ? <span className="hl-count">{count > 99 ? '99+' : count}</span> : null}
      </button>
      {pop.open ? (
        <div className="app-pop" role="dialog" aria-label="최근 알림">
          <div className="app-pop__head"><b>알림</b><span className="hl-cap">안 읽음 {count}건</span></div>
          <div className="app-pop__list">
            {recent.isLoading ? <div className="hl-cap" style={{ padding: 16 }}>불러오는 중…</div> : null}
            {recent.items.map((n) => (
              <button key={n.id} type="button" className={`app-pop__item${n.isRead ? '' : ' is-unread'}`} onClick={() => go(`/tasks?tab=notifications&notification=${n.id}`)}>
                <span className="hl-col" style={{ gap: 2, minWidth: 0, flex: 1 }}>
                  <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</b>
                  {n.body ? <span className="app-pop__body-text">{n.body}</span> : null}
                </span>
                <time className="hl-cap" style={{ flex: 'none' }}>{relTime(n.createdAt)}</time>
              </button>
            ))}
            {!recent.isLoading && !recent.items.length ? <div className="hl-cap" style={{ padding: 20, textAlign: 'center' }}>새 알림이 없어요</div> : null}
          </div>
          <div className="app-pop__foot"><button type="button" className="hl-btn hl-btn--ghost hl-btn--sm" onClick={() => go('/tasks?tab=notifications')}>업무·알림에서 전체 보기</button></div>
        </div>
      ) : null}
    </div>
  );
}

/** 상단 메신저 버튼: 누르면 최근 대화 드롭다운. 항목·전체 보기는 왼쪽 메뉴 '메신저'와 같은 화면으로 간다 (SPEC 5-1). */
function MessengerButton({ count }: { count: number }) {
  const pop = usePopover<HTMLDivElement>();
  const navigate = useNavigate();
  const recent = useRecentChatRooms(pop.open);
  const go = (to: string) => {
    pop.setOpen(false);
    navigate(to);
  };
  return (
    <div className="app-pop-anchor" ref={pop.ref}>
      <button type="button" className="hl-iconbtn" aria-label={`메신저 안 읽음 ${count}건`} aria-haspopup="dialog" aria-expanded={pop.open} onClick={() => pop.setOpen(!pop.open)}>
        <Icon name="chat" size="lg" />{count ? <span className="hl-count">{count > 99 ? '99+' : count}</span> : null}
      </button>
      {pop.open ? (
        <div className="app-pop" role="dialog" aria-label="최근 대화">
          <div className="app-pop__head"><b>메신저</b><span className="hl-cap">안 읽음 {count}건</span></div>
          <div className="app-pop__list">
            {recent.isLoading ? <div className="hl-cap" style={{ padding: 16 }}>불러오는 중…</div> : null}
            {recent.items.map((r) => (
              <button key={r.id} type="button" className={`app-pop__item${r.unreadCount ? ' is-unread' : ''}`} onClick={() => go(`/messenger?room=${r.id}`)}>
                <span className="hl-col" style={{ gap: 2, minWidth: 0, flex: 1 }}>
                  <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</b>
                  <span className="app-pop__body-text">{r.lastMessage ?? '아직 대화가 없어요'}</span>
                </span>
                <span className="hl-col" style={{ alignItems: 'flex-end', gap: 4, flex: 'none' }}>
                  <time className="hl-cap">{r.lastMessageAt ? relTime(r.lastMessageAt) : ''}</time>
                  {r.unreadCount ? <span className="hl-count hl-count--inline">{r.unreadCount}</span> : null}
                </span>
              </button>
            ))}
            {!recent.isLoading && !recent.items.length ? <div className="hl-cap" style={{ padding: 20, textAlign: 'center' }}>참여 중인 대화가 없어요</div> : null}
          </div>
          <div className="app-pop__foot"><button type="button" className="hl-btn hl-btn--ghost hl-btn--sm" onClick={() => go('/messenger')}>메신저 열기</button></div>
        </div>
      ) : null}
    </div>
  );
}

/** 통합 검색: 수주번호·LOT번호 등을 입력하고 Enter → 해당 화면으로 이동. */
function SearchBox() {
  const [q, setQ] = useState('');
  const pop = usePopover<HTMLLabelElement>();
  const navigate = useNavigate();
  const search = useGlobalSearch(q, pop.open);
  const go = (to: string) => {
    pop.setOpen(false);
    setQ('');
    navigate(to);
  };
  return (
    <label className="hl-search app-pop-anchor" style={{ width: 'min(460px, 32vw)' }} ref={pop.ref}>
      <Icon name="search" />
      <input
        type="search"
        placeholder="수주번호·LOT번호 검색"
        aria-label="통합 검색"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          pop.setOpen(true);
        }}
        onFocus={() => q.trim() && pop.setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && search.items[0]) go(search.items[0].linkPath);
        }}
      />
      {pop.open && q.trim().length >= 2 ? (
        <div className="app-pop" style={{ left: 0, right: 'auto', top: 38, width: '100%' }} role="listbox" aria-label="검색 결과">
          <div className="app-pop__list">
            {search.items.map((r) => (
              <button key={`${r.kind}${r.linkPath}`} type="button" role="option" aria-selected="false" className="app-pop__item" onClick={() => go(r.linkPath)}>
                <span className="hl-tag" style={{ flex: 'none' }}>{r.kindLabel}</span>
                <span className="mono" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
              </button>
            ))}
            {!search.items.length ? <div className="hl-cap" style={{ padding: 16, textAlign: 'center' }}>{search.isLoading ? '찾는 중…' : '일치하는 번호가 없어요'}</div> : null}
          </div>
        </div>
      ) : null}
    </label>
  );
}

function UserMenu() {
  const me = useMe();
  const pop = usePopover<HTMLDivElement>();
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const logout = () => {
    void authApi.logout().catch(() => undefined);
    disconnectRealtime();
    queryClient.clear();
    setSession(null);
    navigate('/login');
  };
  const role = ROLE_CODE_LABEL[me.roleCode as RoleCode] ?? me.roleCode;
  return (
    <div className="app-pop-anchor" ref={pop.ref}>
      <button type="button" className="hl-user" aria-haspopup="menu" aria-expanded={pop.open} onClick={() => pop.setOpen(!pop.open)}>
        <span className="hl-user__meta"><b>{me.employeeName}</b><small>{me.departmentName} · {role}</small></span>
        <Icon name="chevron-down" size="sm" />
      </button>
      {pop.open ? (
        <div className="app-pop" style={{ width: 240 }} role="menu">
          <div className="app-pop__head" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
            <b>{me.employeeName} <span className="hl-cap">{me.jobGrade}</span></b>
            <span className="hl-cap">사원번호 {me.employeeNo} · {me.departmentName}{me.headDepartmentIds.length ? ' · 부서장' : ''}</span>
          </div>
          <button type="button" role="menuitem" className="app-pop__item" onClick={logout}><Icon name="logout" />로그아웃</button>
        </div>
      ) : null}
    </div>
  );
}

// AI 패널은 화면을 옮겨도 열린 상태를 유지한다
let aiOpenMemo = false;

export function Shell({ children }: { children?: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  const now = useClock();
  const nav = navFor(me);
  const active = activeNavPath(nav, location.pathname);
  const badges = useNavBadges();
  useShellLive();
  const [aiOpen, setAiOpenState] = useState(aiOpenMemo);
  const setAiOpen = (v: boolean) => {
    aiOpenMemo = v;
    setAiOpenState(v);
  };
  const [custom, setCustom] = useState<ShellTitle>({});
  const setTitle = useCallback((t: ShellTitle) => setCustom(t), []);
  const base = titleFor(location.pathname);
  const title = custom.title ?? base.title;
  useEffect(() => {
    document.title = `${title || 'FantaSteel'} · FantaSteel ERP`;
  }, [title]);

  return (
    <div className="hl hl-app hl-app--rail">
      <nav className="hl-rail" aria-label="주 메뉴">
        <Link className="hl-rail__logo" to="/dashboard" aria-label="FantaSteel 대시보드"><Logo /></Link>
        {nav.map((e, i) =>
          e === 'sep' ? (
            <span key={`sep${i}`} className="hl-rail__sep" />
          ) : (
            <Link key={e.path} className={`hl-rail-item${e.path === active ? ' is-active' : ''}`} to={e.path} aria-current={e.path === active ? 'page' : undefined} title={e.soon ? `${e.label} · 준비 중 (${e.soon})` : e.label}>
              <Icon name={e.icon} />
              {e.label}
              {e.soon ? <span className="app-soon-dot">{e.soon}</span> : null}
              {e.badge && badges[e.badge] ? <span className="hl-count">{badges[e.badge] > 99 ? '99+' : badges[e.badge]}</span> : null}
            </Link>
          ),
        )}
      </nav>
      <div className="hl-col hl-grow" style={{ minWidth: 0 }}>
        <header className="hl-topbar hl-topbar--b">
          <div className="hl-topbar__title">
            <small>{base.area ? `${base.area} · ` : ''}{fmtMDdow(now)} {fmtHM(now)}{custom.subtitle ? ` · ${custom.subtitle}` : ''}</small>
            <b>{title}</b>
          </div>
          <SearchBox />
          <div className="hl-topbar__right">
            <button type="button" className="app-ai-btn" aria-label="AI 어시스턴트 열기 (준비 중, P2)" aria-expanded={aiOpen} onClick={() => setAiOpen(!aiOpen)}>
              <span className="hl-aimark hl-aimark--sm">AI</span>AI 어시스턴트
            </button>
            <NotificationButton count={badges.notifications ?? 0} />
            <MessengerButton count={badges.chat ?? 0} />
            <UserMenu />
          </div>
        </header>
        <div className="hl-body">
          <ShellTitleContext.Provider value={setTitle}>{children ?? <Outlet />}</ShellTitleContext.Provider>
          {aiOpen ? <AiPanel me={me} onClose={() => setAiOpen(false)} /> : null}
        </div>
      </div>
    </div>
  );
}
