// 철강맨 부르기 (이슈 #494): 위쪽 띠가 단계마다 무엇을 보이는지, 소리 크기 막대, 민감도.
import { describe, expect, it } from 'vitest';
import { parseWakeSensitivity, WAKE_START_RMS, wakeBarLine, wakeLevelPercent, type WakeBarInput } from '@/lib/steelmanWakeDisplay';

const now = 1_000_000;
const base: WakeBarInput = { status: 'listening', audioBlocked: false, hearing: false, transcribing: false, called: null, activity: null, answering: false, now };
const text = (patch: Partial<WakeBarInput>) => wakeBarLine({ ...base, ...patch }).text;

describe('wakeBarLine', () => {
  it('기다릴 때와 마이크 상태', () => {
    expect(text({})).toBe('듣는 중 · "철강맨, 재고 알려줘"처럼 불러 주세요');
    expect(text({ status: 'starting' })).toBe('마이크를 여는 중…');
    expect(text({ status: 'paused' })).toBe('탭이 숨겨져 잠깐 쉬어요');
    expect(wakeBarLine({ ...base, status: 'error' })).toEqual({ text: '듣지 못하고 있어요', tone: 'problem' });
  });

  it('브라우저가 소리 듣기를 멈춰 두었으면 화면을 눌러 달라고 하고, 다른 단계보다 먼저 보인다', () => {
    expect(wakeBarLine({ ...base, audioBlocked: true, hearing: true })).toEqual({ text: '화면을 한 번 눌러 주세요 · 브라우저가 소리 듣기를 멈춰 두었어요', tone: 'action' });
  });

  it('말소리 잡음 → 받아쓰는 중 → 들은 말(부르는 말이면 불렀어요, 아니면 넘겼어요)', () => {
    expect(text({ hearing: true })).toBe('듣는 중 · 말소리를 잡았어요');
    expect(text({ transcribing: true })).toBe('받아쓰는 중…');
    expect(text({ activity: { kind: 'heard', text: '철강맨', matched: true } })).toBe('철강맨을 불렀어요');
    expect(text({ activity: { kind: 'heard', text: '점심 뭐 먹지', matched: false } })).toBe("들은 말: '점심 뭐 먹지' (부르는 말이 아니라 넘겼어요)");
    // 들은 말을 보이는 동안 새 말소리를 받아쓰면 받아쓰는 중이 먼저
    expect(text({ transcribing: true, activity: { kind: 'heard', text: 'x', matched: false } })).toBe('받아쓰는 중…');
    // 긴 말은 줄여 보인다
    expect(text({ activity: { kind: 'heard', text: '가'.repeat(60), matched: false } })).toBe(`들은 말: '${'가'.repeat(40)}…' (부르는 말이 아니라 넘겼어요)`);
  });

  it('"철강맨"만 부르면 대답과 남은 초를 보이고, 지나면 보이지 않는다', () => {
    expect(wakeBarLine({ ...base, called: { reply: '네?', until: now + 7_200 } })).toEqual({ text: '네? 말씀하세요 (8초)', tone: 'action' });
    expect(text({ called: { reply: '네?', until: now - 1 } })).toBe('듣는 중 · "철강맨, 재고 알려줘"처럼 불러 주세요');
  });

  it('물어보는 중 → 답하는 중 → 답했어요', () => {
    expect(text({ activity: { kind: 'asking', question: '오늘 내 일정 알려줘' } })).toBe("물어보는 중: '오늘 내 일정 알려줘'");
    expect(text({ answering: true, activity: { kind: 'asking', question: 'x' } })).toBe('철강맨이 답하는 중…');
    expect(text({ activity: { kind: 'answered' } })).toBe('답했어요');
  });
});

describe('소리 크기 막대·민감도', () => {
  it('말 시작 기준이 가운데(50%)이고 넘치면 100%에서 멈춘다', () => {
    expect(wakeLevelPercent(0.015, 0.015)).toBe(50);
    expect(wakeLevelPercent(0.0075, 0.015)).toBe(25);
    expect(wakeLevelPercent(1, 0.015)).toBe(100);
    expect(wakeLevelPercent(0.01, 0)).toBe(0);
  });

  it('민감도가 높을수록 기준이 낮고, 모르는 값은 보통', () => {
    expect(WAKE_START_RMS.high).toBeLessThan(WAKE_START_RMS.normal);
    expect(WAKE_START_RMS.normal).toBeLessThan(WAKE_START_RMS.low);
    expect(WAKE_START_RMS.normal).toBe(0.015);
    expect(parseWakeSensitivity('high')).toBe('high');
    expect(parseWakeSensitivity('loud')).toBe('normal');
    expect(parseWakeSensitivity(undefined)).toBe('normal');
  });
});

describe('긴 명령 표시 (이슈 #494)', () => {
  it('말하는 동안의 중간 글, 잘린 명령 이어 듣기, 이어 말하기 대답', () => {
    expect(text({ hearing: true, partialText: '재고 알려' })).toBe("듣는 중: '재고 알려'");
    // 말이 끝나면 중간 글은 보이지 않는다
    expect(text({ partialText: '재고 알려' })).toBe(text({}));
    expect(text({ continuing: true })).toBe('계속 듣는 중… 말이 끝나면 물어봐요');
    expect(text({ called: { reply: '이어서', until: now + 9_500 } })).toBe('이어서 말씀하세요 (10초)');
    // 답하는 중이 먼저
    expect(text({ answering: true, hearing: true, partialText: 'x' })).toBe('철강맨이 답하는 중…');
  });
});

describe('읽어 주는 중 표시 (이슈 #507)', () => {
  it('철강맨이 답을 읽는 동안은 듣기를 쉰다고 보이고, 소리 처리 막힘·마이크 문제보다는 뒤다', () => {
    expect(wakeBarLine({ ...base, speaking: true })).toEqual({ text: '철강맨이 읽어 주는 중… 듣기는 잠깐 쉬어요', tone: 'busy' });
    // 읽는 동안 마이크가 쉬므로 말소리·중간 글·"네?"가 있어도 읽는 중이 먼저
    expect(text({ speaking: true, hearing: true, partialText: 'x', called: { reply: '네?', until: now + 5_000 } })).toBe('철강맨이 읽어 주는 중… 듣기는 잠깐 쉬어요');
    expect(text({ speaking: true, status: 'error' })).toBe('듣지 못하고 있어요');
    expect(text({ speaking: true, audioBlocked: true })).toContain('화면을 한 번 눌러 주세요');
    expect(text({ speaking: false })).toBe(text({}));
  });
});
