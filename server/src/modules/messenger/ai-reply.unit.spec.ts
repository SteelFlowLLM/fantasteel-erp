// 사내 채팅 AI 답의 저장 표시(aiReplyContent)와 읽기(parseAiReply). 조회 출처 id에 위젯이 붙은 `get_dashboard_summary:process_yield`를
// 읽지 못해 그 답이 방 멤버 모두에게 보이던 일(이슈 #506)을 막는다.
import { aiReplyContent, aiReplyTextOf, AI_REPLY_PREFIX, isUnreadableAiReply, parseAiReply } from '@fantasteel/shared';

describe('AI 답 저장 표시 왕복', () => {
  it('조회 도구 없는 답은 기본 표시, 읽으면 도구 없음', () => {
    const content = aiReplyContent('안녕하세요');
    expect(content).toBe(`${AI_REPLY_PREFIX}안녕하세요`);
    expect(parseAiReply(content)).toEqual({ text: '안녕하세요', dataTools: [] });
  });

  it('도구 이름을 쓴 답은 쓴 도구를 그대로 돌려준다', () => {
    const content = aiReplyContent('재고예요', ['get_inventory', 'get_sales_orders']);
    expect(content.startsWith('[AI 어시스턴트:get_inventory,get_sales_orders] ')).toBe(true);
    expect(parseAiReply(content)).toEqual({ text: '재고예요', dataTools: ['get_inventory', 'get_sales_orders'] });
  });

  it('위젯처럼 범위가 붙은 출처 id(도구:범위)도 왕복한다', () => {
    const content = aiReplyContent('수율이에요\n\n출처: 조회 데이터', ['get_dashboard_summary:process_yield']);
    expect(content.startsWith('[AI 어시스턴트:get_dashboard_summary:process_yield] ')).toBe(true);
    expect(parseAiReply(content)).toEqual({ text: '수율이에요\n\n출처: 조회 데이터', dataTools: ['get_dashboard_summary:process_yield'] });
    expect(aiReplyTextOf(content)).toBe('수율이에요\n\n출처: 조회 데이터');
    expect(isUnreadableAiReply(content)).toBe(false);
  });

  it('범위가 붙은 출처와 붙지 않은 출처가 섞여도 순서를 지킨다', () => {
    const tools = ['get_sales_orders', 'get_dashboard_summary:shipment_result', 'get_dashboard_summary:process_flow', 'read_knowledge'];
    expect(parseAiReply(aiReplyContent('섞인 답', tools))?.dataTools).toEqual(tools);
  });

  it('숫자가 든 이름도 읽는다 (새 도구 이름에 숫자가 있어도 데이터 답이 일반 메시지로 보이지 않게)', () => {
    expect(parseAiReply(aiReplyContent('x', ['get_mill_sheet2', 'get_x:scope_1']))?.dataTools).toEqual(['get_mill_sheet2', 'get_x:scope_1']);
  });
});

describe('읽을 수 없는 AI 답 표시 (fail-closed)', () => {
  it('[AI 어시스턴트로 시작하는데 표시를 읽지 못하면 읽을 수 없는 AI 답이다', () => {
    for (const content of ['[AI 어시스턴트:Get-Bad!] 비밀 숫자', '[AI 어시스턴트:a:b:c] 콜론 셋', '[AI 어시스턴트:get_x,] 쉼표 끝', '[AI 어시스턴트:] 빈 도구', '[AI 어시스턴트 도우미] 읽을 수 없는 표시']) {
      expect(parseAiReply(content)).toBeNull();
      expect(isUnreadableAiReply(content)).toBe(true);
    }
  });

  it('읽을 수 있는 AI 답, 일반 글, 글 없음은 읽을 수 없는 AI 답이 아니다', () => {
    expect(isUnreadableAiReply('[AI 어시스턴트] 답이에요')).toBe(false);
    expect(isUnreadableAiReply('[AI 어시스턴트:get_inventory] 답이에요')).toBe(false);
    expect(isUnreadableAiReply('안녕하세요')).toBe(false);
    expect(isUnreadableAiReply('')).toBe(false);
    expect(isUnreadableAiReply(null)).toBe(false);
  });
});
