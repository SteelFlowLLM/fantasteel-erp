// Notion 업무 공간(이슈 #391)에서 Notion MCP 도구에 맞춘 부분: 데이터베이스 정의, 입력 만들기, 결과 읽기, 행 → 속성.
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AppException } from '../../../common/errors/app.exception';
import {
  buildCreateDatabaseArgs,
  buildCreateRowsArgs,
  buildCreateViewArgs,
  buildReplaceContentArgs,
  buildUpdatePropertiesArgs,
  meetingProperties,
  notionDatabaseDefs,
  readCreatedDatabase,
  readCreatedPages,
  readUpdateResult,
  scheduleEventProperties,
  selectOption,
  seoulIso,
  taskProperties,
} from './notion-workspace.tools';

const PARENT = '1a2b3c4d5e6f47a8b9c0d1e2f3a4b5c6';
const DB = 'aaaabbbbccccddddeeeeffff00002222';
const DS = '248104cd-477e-80af-bc30-000bc80d3a76';
const PAGE1 = '11111111222233334444555566667777';
const PAGE2 = '88888888999900001111222233334444';

const text = (value: string, isError = false): CallToolResult => ({ content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) });
const tool = (name: string, keys: string[]) => ({ name, inputSchema: { properties: Object.fromEntries(keys.map((k) => [k, {}])) } });

