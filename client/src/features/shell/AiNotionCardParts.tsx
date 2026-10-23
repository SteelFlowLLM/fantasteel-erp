'use client';

// 철강맨AI 실행 카드 중 Notion 쓰기와 일정·업무 고치기 카드의 내용과 편집기 (이슈 #398).
// Notion 글(대상 제목·본문)은 사원 누구나 쓴 글이라 글로만 그리고, 링크는 Notion 주소일 때만 건다.
import { AI_NOTION_CONTENT_MAX, AI_NOTION_EDIT_TEXT_MAX, AI_NOTION_TITLE_MAX, type AiNotionCard, type AiNotionPageRef, type AiScheduleEventUpdateCard, type AiTaskUpdateCard } from '@fantasteel/shared';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/Button';
import { DateInput } from '@/components/DateInput';
import { Field } from '@/components/Field';
import { Input, Textarea } from '@/components/Input';
import { Field as DisplayField } from '@/features/meetings/components/MeetingAnalysisPanel';
import { applyScheduleChanges, notionTargetOf, seoulLocalOf } from '@/lib/aiActionCard';
import { isNotionUrl } from '@/lib/aiNotion';

const PREVIEW = 'max-h-48 overflow-auto rounded-xs border border-line bg-surface px-2 py-1.5 text-xs leading-snug break-words whitespace-pre-wrap';

const seoulText = (iso: string) => seoulLocalOf(iso).replace('T', ' ');

function PageLink({ page }: { page: AiNotionPageRef }) {
  return isNotionUrl(page.url) ? (
    <a href={page.url} target="_blank" rel="noopener noreferrer" className="font-medium text-brand hover:underline">
      {page.title}
    </a>
  ) : (
    <span>{page.title}</span>
  );
}

/** 바뀌면 "전 → 후", 그대로면 값만 */
function Change({ before, after }: { before: string; after: string }): ReactNode {
  if (before === after) return after;
  return (
    <>
      <span className="text-ink-3 line-through">{before}</span> → <b>{after}</b>
    </>
  );
}

// ── Notion ────────────────────────────────────────────────

export function NotionCardBody({ card }: { card: AiNotionCard }) {
  return (
    <div className="flex flex-col gap-1">
      <DisplayField label={card.kind === 'NOTION_PAGE_CREATE' ? '만들 위치' : '페이지'}>
        <PageLink page={notionTargetOf(card)} />
      </DisplayField>
      {card.kind === 'NOTION_PAGE_CREATE' ? <DisplayField label="새 제목">{card.pageTitle}</DisplayField> : null}
      {card.kind === 'NOTION_PAGE_UPDATE' && card.newTitle !== null ? (
        <DisplayField label="제목">
          <Change before={card.page.title} after={card.newTitle} />
        </DisplayField>
      ) : null}
      {card.kind === 'NOTION_PAGE_UPDATE' ? (
        <ol aria-label="바꿀 곳" className="flex flex-col gap-1.5">
          {card.edits.map((edit, index) => (
            <li key={index} className="flex flex-col gap-0.5 text-xs">
              <span className="text-cap text-ink-3">바꿀 곳 {index + 1}</span>
              <del className={`${PREVIEW} max-h-24 bg-danger-bg text-ink-2`}>{edit.oldStr}</del>
              <ins className={`${PREVIEW} max-h-24 bg-ok-bg no-underline`}>{edit.newStr || '(지움)'}</ins>
            </li>
          ))}
        </ol>
      ) : (
        <div className="flex flex-col gap-0.5">
          <span className="text-cap text-ink-3">{card.kind === 'NOTION_PAGE_APPEND' ? '페이지 끝에 더할 글' : '본문'}</span>
          <div className={PREVIEW}>{card.content}</div>
        </div>
      )}
      <p className="text-cap text-ink-3">실행하면 글 끝에 철강맨AI와 요청한 사람 이름이 한 줄 남아요</p>
    </div>
  );
}

