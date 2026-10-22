import { describe, expect, it } from 'vitest';
import { MEETING_AUDIO_ACCEPT, audioFileProblem, createRecordStartGuard, fmtClock, meetingDateAfterPick, meetingDateOfAudio, microphoneErrorMessage, pickRecorderMimeType, recordingFileName } from '@/lib/meetingAudio';

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

  it('회의일 기본값: 파일의 마지막 수정 시각을 서울 날짜로 (UTC 날짜가 아니라), 시각을 모르면 null (이슈 #498)', () => {
    // 2026-10-21 23:59:59 KST = 14:59:59 UTC → 같은 날, 1초 뒤는 다음 날
    expect(meetingDateOfAudio(Date.parse('2026-10-21T14:59:59.000Z'))).toBe('2026-10-21');
    expect(meetingDateOfAudio(Date.parse('2026-10-21T15:00:00.000Z'))).toBe('2026-10-22');
    // Drive가 주는 수정 시각(ISO 글자)도 같은 규칙
    expect(meetingDateOfAudio('2026-10-18T01:30:00.000Z')).toBe('2026-10-18');
    expect(meetingDateOfAudio(0)).toBeNull();
    expect(meetingDateOfAudio(null)).toBeNull();
    expect(meetingDateOfAudio(undefined)).toBeNull();
    expect(meetingDateOfAudio('')).toBeNull();
    expect(meetingDateOfAudio('아님')).toBeNull();
    expect(meetingDateOfAudio(Number.NaN)).toBeNull();
  });

  it('파일을 골랐을 때 회의일: 파일 날짜로 바꾸되, 직접 고친 뒤나 파일 날짜를 모를 때는 지금 값을 둔다 (녹음 파일·Drive 녹음 모두)', () => {
    const today = '2026-10-22';
    const fileDate = meetingDateOfAudio(Date.parse('2026-10-10T05:00:00+09:00'));
    expect(meetingDateAfterPick(today, false, fileDate)).toBe('2026-10-10');
    // Drive 녹음: 수정 시각(ISO)에서
    expect(meetingDateAfterPick(today, false, meetingDateOfAudio('2026-10-08T01:00:00.000Z'))).toBe('2026-10-08');
    // 회의일을 직접 고쳤으면 파일을 골라도 그대로
    expect(meetingDateAfterPick('2026-10-15', true, fileDate)).toBe('2026-10-15');
    // 파일 날짜를 모르면(시각 0·Drive가 안 줌) 그대로
    expect(meetingDateAfterPick(today, false, meetingDateOfAudio(0))).toBe(today);
    expect(meetingDateAfterPick(today, false, meetingDateOfAudio(null))).toBe(today);
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

describe('녹음 시작 표 (이슈 #476)', () => {
  it('시작 중이거나 녹음 중이면 또 시작할 수 없고, 끝나면 다시 시작할 수 있다', () => {
    const guard = createRecordStartGuard();
    const first = guard.begin();
    expect(first).not.toBeNull();
    expect(guard.begin()).toBeNull();
    guard.end();
    const second = guard.begin();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });

  it('권한 창이 떠 있는 사이 화면을 떠나면(cancel) 그 시작은 무효가 되고 더는 시작할 수 없다', () => {
    const guard = createRecordStartGuard();
    const token = guard.begin();
    expect(token !== null && guard.isCurrent(token)).toBe(true);
    guard.cancel();
    expect(token !== null && guard.isCurrent(token)).toBe(false);
    expect(guard.begin()).toBeNull();
  });

  it('시작에 실패해(end) 다시 누르면 새 시작이 유효하고 앞 시작은 무효다', () => {
    const guard = createRecordStartGuard();
    const failed = guard.begin() ?? -1;
    guard.end();
    const retry = guard.begin() ?? -1;
    expect(guard.isCurrent(failed)).toBe(false);
    expect(guard.isCurrent(retry)).toBe(true);
  });
});