describe('notionDatabaseDefs', () => {
  it('세 데이터베이스의 CREATE TABLE과 보기 (일정 달력, 할 일 상태별·담당자별 보드)', () => {
    const defs = notionDatabaseDefs(['김영업', '정다은', '김영업']);
    expect(defs.scheduleEvents.schema).toContain('"일시" DATE');
    expect(defs.scheduleEvents.views).toContainEqual({ name: '달력', type: 'calendar', configure: 'CALENDAR BY "일시"' });
    expect(defs.tasks.schema).toContain(`"상태" SELECT('진행':blue, '완료':green)`);
    expect(defs.tasks.schema).toContain(`"담당자" SELECT('김영업':blue, '정다은':green)`);
    expect(defs.tasks.views.map((v) => v.configure)).toEqual(['GROUP BY "상태"', 'GROUP BY "담당자"', 'SORT BY "마감일" ASC']);
    expect(defs.meetingMinutes.schema).toMatch(/^CREATE TABLE \("제목" TITLE, "회의일" DATE/);
  });

  it('사용 중인 사원이 없으면 자리 항목을 둔다 (빈 SELECT는 만들 수 없다)', () => {
    expect(notionDatabaseDefs([]).tasks.schema).toContain(`"담당자" SELECT('담당자 없음':blue)`);
  });

  it('선택 항목 이름: 쉼표·작은따옴표를 바꾸고 100자로 자른다', () => {
    expect(selectOption("O'Neil, Kim")).toBe('O’Neil Kim');
    expect(selectOption('  ')).toBe('이름 없음');
    expect(selectOption('가'.repeat(150))).toHaveLength(100);
  });
});

describe('데이터베이스·보기 만들기', () => {
  const createDb = tool('notion-create-database', ['parent', 'title', 'description', 'schema']);

  it('상위 페이지 아래에 만든다', () => {
    const def = notionDatabaseDefs(['김영업']).tasks;
    expect(buildCreateDatabaseArgs(createDb, PARENT, def)).toEqual({ parent: { type: 'page_id', page_id: PARENT }, title: 'ERP 할 일', description: def.description, schema: def.schema });
  });

  it('입력 모양이 다르면 INT-005', () => {
    expect(() => buildCreateDatabaseArgs(tool('notion-create-database', ['parent']), PARENT, notionDatabaseDefs([]).tasks)).toThrow(AppException);
  });

  it('결과 마크다운에서 데이터 소스 id와 데이터베이스 주소를 읽는다 (상위 페이지 주소는 건너뛴다)', () => {
    const result = text(
      `Created database.\n<parent-page url="https://www.notion.so/${PARENT}"/>\n<database url="{{https://www.notion.so/${DB}}}">\n<data-source url="{{collection://${DS}}}">\nCREATE TABLE ...</data-source></database>`,
    );
    expect(readCreatedDatabase(result, PARENT)).toEqual({ databaseId: DB, dataSourceId: DS, url: `https://www.notion.so/${DB}` });
  });

  it('JSON 결과도 읽고, 데이터베이스 id가 없으면 null로 둔다', () => {
    expect(readCreatedDatabase(text(JSON.stringify({ data_source_id: DS.replace(/-/g, '') })), PARENT)).toEqual({ databaseId: null, dataSourceId: DS, url: null });
  });

  it('데이터 소스 id가 없으면 null (만들어졌는지 모른다), 오류 답은 INT-004', () => {
    expect(readCreatedDatabase(text('Accepted'), PARENT)).toBeNull();
    expect(() => readCreatedDatabase(text('parent not found', true), PARENT)).toThrow(AppException);
  });

  it('보기: 데이터베이스 id가 있으면 그 데이터베이스에, 없으면 상위 페이지에 붙인다', () => {
    const view = { name: '상태별', type: 'board' as const, configure: 'GROUP BY "상태"' };
    const createView = tool('notion-create-view', ['database_id', 'parent_page_id', 'data_source_id', 'name', 'type', 'configure']);
    expect(buildCreateViewArgs(createView, { databaseId: DB, dataSourceId: DS, url: null }, PARENT, view)).toEqual({ database_id: DB, data_source_id: DS, name: '상태별', type: 'board', configure: 'GROUP BY "상태"' });
    expect(buildCreateViewArgs(createView, { databaseId: null, dataSourceId: DS, url: null }, PARENT, view)).toMatchObject({ parent_page_id: PARENT, data_source_id: DS });
  });
});

describe('페이지 만들기·고치기', () => {
  const createPages = tool('notion-create-pages', ['parent', 'pages', 'allow_async']);
  const updatePage = tool('notion-update-page', ['page_id', 'command', 'properties', 'new_str', 'allow_async']);

  it('데이터 소스 아래 여러 페이지를 한 번에, 본문은 있을 때만', () => {
    expect(buildCreateRowsArgs(createPages, DS, [{ properties: { 제목: '가' } }, { properties: { 제목: '나' }, content: '본문' }])).toEqual({
      parent: { type: 'data_source_id', data_source_id: DS },
      pages: [{ properties: { 제목: '가' } }, { properties: { 제목: '나' }, content: '본문' }],
      allow_async: false,
    });
  });

  it('만든 페이지를 보낸 순서대로 읽는다 (대시 있는 id·주소)', () => {
    const json = JSON.stringify({ pages: [{ id: '11111111-2222-3333-4444-555566667777', url: `https://www.notion.so/A-${PAGE1}` }, { id: PAGE2 }] });
    expect(readCreatedPages(text(json), 2)).toEqual([
      { id: PAGE1, url: `https://www.notion.so/A-${PAGE1}` },
      { id: PAGE2, url: `https://www.notion.so/${PAGE2}` },
    ]);
  });

  it('JSON이 아니면 글 속 주소를 순서대로 읽는다', () => {
    expect(readCreatedPages(text(`Created https://www.notion.so/${PAGE1} and https://www.notion.so/${PAGE2}.`), 2)?.map((p) => p.id)).toEqual([PAGE1, PAGE2]);
  });

  it('읽은 수가 보낸 수와 다르면 null, 오류 답은 INT-004', () => {
    expect(readCreatedPages(text(JSON.stringify({ pages: [{ id: PAGE1 }] })), 2)).toBeNull();
    expect(readCreatedPages(text('Accepted'), 1)).toBeNull();
    expect(() => readCreatedPages(text('validation error', true), 1)).toThrow(AppException);
  });

  it('속성 고치기·본문 바꾸기 입력, 오류 답은 INT-004', () => {
    expect(buildUpdatePropertiesArgs(updatePage, PAGE1, { 상태: '완료' })).toEqual({ page_id: PAGE1, command: 'update_properties', properties: { 상태: '완료' }, allow_async: false });
    expect(buildReplaceContentArgs(updatePage, PAGE1, '본문')).toEqual({ page_id: PAGE1, command: 'replace_content', new_str: '본문', allow_async: false });
    expect(() => readUpdateResult(text('Could not find page', true))).toThrow(AppException);
    expect(() => readUpdateResult(text('ok'))).not.toThrow();
  });
});

describe('행 → 속성', () => {
  it('서울 시각 ISO', () => {
    expect(seoulIso(new Date('2026-10-21T05:00:00.000Z'))).toBe('2026-10-21T14:00:00+09:00');
  });

  it('일정: 일시는 시작·끝 시각, 참석자는 이름 글', () => {
    const props = scheduleEventProperties({
      id: 7,
      title: '공급사 미팅',
      description: null,
      startAt: new Date('2026-10-21T05:00:00.000Z'),
      endAt: new Date('2026-10-21T06:30:00.000Z'),
      attendeeNames: ['김영업', '정다은'],
      creatorName: '김영업',
      meetingUrl: null,
      erpUrl: 'http://client.test/schedule?week=2026-10-19',
    });
    expect(props).toEqual({
      제목: '공급사 미팅',
      'date:일시:start': '2026-10-21T14:00:00+09:00',
      'date:일시:end': '2026-10-21T15:30:00+09:00',
      'date:일시:is_datetime': 1,
      참석자: '김영업, 정다은',
      등록자: '김영업',
      설명: null,
      회의록: null,
      ERP: 'http://client.test/schedule?week=2026-10-19',
      번호: 7,
    });
  });

  it('업무: 상태는 공통 코드 표시명, 담당자는 선택 항목, 마감일은 날짜만', () => {
    const props = taskProperties({
      id: 3,
      title: '견적서 보내기',
      description: 'x'.repeat(2500),
      status: 'DONE',
      assigneeName: '정다은',
      creatorName: '김영업',
      dueDate: new Date('2026-10-24T00:00:00.000Z'),
      source: 'MEETING',
      meetingUrl: 'https://www.notion.so/m',
      erpUrl: 'http://client.test/tasks',
    });
    expect(props).toMatchObject({ 상태: '완료', 담당자: '정다은', 'date:마감일:start': '2026-10-24', 'date:마감일:is_datetime': 0, 출처: '회의록', 회의록: 'https://www.notion.so/m', 번호: 3 });
    expect(String(props.설명)).toHaveLength(2000);
  });

  it('회의록: 회의일은 날짜, 확정 시각은 있을 때만', () => {
    const base = { id: 1, title: '원료 회의', meetingDate: new Date('2026-10-14T00:00:00.000Z'), attendeeNames: ['정다은'], creatorName: '정다은', erpUrl: 'http://client.test/meetings?id=1' };
    expect(meetingProperties({ ...base, confirmedAt: null })).not.toHaveProperty('date:확정:start');
    expect(meetingProperties({ ...base, confirmedAt: new Date('2026-10-15T05:00:00.000Z') })).toMatchObject({ 'date:회의일:start': '2026-10-14', 'date:확정:start': '2026-10-15T14:00:00+09:00' });
  });
});