export function NotionCardEditor({ card, onCancel, onSave }: { card: AiNotionCard; onCancel: () => void; onSave: (card: AiNotionCard) => void }) {
  const [draft, setDraft] = useState(card);
  const id = (name: string) => `${card.key}-${name}`;
  const save = () => {
    if (draft.kind === 'NOTION_PAGE_CREATE') onSave({ ...draft, title: `Notion 새 페이지 · ${draft.pageTitle}` });
    // 사용자가 고친 새 글은 Notion이 다시 확인하므로, AI가 붙인 확인 사유는 그대로 둔다
    else onSave(draft);
  };
  return (
    <div className="flex flex-col gap-2.5 rounded-xs border border-line-strong bg-surface p-3">
      {draft.kind === 'NOTION_PAGE_CREATE' ? (
        <Field label="새 제목" htmlFor={id('title')}>
          <Input id={id('title')} value={draft.pageTitle} maxLength={AI_NOTION_TITLE_MAX} onChange={(e) => setDraft({ ...draft, pageTitle: e.target.value })} />
        </Field>
      ) : null}
      {draft.kind === 'NOTION_PAGE_UPDATE' ? (
        <>
          <Field label="제목 (바꾸지 않으면 비워 두기)" htmlFor={id('title')}>
            <Input id={id('title')} value={draft.newTitle ?? ''} maxLength={AI_NOTION_TITLE_MAX} onChange={(e) => setDraft({ ...draft, newTitle: e.target.value.trim() === '' ? null : e.target.value })} />
          </Field>
          {draft.edits.map((edit, index) => (
            <div key={index} className="flex flex-col gap-1">
              <span className="text-cap text-ink-3">바꿀 곳 {index + 1} · 지금 글</span>
              <div className={`${PREVIEW} max-h-24`}>{edit.oldStr}</div>
              <Field label="새 글" htmlFor={id(`edit-${index}`)}>
                <Textarea
                  id={id(`edit-${index}`)}
                  rows={2}
                  maxLength={AI_NOTION_EDIT_TEXT_MAX}
                  value={edit.newStr}
                  onChange={(e) => setDraft({ ...draft, edits: draft.edits.map((item, i) => (i === index ? { ...item, newStr: e.target.value } : item)) })}
                />
              </Field>
              <Button size="sm" className="self-end" onClick={() => setDraft({ ...draft, edits: draft.edits.filter((_, i) => i !== index) })}>
                이 곳 빼기
              </Button>
            </div>
          ))}
        </>
      ) : (
        <Field label={draft.kind === 'NOTION_PAGE_APPEND' ? '더할 글' : '본문'} htmlFor={id('content')}>
          <Textarea id={id('content')} rows={8} maxLength={AI_NOTION_CONTENT_MAX} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
        </Field>
      )}
      <div className="flex justify-end gap-1.5">
        <Button size="sm" onClick={onCancel}>
          취소
        </Button>
        <Button size="sm" variant="primary" onClick={save}>
          저장
        </Button>
      </div>
    </div>
  );
}

// ── 일정 고치기 ──────────────────────────────────────────

export function ScheduleUpdateBody({ card }: { card: AiScheduleEventUpdateCard }) {
  const { before } = card;
  return (
    <div className="flex flex-col gap-0.5">
      <DisplayField label="제목">
        <Change before={before.scheduleEventTitle} after={card.scheduleEventTitle} />
      </DisplayField>
      <DisplayField label="시각">
        <Change before={`${seoulText(before.startAt)} ~ ${seoulText(before.endAt)}`} after={`${seoulText(card.startAt)} ~ ${seoulText(card.endAt)}`} />
      </DisplayField>
      {before.scheduleEventDescription || card.scheduleEventDescription ? (
        <DisplayField label="설명">
          <Change before={before.scheduleEventDescription ?? '(없음)'} after={card.scheduleEventDescription ?? '(없음)'} />
        </DisplayField>
      ) : null}
      <p className="text-cap text-ink-3">실행하면 ERP 일정이 바뀌고, Notion 일정 데이터베이스에는 자동으로 반영돼요</p>
    </div>
  );
}

