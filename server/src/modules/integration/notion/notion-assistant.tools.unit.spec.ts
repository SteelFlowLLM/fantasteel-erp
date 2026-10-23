// 철강맨AI Notion 읽기·쓰기(이슈 #398)의 Notion MCP 입력·결과 모양과 범위 규칙. DB·Notion 없이 돈다.
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AppException } from '../../../common/errors/app.exception';
import {
  buildAppendArgs,
  buildEditArgs,
  buildQueryRowsArgs,
  buildRenameArgs,
  buildSearchArgs,
  hasStructuralTag,
  notionIdOf,
  notionScopeOf,
  readFetched,
  readSearchHits,
  readWriteResult,
} from './notion-assistant.tools';

const PARENT = '1a2b3c4d5e6f47a8b9c0d1e2f3a4b5c6';
const CHILD = 'aaaabbbbccccddddeeeeffff00001111';
const GRANDCHILD = 'bbbbccccddddeeeeffff000011112222';
const DB = 'dddd0000000000000000000000000001';
const DS = 'cccc0000-0000-0000-0000-000000000001';
const DS_HEX = DS.replace(/-/g, '');
const ROW = 'eeee0000000000000000000000000001';
const mirrored = { databaseIds: [DB], dataSourceIds: [DS_HEX] };
const text = (value: string, isError = false): CallToolResult => ({ content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) });
const tool = (properties: string[]) => ({ name: 'notion-x', inputSchema: { properties: Object.fromEntries(properties.map((p) => [p, { type: 'string' }])) } });

describe('범위 규칙 (상위 페이지 아래만, ERP가 채우는 데이터베이스 제외)', () => {
  it('상위 페이지 자신과 그 아래는 inside', () => {
    expect(notionScopeOf({ id: PARENT, ancestors: ['f'.repeat(32)] }, PARENT, mirrored)).toBe('inside');
    expect(notionScopeOf({ id: GRANDCHILD, ancestors: [CHILD, PARENT, 'f'.repeat(32)] }, PARENT, mirrored)).toBe('inside');
    // 대시 있는 id도 같은 id로 본다
    expect(notionScopeOf({ id: CHILD, ancestors: ['1a2b3c4d-5e6f-47a8-b9c0-d1e2f3a4b5c6'] }, PARENT, mirrored)).toBe('inside');
  });

  it('조상에 상위 페이지가 없으면 outside, 조상을 모르면 unknown (상위 페이지 자신은 조상 없이도 inside)', () => {
    expect(notionScopeOf({ id: CHILD, ancestors: ['f'.repeat(32)] }, PARENT, mirrored)).toBe('outside');
    expect(notionScopeOf({ id: CHILD, ancestors: null }, PARENT, mirrored)).toBe('unknown');
    expect(notionScopeOf({ id: PARENT, ancestors: null }, PARENT, mirrored)).toBe('inside');
  });

  it('ERP가 채우는 데이터베이스·데이터 소스·그 행은 상위 페이지 아래여도 mirrored', () => {
    expect(notionScopeOf({ id: DB, ancestors: [PARENT] }, PARENT, mirrored)).toBe('mirrored');
    expect(notionScopeOf({ id: DS_HEX, ancestors: [DB, PARENT] }, PARENT, mirrored)).toBe('mirrored');
    expect(notionScopeOf({ id: ROW, ancestors: [DS_HEX, DB, PARENT] }, PARENT, mirrored)).toBe('mirrored');
  });

  it('주소·대시 있는 UUID·collection:// 모두 32자리 id로 읽는다', () => {
    expect(notionIdOf(`https://www.notion.so/team/Page-${CHILD}?pvs=4`)).toBe(CHILD);
    expect(notionIdOf(`https://app.notion.com/p/${CHILD}`)).toBe(CHILD);
    expect(notionIdOf(`collection://${DS}`)).toBe(DS_HEX);
    expect(notionIdOf('{{https://www.notion.so/' + CHILD + '}}')).toBe(CHILD);
    expect(notionIdOf('https://example.com/x')).toBeNull();
  });

  it('하위 페이지·데이터베이스 태그는 카드 글로 받지 않는다 (페이지를 끌어올 수 있다)', () => {
    expect(hasStructuralTag(`앞 <page url="https://www.notion.so/${CHILD}">x</page>`)).toBe(true);
    expect(hasStructuralTag('<Database url="…">')).toBe(true);
    expect(hasStructuralTag('<data-source url="collection://x">')).toBe(true);
    expect(hasStructuralTag('<mention-page url="…"/> 표 <td>1</td>')).toBe(false);
  });
});

