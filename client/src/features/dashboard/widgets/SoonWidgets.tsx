// P2(2등급 AI) 위젯: 데이터 없이 디자인만 흐리게 보인다 (AI 활용 현황). Agent 위험 감지는 AgentRiskWidget이 실제 후보를 보인다.
// 편집 모드에서는 다른 위젯처럼 옮기고, 크기를 바꾸고, 빼고, 추가할 수 있다.
import type { ReactNode } from 'react';
import { Figure, WidgetFrame, type WidgetProps } from '@/features/dashboard/components/WidgetFrame';
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

export function AiUsageWidget(props: WidgetProps) {
  return (
    <WidgetFrame widgetKey="AI_USAGE" {...props}>
      <SoonArea>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Figure label="철강맨AI 질문" value="—" unit="건" tone="muted" />
          <Figure label="업무 초안" value="—" unit="건" tone="muted" />
          <Figure label="Agent 감지" value="—" unit="건" tone="muted" />
        </div>
        <div className="h-3 rounded-xs bg-surface-3" />
        <span className="text-cap text-ink-3">AI 기능(2등급)이 추가되면 사용 현황이 여기에 보여요</span>
      </SoonArea>
    </WidgetFrame>
  );
}
