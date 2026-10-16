// 줄 나누기: 네트워크 조각이 줄 중간이나 한글 글자 중간에서 끊겨도 같은 줄이 나와야 한다.
import { describe, expect, it } from 'vitest';
import { createLineSplitter } from '@/api/lineSplitter';

const bytes = (text: string) => new TextEncoder().encode(text);

function collect(chunks: Uint8Array[]): string[] {
  const lines: string[] = [];
  const splitter = createLineSplitter((line) => lines.push(line));
  for (const chunk of chunks) splitter.push(chunk);
  splitter.end();
  return lines;
}

describe('createLineSplitter', () => {
  const text = '{"type":"answer","text":"철강 재고"}\n{"type":"thinking","text":"음, 한글"}\n{"type":"done"}\n';
  const expected = ['{"type":"answer","text":"철강 재고"}', '{"type":"thinking","text":"음, 한글"}', '{"type":"done"}'];

  it('한 번에 와도 줄마다 나눈다', () => {
    expect(collect([bytes(text)])).toEqual(expected);
  });

  it('어느 바이트에서 끊겨도 한글 글자 중간 포함 같은 줄이 나온다', () => {
    const all = bytes(text);
    for (let cut = 1; cut < all.length; cut += 1) {
      expect(collect([all.slice(0, cut), all.slice(cut)]), `cut=${cut}`).toEqual(expected);
    }
  });

  it('한 바이트씩 와도 같은 줄이 나온다', () => {
    const all = bytes(text);
    expect(collect(Array.from(all, (_, i) => all.slice(i, i + 1)))).toEqual(expected);
  });

  it('빈 줄은 건너뛰고 \\r\\n 줄바꿈도 받는다', () => {
    expect(collect([bytes('가\r\n\n\n나\r\n')])).toEqual(['가', '나']);
  });

  it('줄바꿈 없이 끝난 마지막 줄도 끝날 때 내보낸다', () => {
    expect(collect([bytes('가\n나다')])).toEqual(['가', '나다']);
  });
});