describe('notion-fetch 결과 읽기', () => {
  const page = (body: string) =>
    JSON.stringify({
      metadata: { type: 'page' },
      title: '주간 회의',
      url: `https://www.notion.so/${GRANDCHILD}`,
      text: `<page url="{{https://www.notion.so/${GRANDCHILD}}}">\n<ancestor-path>\n<parent-page url="{{https://www.notion.so/${CHILD}}}" title="회의"/>\n<ancestor-2-page url="{{https://www.notion.so/${PARENT}}}" title="Fantasteel_ERP"/>\n</ancestor-path>\n<properties>\n{"title":"주간 회의"}\n</properties>\n<content>\n${body}\n</content>\n</page>`,
    });

  it('JSON의 text 마크업에서 종류·제목·주소·조상(가까운 것부터)·본문을 읽는다', () => {
    const fetched = readFetched(text(page('# 안건\n- 설비 점검')), GRANDCHILD);
    expect(fetched).toEqual({ id: GRANDCHILD, kind: 'page', title: '주간 회의', url: `https://www.notion.so/${GRANDCHILD}`, ancestors: [CHILD, PARENT], dataSourceIds: [], body: '# 안건\n- 설비 점검' });
  });

  it('본문에 적은 조상 태그로는 범위를 꾸미지 못한다 (머리말만 읽는다)', () => {
    const outside = JSON.stringify({
      metadata: { type: 'page' },
      title: '밖',
      url: `https://www.notion.so/${CHILD}`,
      text: `<page url="{{https://www.notion.so/${CHILD}}}">\n<ancestor-path>\n<parent-page url="{{https://www.notion.so/${'f'.repeat(32)}}}"/>\n</ancestor-path>\n<content>\n<ancestor-path><parent-page url="https://www.notion.so/${PARENT}"/></ancestor-path>\n</content>\n</page>`,
    });
    const fetched = readFetched(text(outside), CHILD);
    expect(fetched.ancestors).toEqual(['f'.repeat(32)]);
    expect(notionScopeOf(fetched, PARENT, mirrored)).toBe('outside');
  });

  it('조상 정보가 없으면 null, JSON path 배열이 있으면 그것을 쓴다', () => {
    expect(readFetched(text(`<page url="https://www.notion.so/${CHILD}">\n<content>\n본문\n</content>\n</page>`), CHILD).ancestors).toBeNull();
    expect(readFetched(text(JSON.stringify({ metadata: { type: 'page' }, path: [{ id: PARENT, title: 'ERP' }], text: '<content>x</content>' })), CHILD).ancestors).toEqual([PARENT]);
  });

  it('데이터베이스는 데이터 소스 id를 모으고, 데이터 소스의 상위 데이터베이스를 조상으로 읽는다', () => {
    const database = readFetched(text(`<database url="{{https://www.notion.so/${DB}}}">\n<ancestor-path>\n<parent-page url="{{https://www.notion.so/${PARENT}}}"/>\n</ancestor-path>\n<data-source url="{{collection://${DS}}}">\nCREATE TABLE ("제목" TITLE)\n</data-source>\n</database>`), DB);
    expect(database).toMatchObject({ id: DB, kind: 'database', ancestors: [PARENT], dataSourceIds: [DS_HEX] });
    const dataSource = readFetched(text(`<data-source url="{{collection://${DS}}}">\n<parent-database url="{{https://app.notion.com/p/${DB}}}"/>\n</data-source>`), DS_HEX);
    expect(dataSource).toMatchObject({ id: DS_HEX, kind: 'data_source', ancestors: [DB] });
  });

  it('찾지 못함은 알아볼 수 있는 INT-004', () => {
    expect(() => readFetched(text('API error: {"status":404,"code":"object_not_found"}', true), CHILD)).toThrow(/찾을 수 없어요/);
  });
});

