import { aiQuestionOf, mentionsAi } from '@fantasteel/shared';

describe('@AI 호출 판단 (REQ-AST-002)', () => {
  it('보통 호출은 인식하고 질문에서 @AI를 뺀다', () => {
    expect(mentionsAi('@AI 재고 알려줘')).toBe(true);
    expect(mentionsAi('확인 부탁해요 @ai 재고는?')).toBe(true);
    expect(aiQuestionOf('@AI 재고 알려줘')).toBe('재고 알려줘');
    expect(aiQuestionOf('재고 알려줘 @AI')).toBe('재고 알려줘');
    expect(aiQuestionOf('@AI, 재고는?')).toBe('재고는?');
  });

  it('이메일·이어 붙은 영문은 호출이 아니다', () => {
    expect(mentionsAi('mail me at kim@AI.com')).toBe(false);
    expect(mentionsAi('@AIR 문의')).toBe(false);
  });

  it('펜스 코드 블록 안의 @AI는 호출이 아니다', () => {
    const text = '이렇게 써요\n```\n@AI 재고\n```\n끝';
    expect(mentionsAi(text)).toBe(false);
    expect(aiQuestionOf(text)).toContain('@AI 재고');
    expect(mentionsAi('```ts\n@AI\n')).toBe(false);
  });

  it('인라인 코드 안의 @AI는 호출이 아니다', () => {
    expect(mentionsAi('`@AI 재고`처럼 써요')).toBe(false);
    expect(mentionsAi('`@AI` 라고 쓰면 돼요')).toBe(false);
  });

  it('> 인용 줄 안의 @AI는 호출이 아니다', () => {
    expect(mentionsAi('> @AI 재고 알려줘\n동의해요')).toBe(false);
    expect(mentionsAi('  >@AI 재고')).toBe(false);
  });

  it('코드·인용 밖의 @AI는 코드가 있어도 호출이고, 코드 안 @AI는 질문에 남는다', () => {
    const text = '`@AI` 말고 @AI 이 코드 설명해\n> @AI 인용';
    expect(mentionsAi(text)).toBe(true);
    expect(aiQuestionOf(text)).toBe('`@AI` 말고 이 코드 설명해 > @AI 인용');
  });
});
