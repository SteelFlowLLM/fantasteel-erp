// Notion MCP 도구에 맞춘 부분: 상위 페이지 id 읽기, 페이지 만들기 입력, 결과에서 주소 읽기.
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { buildCreatePageArgs, normalizeNotionPageId, readCreatedPageUrl } from './notion.tools';

const ID = '1a2b3c4d5e6f47a8b9c0d1e2f3a4b5c6';
const DASHED = '1a2b3c4d-5e6f-47a8-b9c0-d1e2f3a4b5c6';

describe('normalizeNotionPageId', () => {
  it('대시 있는·없는 id, 대문자를 소문자 32자리로', () => {
    expect(normalizeNotionPageId(ID)).toBe(ID);
    expect(normalizeNotionPageId(DASHED)).toBe(ID);
    expect(normalizeNotionPageId(` ${ID.toUpperCase()} `)).toBe(ID);
  });

  it('제목이 붙은 페이지 주소에서 끝의 id를 읽는다', () => {
    expect(normalizeNotionPageId(`https://www.notion.so/fantasteel/Meeting-Notes-${ID}`)).toBe(ID);
    expect(normalizeNotionPageId(`https://www.notion.so/${ID}?pvs=4`)).toBe(ID);
    expect(normalizeNotionPageId(`https://fantasteel.notion.site/abc-${DASHED}`)).toBe(ID);
    expect(normalizeNotionPageId(`www.notion.so/team/Page-${ID}#heading`)).toBe(ID);
  });

  it('한글 제목(퍼센트 인코딩)도 읽는다', () => {
    expect(normalizeNotionPageId(`https://www.notion.so/team/${encodeURIComponent('회의록')}-${ID}`)).toBe(ID);
  });

  it('하위 도메인 주소(app.notion.com/p/<id>)도 읽는다', () => {
    expect(normalizeNotionPageId('https://app.notion.com/p/0654571d777347869b23a886f9ad967d')).toBe('0654571d777347869b23a886f9ad967d');
    expect(normalizeNotionPageId(`https://app.notion.com/p/${ID}?pvs=204`)).toBe(ID);
  });

  it('미리보기로 연 페이지(p)를 먼저 본다', () => {
    const other = 'ffffffffffffffffffffffffffffffff';
    expect(normalizeNotionPageId(`https://www.notion.so/team/Board-${other}?v=0000&p=${ID}&pm=s`)).toBe(ID);
  });

  it('Notion 주소가 아니거나 id가 없으면 null', () => {
    expect(normalizeNotionPageId('')).toBeNull();
    expect(normalizeNotionPageId('회의록 페이지')).toBeNull();
    expect(normalizeNotionPageId(`https://example.com/${ID}`)).toBeNull();
    expect(normalizeNotionPageId('https://www.notion.so/team/Meeting-Notes')).toBeNull();
    expect(normalizeNotionPageId('1a2b3c')).toBeNull();
    expect(normalizeNotionPageId(`https://www.notion.so/team/Page-${ID}extra`)).toBeNull();
  });
});

describe('buildCreatePageArgs', () => {
  const tool = (properties: Record<string, unknown>) => ({ name: 'notion-create-pages', inputSchema: { type: 'object', properties } });

  it('상위 페이지 아래 페이지 하나, allow_async가 있으면 false', () => {
    expect(buildCreatePageArgs(tool({ parent: {}, pages: {}, allow_async: {} }), ID, { title: '주간 회의', content: '본문' })).toEqual({
      parent: { type: 'page_id', page_id: ID },
      pages: [{ properties: { title: '주간 회의' }, content: '본문' }],
      allow_async: false,
    });
  });

  it('allow_async가 없는 서버에는 넣지 않는다', () => {
    expect(buildCreatePageArgs(tool({ parent: {}, pages: {} }), ID, { title: 't', content: 'c' })).not.toHaveProperty('allow_async');
  });

  it('입력 모양이 다르면 INT-005', () => {
    expect(() => buildCreatePageArgs(tool({ page: {} }), ID, { title: 't', content: 'c' })).toThrow(expect.objectContaining({ code: 'INT-005' }));
  });
});

describe('readCreatedPageUrl', () => {
  const text = (t: string): CallToolResult => ({ content: [{ type: 'text', text: t }] });

  it('JSON 결과의 pages[0].url', () => {
    expect(readCreatedPageUrl(text(JSON.stringify({ pages: [{ id: DASHED, url: `https://www.notion.so/${ID}`, properties: { title: 'x' } }] })))).toBe(`https://www.notion.so/${ID}`);
  });

  it('주소 없이 id만 있으면 id로 주소를 만든다', () => {
    expect(readCreatedPageUrl(text(JSON.stringify({ pages: [{ id: DASHED }] })))).toBe(`https://www.notion.so/${ID}`);
  });

  it('structuredContent도 본다', () => {
    expect(readCreatedPageUrl({ content: [], structuredContent: { result: { url: 'https://www.notion.so/abc' } } })).toBe('https://www.notion.so/abc');
  });

  it('실제 응답(app.notion.com/p/…?pvs=204)은 물음표 뒤를 떼고 남긴다', () => {
    const real = '{"pages":[{"id":"3fe44f56-d61f-81f2-92e0-ffd920d310c4","url":"https://app.notion.com/p/3fe44f56d61f81f292e0ffd920d310c4?pvs=204","properties":{"title":"x"}}]}';
    expect(readCreatedPageUrl(text(real))).toBe('https://app.notion.com/p/3fe44f56d61f81f292e0ffd920d310c4');
    expect(readCreatedPageUrl(text(`Created https://app.notion.com/p/${ID}?pvs=204.`))).toBe(`https://app.notion.com/p/${ID}`);
  });

  it('JSON이 아닌 글 속 주소', () => {
    expect(readCreatedPageUrl(text(`Created page: https://www.notion.so/Weekly-${ID}.`))).toBe(`https://www.notion.so/Weekly-${ID}`);
  });

  it('서버가 오류로 답하면(만들지 않음) INT-004', () => {
    expect(() => readCreatedPageUrl({ ...text('Could not find page'), isError: true })).toThrow(expect.objectContaining({ code: 'INT-004' }));
  });

  it('성공 답인데 주소가 없으면(만들어졌을 수 있음) null', () => {
    expect(readCreatedPageUrl(text('{"async_task":{"id":"t1"}}'))).toBeNull();
    expect(readCreatedPageUrl(text('Done'))).toBeNull();
  });
});
