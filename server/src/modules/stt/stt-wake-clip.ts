import { STT_WAKE_CLIP_LIMITS } from '@fantasteel/shared';

/** 브라우저가 소리 판의 묶음 단위로 자르므로 8초에 조금 못 미치거나 넘을 수 있어 여유를 둔다 */
const LENGTH_SLACK_SEC = 0.5;

/**
 * 철강맨 부르기 조각(이슈 #457)은 화면이 만든 PCM WAV만 받는다. 이름표(MIME)가 아니라 바이트 머리(RIFF·WAVE·fmt·data)를 읽어
 * PCM인지, 길이가 maxSeconds(부르는 말 8초, 명령 30초) 안인지 본다. 받을 수 없으면 사람이 읽을 이유, 받으면 null
 */
export function wakeClipProblem(buffer: Buffer, maxSeconds: number = STT_WAKE_CLIP_LIMITS.maxSeconds): string | null {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return 'WAV 소리만 보낼 수 있어요';
  let byteRate: number | null = null;
  let dataBytes: number | null = null;
  for (let at = 12; at + 8 <= buffer.length; ) {
    const id = buffer.toString('ascii', at, at + 4);
    const size = buffer.readUInt32LE(at + 4);
    if (id === 'fmt ' && at + 20 <= buffer.length) {
      if (buffer.readUInt16LE(at + 8) !== 1) return 'PCM WAV만 보낼 수 있어요';
      if (at + 16 <= buffer.length) byteRate = buffer.readUInt32LE(at + 16);
    }
    if (id === 'data') {
      dataBytes = Math.min(size, buffer.length - at - 8);
      break;
    }
    at += 8 + size + (size % 2);
  }
  if (!byteRate || dataBytes === null) return 'WAV 머리글을 읽을 수 없어요';
  if (dataBytes / byteRate > maxSeconds + LENGTH_SLACK_SEC) return `말소리 조각은 ${maxSeconds}초까지 보낼 수 있어요`;
  return null;
}
