// 철강맨 말하기 (이슈 #507): 답 글을 소리 내 읽을 글로 바꾸는 규칙 — 마크다운·표·코드 블록·링크 주소·출처를 빼고, 긴 답은 앞부분만, 숫자·단위는 읽기 좋게.
import { describe, expect, it } from 'vitest';
import { SPEAK_MAX_CHARS, SPEAK_MORE_ON_SCREEN, speakableNumbers, speechTextOf, splitForSpeech } from '@/lib/steelmanSpeechText';

describe('읽을 글 만들기: 빼는 것', () => {
  it('짧은 평문은 그대로 읽는다', () => {
    expect(speechTextOf('열연 코일 재고는 12톤이에요.')).toEqual({ text: '열연 코일 재고는 12톤이에요.', truncated: false });
  });

  it('마크다운 기호(제목·굵게·기울임·인용·코드 표시·목록 기호)를 뺀다', () => {
    const { text } = speechTextOf('## 재고 현황\n**열연 코일**은 `HR-01` 로트예요.\n> 참고\n- 첫째 *항목*\n1. 둘째 항목');
    expect(text).toBe('재고 현황.\n열연 코일은 HR-01 로트예요.\n참고.\n첫째 항목.\n둘째 항목.');
    expect(text).not.toMatch(/[#*`>]/);
  });

  it('코드 블록은 통째로 빼고, 뺐으면 화면 안내로 끝낸다', () => {
    const result = speechTextOf('쿼리는 아래와 같아요.\n```sql\nselect * from lot;\n```\n실행해 보세요.');
    expect(result.text).toBe(`쿼리는 아래와 같아요.\n실행해 보세요.\n${SPEAK_MORE_ON_SCREEN}`);
    expect(result.text).not.toContain('select');
    expect(result.truncated).toBe(true);
    // 닫지 않은 코드 블록도 끝까지 뺀다
    expect(speechTextOf('예시예요.\n```\nabc').text).not.toContain('abc');
  });

  it('표(위아래 선·칸 줄)는 빼고 안내로 끝낸다. 표만 있는 답은 안내만 읽는다', () => {
    const table = '| 로트 | 톤 |\n|---|---|\n| HR-01 | 12.5 |';
    expect(speechTextOf(`재고는 아래 표와 같아요.\n\n${table}`)).toEqual({ text: `재고는 아래 표와 같아요.\n${SPEAK_MORE_ON_SCREEN}`, truncated: true });
    expect(speechTextOf(table)).toEqual({ text: SPEAK_MORE_ON_SCREEN, truncated: true });
    // 앞 | 가 없는 표
    expect(speechTextOf('로트 | 톤 | 상태\n--- | --- | ---\nHR-01 | 12 | 정상').text).toBe(SPEAK_MORE_ON_SCREEN);
  });

  it('링크는 글자와 주소를 모두 빼고(출처 표시), 맨 주소도 뺀다', () => {
    const { text } = speechTextOf('철강 가격이 올랐어요. [한국철강신문](https://example.com/news/1) 자세한 건 https://example.com/a?b=1 에서 봐요. www.example.com 도요.');
    expect(text).not.toMatch(/example|한국철강신문|https?/);
    expect(text).toContain('철강 가격이 올랐어요.');
  });

  it('서버가 지우고 남은 출처 표시와 HTML 태그, 이모지를 뺀다', () => {
    expect(speechTextOf('재고가 있어요 [TRM-056, TRM-060] <b>확인</b> 👍').text).toBe('재고가 있어요 확인.');
  });

  it('구분선과 빈 줄은 건너뛴다', () => {
    expect(speechTextOf('첫 문단이에요.\n\n---\n\n둘째 문단이에요.').text).toBe('첫 문단이에요.\n둘째 문단이에요.');
  });

  it('읽을 것이 하나도 없으면(이모지·기호뿐) 안내만, 빈 답은 빈 글', () => {
    expect(speechTextOf('👍👍')).toEqual({ text: SPEAK_MORE_ON_SCREEN, truncated: true });
    expect(speechTextOf('   \n ')).toEqual({ text: '', truncated: false });
  });
});

describe('읽을 글 만들기: 긴 답', () => {
  const sentence = (n: number) => `${n}번째 문장은 철강맨이 읽을 만큼 적당히 긴 한국어 문장이에요.`;

  it(`${SPEAK_MAX_CHARS}자 안에서 줄 단위로 읽고 안내로 끝낸다`, () => {
    const lines = Array.from({ length: 20 }, (_, i) => sentence(i + 1));
    const { text, truncated } = speechTextOf(lines.join('\n'));
    expect(truncated).toBe(true);
    expect(text.endsWith(`\n${SPEAK_MORE_ON_SCREEN}`)).toBe(true);
    const body = text.slice(0, -`\n${SPEAK_MORE_ON_SCREEN}`.length);
    expect(body.length).toBeLessThanOrEqual(SPEAK_MAX_CHARS);
    expect(body.split('\n').every((line) => lines.includes(line))).toBe(true);
    expect(body.startsWith(sentence(1))).toBe(true);
    expect(body).not.toContain(sentence(20));
  });

  it('딱 한도 이하면 다 읽는다', () => {
    const one = '가'.repeat(SPEAK_MAX_CHARS - 1) + '.';
    expect(speechTextOf(one)).toEqual({ text: one, truncated: false });
  });

  it('첫 줄 하나가 한도보다 길면 문장 끝에서 자른다', () => {
    const long = Array.from({ length: 12 }, (_, i) => sentence(i + 1)).join(' ');
    const { text, truncated } = speechTextOf(long);
    expect(truncated).toBe(true);
    const body = text.replace(`\n${SPEAK_MORE_ON_SCREEN}`, '');
    expect(body.length).toBeLessThanOrEqual(SPEAK_MAX_CHARS);
    expect(body.endsWith('이에요.')).toBe(true);
  });

  it('띄어쓰기도 문장 끝도 없는 긴 글은 한도에서 자르고 마침표를 붙인다', () => {
    const { text } = speechTextOf('가'.repeat(SPEAK_MAX_CHARS + 50));
    expect(text.startsWith('가'.repeat(SPEAK_MAX_CHARS))).toBe(true);
    expect(text).toContain(SPEAK_MORE_ON_SCREEN);
  });
});

describe('숫자·단위가 읽기 좋게', () => {
  it('톤: 소수 셋째 자리 0을 떼고, 천 단위 쉼표를 없앤다', () => {
    expect(speakableNumbers('재고는 12.500톤이고 1,200.000톤까지 늘어요')).toBe('재고는 12.5톤이고 1200톤까지 늘어요');
    expect(speakableNumbers('0.250톤')).toBe('0.25톤');
    expect(speakableNumbers('10.0톤')).toBe('10톤');
  });

  it('mm·cm·kg·m·%·℃·ton을 한글 단위로', () => {
    expect(speakableNumbers('두께 3.2mm, 폭 1219 mm')).toBe('두께 3.2 밀리미터, 폭 1219 밀리미터');
    expect(speakableNumbers('길이 10m와 5cm, 무게 80kg')).toBe('길이 10 미터와 5 센티미터, 무게 80 킬로그램');
    expect(speakableNumbers('불량률 3.5%')).toBe('불량률 3.5 퍼센트');
    expect(speakableNumbers('온도 1,600℃')).toBe('온도 1600도');
    expect(speakableNumbers('12 ton, 3 tons')).toBe('12 톤, 3 톤');
    expect(speakableNumbers('강도 490MPa')).toBe('강도 490 메가파스칼');
  });

  it('단위가 아닌 글자는 건드리지 않는다 (min, mm2 같은 낱말·철판 두께 5T)', () => {
    expect(speakableNumbers('5 min 뒤, 3T 두께')).toBe('5 min 뒤, 3T 두께');
    expect(speakableNumbers('HR-01 로트')).toBe('HR-01 로트');
  });

  it('날짜·범위·치수를 읽는 대로', () => {
    expect(speakableNumbers('납기는 2026-10-22예요')).toBe('납기는 2026년 10월 22일예요');
    expect(speakableNumbers('2026.01.05')).toBe('2026년 1월 5일');
    expect(speakableNumbers('10~20톤')).toBe('10에서 20톤');
    expect(speakableNumbers('1219×2438')).toBe('1219 곱하기 2438');
    expect(speakableNumbers('열연 → 냉연')).toBe('열연, 냉연');
  });

  it('채번(SO-2610-0001)·점이 여러 개인 숫자는 그대로 둔다', () => {
    expect(speakableNumbers('수주 SO-2610-0001')).toBe('수주 SO-2610-0001');
    expect(speakableNumbers('버전 1.2.3')).toBe('버전 1.2.3');
  });

  it('전체 흐름: 목록 항목의 단위까지 한 번에', () => {
    expect(speechTextOf('- 열연 코일 HR-01: 12.500톤\n- 두께 3.2mm, 불량률 1.0%').text).toBe('열연 코일 HR-01: 12.5톤.\n두께 3.2 밀리미터, 불량률 1 퍼센트.');
  });
});

describe('목소리에 나눠 맡기기', () => {
  it('문장 끝에서 나누고 소수점은 나누지 않는다', () => {
    expect(splitForSpeech('재고는 12.5톤이에요. 다음 문장이에요! 끝이에요.', 13)).toEqual(['재고는 12.5톤이에요.', '다음 문장이에요!', '끝이에요.']);
  });

  it('짧은 문장은 한도 안에서 합치고, 줄바꿈은 나눈다', () => {
    expect(splitForSpeech('가. 나. 다.\n라.')).toEqual(['가. 나. 다. 라.']);
  });

  it('한도보다 긴 문장은 띄어쓰기에서 자른다', () => {
    const chunks = splitForSpeech('가나다 라마바 사아자 차카타 파하', 8);
    expect(chunks.every((chunk) => chunk.length <= 8)).toBe(true);
    expect(chunks.join(' ')).toBe('가나다 라마바 사아자 차카타 파하');
  });
});
