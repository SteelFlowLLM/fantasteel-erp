'use client';

// 웹 검색 답 보기 (이슈 #367): 최종 답의 안전한 링크와 아래의 웹 출처 목록.
// 웹에서 온 글(출처 제목)과 모델이 쓴 글은 모두 글로만 그리고, 링크는 이번 질문의 웹 출처에 있는 주소만 연다.
// 받는 중인 답(AiLiveView)은 이 컴포넌트를 쓰지 않는다: 원문이 끝나기 전에는 링크를 만들지 않는다.
import type { AiWebSource } from '@fantasteel/shared';
import { useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { ANSWER_SOURCE_GROUP_LABEL, answerSourceGroupOf, groupAnswerSources, openableWebSources, tokenizeAnswerLinks, type AnswerSourceGroup } from '@/lib/aiWebLinks';

/** 이 개수를 넘으면 앞의 몇 개만 보이고 나머지는 펼친다 */
export const WEB_SOURCES_COLLAPSED = 3;

const LINK = 'text-brand underline decoration-line-strong underline-offset-2 hover:decoration-brand';

/** 최종 답 글. webSources가 없으면(웹 검색을 켜지 않은 질문) 그대로 글이다 */
export function AiAnswerText({ content, webSources, className }: { content: string; webSources: AiWebSource[] | undefined; className: string }) {
  const tokens = useMemo(() => (webSources ? tokenizeAnswerLinks(content, webSources) : null), [content, webSources]);
  if (!tokens) return <p className={className}>{content}</p>;
  return (
    <p className={className}>
      {tokens.map((token, index) =>
        token.kind === 'link' ? (
          <a key={index} href={token.href} target="_blank" rel="noopener noreferrer" className={LINK}>
            {token.text}
          </a>
        ) : (
          <span key={index}>{token.text}</span>
        ),
      )}
    </p>
  );
}

/** 답 아래 출처: 회사 Drive·Notion·웹을 묶음별로 나눠(이슈 #530) 제목은 글로, 주소 호스트를 함께 보이고, 새 탭으로 연다 */
export function AiWebSources({ sources }: { sources: AiWebSource[] | undefined }) {
  const items = useMemo(() => openableWebSources(sources), [sources]);
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  const shown = expanded ? items : items.slice(0, WEB_SOURCES_COLLAPSED);
  const hidden = items.length - shown.length;
  const total = (group: AnswerSourceGroup) => items.filter((item) => answerSourceGroupOf(item.href) === group).length;
  return (
    <div className="flex flex-col gap-1 border-t border-line pt-2 text-cap">
      {groupAnswerSources(shown).map(({ group, items: groupItems }) => (
        <div key={group} className="flex flex-col gap-1">
          <span className="font-semibold text-ink-2">
            {ANSWER_SOURCE_GROUP_LABEL[group]} · {total(group)}건
          </span>
          <ul className="flex flex-col gap-1">
            {groupItems.map((item) => (
              <li key={item.href} className="flex min-w-0 items-start gap-1.5">
                <Icon name="link" size="sm" className="mt-0.5 flex-none text-ink-3" />
                <span className="min-w-0 break-words">
                  <a href={item.href} target="_blank" rel="noopener noreferrer" className={LINK}>
                    {item.title}
                  </a>
                  <span className="text-ink-3"> · {item.host}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {items.length > WEB_SOURCES_COLLAPSED ? (
        <button type="button" aria-expanded={expanded} className="self-start text-cap font-medium text-ink-2 hover:text-ink" onClick={() => setExpanded((value) => !value)}>
          {expanded ? '접기' : `${hidden}건 더 보기`}
        </button>
      ) : null}
    </div>
  );
}
