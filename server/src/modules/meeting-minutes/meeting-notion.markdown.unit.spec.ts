// 확정 회의록 → Notion 마크다운: 머리 정보, 요약, 결정사항, 허가한 후보만 싣는지 확인한다.
import { MEETING_MINUTES_STATUS, ROLE, type MeetingCandidate, type MeetingMinutesView } from '@fantasteel/shared';
import { buildMeetingNotionMarkdown, escapeNotionText, meetingNotionTitle } from './meeting-notion.markdown';

const candidate = (over: Partial<MeetingCandidate>): MeetingCandidate => ({
  key: 'c1',
  kind: 'TASK',
  title: '견적서 발송',
  description: null,
  evidence: [],
  sourceText: null,
  assigneeId: null,
  assigneeName: null,
  dueDate: null,
  startAt: null,
  endAt: null,
  endAssumed: false,
  attendeeIds: [],
  purchase: null,
  itemName: null,
  relatedSalesOrderNo: null,
  salesOrderId: null,
  issues: [],
  context: [],
  decision: 'APPROVED',
  registered: null,
  ...over,
});

const meeting = (over: Partial<MeetingMinutesView> = {}): MeetingMinutesView => ({
  id: 12,
  meetingMinutesTitle: '10월 영업 회의',
  meetingDate: '2026-10-14',
  meetingMinutesStatus: MEETING_MINUTES_STATUS.CONFIRMED,
  transcript: '원본 전사는 싣지 않는다',
  transcriptSegments: [],
  speakers: [],
  summary: '견적서와 방문 일정을 정했어요.\n다음 주에 다시 봅니다.',
  analysisResult: {
    summary: '견적서와 방문 일정을 정했어요.',
    decisions: [{ text: '견적은 톤당\n80만 원', evidence: [] }],
    candidates: [
      candidate({ key: 'c1', assigneeId: 7, assigneeName: '박 대리', dueDate: '2026-10-20' }),
      candidate({ key: 'c2', kind: 'EVENT', title: '동해철강 방문', startAt: '2026-10-21T14:00:00+09:00', endAt: '2026-10-21T15:00:00+09:00', attendeeIds: [7, 99] }),
      candidate({
        key: 'c3',
        kind: 'PURCHASE',
        title: '철광석 보충',
        itemName: '철광석',
        purchase: { itemId: 1, requestedTon: '120.000', desiredReceiptDate: '2026-10-30', requestReason: null, sourceText: null },
      }),
      candidate({ key: 'c4', title: '제외한 할 일', decision: 'EXCLUDED' }),
    ],
    model: 'm',
    analyzedAt: '2026-10-14T05:00:00.000Z',
  },
  analysisProgress: null,
  transcriptionProgress: null,
  failureReason: null,
  creator: { id: 7, name: '박서영' },
  attendees: [
    { employeeId: 7, employeeName: '박서영', departmentName: '영업부', roleCode: ROLE.SALES },
    { employeeId: 8, employeeName: '정다은', departmentName: '구매부', roleCode: ROLE.PURCHASE },
  ],
  confirmedAt: '2026-10-15T05:03:00.000Z',
  notionPageUrl: null,
  notionExportedAt: null,
  createdAt: '2026-10-14T00:00:00.000Z',
  updatedAt: '2026-10-15T05:03:00.000Z',
  ...over,
});

describe('buildMeetingNotionMarkdown', () => {
  it('머리 정보·요약·결정사항·허가한 후보를 섹션으로 싣는다', () => {
    expect(buildMeetingNotionMarkdown(meeting())).toBe(
      [
        '**회의일** 2026-10-14',
        '**참석자** 박서영(영업부), 정다은(구매부)',
        '**작성자** 박서영 · **확정** 2026-10-15 14:03',
        '',
        '## 요약',
        '견적서와 방문 일정을 정했어요.\n다음 주에 다시 봅니다.',
        '',
        '## 결정사항',
        '- 견적은 톤당 80만 원',
        '',
        '## 할 일',
        '- [ ] 견적서 발송 — 담당 박서영 · 마감 2026-10-20',
        '',
        '## 일정',
        '- 동해철강 방문 — 2026-10-21 14:00~15:00 · 참석 박서영 외 1명',
        '',
        '## 구매요청 초안',
        '- 철광석 보충 — 철광석 · 120.000톤 · 희망 입고 2026-10-30',
        '',
        '---',
        'FantaSteel ERP 회의록 #12에서 내보냈어요.',
      ].join('\n'),
    );
  });

  it('제외한 후보와 원본 전사는 싣지 않는다', () => {
    const md = buildMeetingNotionMarkdown(meeting());
    expect(md).not.toContain('제외한 할 일');
    expect(md).not.toContain('원본 전사');
  });

  it('분석 결과·요약이 없으면 머리 정보와 빈 요약 안내만', () => {
    const md = buildMeetingNotionMarkdown(meeting({ analysisResult: null, summary: null }));
    expect(md).toContain('## 요약\n요약이 없어요.');
    expect(md).not.toContain('## 결정사항');
    expect(md).not.toContain('## 할 일');
  });

  it('담당자가 참석자가 아니면 말한 이름을 쓴다', () => {
    const view = meeting();
    view.analysisResult!.candidates = [candidate({ assigneeId: 50, assigneeName: '김 과장', dueDate: null })];
    expect(buildMeetingNotionMarkdown(view)).toContain('- [ ] 견적서 발송 — 담당 김 과장');
  });
});

