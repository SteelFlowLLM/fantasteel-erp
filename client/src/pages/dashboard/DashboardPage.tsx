// 대시보드 (REQ-DSH-001·002, BP-DSH-01, SPEC 5-3). 사용자마다 저장한 위젯 배치를 12칸 격자에 그린다.
// 보기: 위젯 고정 · 편집(?edit=1): 끌어 옮기기·크기 조절·추가·제외 후 저장.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { ROLE_CODE_LABEL, type Permission, type RoleCode, type WidgetCode, type WidgetPlacement } from '@fantasteel/shared';
import { dashboardApi, dashboardKeys, type DashboardLayoutResponse } from '@/api/dashboard';
import { Icon, QueryBoundary } from '@/components/ui';
import { DashboardGrid, compactPlacements } from '@/features/dashboard/DashboardGrid';
import { WidgetAddPanel } from '@/features/dashboard/WidgetAddPanel';
import { appendPlacement, buildDefaultPlacements, samePlacements } from '@/features/dashboard/widgetCatalog';
import { useAction } from '@/hooks/useApi';
import { useRealtimeEvent } from '@/hooks/useRealtime';
import { fmtMDdow, todayStr } from '@/lib/format';
import { canUse, useMe } from '@/stores/auth';
import './DashboardPage.css';

/** 권한(USE)이 있는 업무로 가는 바로가기. 앞에서부터 최대 3개만 보여준다. */
const QUICK_LINKS: { permission: Permission; to: string; label: string; icon: string }[] = [
  { permission: 'ORDER_CREATE', to: '/sales-orders/new', label: '수주 등록', icon: 'plus' },
  { permission: 'SHIPMENT_REQUEST', to: '/shipment-requests/new', label: '출하요청 등록', icon: 'truck' },
  { permission: 'PURCHASE_REQUISITION_CREATE', to: '/mrp', label: 'MRP', icon: 'calc' },
  { permission: 'RECEIPT_CONFIRM', to: '/goods-receipts', label: '입고 확정', icon: 'box' },
  { permission: 'PLAN_CONFIRM', to: '/production/plans', label: '생산계획', icon: 'calendar' },
  { permission: 'RESULT_CONFIRM', to: '/production/results', label: '공정 실적', icon: 'factory' },
  { permission: 'INSPECTION_REGISTER', to: '/quality/inspections', label: '검사 입력', icon: 'quality' },
  { permission: 'GOODS_ISSUE_CONFIRM', to: '/goods-issues', label: '출고 확정', icon: 'truck' },
];
const MAX_QUICK_LINKS = 3;
/** 실시간 변경이 몰려 올 때 위젯을 한 번만 다시 부르기 위한 지연 */
const REFRESH_DEBOUNCE_MS = 1_000;

export function DashboardPage() {
  const layout = useQuery({ queryKey: dashboardKeys.layout, queryFn: dashboardApi.layout });
  return (
    <QueryBoundary query={layout} loadingLabel="대시보드를 불러오는 중…">
      {(data) => <DashboardView saved={data} />}
    </QueryBoundary>
  );
}