export function ScheduleUpdateEditor({ card, onCancel, onSave }: { card: AiScheduleEventUpdateCard; onCancel: () => void; onSave: (card: AiScheduleEventUpdateCard) => void }) {
  const [title, setTitle] = useState(card.scheduleEventTitle);
  const [startAt, setStartAt] = useState(seoulLocalOf(card.startAt));
  const [endAt, setEndAt] = useState(seoulLocalOf(card.endAt));
  const [description, setDescription] = useState(card.scheduleEventDescription ?? '');
  const id = (name: string) => `${card.key}-${name}`;
  const titleError = title.trim() === '' ? '제목을 입력해 주세요' : null;
  const timeError = !startAt || !endAt ? '시각을 입력해 주세요' : endAt <= startAt ? '끝 시각은 시작 시각보다 뒤여야 해요' : null;
  return (
    <div className="flex flex-col gap-2.5 rounded-xs border border-line-strong bg-surface p-3">
      <Field label="제목" htmlFor={id('title')} error={titleError}>
        <Input id={id('title')} value={title} maxLength={100} invalid={!!titleError} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <Field label="시작" htmlFor={id('start')} error={timeError}>
          <Input id={id('start')} type="datetime-local" value={startAt} invalid={!!timeError} onChange={(e) => setStartAt(e.target.value)} />
        </Field>
        <Field label="끝" htmlFor={id('end')}>
          <Input id={id('end')} type="datetime-local" value={endAt} invalid={!!timeError} onChange={(e) => setEndAt(e.target.value)} />
        </Field>
      </div>
      <Field label="설명" htmlFor={id('description')}>
        <Textarea id={id('description')} rows={2} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-1.5">
        <Button size="sm" onClick={onCancel}>
          취소
        </Button>
        <Button size="sm" variant="primary" disabled={!!titleError || !!timeError} onClick={() => onSave(applyScheduleChanges(card, { title: title.trim(), description, startAt, endAt }))}>
          저장
        </Button>
      </div>
    </div>
  );
}

// ── 업무 고치기 ──────────────────────────────────────────

export function TaskUpdateBody({ card }: { card: AiTaskUpdateCard }) {
  const { before } = card;
  if (card.complete) {
    return (
      <div className="flex flex-col gap-0.5">
        <DisplayField label="업무">{before.taskTitle}</DisplayField>
        <DisplayField label="상태">
          진행 → <b>완료</b>
        </DisplayField>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      <DisplayField label="제목">
        <Change before={before.taskTitle} after={card.taskTitle} />
      </DisplayField>
      <DisplayField label="마감일">
        <Change before={before.dueDate} after={card.dueDate} />
      </DisplayField>
      {before.taskDescription || card.taskDescription ? (
        <DisplayField label="설명">
          <Change before={before.taskDescription ?? '(없음)'} after={card.taskDescription ?? '(없음)'} />
        </DisplayField>
      ) : null}
      <p className="text-cap text-ink-3">실행하면 ERP 업무가 바뀌고, Notion 할 일 데이터베이스에는 자동으로 반영돼요</p>
    </div>
  );
}

export function TaskUpdateEditor({ card, onCancel, onSave }: { card: AiTaskUpdateCard; onCancel: () => void; onSave: (card: AiTaskUpdateCard) => void }) {
  const [draft, setDraft] = useState(card);
  const id = (name: string) => `${card.key}-${name}`;
  const titleError = draft.taskTitle.trim() === '' ? '제목을 입력해 주세요' : null;
  return (
    <div className="flex flex-col gap-2.5 rounded-xs border border-line-strong bg-surface p-3">
      <Field label="제목" htmlFor={id('title')} error={titleError}>
        <Input id={id('title')} value={draft.taskTitle} maxLength={200} invalid={!!titleError} onChange={(e) => setDraft({ ...draft, taskTitle: e.target.value })} />
      </Field>
      <Field label="마감일" htmlFor={id('due')}>
        <DateInput id={id('due')} value={draft.dueDate} onChange={(value) => setDraft({ ...draft, dueDate: value || draft.dueDate })} />
      </Field>
      <Field label="설명" htmlFor={id('description')}>
        <Textarea id={id('description')} rows={2} maxLength={1000} value={draft.taskDescription ?? ''} onChange={(e) => setDraft({ ...draft, taskDescription: e.target.value.trim() === '' ? null : e.target.value })} />
      </Field>
      <div className="flex justify-end gap-1.5">
        <Button size="sm" onClick={onCancel}>
          취소
        </Button>
        <Button size="sm" variant="primary" disabled={!!titleError} onClick={() => onSave({ ...draft, taskTitle: draft.taskTitle.trim(), title: `업무 고치기 · ${draft.taskTitle.trim()}` })}>
          저장
        </Button>
      </div>
    </div>
  );
}
