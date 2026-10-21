// 실시간 답 스트림 쓰기의 역압 처리 (이슈 #479, DB 없음)
import type { AiAssistantStreamEvent } from '@fantasteel/shared';
import { ndjsonWriter, STREAM_BUFFER_MAX_BYTES, type NdjsonOut } from './ai-assistant.controller';

const fakeOut = () => {
  const lines: string[] = [];
  const out = { writableEnded: false, writableNeedDrain: false, writableLength: 0, write: (chunk: string) => (lines.push(chunk), true) };
  return { out: out as NdjsonOut & typeof out, lines };
};
const frame = { type: 'browser_frame', url: 'example.com/', title: '예시', image: 'AAAA' } as unknown as AiAssistantStreamEvent;
const live = { type: 'browser_live', url: 'example.com/', image: 'AAAA' } as unknown as AiAssistantStreamEvent;
const answer: AiAssistantStreamEvent = { type: 'answer', text: '네' };

describe('ndjsonWriter', () => {
  it('이벤트를 한 줄에 JSON 하나로 쓴다', () => {
    const { out, lines } = fakeOut();
    ndjsonWriter(out, new AbortController())(answer);
    expect(lines).toEqual([`${JSON.stringify(answer)}\n`]);
  });

  it('버퍼가 밀려 있으면 브라우저 화면 사진은 건너뛰고 글 이벤트는 그대로 쓴다', () => {
    const { out, lines } = fakeOut();
    out.writableNeedDrain = true;
    const write = ndjsonWriter(out, new AbortController());
    write(frame);
    write(live);
    write(answer);
    expect(lines).toEqual([`${JSON.stringify(answer)}\n`]);
    out.writableNeedDrain = false;
    write(frame);
    expect(lines).toHaveLength(2);
  });

  it('화면이 읽지 않아 버퍼가 상한을 넘으면 답을 멈추고, 멈춘 뒤·끝난 뒤에는 쓰지 않는다', () => {
    const { out, lines } = fakeOut();
    const abort = new AbortController();
    const write = ndjsonWriter(out, abort);
    out.writableLength = STREAM_BUFFER_MAX_BYTES + 1;
    write(answer);
    expect(abort.signal.aborted).toBe(true);
    write(answer);
    expect(lines).toHaveLength(1);
    const ended = fakeOut();
    ended.out.writableEnded = true;
    ndjsonWriter(ended.out, new AbortController())(answer);
    expect(ended.lines).toEqual([]);
  });
});
