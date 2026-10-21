// DB 없이 도는 화자 분리 단위 테스트: 구간 읽기·요약, 분석 프롬프트의 화자 표시, 업로드 형식 판정, AI 화자 추정 답 거르기.
import type { TranscriptSegment } from '@fantasteel/shared';
import { buildAnalysisUserMessage, segmentPromptText } from './meeting-analysis.prompt';
import { isMeetingAudio } from './meeting-audio';
import { readSegments, summarizeSpeakers } from './meeting-minutes.json';
import { buildSpeakerUserMessage, pickSpeakerSuggestions, speakerTranscriptChars, SUGGEST_TRANSCRIPT_MAX } from './meeting-speaker-suggest';

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

describe('AI 화자 추정 (이슈 #406)', () => {
  const attendees = [
    { employeeId: 11, employeeName: '정다은', departmentName: '구매부', roleLabel: '구매' },
    { employeeId: 22, employeeName: '최준혁', departmentName: '구매부', roleLabel: '구매 부서장' },
    { employeeId: 33, employeeName: '김품질', departmentName: '품질부', roleLabel: '품질' },
  ];
  const labels = ['SPEAKER_1', 'SPEAKER_2', 'SPEAKER_3'];

  it('프롬프트에 번호 붙은 참석자, 화면과 같은 화자 이름, 연결된 이름 대신 이름표를 넣는다', () => {
    const text = buildSpeakerUserMessage({
      attendees,
      labels: ['SPEAKER_1', 'SPEAKER_2'],
      segments: [
        { start: 0, end: 1, text: '구매부 정다은입니다', speaker: 'SPEAKER_1', speakerEmployeeId: 11, speakerName: '정다은' },
        { start: 1, end: 2, text: '네', speaker: 'SPEAKER_2' },
        { start: 2, end: 3, text: '잡음', speaker: null },
      ],
    });
    expect(text).toContain('1. 정다은 (구매부, 구매)\n2. 최준혁 (구매부, 구매 부서장)');
    expect(text).toContain('화자: 화자1, 화자2');
    expect(text).toContain('[1] 화자1: 구매부 정다은입니다\n[2] 화자2: 네\n[3] (화자 모름): 잡음');
  });

  it('긴 전사는 상한까지만 넣는다', () => {
    const segments = Array.from({ length: 2000 }, (_, i) => ({ start: i, end: i + 1, text: '가'.repeat(50), speaker: 'SPEAKER_1' }));
    const text = buildSpeakerUserMessage({ attendees, labels: ['SPEAKER_1'], segments });
    const transcript = text.slice(text.indexOf('<transcript>'));
    expect(transcript.length).toBeLessThan(SUGGEST_TRANSCRIPT_MAX + 100);
    expect(transcript).not.toContain('[2000]');
  });

  it('전사가 넘치면 앞부분 뒤에 회의 중간에 처음 말한 화자의 첫 발언도 넣고 번호는 그대로 둔다 (이슈 #522)', () => {
    const segments: TranscriptSegment[] = Array.from({ length: 2000 }, (_, i) => ({ start: i, end: i + 1, text: `${'가'.repeat(50)} ${i + 1}`, speaker: 'SPEAKER_1' }));
    segments[1500] = { start: 1500, end: 1501, text: '늦게 온 구매부 정다은입니다', speaker: 'SPEAKER_2' };
    segments[1700] = { start: 1700, end: 1701, text: '두 번째 말', speaker: 'SPEAKER_2' };
    const text = buildSpeakerUserMessage({ attendees, labels: ['SPEAKER_1', 'SPEAKER_2'], segments }, 10_000);
    const transcript = text.slice(text.indexOf('<transcript>'));
    expect(transcript.length).toBeLessThan(10_000 + 100);
    expect(transcript).toContain('[1] 화자1: ');
    expect(transcript).toContain('[1501] 화자2: 늦게 온 구매부 정다은입니다');
    expect(transcript).toContain('[1701] 화자2: 두 번째 말');
    expect(text).toContain('화자마다 처음 발언 몇 개만 보여요');
    // 원래 순서대로
    expect(transcript.indexOf('[1501]')).toBeLessThan(transcript.indexOf('[1701]'));
  });

  it('다 들어가면 전부 넣고 빠졌다는 안내가 없다', () => {
    const segments: TranscriptSegment[] = [{ start: 0, end: 1, text: '안녕하세요', speaker: 'SPEAKER_1' }];
    const text = buildSpeakerUserMessage({ attendees, labels: ['SPEAKER_1'], segments });
    expect(text).toContain('[1] 화자1: 안녕하세요');
    expect(text).not.toContain('처음 발언 몇 개만');
  });

  it('전사 글자 수는 모델 문맥 길이의 절반(1토큰≈2자)이고, 모르면 2.4만 자, 2분 안에 답하게 8만 자까지 (이슈 #522)', () => {
    expect(speakerTranscriptChars(null)).toBe(SUGGEST_TRANSCRIPT_MAX);
    expect(speakerTranscriptChars(32_768)).toBe(32_768);
    expect(speakerTranscriptChars(262_144)).toBe(80_000);
  });

  it('번호를 사원 id로 바꾸고, 답에서 빠진 화자는 모름으로 채운다', () => {
    const result = pickSpeakerSuggestions({ speakers: [{ speaker: '화자1', attendeeNo: 1, reason: "[1] '정다은입니다'" }, { speaker: '화자 2', attendeeNo: null, reason: '근거 없음' }] }, labels, attendees);
    expect(result).toEqual([
      { label: 'SPEAKER_1', employeeId: 11, reason: "[1] '정다은입니다'" },
      { label: 'SPEAKER_2', employeeId: null, reason: '근거 없음' },
      { label: 'SPEAKER_3', employeeId: null, reason: '' },
    ]);
  });

  it('목록 밖 번호·소수는 모름, 없는 화자는 버리고, 같은 사람을 둘에 고르면 둘 다 비운다', () => {
    const result = pickSpeakerSuggestions(
      {
        speakers: [
          { speaker: '화자1', attendeeNo: 2, reason: 'a' },
          { speaker: '화자2', attendeeNo: 2, reason: 'b' },
          { speaker: '화자3', attendeeNo: 9, reason: 'c' },
          { speaker: '화자7', attendeeNo: 3, reason: 'd' },
          { speaker: 'SPEAKER_3', attendeeNo: 3, reason: '두 번째 답은 무시' },
        ],
      },
      labels,
      attendees,
    );
    expect(result?.map((r) => [r.label, r.employeeId])).toEqual([
      ['SPEAKER_1', null],
      ['SPEAKER_2', null],
      ['SPEAKER_3', null],
    ]);
    expect(result?.[0].reason).toBe('같은 사람을 다른 화자에도 골라 비워 뒀어요');
    expect(pickSpeakerSuggestions({ speakers: [{ speaker: '화자1', attendeeNo: 1.5, reason: '' }] }, labels, attendees)?.[0].employeeId).toBeNull();
  });

  it('모양이 틀리거나 알아볼 화자가 하나도 없으면 null', () => {
    expect(pickSpeakerSuggestions(null, labels, attendees)).toBeNull();
    expect(pickSpeakerSuggestions({ speakers: 'x' }, labels, attendees)).toBeNull();
    expect(pickSpeakerSuggestions({ speakers: [{ speaker: '화자9', attendeeNo: 1, reason: '' }] }, labels, attendees)).toBeNull();
  });
});
