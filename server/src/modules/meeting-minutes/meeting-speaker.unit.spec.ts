// DB 없이 도는 화자 분리 단위 테스트: 구간 읽기·요약, 분석 프롬프트의 화자 표시, 업로드 형식 판정.
import type { TranscriptSegment } from '@fantasteel/shared';
import { buildAnalysisUserMessage, segmentPromptText } from './meeting-analysis.prompt';
import { isMeetingAudio } from './meeting-audio';
import { readSegments, summarizeSpeakers } from './meeting-minutes.json';

describe('readSegments (화자 칸)', () => {
  it('speaker가 문자열이면 화자 칸을 모두 읽고, 없으면 칸 자체를 만들지 않는다', () => {
    const result = readSegments([
      { start: 0, end: 1, text: '안녕', speaker: 'SPEAKER_1', speakerEmployeeId: 7, speakerName: '정다은' },
      { start: 1, end: 2, text: '네', speaker: 'SPEAKER_2' },
      { start: null, end: null, text: '글로 넣은 줄' },
      { start: 2, end: 3, text: '깨진', speaker: 3, speakerEmployeeId: 'x' },
    ]);
    expect(result[0]).toEqual({ start: 0, end: 1, text: '안녕', speaker: 'SPEAKER_1', speakerEmployeeId: 7, speakerName: '정다은' });
    expect(result[1]).toEqual({ start: 1, end: 2, text: '네', speaker: 'SPEAKER_2', speakerEmployeeId: null, speakerName: null });
    expect(result[2]).toEqual({ start: null, end: null, text: '글로 넣은 줄' });
    expect(result[3]).toEqual({ start: 2, end: 3, text: '깨진' });
  });
});

describe('summarizeSpeakers', () => {
  const seg = (text: string, speaker: string | null, speakerEmployeeId?: number, speakerName?: string): TranscriptSegment => ({
    start: null,
    end: null,
    text,
    ...(speaker ? { speaker, speakerEmployeeId: speakerEmployeeId ?? null, speakerName: speakerName ?? null } : {}),
  });

  it('처음 나온 순서로 발언 수·사원 연결·첫 두 발언을 모은다', () => {
    const speakers = summarizeSpeakers([seg('가', 'SPEAKER_2'), seg('나', 'SPEAKER_1', 9, '최준혁'), seg('다', 'SPEAKER_2'), seg('라', 'SPEAKER_2'), seg('마', null)]);
    expect(speakers).toEqual([
      { label: 'SPEAKER_2', employeeId: null, employeeName: null, segmentCount: 3, firstTexts: ['가', '다'] },
      { label: 'SPEAKER_1', employeeId: 9, employeeName: '최준혁', segmentCount: 1, firstTexts: ['나'] },
    ]);
  });

  it('화자 칸이 없는 전사는 빈 배열', () => {
    expect(summarizeSpeakers([seg('글', null)])).toEqual([]);
  });
});

describe('분석 프롬프트의 화자 표시', () => {
  it('이름이 연결되면 "이름: 글", 이름표만 있으면 "화자1: 글", 화자가 없으면 글 그대로', () => {
    expect(segmentPromptText({ start: 0, end: 1, text: '내일까지요', speaker: 'SPEAKER_1', speakerName: '정다은' })).toBe('정다은: 내일까지요');
    expect(segmentPromptText({ start: 0, end: 1, text: '알겠어요', speaker: 'SPEAKER_2', speakerName: null })).toBe('화자2: 알겠어요');
    expect(segmentPromptText({ start: 0, end: 1, text: '그대로', speaker: 'A' })).toBe('A: 그대로');
    expect(segmentPromptText({ start: null, end: null, text: '김영업: 이미 이름 있음' })).toBe('김영업: 이미 이름 있음');
  });

  it('사용자 메시지는 [번호] 뒤에 화자 표시를 붙여 보낸다', () => {
    const message = buildAnalysisUserMessage({
      meetingDate: '2026-10-15',
      attendees: [{ employeeName: '정다은', departmentName: '구매부', roleLabel: '구매' }],
      segments: [
        segmentPromptText({ start: 0, end: 1, text: '방문합시다', speaker: 'SPEAKER_1', speakerName: '정다은' }),
        segmentPromptText({ start: 1, end: 2, text: '좋아요', speaker: 'SPEAKER_2' }),
      ],
    });
    expect(message).toContain('[1] 정다은: 방문합시다');
    expect(message).toContain('[2] 화자2: 좋아요');
  });
});

describe('isMeetingAudio', () => {
  it('audio/*·video/webm·video/mp4는 그대로 받는다', () => {
    expect(isMeetingAudio('audio/mpeg', 'a.bin')).toBe(true);
    expect(isMeetingAudio('video/webm', '녹음.webm')).toBe(true);
    expect(isMeetingAudio('video/mp4', 'x.mp4')).toBe(true);
  });

  it('MIME이 비었거나 octet-stream이면 확장자로 알아본다', () => {
    for (const ext of ['m4a', 'mp3', 'wav', 'webm', 'aac', 'ogg', 'mp4', 'flac', 'MP3']) {
      expect(isMeetingAudio('', `회의.${ext}`)).toBe(true);
      expect(isMeetingAudio('application/octet-stream', `회의.${ext}`)).toBe(true);
    }
    expect(isMeetingAudio('application/octet-stream', '회의.txt')).toBe(false);
    expect(isMeetingAudio('', '확장자없음')).toBe(false);
  });

  it('분명한 비오디오 MIME은 확장자가 오디오여도 거절한다', () => {
    expect(isMeetingAudio('text/plain', 'a.mp3')).toBe(false);
  });
});
