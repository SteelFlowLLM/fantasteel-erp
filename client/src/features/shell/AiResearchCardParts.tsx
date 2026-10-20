'use client';

// 철강맨AI의 심층 조사 만들기 카드 내용과 편집기 (이슈 #408). 카드는 질문만 담고, 앞 답의 웹 검색 결과는 넘길지 사용자가 고른다.
import { AI_RESEARCH_LIMITS, type AiResearchCard, type AiResearchSeed } from '@fantasteel/shared';
import { useId, useState } from 'react';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Textarea } from '@/components/Input';
import { Field as DisplayField } from '@/features/meetings/components/MeetingAnalysisPanel';

/** seed가 있으면 넘길지 고르는 칸을 보인다. locked(실행했거나 닫음)면 고를 수 없다 */
export function ResearchCardBody({ card, seed, includeSeed, locked, onIncludeSeed }: { card: AiResearchCard; seed: AiResearchSeed | null; includeSeed: boolean; locked: boolean; onIncludeSeed: (checked: boolean) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <DisplayField label="조사 질문">
        <span className="whitespace-pre-wrap">{card.question}</span>
      </DisplayField>
      {seed && !locked ? (
        <label className="inline-flex items-start gap-1.5 text-xs text-ink-2">
          <input type="checkbox" className="mt-0.5" checked={includeSeed} onChange={(event) => onIncludeSeed(event.target.checked)} />
          <span>
            앞 답의 웹 검색 결과도 넘기기 <span className="text-ink-3">(간단 답과 출처 {seed.sources.length}개 · 이미 찾은 것은 빼고 모자란 부분을 더 찾아요)</span>
          </span>
        </label>
      ) : null}
      <p className="text-cap text-ink-3">실행하면 조사 계획을 세워요. 계획을 확인하고 고친 뒤 심층 조사 화면에서 시작해요.</p>
    </div>
  );
}

export function ResearchCardEditor({ card, onCancel, onSave }: { card: AiResearchCard; onCancel: () => void; onSave: (next: AiResearchCard) => void }) {
  const id = useId();
  const [question, setQuestion] = useState(card.question);
  const tooShort = question.trim().length < AI_RESEARCH_LIMITS.questionMin;
  return (
    <div className="flex flex-col gap-2">
      <Field label="조사 질문" htmlFor={id} hint={tooShort ? `${AI_RESEARCH_LIMITS.questionMin}자 이상 써 주세요` : undefined}>
        <Textarea id={id} rows={3} maxLength={AI_RESEARCH_LIMITS.questionMax} value={question} onChange={(event) => setQuestion(event.target.value)} />
      </Field>
      <div className="flex justify-end gap-1.5">
        <Button size="sm" onClick={onCancel}>
          취소
        </Button>
        <Button size="sm" variant="primary" disabled={tooShort} onClick={() => onSave({ ...card, question: question.trim() })}>
          저장
        </Button>
      </div>
    </div>
  );
}
