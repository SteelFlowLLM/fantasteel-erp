// 메시지 입력창 (hl-composer): Enter 보내기 · Shift+Enter 줄바꿈 · @ 멘션 고르기 · 파일 첨부.
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { messengerApi, type ChatRoomMemberView, type ChatRoomView, type MessageView } from '@/api/messenger';
import { ComingSoon, Icon } from '@/components/ui';
import { useAction } from '@/hooks/useApi';
import { fmtBytes } from '@/lib/format';

const MAX_LENGTH = 4000;
/** 커서 바로 앞의 "@검색어" (앞은 줄 처음이거나 공백) */
const MENTION_AT_CARET = /(^|\s)@([^\s@]*)$/;

/** 내용에 "@이름"이 적힌 방 멤버 — 서버가 내용에서 찾는 규칙과 같다 (뒤에 '님'이 붙어도 된다). */
function mentionedIds(content: string, members: ChatRoomMemberView[], myEmployeeId: number): number[] {
  return members.filter((m) => m.employeeId !== myEmployeeId && content.includes(`@${m.employeeName}`)).map((m) => m.employeeId);
}

export function ChatComposer({ room, myEmployeeId, onSent }: { room: ChatRoomView; myEmployeeId: number; onSent: (message: MessageView) => void }) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [caret, setCaret] = useState(0);
  const [pickIndex, setPickIndex] = useState(0);
  const [pickClosed, setPickClosed] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const done = (m: MessageView) => {
    setText('');
    setFile(null);
    setCaret(0);
    onSent(m);
    areaRef.current?.focus();
  };
  // 실패하면 서버 메시지(형식·용량 제한 등)를 토스트로 보여주고 입력한 내용은 그대로 둔다
  const send = useAction(messengerApi.send, { onSuccess: done });
  const sendFile = useAction(messengerApi.sendFile, { onSuccess: done });
  const busy = send.isPending || sendFile.isPending;

  const before = text.slice(0, caret);
  const match = pickClosed ? null : MENTION_AT_CARET.exec(before);
  const query = match ? match[2] : null;
  const candidates = useMemo(
    () => (query === null ? [] : room.members.filter((m) => m.employeeId !== myEmployeeId && m.employeeName.includes(query)).slice(0, 8)),
    [query, room.members, myEmployeeId],
  );
  const picking = query !== null;
  const active = Math.min(pickIndex, Math.max(candidates.length - 1, 0));

  const pick = (member: ChatRoomMemberView) => {
    if (!match) return;
    const start = before.length - match[2].length - 1; // '@' 위치
    const inserted = `@${member.employeeName} `;
    const next = text.slice(0, start) + inserted + text.slice(caret);
    const pos = start + inserted.length;
    setText(next);
    setCaret(pos);
    setPickIndex(0);
    requestAnimationFrame(() => {
      areaRef.current?.focus();
      areaRef.current?.setSelectionRange(pos, pos);
    });
  };

  const submit = () => {
    const content = text.trim();
    if (busy) return;
    if (file) {
      sendFile.mutate({ id: room.id, file, content: content || undefined });
      return;
    }
    if (!content) return;
    const ids = mentionedIds(content, room.members, myEmployeeId);
    // 멘션이 없으면 보내지 않는다 → 서버가 내용의 @이름을 직접 찾는다 (결과는 같다)
    send.mutate({ id: room.id, content, mentionEmployeeIds: ids.length ? ids : undefined });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 한글 조합 중의 Enter는 글자 확정이므로 보내지 않는다
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (picking && candidates.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setPickIndex((active + (e.key === 'ArrowDown' ? 1 : candidates.length - 1)) % candidates.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(candidates[active]);
        return;
      }
    }
    if (picking && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setPickClosed(true);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const insertAt = () => {
    const el = areaRef.current;
    const pos = el?.selectionStart ?? text.length;
    const needsSpace = pos > 0 && !/\s/.test(text[pos - 1]);
    const inserted = `${needsSpace ? ' ' : ''}@`;
    setText(text.slice(0, pos) + inserted + text.slice(pos));
    setCaret(pos + inserted.length);
    setPickClosed(false);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos + inserted.length, pos + inserted.length);
    });
  };

  const lines = Math.min(6, Math.max(1, text.split('\n').length));
  return (
    <div className="msgr-composer">
      {picking ? (
        <div className="msgr-mention-pop" role="listbox" aria-label="멘션할 멤버">
          <div className="msgr-mention-pop__item is-disabled" role="option" aria-selected="false" aria-disabled="true">
            <span className="hl-aimark hl-aimark--sm">AI</span>
            <span className="hl-grow">@AI 호출 <span className="hl-cap">AI 어시스턴트에게 묻기</span></span>
            <ComingSoon grade="P2" />
          </div>
          {candidates.map((m, i) => (
            <button
              key={m.employeeId}
              type="button"
              role="option"
              aria-selected={i === active}
              className={`msgr-mention-pop__item${i === active ? ' is-active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setPickIndex(i)}
              onClick={() => pick(m)}
            >
              <span className="hl-avatar hl-avatar--sm">{m.employeeName.slice(0, 1)}</span>
              <span className="hl-grow">{m.employeeName} <span className="hl-cap">{m.departmentName} · {m.jobGrade}</span></span>
            </button>
          ))}
          {!candidates.length ? <div className="hl-cap" style={{ padding: '8px 12px' }}>일치하는 멤버가 없어요</div> : null}
        </div>
      ) : null}
      <div className="hl-composer">
        {file ? (
          <div className="hl-row" style={{ padding: '8px 10px 0' }}>
            <span className="hl-file" style={{ padding: '6px 10px' }}>
              <Icon name="file" />
              <b style={{ fontSize: 12.5, fontWeight: 600, wordBreak: 'break-all' }}>{file.name}</b>
              <span className="hl-cap">{fmtBytes(file.size)}</span>
              <button type="button" className="hl-iconbtn hl-iconbtn--sm" aria-label="첨부 취소" disabled={busy} onClick={() => setFile(null)}><Icon name="x" size="sm" /></button>
            </span>
          </div>
        ) : null}
        <textarea
          ref={areaRef}
          value={text}
          maxLength={MAX_LENGTH}
          style={{ height: 24 + lines * 20 }}
          placeholder={file ? '파일과 같이 보낼 말을 적어 주세요 (선택)' : '메시지 입력 · @ 로 멤버 멘션'}
          aria-label="메시지 입력"
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart);
            setPickClosed(false);
            setPickIndex(0);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          onBlur={() => setPickClosed(true)}
        />
        <div className="hl-composer__bar">
          <button type="button" className="hl-iconbtn hl-iconbtn--sm" aria-label="파일 첨부" title="파일 첨부 (20MB까지, 실행 파일 제외)" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Icon name="clip" />
          </button>
          <button type="button" className="hl-btn hl-btn--ghost hl-btn--sm" aria-label="멤버 멘션" onMouseDown={(e) => e.preventDefault()} onClick={insertAt}>@ 멘션</button>
          <button type="button" className="hl-btn hl-btn--ai-outline hl-btn--sm" disabled title="준비 중 (P2)">
            <span className="hl-aimark hl-aimark--sm" style={{ width: 16, height: 16, fontSize: 8 }}>AI</span>@AI 호출 <ComingSoon grade="P2" />
          </button>
          <span className="hl-cap" style={{ marginLeft: 8 }}>Enter 보내기 · Shift+Enter 줄바꿈</span>
          <button type="button" className="hl-btn hl-btn--primary hl-btn--sm" style={{ marginLeft: 'auto' }} disabled={busy || (!file && !text.trim())} onClick={submit}>
            <Icon name="send" />
            {busy ? '보내는 중…' : '보내기'}
          </button>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