describe('meetingNotionTitle', () => {
  it('줄바꿈을 지우고 길면 자른다', () => {
    expect(meetingNotionTitle(meeting({ meetingMinutesTitle: ' 주간\n회의 ' }))).toBe('주간 회의');
    expect(meetingNotionTitle(meeting({ meetingMinutesTitle: '가'.repeat(300) }))).toHaveLength(200);
    expect(meetingNotionTitle(meeting({ meetingMinutesTitle: '  ' }))).toBe('2026-10-14 회의');
  });
});

describe('escapeNotionText', () => {
  it('Notion 태그·링크·백슬래시를 글자로 막는다', () => {
    expect(escapeNotionText('<mention-user url="user://1"/> 님 [링크](https://x) a\\b')).toBe('\\<mention-user url="user://1"/\\> 님 \\[링크\\](https://x) a\\\\b');
    expect(escapeNotionText('<page url="https://www.notion.so/abc">비밀</page>')).toBe('\\<page url="https://www.notion.so/abc"\\>비밀\\</page\\>');
    expect(escapeNotionText('<callout>주의</callout>')).not.toMatch(/(^|[^\\])</);
  });

  it('줄 맨 앞 블록 표시(제목·인용·목록·구분선·코드·표·수식)를 막는다', () => {
    expect(escapeNotionText('# 제목\n> 인용\n- 목록\n* 별\n+ 더하기\n---\n```js\n| a | b |\n$$x$$\n1. 첫째\n2) 둘째')).toBe(
      ['\\# 제목', '\\> 인용', '\\- 목록', '\\* 별', '\\+ 더하기', '\\---', '\\```js', '\\| a | b |', '\\$$x$$', '1\\. 첫째', '2\\) 둘째'].join('\n'),
    );
  });

  it('줄 앞 공백(하위 블록)을 지우고, 보통 글·줄 중간 표시는 그대로 둔다', () => {
    expect(escapeNotionText('    - 들여쓴 목록\n\t코드')).toBe('\\- 들여쓴 목록\n코드');
    expect(escapeNotionText('철광석 120톤 - 다음 주 #3 라인 1.5배')).toBe('철광석 120톤 - 다음 주 #3 라인 1.5배');
    expect(escapeNotionText('#해시태그 2026.10')).toBe('#해시태그 2026.10');
  });

  it('회의록 칸(요약·제목·결정사항·이름)이 모두 막힌다', () => {
    const view = meeting({
      summary: '# 가짜 제목\n<mention-user url="user://9"/>',
      attendees: [{ employeeId: 7, employeeName: '<b>박</b>', departmentName: '영업부', roleCode: ROLE.SALES }],
    });
    view.analysisResult!.decisions = [{ text: '> 인용처럼', evidence: [] }];
    view.analysisResult!.candidates = [candidate({ title: '<page url="x">', assigneeId: 7, dueDate: '2026-10-20' })];
    const md = buildMeetingNotionMarkdown(view);
    expect(md).toContain('## 요약\n\\# 가짜 제목\n\\<mention-user url="user://9"/\\>');
    expect(md).toContain('**참석자** \\<b\\>박\\</b\\>(영업부)');
    expect(md).toContain('- \\> 인용처럼');
    expect(md).toContain('- [ ] \\<page url="x"\\> — 담당 \\<b\\>박\\</b\\>');
    expect(md).not.toMatch(/(^|[^\\])<(mention|page|b)/m);
  });
});
