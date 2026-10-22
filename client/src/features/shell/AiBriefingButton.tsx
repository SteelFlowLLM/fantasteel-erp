// 철강맨AI 빈 대화 첫 화면의 [오늘 브리핑] 단추 (이슈 #506). /브리핑 명령과 같은 질문을 보낸다.
import { AI_BRIEFING_QUESTION } from '@fantasteel/shared';
import { Icon } from '@/components/Icon';
import { QUESTION_CHIP } from '@/features/shell/aiSourceDisplay';

export const AI_BRIEFING_BUTTON_LABEL = '오늘 브리핑';

export function AiBriefingButton({ disabled, onAsk }: { disabled: boolean; onAsk: (question: string) => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      title="오늘 일정·업무·결재·알림·Agent 위험·납기를 모아 먼저 할 일 3가지를 정리해요"
      className={`${QUESTION_CHIP} self-start`}
      onClick={() => onAsk(AI_BRIEFING_QUESTION)}
    >
      <Icon name="calendar" size="sm" />
      {AI_BRIEFING_BUTTON_LABEL}
    </button>
  );
}
