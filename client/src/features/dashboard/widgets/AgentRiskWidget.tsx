// Agent 위험 감지 위젯 (REQ-AGT-005·006, BP-DSH-01): 확정 대기 대응 후보 수와 위험 유형별 건수, 최근 후보.
// 후보 목록은 서버가 후보 업무의 조회 권한으로 걸러 주고, AI는 상황 설명만 해서 이 위젯에는 규칙이 만든 요약만 보인다.
import Link from 'next/link';
import type { AgentRiskData } from '@/api/dashboard';
import { DRAFT_STATUS_LABEL } from '@/codes';
import { Badge } from '@/components/Badge';
import { Figure, WidgetBody, WidgetEmpty, WidgetFrame, type WidgetProps } from '@/features/dashboard/components/WidgetFrame';
import { RISK_NAME, STATUS_TONE } from '@/features/agent/lib/agentDisplay';
import { useDashboardWidget, useDashboardWidgetAccess } from '@/hooks/useDashboardWidget';
import { useMe } from '@/hooks/useMe';

function AgentRiskBody({ data }: { data: AgentRiskData }) {
  if (data.openCount === 0) return <WidgetEmpty>확정을 기다리는 대응 후보가 없어요</WidgetEmpty>;
  return (
    <div className="flex flex-col gap-2.5 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Figure label="확정 대기 후보" value={String(data.openCount)} unit="건" tone="danger" />
        <div className="flex flex-wrap gap-1">
          {data.byRisk.map((r) => (
            <Badge key={r.riskType} tone="danger" plain>
              {RISK_NAME[r.riskType]} {r.count}
            </Badge>
          ))}
        </div>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {data.items.map((item) => (
          <li key={item.id} className="flex min-w-0 items-center gap-2 text-sm">
            <Badge tone={STATUS_TONE[item.draftStatus]}>{DRAFT_STATUS_LABEL[item.draftStatus]}</Badge>
            <span className="min-w-0 flex-1 truncate text-ink-2" title={item.summary}>
              {RISK_NAME[item.riskType]} · {item.summary}
            </span>
          </li>
        ))}
      </ul>
      <Link href="/agent" className="text-xs text-run hover:underline">
        대응 후보 확인하고 확정하기
      </Link>
    </div>
  );
}

/** 품질 대시보드는 이 위젯을 맨 아래 한 칸 높이로 둔다(lib/layout.ts): 카드 머리 한 줄에 건수만 보인다 */
function inlineSummary(data: AgentRiskData): string {
  if (data.openCount === 0) return '확정을 기다리는 대응 후보가 없어요';
  return `확정 대기 ${data.openCount}건 · ${data.byRisk.map((r) => `${RISK_NAME[r.riskType]} ${r.count}`).join(' · ')}`;
}

export function AgentRiskWidget(props: WidgetProps) {
  const me = useMe();
  const access = useDashboardWidgetAccess('AGENT_RISK');
  const query = useDashboardWidget('AGENT_RISK', access.allowed);
  if (me.roleCode === 'QUALITY') {
    return (
      <WidgetFrame widgetKey="AGENT_RISK" {...props} inline>
        <p className="truncate text-sm text-ink-2" title={query.data ? inlineSummary(query.data) : undefined}>
          {query.data ? inlineSummary(query.data) : query.error ? '대응 후보를 불러오지 못했어요' : '불러오는 중…'}
        </p>
      </WidgetFrame>
    );
  }
  return (
    <WidgetFrame widgetKey="AGENT_RISK" {...props} meta={query.data ? `확정 대기 ${query.data.openCount}건` : null}>
      <WidgetBody allowed={access.allowed} permissions={access.permissions} query={query}>
        {(data) => <AgentRiskBody data={data} />}
      </WidgetBody>
    </WidgetFrame>
  );
}
