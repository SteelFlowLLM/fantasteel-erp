// 심층 조사 보고서 PDF (이슈 #521, DB 없음). 만든 PDF를 웹 읽기와 같은 PDF 글 뽑기(unpdf worker)로 다시 읽어 한글·표·출처가 들어갔는지 본다
import { extractPdfIsolated } from '../ai-assistant/web/page-extract';
import { chartRows, pdfBlocks, plainInline, renderResearchPdf, researchPdfFileName, seoulDateTime, type ResearchPdfInput } from './ai-research.pdf';

// worker를 띄우고 글꼴(약 10MB)을 읽는 데 시간이 걸린다
jest.setTimeout(60_000);

const report = [
  '> **이 보고서는 완전하지 않아요.** 시간이 넘어 멈췄어요.',
  '',
  '# 열연 코일 가격 정리',
  '열연 가격은 **올랐어요** [1]. [링크 글](https://example.com/a)과 `코드`는 글만 남겨요.',
  '',
  '## 강종별 기준',
  '| 강종 | 인장강도(MPa) | 비고 |',
  '| --- | ---: | --- |',
  '| SS275 | 410~550 | 사내 지식 [2] |',
  '| SM355A | 490~630 | |',
  '',
  '- 첫째 항목',
  '- 둘째 항목 [1]',
  '1. 순서 하나',
  '2. 순서 둘',
  '',
  '## 출처',
  '- [1] [모델이 쓴 목록](https://x.example)',
].join('\n');

const input: ResearchPdfInput = {
  id: 12,
  title: '열연 코일 가격 동향',
  question: '열연 코일 가격이 왜 올랐는지 알려 줘',
  writtenAt: new Date('2026-10-22T00:30:00Z'),
  versionLabel: '2판',
  fallbackLabel: null,
  report,
  charts: [{ title: '월별 가격', type: 'line', unit: '천원/톤', xLabel: '월', series: [{ name: '열연', points: [{ x: '9월', y: 850, sourceId: 1 }, { x: '10월', y: 1020, sourceId: 1 }] }] }],
  sources: [
    { id: 1, title: '철강 가격 뉴스', url: 'https://news.example.kr/steel' },
    { id: 2, title: '사내 지식 · KS 규격 8. 강종별 기준값', url: 'knowledge:ks:KS-8' },
  ],
};

describe('보고서 마크다운 → PDF 블록', () => {
  it('제목·문단·표·목록·인용으로 나누고, 줄 안 표시는 글만 남기며 끝의 출처 목록은 뗀다', () => {
    const blocks = pdfBlocks(report);
    expect(blocks.map((b) => b.kind)).toEqual(['quote', 'heading', 'paragraph', 'heading', 'table', 'list', 'list']);
    expect(blocks[0]).toEqual({ kind: 'quote', text: '이 보고서는 완전하지 않아요. 시간이 넘어 멈췄어요.' });
    expect(blocks[2]).toEqual({ kind: 'paragraph', text: '열연 가격은 올랐어요 [1]. 링크 글과 코드는 글만 남겨요.' });
    expect(blocks[4]).toEqual({ kind: 'table', rows: [['강종', '인장강도(MPa)', '비고'], ['SS275', '410~550', '사내 지식 [2]'], ['SM355A', '490~630', '']] });
    expect(blocks[5]).toEqual({ kind: 'list', ordered: false, items: ['첫째 항목', '둘째 항목 [1]'] });
    expect(blocks[6]).toEqual({ kind: 'list', ordered: true, items: ['순서 하나', '순서 둘'] });
    expect(JSON.stringify(blocks)).not.toContain('모델이 쓴 목록');
  });

  it('줄 안 표시 지우기·차트 숫자 표·파일 이름·서울 시각', () => {
    expect(plainInline('![그림](https://x/a.png)**굵게** <b>태그</b> [글](https://x/(a))')).toBe('굵게 태그 글');
    expect(chartRows(input.charts[0])).toEqual([
      ['월', '열연 (천원/톤)'],
      ['9월', '850 [1]'],
      ['10월', '1,020 [1]'],
    ]);
    expect(researchPdfFileName({ id: 12, title: '열연/코일: 가격 "동향"', versionLabel: '2판' })).toBe('심층조사-12-열연_코일_가격_동향-2판.pdf');
    expect(researchPdfFileName({ id: 3, title: '', versionLabel: null })).toBe('심층조사-3.pdf');
    expect(seoulDateTime(new Date('2026-10-21T23:30:00Z'))).toBe('2026-10-22 08:30');
  });
});

describe('보고서 PDF 만들기', () => {
  it('한글 글꼴로 제목·질문·작성일·본문·표·차트·출처를 쓴다 (다시 읽으면 글이 나온다)', async () => {
    const pdf = await renderResearchPdf(input);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const page = await extractPdfIsolated(pdf, 'https://erp.local/research.pdf', 30_000);
    const text = page.text.replace(/\s+/g, ' ');
    expect(page.title).toBe('열연 코일 가격 동향');
    for (const expected of ['열연 코일 가격 동향', '작성 2026-10-22 09:30 (서울) · 2판 · 심층 조사 #12', '열연 코일 가격이 왜 올랐는지 알려 줘', '열연 가격은 올랐어요 [1]', '강종별 기준', 'SM355A', '490~630', '사내 지식 [2]', '첫째 항목', '순서 둘', '차트 (숫자 표)', '1,020 [1]', '출처', '[1] 철강 가격 뉴스', 'https://news.example.kr/steel', '[2] 사내 지식 · KS 규격 8. 강종별 기준값', '1/1'])
      expect(text).toContain(expected);
    expect(text).not.toContain('knowledge:ks');
    expect(text).not.toContain('모델이 쓴 목록');
  });

  it('긴 표는 쪽을 넘기고 머리줄을 다시 그린다. 대체본 표시도 넣는다', async () => {
    const rows = Array.from({ length: 80 }, (_, i) => `| ${i + 1}행 | 값 ${i + 1} |`);
    const pdf = await renderResearchPdf({ ...input, versionLabel: null, fallbackLabel: '대체본(보고서 생성 시간 초과)', charts: [], report: ['| 번호 | 값 |', '| --- | --- |', ...rows].join('\n') });
    const page = await extractPdfIsolated(pdf, 'https://erp.local/long.pdf', 30_000);
    const text = page.text.replace(/\s+/g, ' ');
    expect(text).toContain('대체본(보고서 생성 시간 초과)');
    expect(text).toContain('80행');
    expect(text.split('번호 값').length - 1).toBeGreaterThanOrEqual(2);
    expect(text).toMatch(/1\/[2-9]/);
  });

  it('글꼴을 읽지 못하면 실패를 돌려준다 (서비스가 RES-010으로 바꾼다)', async () => {
    await expect(renderResearchPdf(input, '/no/such/font.ttf')).rejects.toBeInstanceOf(Error);
  });
});
