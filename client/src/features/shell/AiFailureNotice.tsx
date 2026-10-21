'use client';

// 철강맨AI 실패 줄 안의 LLM 실패 안내 (이슈 #462): 오류 코드별로 무엇을 하면 되는지와, 관리자에게는 AI 연결 화면 링크
import type { AiLlmFailureCode } from '@fantasteel/shared';
import Link from 'next/link';
import { useCanOpenHref } from '@/hooks/usePermission';
import { AI_LLM_FAILURE_GUIDE, AI_LLM_SETTINGS_HREF } from '@/lib/aiLlmFailure';

export function AiFailureNotice({ code }: { code: AiLlmFailureCode }) {
  const canOpen = useCanOpenHref();
  const guide = AI_LLM_FAILURE_GUIDE[code];
  return (
    <p className="text-cap leading-normal break-keep wrap-anywhere text-ink-3">
      {guide.hint}{' '}
      {guide.needsSettings && canOpen(AI_LLM_SETTINGS_HREF) ? (
        <Link href={AI_LLM_SETTINGS_HREF} className="font-semibold text-steelman-ink underline">
          AI 연결 화면 열기
        </Link>
      ) : null}
    </p>
  );
}
