// P2(2등급 AI) 위젯: 데이터 없이 디자인만 흐리게 보인다 (BP-DSH-01 "P2 미구현 시 Agent 영역은 비활성").
// 편집 모드에서는 다른 위젯처럼 옮기고, 크기를 바꾸고, 빼고, 추가할 수 있다.
import { Fragment, useState, type ReactNode } from 'react';
import type { RoleCode } from '@/codes';
import { Badge } from '@/components/Badge';
import { SoonButton } from '@/components/ComingSoon';
import { Icon } from '@/components/Icon';
import { Figure, WidgetFrame, type WidgetProps } from '@/features/dashboard/components/WidgetFrame';
import { REJECT_RATE_ALERT } from '@/features/dashboard/lib/widgetMath';
import { useMe } from '@/hooks/useMe';
import { fmtPct } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * 예시 영역: 눌리지 않고 화면 낭독기에서 숨긴다. 기본은 흐리게 그린다.
 * dim=false면 글씨는 선명하게 두고 비활성 표시는 "준비 중 (P2)"·"예시"·눌리지 않는 버튼으로 한다 (BP-DSH-01 "Agent 영역은 비활성으로 표시")
 */
function SoonArea({ children, dim = true }: { children: ReactNode; dim?: boolean }) {
  return (
    <div aria-hidden="true" inert className={cn('pointer-events-none flex flex-col gap-2.5 px-4 py-3 select-none', dim && 'opacity-[0.62] grayscale-25')}>
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

/** 품질 예시: 강종별 불합격률이 기준을 넘으면 품질 부서에 알린다 (REQ-AGT-004). 기준은 불합격률 위젯의 "기준 초과"와 같은 값 */
const REJECT_RATE_EXAMPLE: AgentRiskExample = {
  type: '불합격률 상승',
  target: 'SM355A · 최근 30일',
  text: 'AI Factory Agent가 강종별 불합격률을 살펴 기준을 넘으면 품질 부서에 알려 줘요. AI는 상황만 설명하고, 원인 확인과 조치는 품질 담당이 해요.',
  rows: [
    ['불합격률', '5.6% (1/18건)'],
    ['기준', fmtPct(REJECT_RATE_ALERT, 1)],
    ['공정별 불합격', '연주 1/16건'],
  ],
  note: '알림은 품질 부서원에게 가요. 불합격 LOT의 처리 상태는 불합격 관리에서 지정해요.',
  action: '불합격 LOT 보기',
};

/** 원료 부족 → 구매요청 초안 (REQ-AGT-002). 다른 역할의 기본 예시 */
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

/**
 * 유형별 예시 (REQ-AGT-002~004). 실제 감지는 P2라 숫자는 모두 예시다.
 * 감지와 대응 후보는 규칙이 만들고(AGT-005), AI는 상황 설명만 한다(AGT-006).
 */
const AGENT_RISK_EXAMPLES: Record<AgentRiskType, AgentRiskExample> = {
  '원료 부족': RAW_MATERIAL_EXAMPLE,
  '합격 매수 부족': {
    type: '합격 매수 부족',
    target: 'SO-2609-004 품목 1 · SL-SM355A-250x1500x10000',
    text: '검사 결과가 등록될 때 합격 매수가 수주 매수보다 부족하면 알려 줘요. 대응 후보로 부족한 매수만큼 재생산 계획 초안을 만들어요.',
    rows: [
      ['수주 매수', '10매'],
      ['합격·예약', '6매'],
      ['대응 후보', '재생산 계획 초안 · 4매'],
    ],
    note: '재생산 계획은 생산 담당이 확정해요. 확정 권한은 후보가 만드는 업무의 권한을 따라요.',
    action: '대응 후보 확정',
  },
  '납기 위험': {
    type: '납기 위험',
    target: 'SO-2610-001 품목 1 · 납기 D-2',
    text: '납기일까지 남은 일수가 기준일 이하인데 출하가 다 되지 않은 수주 품목을 찾아 담당자에게 알려 줘요.',
    rows: [
      ['납기 · 남은 일수', '10-08 · 2일'],
      ['수주 · 출하', '10매 · 4매'],
      ['납기 위험 기준일', '3일 (생산 설정값)'],
    ],
    note: '알림은 수주 담당 영업에게 가요. 출하요청·배정은 영업 화면에서 진행해요.',
    action: '수주 보기',
  },
  '여재 장기 보유': {
    type: '여재 장기 보유',
    target: 'SL-SS275-250x1200x10000',
    text: '수주에 묶이지 않은 합격 슬래브(여재)를 오래 갖고 있으면 알려 주고, 같은 규격을 기다리는 수주에 배정을 추천해요.',
    rows: [
      ['여재', '3매'],
      ['가장 오래 보유', '21일'],
      ['대응 후보', '대기 수주 배정 추천 · 3매'],
    ],
    note: '배정 추천은 담당 영업이 확인하고 확정해요.',
    action: '대응 후보 확정',
  },
  '불합격률 상승': REJECT_RATE_EXAMPLE,
};

/** 역할에 맞는 예시를 먼저 보여 준다. 없으면 원료 부족 예시 */
const AGENT_RISK_EXAMPLE_BY_ROLE: Partial<Record<RoleCode, AgentRiskExample>> = {
  QUALITY: REJECT_RATE_EXAMPLE,
};

export function AgentRiskWidget(props: WidgetProps) {
  const me = useMe();
  const roleExample = AGENT_RISK_EXAMPLE_BY_ROLE[me.roleCode];
  // 역할 예시가 있는 대시보드(품질)는 유형을 눌러 그 유형의 예시를 볼 수 있다. 실제 감지 목록은 P2에서 이 자리를 쓴다
  const interactive = roleExample !== undefined;
  const [selected, setSelected] = useState<AgentRiskType>((roleExample ?? RAW_MATERIAL_EXAMPLE).type);
  const example = AGENT_RISK_EXAMPLES[selected];
  return (
    <WidgetFrame widgetKey="AGENT_RISK" {...props} meta="예시">
      {interactive ? (
        <div role="group" aria-label="위험 유형별 예시" className="flex flex-wrap gap-1 px-4 pt-3">
          {AGENT_RISK_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={type === selected}
              onClick={() => setSelected(type)}
              className="h-5 rounded-xs bg-surface-3 px-1.5 text-cap text-ink-2 hover:text-ink aria-pressed:bg-danger-bg aria-pressed:text-danger"
            >
              {type}
            </button>
          ))}
        </div>
      ) : null}
      {/* 역할에 맞춘 예시(품질)는 읽으라고 둔 것이라 선명하게 */}
      <SoonArea dim={!interactive}>
        {interactive ? null : (
          <div className="flex flex-wrap gap-1">
            {AGENT_RISK_TYPES.map((type) => (
              <Badge key={type} tone={type === example.type ? 'danger' : 'neutral'} plain>
                {type}
              </Badge>
            ))}
          </div>
        )}
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