function DashboardView({ saved }: { saved: DashboardLayoutResponse }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const editing = params.get('edit') === '1';
  // 편집 중에만 쓰는 임시 배치. null이면 저장된 배치 그대로다.
  const [draft, setDraft] = useState<WidgetPlacement[] | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  const placements = editing && draft ? draft : saved.placements;
  const dirty = useMemo(
    () => editing && draft !== null && !samePlacements(compactPlacements(draft), compactPlacements(saved.placements)),
    [editing, draft, saved.placements],
  );

  const setEditing = useCallback(
    (on: boolean) => {
      setDraft(null);
      setPanelOpen(true);
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (on) next.set('edit', '1');
        else next.delete('edit');
        return next;
      }, { replace: true });
    },
    [setParams],
  );

  // 다른 업무 데이터가 바뀌면 위젯 숫자도 바뀌므로, 어떤 주제든 오면 위젯을 다시 부른다 (몰려 오면 한 번만)
  const timer = useRef<number | null>(null);
  useRealtimeEvent('changed', () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.widgets });
    }, REFRESH_DEBOUNCE_MS);
  });
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  // 저장하지 않은 변경이 있을 때 창을 닫거나 새로 고치면 브라우저가 한 번 물어본다
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useAction((next: WidgetPlacement[]) => dashboardApi.saveLayout(next), {
    success: '위젯 배치를 저장했어요',
    onSuccess: (res) => {
      queryClient.setQueryData(dashboardKeys.layout, res);
      setEditing(false);
    },
  });

  const remove = (code: WidgetCode) => setDraft(placements.filter((p) => p.widgetCode !== code));
  const add = (code: WidgetCode) => setDraft(appendPlacement(placements, code));
  const quick = QUICK_LINKS.filter((q) => canUse(me, q.permission)).slice(0, MAX_QUICK_LINKS);
  const role = ROLE_CODE_LABEL[me.roleCode as RoleCode] ?? me.roleCode;

  return (
    <>
      <main className="hl-main dsh-main">
        <div className="hl-row dsh-top">
          <div className="hl-col hl-grow" style={{ gap: 2 }}>
            <b className="dsh-clip dsh-top__hello">{me.employeeName}님, 안녕하세요</b>
            <span className="hl-cap dsh-clip">{me.departmentName} · {role} · {todayStr().slice(0, 5)}{fmtMDdow(new Date())}</span>
          </div>
          {!editing ? (
            <>
              {quick.map((q, i) => (
                <Link key={q.to} className={`hl-btn${i === 0 ? ' hl-btn--primary' : ''}`} to={q.to}><Icon name={q.icon} />{q.label}</Link>
              ))}
              <button type="button" className="hl-btn" onClick={() => setEditing(true)}><Icon name="widget" />위젯 편집</button>
            </>
          ) : null}
        </div>

        {editing ? (
          <div className="hl-banner hl-banner--run dsh-editbar" role="region" aria-label="위젯 편집">
            <Icon name="widget" />
            <span>
              <b>위젯 편집 중</b> · 카드 머리를 끌어 옮기고, 모서리를 끌어 크기를 바꾸고, ×로 제외해요
              {dirty ? <span className="hl-badge hl-badge--wait" style={{ marginLeft: 8 }} role="status">저장 안 된 변경 있음</span> : null}
            </span>
            <div className="hl-banner__actions">
              {!panelOpen ? <button type="button" className="hl-btn hl-btn--sm" onClick={() => setPanelOpen(true)}><Icon name="plus" />위젯 추가</button> : null}
              <button type="button" className="hl-btn hl-btn--sm" disabled={save.isPending} onClick={() => setDraft(buildDefaultPlacements())}><Icon name="refresh" />기본 배치로</button>
              <button type="button" className="hl-btn hl-btn--sm" disabled={save.isPending} onClick={() => setEditing(false)}>취소</button>
              <button
                type="button"
                className="hl-btn hl-btn--primary hl-btn--sm"
                disabled={save.isPending || (!dirty && !saved.isDefault)}
                title={!dirty && !saved.isDefault ? '바뀐 내용이 없어요' : undefined}
                onClick={() => save.mutate(compactPlacements(placements))}
              >
                <Icon name="check" />저장
              </button>
            </div>
          </div>
        ) : null}

        {placements.length ? (
          <DashboardGrid placements={placements} editing={editing} onChange={setDraft} onRemove={remove} />
        ) : (
          <div className="hl-widget-slot dsh-empty">
            <Icon name="widget" size="lg" />
            <b style={{ fontSize: 13, color: 'var(--ink-2)' }}>표시할 위젯이 없어요</b>
            {editing ? (
              <span className="hl-cap">오른쪽 "위젯 추가"에서 위젯을 골라 주세요</span>
            ) : (
              <button type="button" className="hl-btn hl-btn--sm" onClick={() => setEditing(true)}><Icon name="plus" />위젯 추가</button>
            )}
          </div>
        )}
      </main>
      {editing && panelOpen ? <WidgetAddPanel placements={placements} onAdd={add} onClose={() => setPanelOpen(false)} /> : null}
    </>
  );
}