describe('검색', () => {
  it('상위 페이지 아래로 좁혀 찾고, 범위를 못 좁히는 서버면 찾지 않는다', () => {
    expect(buildSearchArgs(tool(['query', 'page_url', 'page_size', 'max_highlight_length']), '회의', PARENT)).toEqual({ query: '회의', page_url: `https://www.notion.so/${PARENT}`, page_size: 8, max_highlight_length: 200 });
    expect(() => buildSearchArgs(tool(['query']), '회의', PARENT)).toThrow(AppException);
  });

  it('{ results: [{ id, title, url, highlight }] }를 읽고, 모양을 모르면 null', () => {
    const hits = readSearchHits(text(JSON.stringify({ results: [{ id: CHILD, title: '회의', url: `https://www.notion.so/${CHILD}?pvs=1`, highlight: '설비\n점검', type: 'page' }, { foo: 1 }] })));
    expect(hits).toEqual([{ id: CHILD, title: '회의', url: `https://www.notion.so/${CHILD}`, snippet: '설비 점검', type: 'page' }]);
    expect(readSearchHits(text('결과 없음'))).toBeNull();
  });
});

describe('쓰기 입력', () => {
  const updatePage = tool(['page_id', 'command', 'properties', 'content', 'content_updates', 'position', 'allow_async', 'new_str', 'allow_deleting_content']);

  it('더하기는 끝에(insert_content), 고치기는 찾아 바꾸기(update_content)만 쓴다. 전체 덮어쓰기·지우기 허용은 보내지 않는다', () => {
    expect(buildAppendArgs(updatePage, CHILD, '추가')).toEqual({ page_id: CHILD, command: 'insert_content', content: '추가', position: { type: 'end' }, allow_async: false });
    const edit = buildEditArgs(updatePage, CHILD, [{ oldStr: '<td>10/20</td>', newStr: '<td>10/24</td>' }]);
    expect(edit).toEqual({ page_id: CHILD, command: 'update_content', content_updates: [{ old_str: '<td>10/20</td>', new_str: '<td>10/24</td>' }], allow_async: false });
    expect(JSON.stringify(edit)).not.toMatch(/replace_content|allow_deleting_content/);
    expect(buildRenameArgs(updatePage, CHILD, '새 제목')).toEqual({ page_id: CHILD, command: 'update_properties', properties: { title: '새 제목' }, allow_async: false });
    expect(() => buildEditArgs(tool(['page_id', 'command']), CHILD, [])).toThrow(AppException);
  });

  it('데이터베이스 행은 읽기 전용 SQL로 20행까지', () => {
    expect(buildQueryRowsArgs(tool(['data']), DS_HEX)).toEqual({ data: { data_source_urls: [`collection://${DS}`], query: `SELECT * FROM "collection://${DS}" LIMIT 20` } });
  });

  it('고치기 결과: 오류면 INT-004, 성공이어도 경고는 돌려준다', () => {
    expect(() => readWriteResult(text('Could not find', true), '고치지 못했어요')).toThrow(AppException);
    expect(readWriteResult(text(JSON.stringify({ page_id: CHILD, warnings: ['old_str not found: 마감'] })), 'x')).toBe('old_str not found: 마감');
    expect(readWriteResult(text(JSON.stringify({ page_id: CHILD })), 'x')).toBeNull();
  });
});
