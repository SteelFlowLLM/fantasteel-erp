'use client';

// 대시보드 (P3, REQ-DSH-001·002, BP-DSH-01, SPEC 4장 3번). 사원마다 저장한 위젯 배치를 12칸 격자에 그린다.
// 보기: 위젯 고정 · 편집: 끌어 옮기기·크기 조절·추가·제외 → 저장(이 브라우저, 사원별). '기본 배치로'는 기본 위젯 6개 배치(품질은 수주 충족 현황 자리에 강종별 불합격률)로 되돌린다.
// 권한(조회)이 없는 위젯은 잠금으로 보이고, P2 위젯(Agent 위험 감지·AI 활용 현황)은 준비 중으로 흐리게 보인다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DashboardWidgetKey } from '@/api/dashboard';
import { Badge } from '@/components/Badge';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { PageMain } from '@/components/Page';
import { DashboardGrid } from '@/features/dashboard/DashboardGrid';
import { appendPlacement, buildDefaultPlacements, compactPlacements, removePlacement, samePlacements, type WidgetPlacement } from '@/features/dashboard/lib/layout';
import { WidgetAddPanel } from '@/features/dashboard/WidgetAddPanel';
import { useDashboardLayout } from '@/hooks/useDashboardLayout';
import { useMe } from '@/hooks/useMe';
import { fmtMDdow, todayStr } from '@/lib/format';
import { toast } from '@/stores/useToastStore';

export function DashboardScreen() {
  const me = useMe();
  const layout = useDashboardLayout(me.employeeId, me.roleCode);
  const [editing, setEditing] = useState(false);
  // 편집 중에만 쓰는 임시 배치. null이면 저장된 배치 그대로
  const [draft, setDraft] = useState<WidgetPlacement[] | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  const placements = editing && draft ? draft : layout.placements;
  const dirty = useMemo(() => editing && draft !== null && !samePlacements(compactPlacements(draft), compactPlacements(layout.placements)), [editing, draft, layout.placements]);

  const startEdit = useCallback((open: boolean) => {
    setDraft(null);
    setPanelOpen(true);
    setEditing(open);
  }, []);

  // 저장하지 않은 변경이 있을 때 창을 닫거나 새로 고치면 브라우저가 한 번 물어본다
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = () => {
    const ok = layout.save(compactPlacements(placements));
    if (ok) toast.ok('위젯 배치를 저장했어요');
    else toast.error('이 브라우저에 배치를 저장하지 못했어요. 브라우저 저장소 설정을 확인해 주세요');
    startEdit(false);
  };
  const remove = (key: DashboardWidgetKey) => setDraft(removePlacement(placements, key));
  const add = (key: DashboardWidgetKey) => setDraft(appendPlacement(placements, key));

  return (
    <>
      <PageMain className="gap-3.5">
        <div className="flex flex-none flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <b className="truncate text-lg font-semibold">{me.employeeName}님, 안녕하세요</b>
            <span className="truncate text-cap text-ink-3">
              {me.departmentName} · {me.roleName} · {todayStr().slice(0, 5)}
              {fmtMDdow(new Date())}
            </span>
          </div>
          {!editing ? (
            <Button icon="widget" onClick={() => startEdit(true)}>
              위젯 편집
            </Button>
          ) : null}
        </div>

        {editing ? (
          <Banner
            tone="run"
            icon="widget"
            actions={
              <>
                {!panelOpen ? (
                  <Button size="sm" icon="plus" onClick={() => setPanelOpen(true)}>
                    위젯 추가
                  </Button>
                ) : null}
                <Button size="sm" icon="refresh" onClick={() => setDraft(buildDefaultPlacements(me.roleCode))}>
                  기본 배치로
                </Button>
                <Button size="sm" onClick={() => startEdit(false)}>
                  취소
                </Button>
                <Button size="sm" variant="primary" icon="check" disabled={!dirty} title={dirty ? undefined : '바뀐 내용이 없어요'} onClick={save}>
                  저장
                </Button>
              </>
            }
          >
            <b>위젯 편집 중</b> · 카드 머리를 끌어 옮기고, 모서리를 끌어 크기를 바꾸고, ×로 제외해요
            {dirty ? (
              <Badge tone="wait" className="ml-2">
                저장 안 된 변경 있음
              </Badge>
            ) : null}
            {!dirty && layout.isCustom && draft === null ? <span className="ml-2 text-cap">· 지금은 내가 저장한 배치예요</span> : null}
          </Banner>
        ) : null}

        {placements.length > 0 ? (
          <DashboardGrid placements={placements} editing={editing} onChange={setDraft} onRemove={remove} />
        ) : (
          <div className="flex min-h-[220px] flex-none flex-col items-center justify-center gap-2 rounded-md border border-dashed border-line-strong bg-surface-2 text-ink-3">
            <Icon name="widget" size="lg" />
            <b className="text-sm font-semibold text-ink-2">표시할 위젯이 없어요</b>
            {editing ? (
              <span className="text-cap">오른쪽 &quot;위젯 추가&quot;에서 위젯을 골라 주세요</span>
            ) : (
              <Button size="sm" icon="plus" onClick={() => startEdit(true)}>
                위젯 추가
              </Button>
            )}
          </div>
        )}
      </PageMain>
      {editing && panelOpen ? <WidgetAddPanel placements={placements} onAdd={add} onClose={() => setPanelOpen(false)} /> : null}
    </>
  );
}
