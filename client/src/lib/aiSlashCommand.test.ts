// 철강맨AI 입력칸 / 명령 (이슈 #410): 고르기 창 열기·거르기, 보낼 글 가르기.
import { describe, expect, it } from 'vitest';
import { AI_SLASH_COMMANDS, filterSlashCommands, hangulKeystrokes, parseSlashDraft, slashCompletion, slashQueryOf, slashUsage } from '@/lib/aiSlashCommand';

const names = (query: string) => filterSlashCommands(query).map((command) => command.name);
const command = (name: string) => {
  const found = AI_SLASH_COMMANDS.find((c) => c.name === name);
  if (!found) throw new Error(name);
  return found;
};

describe('고르기 창 열기', () => {
  it('첫 글자가 /이고 띄어쓰기 전이면 / 뒤 글을 검색어로 연다', () => {
    expect(slashQueryOf('/')).toBe('');
    expect(slashQueryOf('/웹')).toBe('웹');
    expect(slashQueryOf('/조ㅅ')).toBe('조ㅅ');
  });

  it('띄어쓰기 뒤, 가운데의 /, //로 시작하는 글에서는 열지 않는다', () => {
    expect(slashQueryOf('/웹 ')).toBeNull();
    expect(slashQueryOf('/웹 오늘 환율')).toBeNull();
    expect(slashQueryOf('여재/잔재')).toBeNull();
    expect(slashQueryOf(' /웹')).toBeNull();
    expect(slashQueryOf('//웹')).toBeNull();
    expect(slashQueryOf('')).toBeNull();
  });
});

describe('명령 거르기', () => {
  it('빈 검색어면 여섯 명령을 정해 둔 순서로', () => {
    expect(names('')).toEqual(['조사', '웹', '브라우저', '새대화', '목록', '브리핑']);
  });

  it('/브리핑은 질문을 받지 않고 바로 하는 명령이다 (이슈 #506)', () => {
    expect(command('브리핑')).toMatchObject({ key: 'briefing', takesQuestion: false });
    expect(slashUsage(command('브리핑'))).toBe('/브리핑');
    expect(parseSlashDraft('/브리핑')).toEqual({ kind: 'command', command: command('브리핑'), question: '' });
    expect(parseSlashDraft('//브리핑')).toEqual({ kind: 'text', text: '/브리핑', escaped: true });
    expect(names('브리핑')).toEqual(['브리핑']);
    // 브라우저와 앞글자(브)가 같다: 더 치면 갈린다
    expect(names('브')).toEqual(['브라우저', '브리핑']);
    expect(names('브리')).toEqual(['브리핑']);
    expect(names('ㅂㅡㄹ')).toEqual(['브라우저', '브리핑']);
  });

  it('검색어로 시작하는 명령만', () => {
    expect(names('조사')).toEqual(['조사']);
    expect(names('새')).toEqual(['새대화']);
    expect(names('usr')).toEqual([]);
    expect(names('사')).toEqual([]);
  });

  it('한글을 조합하는 중에도 창이 이어서 맞는다', () => {
    expect(names('ㅈ')).toEqual(['조사']);
    expect(names('조ㅅ')).toEqual(['조사']);
    expect(names('우')).toEqual(['웹']);
    expect(names('웨')).toEqual(['웹']);
    // 받침이 다음 글자로 넘어가기 전
    expect(names('샏')).toEqual(['새대화']);
    expect(names('목ㄹ')).toEqual(['목록']);
    expect(names('목로')).toEqual(['목록']);
    // 받침 ㄹ이 다음 글자의 초성일 수도 있어, 브라우저와 브리핑이 함께 남는다 (브리핑 이슈 #506)
    expect(names('블')).toEqual(['브라우저', '브리핑']);
    expect(names('브라')).toEqual(['브라우저']);
    expect(names('블ㅣ')).toEqual(['브리핑']);
    expect(names('새대ㅎ')).toEqual(['새대화']);
    expect(names('새대호')).toEqual(['새대화']);
  });

  it('두벌식 낱자로 푼다', () => {
    expect(hangulKeystrokes('웹')).toBe('ㅇㅜㅔㅂ');
    expect(hangulKeystrokes('몱')).toBe('ㅁㅗㄹㄱ');
    expect(hangulKeystrokes('ㅘA')).toBe('ㅗㅏa');
  });
});

describe('보낼 글 가르기', () => {
  it('명령과 질문을 가른다', () => {
    expect(parseSlashDraft('/웹  오늘 환율\n알려줘 ')).toEqual({ kind: 'command', command: command('웹'), question: '오늘 환율\n알려줘' });
    expect(parseSlashDraft('/조사 SS275 시세')).toEqual({ kind: 'command', command: command('조사'), question: 'SS275 시세' });
    expect(parseSlashDraft('/새대화')).toEqual({ kind: 'command', command: command('새대화'), question: '' });
    expect(parseSlashDraft('/웹')).toEqual({ kind: 'command', command: command('웹'), question: '' });
  });

  it('여섯 낱말과 똑같지 않으면 보통 질문이다', () => {
    expect(parseSlashDraft('/usr 경로가 뭐야')).toEqual({ kind: 'text', text: '/usr 경로가 뭐야', escaped: false });
    expect(parseSlashDraft('/웹검색 켜줘')).toEqual({ kind: 'text', text: '/웹검색 켜줘', escaped: false });
    expect(parseSlashDraft('여재 /웹 뭐야')).toEqual({ kind: 'text', text: '여재 /웹 뭐야', escaped: false });
    expect(parseSlashDraft(' /웹 환율')).toEqual({ kind: 'text', text: ' /웹 환율', escaped: false });
    expect(parseSlashDraft('/브리핑해줘')).toEqual({ kind: 'text', text: '/브리핑해줘', escaped: false });
  });

  it('//명령은 앞의 /를 하나 빼고 글 그대로 보낸다 (명령 낱말이 아니면 그대로)', () => {
    expect(parseSlashDraft('//웹 이 뭐야')).toEqual({ kind: 'text', text: '/웹 이 뭐야', escaped: true });
    expect(parseSlashDraft('//목록')).toEqual({ kind: 'text', text: '/목록', escaped: true });
    expect(parseSlashDraft('// 주석')).toEqual({ kind: 'text', text: '// 주석', escaped: false });
  });

  it('사용법과 채울 글', () => {
    expect(slashUsage(command('웹'))).toBe('/웹 질문');
    expect(slashUsage(command('목록'))).toBe('/목록');
    expect(slashCompletion(command('브라우저'))).toBe('/브라우저 ');
  });
});
