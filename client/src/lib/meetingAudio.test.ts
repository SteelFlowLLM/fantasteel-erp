import { describe, expect, it } from 'vitest';
import { audioFileProblem, fmtClock, microphoneErrorMessage, pickRecorderMimeType, recordingFileName } from '@/lib/meetingAudio';

describe('회의 음성 도우미 (lib/meetingAudio.ts)', () => {
  it('녹음 형식: webm/opus 먼저, 없으면 mp4, 둘 다 없으면 기본값', () => {
    expect(pickRecorderMimeType(() => true)).toBe('audio/webm;codecs=opus');
    expect(pickRecorderMimeType((m) => m === 'audio/mp4')).toBe('audio/mp4');
    expect(pickRecorderMimeType(() => false)).toBeUndefined();
  });

  it('시간 표시 mm:ss', () => {
    expect(fmtClock(0)).toBe('00:00');
    expect(fmtClock(75.9)).toBe('01:15');
    expect(fmtClock(3725)).toBe('1:02:05');
    expect(fmtClock(-3)).toBe('00:00');
  });

  it('녹음 파일 이름은 형식에 맞는 확장자를 쓴다', () => {
    expect(recordingFileName('audio/webm;codecs=opus')).toBe('회의-녹음.webm');
    expect(recordingFileName('audio/mp4')).toBe('회의-녹음.m4a');
  });

  it('올릴 파일: 오디오·video/webm만, 비었거나 100MB를 넘으면 거절', () => {
    expect(audioFileProblem({ type: 'audio/mpeg', size: 1000 })).toBeNull();
    expect(audioFileProblem({ type: 'video/webm', size: 1000 })).toBeNull();
    expect(audioFileProblem({ type: 'image/png', size: 1000 })).toBe('오디오 파일만 올릴 수 있어요');
    expect(audioFileProblem({ type: 'audio/wav', size: 0 })).toBe('음성이 비어 있어요');
    expect(audioFileProblem({ type: 'audio/wav', size: 100 * 1024 * 1024 + 1 })).toContain('100.0 MB');
  });

  it('마이크 오류 안내', () => {
    expect(microphoneErrorMessage(new Error('x'), false)).toBe('마이크는 https 또는 localhost에서만 쓸 수 있어요');
    expect(microphoneErrorMessage(new DOMException('', 'NotAllowedError'), true)).toContain('허용');
    expect(microphoneErrorMessage(new DOMException('', 'NotFoundError'), true)).toContain('찾지 못했어요');
    expect(microphoneErrorMessage(new Error('x'), true)).toBe('마이크를 켜지 못했어요');
  });
});
