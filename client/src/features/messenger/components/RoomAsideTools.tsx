'use client';

// 방 정보 칸의 편의 기능: 대화 검색(본문, 대소문자 무시)과 파일 모아보기. 둘 다 최신순.
import { useState, type FormEvent } from 'react';
import type { MessageView } from '@/api/messenger';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Input } from '@/components/Input';
import { Spinner } from '@/components/StateView';
import { useChatFiles, useChatSearch, useMessageFileDownload } from '@/hooks/useMessenger';
import { fmtDate, fmtHM } from '@/lib/format';

const FILE_PAGE = 5;

/** 본문에서 검색어를 굵게 (대소문자 무시) */
function Highlighted({ text, keyword }: { text: string; keyword: string }) {
  const lower = text.toLowerCase();
  const needle = keyword.toLowerCase();
  const parts: { text: string; hit: boolean }[] = [];
  let from = 0;
  for (let index = lower.indexOf(needle); needle && index >= 0; index = lower.indexOf(needle, from)) {
    if (index > from) parts.push({ text: text.slice(from, index), hit: false });
    parts.push({ text: text.slice(index, index + needle.length), hit: true });
    from = index + needle.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), hit: false });
  return (
    <>
      {parts.map((part, index) =>
        part.hit ? (
          <mark key={index} className="rounded-xs bg-wait-bg px-0.5 text-ink">
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

const whenOf = (message: MessageView) => `${fmtDate(message.createdAt)} ${fmtHM(message.createdAt)}`;

export function RoomSearch({ chatRoomId, onJump }: { chatRoomId: number; onJump: (messageId: number) => void }) {
  const [draft, setDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const search = useChatSearch(chatRoomId, keyword);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setKeyword(draft.trim());
  };
  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={submit} className="flex items-center gap-1.5" role="search">
        <Input value={draft} placeholder="대화 내용 검색" aria-label="대화 내용 검색" onChange={(event) => setDraft(event.target.value)} />
        <IconButton icon="search" label="검색" type="submit" />
        {keyword ? (
          <IconButton
            icon="x"
            label="검색 지우기"
            onClick={() => {
              setDraft('');
              setKeyword('');
            }}
          />
        ) : null}
      </form>
      {search.isFetching && !search.data ? <Spinner className="py-2" /> : null}
      {search.error ? <p className="text-cap text-danger">검색하지 못했어요</p> : null}
      {keyword && search.data ? (
        search.data.items.length === 0 ? (
          <p className="text-cap text-ink-3">‘{keyword}’이(가) 들어 있는 메시지가 없어요</p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="검색 결과">
            {search.data.items.map((message) => (
              <li key={message.id}>
                <button
                  type="button"
                  onClick={() => onJump(message.id)}
                  title="대화에서 이 메시지로 이동"
                  className="flex w-full flex-col gap-0.5 rounded-sm bg-surface-2 px-2.5 py-2 text-left text-xs hover:bg-surface-3"
                >
                  <span className="text-cap text-ink-3">
                    <b className="font-semibold text-ink-2">{message.senderName}</b> · {whenOf(message)}
                  </span>
                  <span className="break-words whitespace-pre-wrap">
                    <Highlighted text={message.content ?? ''} keyword={keyword} />
                  </span>
                </button>
              </li>
            ))}
            {search.data.hasMore ? <li className="text-cap text-ink-3">최근 {search.data.items.length}건만 보여요. 검색어를 더 자세히 넣어 보세요</li> : null}
          </ul>
        )
      ) : null}
    </div>
  );
}

export function RoomFiles({ chatRoomId }: { chatRoomId: number }) {
  const [limit, setLimit] = useState(FILE_PAGE);
  const files = useChatFiles(chatRoomId, limit);
  const download = useMessageFileDownload();
  if (files.isPending) return <Spinner className="py-2" />;
  if (files.error) return <p className="text-cap text-danger">파일 목록을 불러오지 못했어요</p>;
  if (files.data.items.length === 0) return <p className="text-cap text-ink-3">주고받은 파일이 없어요</p>;
  return (
    <ul className="flex flex-col gap-1.5" aria-label="주고받은 파일">
      {files.data.items.flatMap((message) =>
        message.files.map((file) => {
        const name = file.name;
        return (
          <li key={`${message.id}-${file.id}`} className="flex items-center gap-2 text-xs">
            <Icon name="clip" size="sm" className="flex-none text-ink-3" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium" title={name}>
                {name}
              </span>
              <span className="text-cap text-ink-3">
                {message.senderName} · {fmtDate(message.createdAt)}
              </span>
            </span>
            <IconButton icon="download" label={`${name} 내려받기`} size="sm" className="ml-auto" disabled={download.isPending} onClick={() => download.mutate({ messageId: message.id, fileId: file.id, fileName: name })} />
          </li>
        );
      }),
      )}
      {files.data.hasMore ? (
        <li>
          <Button size="sm" variant="ghost" disabled={files.isFetching} onClick={() => setLimit((current) => current + FILE_PAGE * 2)}>
            {files.isFetching ? '불러오는 중…' : '파일 더 보기'}
          </Button>
        </li>
      ) : null}
    </ul>
  );
}
