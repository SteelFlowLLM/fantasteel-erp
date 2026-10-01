import { describe, expect, it } from 'vitest';
import { findErpNos, findMentions, previewText, splitMessageText } from '@/features/messenger/lib/messageText';

describe('멘션 찾기 (REQ-MSG-005)', () => {
  const candidates = [
    { id: 1, name: '권예진' },
    { id: 2, name: '생산부' },
    { id: 3, name: '생산부장' },
    { id: 4, name: '품질부' },
  ];

  it('@이름을 찾고, 긴 이름을 먼저 맞춘다', () => {
    expect(findMentions('@권예진님 확인 부탁해요', candidates).map((c) => c.id)).toEqual([1]);
    expect(findMentions('@생산부장 확인', candidates).map((c) => c.id)).toEqual([3]);
    expect(findMentions('@생산부 확인 @품질부 도', candidates).map((c) => c.id)).toEqual([2, 4]);
  });

  it('같은 대상은 한 번만, @ 없는 이름은 멘션이 아니다', () => {
    expect(findMentions('@권예진 @권예진 권예진', candidates).map((c) => c.id)).toEqual([1]);
    expect(findMentions('권예진 품질부', candidates)).toEqual([]);
    expect(findMentions('메일 a@b.com', candidates)).toEqual([]);
  });
});

describe('ERP 번호 찾기 (REQ-MSG-006)', () => {
  it('수주·구매요청·출하요청 번호를 찾는다', () => {
    expect(findErpNos('수주SO-2610-001과 PR-2610-0012, DR-2610-0003 확인. SO-2610-001 다시')).toEqual([
      { no: 'SO-2610-001', kind: 'SALES_ORDER' },
      { no: 'PR-2610-0012', kind: 'PURCHASE_REQUISITION' },
      { no: 'DR-2610-0003', kind: 'SHIPMENT_REQUEST' },
    ]);
  });

  it('형식이 다르면 찾지 않는다', () => {
    expect(findErpNos('SO-20260930-0001 PR-2610-12 XSO-2610-001')).toEqual([]);
  });
});

describe('본문 조각 나누기', () => {
  it('멘션·링크·글로 나누고 나를 멘션했는지 표시한다', () => {
    const segments = splitMessageText('@권예진 SO-2610-001 확인 @품질부', {
      mentionNames: ['권예진', '품질부'],
      myNames: ['품질부'],
      links: [{ text: 'SO-2610-001', href: '/sales-orders/1' }],
    });
    expect(segments).toEqual([
      { kind: 'mention', text: '@권예진', isMe: false },
      { kind: 'text', text: ' ' },
      { kind: 'link', text: 'SO-2610-001', href: '/sales-orders/1' },
      { kind: 'text', text: ' 확인 ' },
      { kind: 'mention', text: '@품질부', isMe: true },
    ]);
  });

  it('미리보기는 줄바꿈을 접고 길면 자른다', () => {
    expect(previewText('첫 줄\n둘째 줄')).toBe('첫 줄 둘째 줄');
    expect(previewText('가'.repeat(70), 60)).toBe(`${'가'.repeat(60)}…`);
  });
});
