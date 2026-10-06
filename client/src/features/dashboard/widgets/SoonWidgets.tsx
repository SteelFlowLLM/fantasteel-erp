// P2(2등급 AI) 위젯: 데이터 없이 디자인만 흐리게 보인다 (BP-DSH-01 "P2 미구현 시 Agent 영역은 비활성").
// 편집 모드에서는 다른 위젯처럼 옮기고, 크기를 바꾸고, 빼고, 추가할 수 있다.
import { Fragment, type ReactNode } from 'react';
import type { RoleCode } from '@/codes';
import { Badge } from '@/components/Badge';
import { SoonButton } from '@/components/ComingSoon';
import { Icon } from '@/components/Icon';
import { Figure, WidgetFrame, type WidgetProps } from '@/features/dashboard/components/WidgetFrame';
import { useMe } from '@/hooks/useMe';

/** 흐린 예시 영역: 눌리지 않고 화면 낭독기에서 숨긴다 */
function SoonArea({ children }: { children: ReactNode }) {
  return (
    <div aria-hidden="true" inert className="pointer-events-none flex flex-col gap-2.5 px-4 py-3 opacity-[0.62] grayscale-25 select-none">
      {children}
    </div>
  );
}

/** Agent 위험 유형 (공통 코드 정의서 'P2 이후 추가 코드', 업무 프로세스 BP-AGT-01) */
const AGENT_RISK_TYPES = ['원료 부족', '합격 매수 부족', '납기 위험', '여재 장기 보유', '불합격률 상승'] as const;
type AgentRiskType = (typeof AGENT_RISK_TYPES)[number];

interface AgentRiskExample {
  type: AgentRiskType;
  target: string;
  text: string;
  rows: readonly (readonly [string, string])[];
  note: string;
  action: string;
}

/** 기본 예시: 원료 부족 → 구매요청 초안 (REQ-AGT-002) */
const RAW_MATERIAL_EXAMPLE: AgentRiskExample = {
  type: '원료 부족',
  target: '실리코망가니즈 · PP-2610-0001',
  text: 'AI Factory Agent가 생산계획 소요와 원료 잔량·입고예정을 살펴 위험을 찾으면 여기에 알려 줘요. AI는 상황만 설명하고, 대응 후보는 규칙이 만들어요.',
  rows: [
    ['총소요', '2.500 t'],
    ['잔량 · 입고예정', '1.000 t · 0.000 t'],
    ['대응 후보', '구매요청 초안 · 1.500 t'],
  ],
  note: '대응 후보는 담당 부서원이 확정해요(확정한 사람이 요청자). 구매요청이면 요청자 소속 부서장이 최종 승인해요.',
  action: '대응 후보 확정',
};

/** 품질 예시: 강종별 불합격률이 기준을 넘으면 품질 부서에 알린다 (REQ-AGT-004). 기준값은 아직 정하지 않아 예시 값이다 */
const REJECT_RATE_EXAMPLE: AgentRiskExample = {
  type: '불합격률 상승',
  target: 'SM355A · 최근 30일',
  text: 'AI Factory Agent가 강종별 불합격률을 살펴 기준을 넘으면 품질 부서에 알려 줘요. AI는 상황만 설명하고, 원인 확인과 조치는 품질 담당이 해요.',
  rows: [
    ['불합격률', '5.6% (1/18건)'],
    ['기준 (예시)', '5.0%'],
    ['공정별 불합격', '연주 1/16건'],
  ],
  note: '알림은 품질 부서원에게 가요. 불합격 LOT의 처리 상태는 불합격 관리에서 지정해요.',
  action: '불합격 LOT 보기',
};

/** 역할에 맞는 예시를 먼저 보여 준다. 없으면 기본 예시 */
const AGENT_RISK_EXAMPLE_BY_ROLE: Partial<Record<RoleCode, AgentRiskExample>> = {
  QUALITY: REJECT_RATE_EXAMPLE,
};

export function AgentRiskWidget(props: WidgetProps) {
  const me = useMe();
  const example = AGENT_RISK_EXAMPLE_BY_ROLE[me.roleCode] ?? RAW_MATERIAL_EXAMPLE;
  return (
    <WidgetFrame widgetKey="AGENT_RISK" {...props} meta="예시">
      <SoonArea>
        <div className="flex flex-wrap gap-1">
          {AGENT_RISK_TYPES.map((type) => (
            <Badge key={type} tone={type === example.type ? 'danger' : 'neutral'} plain>
              {type}
            </Badge>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="danger">{example.type}</Badge>
          <span className="truncate text-sm text-ink-2">{example.target}</span>
        </div>
        <p className="text-sm leading-5">{example.text}</p>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 rounded-md bg-surface-2 px-3 py-2.5 text-sm">
          {example.rows.map(([label, value]) => (
            <Fragment key={label}>
              <dt className="text-ink-3">{label}</dt>
              <dd className="tabular-nums">{value}</dd>
            </Fragment>
          ))}
        </dl>
        <div className="flex items-start gap-1.5 text-cap text-ink-3">
          <Icon name="info" size="sm" className="mt-px flex-none" />
          <span>{example.note}</span>
        </div>
        <div>
          <SoonButton size="sm">{example.action}</SoonButton>
        </div>
      </SoonArea>
    </WidgetFrame>
  );
}

export function AiUsageWidget(props: WidgetProps) {
  return (
    <WidgetFrame widgetKey="AI_USAGE" {...props}>
      <SoonArea>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Figure label="AI 어시스턴트 질문" value="—" unit="건" tone="muted" />
          <Figure label="업무 초안" value="—" unit="건" tone="muted" />
          <Figure label="Agent 감지" value="—" unit="건" tone="muted" />
        </div>
        <div className="h-3 rounded-xs bg-surface-3" />
        <span className="text-cap text-ink-3">AI 기능(2등급)이 추가되면 사용 현황이 여기에 보여요</span>
      </SoonArea>
    </WidgetFrame>
  );
}
