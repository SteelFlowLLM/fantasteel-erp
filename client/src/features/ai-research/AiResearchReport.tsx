'use client';

// 완료된 보고서: 마크다운을 제목·문단·목록 글로만 그리고, [n] 인용을 아래 출처 목록으로 잇는다.
// 보고서·출처 제목은 웹에서 온 글이다. HTML로 넣지 않고(React 글), 눌러 열리는 링크는 모은 출처의 http·https 주소만 새 탭으로 연다.
import type { AiResearchRunView } from '@fantasteel/shared';
import { Fragment, useMemo } from 'react';
import { Card, CardBody, CardHead } from '@/components/Card';
import { reportBlocks, sourceRows, type ReportInline } from '@/lib/aiResearch';

const sourceElementId = (id: number) => `research-source-${id}`;

function jumpToSource(id: number) {
  const element = document.getElementById(sourceElementId(id));
  element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  element?.focus({ preventScroll: true });
}

function Inline({ parts }: { parts: ReportInline[] }) {
  return (
    <>
      {parts.map((part, index) => {
        if (part.kind === 'cite') {
          return (
            <button key={index} type="button" aria-label={`출처 ${part.id}번으로 가기`} onClick={() => jumpToSource(part.id)} className="mx-px align-baseline text-xs font-semibold text-run hover:underline">
              [{part.id}]
            </button>
          );
        }
        if (part.kind === 'link') {
          return (
            <a key={index} href={part.href} target="_blank" rel="noopener noreferrer" className="text-run underline">
              {part.text}
            </a>
          );
        }
        return <Fragment key={index}>{part.text}</Fragment>;
      })}
    </>
  );
}

const HEADING = ['text-lg font-semibold', 'text-base font-semibold', 'text-sm font-semibold', 'text-sm font-semibold text-ink-2'];

export function AiResearchReport({ run }: { run: AiResearchRunView }) {
  const blocks = useMemo(() => reportBlocks(run.report ?? '', run.sources), [run.report, run.sources]);
  const rows = useMemo(() => sourceRows(run.sources), [run.sources]);
  return (
    <>
      <Card className="flex-none">
        <CardHead title="보고서" />
        <CardBody className="gap-2.5 text-sm leading-relaxed">
          {blocks.length === 0 ? <p className="text-ink-3">보고서 내용이 없어요</p> : null}
          {blocks.map((block, index) => {
            if (block.kind === 'heading') {
              return (
                <h3 key={index} className={`mt-1.5 ${HEADING[block.level - 1]}`}>
                  <Inline parts={block.inline} />
                </h3>
              );
            }
            if (block.kind === 'list') {
              return (
                <ul key={index} className="flex list-disc flex-col gap-1 pl-5">
                  {block.items.map((item, i) => (
                    <li key={i}>
                      <Inline parts={item} />
                    </li>
                  ))}
                </ul>
              );
            }
            return (
              <p key={index} className="whitespace-pre-line">
                <Inline parts={block.inline} />
              </p>
            );
          })}
        </CardBody>
      </Card>
      <Card className="flex-none">
        <CardHead title="출처" meta={`${rows.length}개`} />
        <CardBody className="gap-0 p-0">
          {rows.length === 0 ? <p className="px-4 py-3 text-sm text-ink-3">모은 출처가 없어요</p> : null}
          <ol>
            {rows.map((row) => (
              <li key={row.id} id={sourceElementId(row.id)} tabIndex={-1} className="flex items-baseline gap-2 border-b border-line px-4 py-2 text-sm outline-none last:border-b-0 focus:bg-brand-tint">
                <span className="w-7 flex-none font-semibold text-ink-3 tabular-nums">[{row.id}]</span>
                <span className="min-w-0 flex-1">
                  {row.href ? (
                    <a href={row.href} target="_blank" rel="noopener noreferrer" className="text-run underline">
                      {row.title}
                    </a>
                  ) : (
                    row.title
                  )}
                  {row.host ? <span className="ml-2 text-cap text-ink-3">{row.host}</span> : null}
                </span>
                {row.read ? <span className="flex-none text-cap text-ink-3">읽음</span> : null}
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>
    </>
  );
}
