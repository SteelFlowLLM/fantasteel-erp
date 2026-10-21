// 철강맨 부르기 조각의 WAV 머리 확인 (이슈 #457 리뷰): MIME가 아니라 바이트로 PCM WAV·8초를 본다.
import { silentWav } from './stt.client';
import { wakeClipProblem } from './stt-wake-clip';

describe('wakeClipProblem', () => {
  it('PCM WAV 8초(+0.5초 여유)까지 받는다', () => {
    expect(wakeClipProblem(silentWav(1))).toBeNull();
    expect(wakeClipProblem(silentWav(8))).toBeNull();
    expect(wakeClipProblem(silentWav(9))).toBe('말소리 조각은 8초까지 보낼 수 있어요');
  });

  it('WAV가 아니거나 PCM이 아니거나 머리가 깨졌으면 거절', () => {
    expect(wakeClipProblem(Buffer.from('ID3'.padEnd(100, '\0')))).toBe('WAV 소리만 보낼 수 있어요');
    const float = silentWav(1);
    float.writeUInt16LE(3, 20);
    expect(wakeClipProblem(float)).toBe('PCM WAV만 보낼 수 있어요');
    const noData = silentWav(1);
    noData.write('junk', 36, 'ascii');
    noData.writeUInt32LE(4, 40);
    expect(wakeClipProblem(noData.subarray(0, 52))).toBe('WAV 머리글을 읽을 수 없어요');
  });

  it('data 앞에 다른 덩이(LIST)가 있어도 읽는다', () => {
    const base = silentWav(1);
    const list = Buffer.alloc(12);
    list.write('LIST', 0, 'ascii');
    list.writeUInt32LE(4, 4);
    list.write('INFO', 8, 'ascii');
    const wav = Buffer.concat([base.subarray(0, 36), list, base.subarray(36)]);
    expect(wakeClipProblem(wav)).toBeNull();
  });
});
