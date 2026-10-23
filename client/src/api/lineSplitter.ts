// 줄 단위(NDJSON) 응답 나누기. 네트워크 조각은 줄 중간이나 한글 글자(3바이트) 중간에서 끊길 수 있어,
// 바이트를 stream 모드 디코더로 이어 읽고 '\n'이 올 때까지 모아 둔다.

export interface LineSplitter {
  /** 받은 바이트 조각을 넣는다. 줄이 완성될 때마다 onLine을 부른다 (빈 줄은 건너뛴다) */
  push: (chunk: Uint8Array) => void;
  /** 응답이 끝났을 때: 줄바꿈 없이 끝난 마지막 줄을 내보낸다 */
  end: () => void;
}

export function createLineSplitter(onLine: (line: string) => void): LineSplitter {
  const decoder = new TextDecoder();
  let buffer = '';

  const emit = (raw: string) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.trim() !== '') onLine(line);
  };

  return {
    push(chunk) {
      buffer += decoder.decode(chunk, { stream: true });
      const parts = buffer.split('\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) emit(part);
    },
    end() {
      buffer += decoder.decode();
      const rest = buffer;
      buffer = '';
      emit(rest);
    },
  };
}
