import { describe, expect, it } from 'vitest';
import { MEETING_AUDIO_ACCEPT, audioFileProblem, fmtClock, microphoneErrorMessage, pickRecorderMimeType, recordingFileName } from '@/lib/meetingAudio';

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

  it('올릴 파일: 오디오·video/webm만, 비었거나 500MB를 넘으면 거절', () => {
    expect(audioFileProblem({ type: 'audio/mpeg', size: 1000 })).toBeNull();
    expect(audioFileProblem({ type: 'video/webm', size: 1000 })).toBeNull();
    expect(audioFileProblem({ type: 'image/png', size: 1000 })).toBe('오디오 파일만 올릴 수 있어요');
    expect(audioFileProblem({ type: 'audio/wav', size: 0 })).toBe('음성이 비어 있어요');
    expect(audioFileProblem({ type: 'audio/wav', size: 500 * 1024 * 1024 + 1 })).toContain('500.0 MB');
    expect(audioFileProblem({ type: 'audio/wav', size: 500 * 1024 * 1024 })).toBeNull();
  });

  it('올릴 파일: MIME이 비었거나 octet-stream이면 확장자로 알아본다', () => {
    expect(audioFileProblem({ type: '', size: 1000, name: '회의.m4a' })).toBeNull();
    expect(audioFileProblem({ type: 'application/octet-stream', size: 1000, name: '회의.FLAC' })).toBeNull();
    expect(audioFileProblem({ type: 'application/octet-stream', size: 1000, name: '문서.pdf' })).toBe('오디오 파일만 올릴 수 있어요');
    expect(audioFileProblem({ type: 'text/plain', size: 1000, name: 'a.mp3' })).toBe('오디오 파일만 올릴 수 있어요');
    expect(MEETING_AUDIO_ACCEPT).toContain('.m4a');
    expect(MEETING_AUDIO_ACCEPT).toContain('audio/*');
  });

  it('마이크 오류 안내', () => {
    expect(microphoneErrorMessage(new Error('x'), false)).toBe('마이크는 https 또는 localhost에서만 쓸 수 있어요');
    expect(microphoneErrorMessage(new DOMException('', 'NotAllowedError'), true)).toContain('허용');
    expect(microphoneErrorMessage(new DOMException('', 'NotFoundError'), true)).toContain('찾지 못했어요');
    expect(microphoneErrorMessage(new Error('x'), true)).toBe('마이크를 켜지 못했어요');
  });
});
