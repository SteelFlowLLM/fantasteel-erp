import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ComingSoonArea } from '@/components/ComingSoon';

const noticeOf = (grade: 'P2' | 'EX', title: string) =>
  renderToStaticMarkup(createElement(ComingSoonArea, { grade, title, children: createElement('div', null, '본문') }));

describe('준비 중 화면 안내 띠', () => {
  it('제목 뒤 조사를 받침에 맞춰 붙인다', () => {
    expect(noticeOf('P2', 'AI Factory Agent')).toContain('<b>AI Factory Agent는</b> 2등급(AI) 기능이라');
    expect(noticeOf('P2', 'Voice2ERP 회의록')).toContain('<b>Voice2ERP 회의록은</b> 2등급(AI) 기능이라');
    expect(noticeOf('EX', '과거 사례 검색')).toContain('<b>과거 사례 검색은</b> 추가 기능이라');
  });

  it('은(는)처럼 두 조사를 함께 쓰지 않는다', () => {
    expect(noticeOf('P2', 'AI Factory Agent')).not.toContain('은(는)');
  });
});
