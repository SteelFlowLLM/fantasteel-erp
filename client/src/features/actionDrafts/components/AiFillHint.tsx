// 초안 카드 머리의 AI 추출 안내 (SPEC 5장 결정 2, message-action.md 10장): AI가 메시지에서 칸을 채웠는지, 아니면 왜 비었는지(이슈 #472).
import type { AiExtractionStatus } from '@fantasteel/shared';
import { Badge } from '@/components/Badge';
import { aiExtractionNotice } from '@/features/actionDrafts/lib/typedDrafts';

export function AiFillHint({ aiFilledFields, aiExtraction, editable }: { aiFilledFields: readonly string[]; aiExtraction?: AiExtractionStatus | null; editable: boolean }) {
  if (aiFilledFields.length > 0) {
    return (
      <span className="flex items-center gap-1.5 text-cap text-ink-3">
        <Badge tone="ai" plain>
          AI 추출
        </Badge>
        {editable ? 'AI가 메시지에서 채운 값이에요. 맞는지 확인하고 고쳐 주세요' : 'AI가 메시지에서 채운 값으로 만든 초안이에요'}
      </span>
    );
  }
  const notice = aiExtractionNotice(aiExtraction);
  if (notice) {
    return (
      <span role="status" className="flex items-center gap-1.5 text-cap text-ink-3">
        <Badge tone="wait" plain>
          AI 추출 안 됨
        </Badge>
        {notice}
      </span>
    );
  }
  return editable ? <span className="text-cap text-ink-3">AI가 채운 값이 없어요. 메시지를 보면서 값을 입력해 주세요</span> : null;
}
