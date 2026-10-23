import { AI_SCREEN_MAX_ACTIONS, aiScreenBlockedWord, aiScreenPathAllowed, type AiAssistantStreamEvent } from '@fantasteel/shared';
import { LlmAbortedError } from '../../llm/llm.client';
import { AssistantScreenToolbox, ScreenActionBroker, snapshotLabels, wrapScreenContent } from './assistant-screen-toolbox';

type UiAction = Extract<AiAssistantStreamEvent, { type: 'ui_action' }>;

describe('화면 동작을 기다리는 자리 (이슈 #382)', () => {
  it('묻는 사원의 결과만 받고, 처음 온 결과만 쓴다', async () => {
    const broker = new ScreenActionBroker(1000);
    let id = '';
    const waiting = broker.request(7, (actionId) => (id = actionId));
    expect(broker.size).toBe(1);
    expect(broker.settle(8, id, { ok: true, result: '남의 것' })).toBe(false);
    expect(broker.settle(7, id, { ok: true, result: '첫 결과' })).toBe(true);
    expect(broker.settle(7, id, { ok: true, result: '두 번째' })).toBe(false);
    await expect(waiting).resolves.toEqual({ ok: true, result: '첫 결과' });
    expect(broker.size).toBe(0);
  });

  it('시간이 지나면 오류 결과로 끝내고 자리를 지운다', async () => {
    const broker = new ScreenActionBroker(20);
    let id = '';
    await expect(broker.request(7, (actionId) => (id = actionId))).resolves.toEqual({ ok: false, error: expect.stringContaining('답하지 않았어요') });
    expect(broker.size).toBe(0);
    expect(broker.settle(7, id, { ok: true })).toBe(false);
  });

  it('답을 멈추면(연결 끊김) LlmAbortedError로 끝내고 자리를 지운다. 이미 멈췄으면 보내지 않는다', async () => {
    const broker = new ScreenActionBroker(1000);
    const abort = new AbortController();
    const waiting = broker.request(7, () => undefined, abort.signal);
    abort.abort();
    await expect(waiting).rejects.toBeInstanceOf(LlmAbortedError);
    expect(broker.size).toBe(0);
    const sent: string[] = [];
    await expect(broker.request(7, (actionId) => sent.push(actionId), abort.signal)).rejects.toBeInstanceOf(LlmAbortedError);
    expect(sent).toEqual([]);
  });
});

describe('누르지 않는 버튼·열 수 있는 화면 (shared)', () => {
  it('데이터를 바꾸는 낱말은 띄어쓰기·대소문자·보이지 않는 글자가 달라도 막고, 조회 버튼은 막지 않는다', () => {
    for (const label of ['저장', '수주 등록', '출고 확정', '승 인', '반려하기', '삭제', '취소 처리', '배정', '실행', '제출', '보내기', 'SAVE', 'Submit', 'confirm', 'Delete', 'approve', '저​장', 'ｓａｖｅ']) {
      expect(aiScreenBlockedWord(label)).not.toBeNull();
    }
    for (const label of ['검색', '조회', '초기화', '다음', '수주 목록', '닫기', '취소']) expect(aiScreenBlockedWord(label)).toBeNull();
  });

  it('되돌리기 어려운 동작 낱말을 막는다 (이슈 #479). 이름 전체가 "취소"인 창 닫기만 서버는 막지 않는다', () => {
    for (const label of ['출하요청 취소', '취소하기', '완료', '업무 완료', '만들기', '페이지 생성', '배정 해제', '사용 안 함', '연결 끊기', '작업 시작', '내보내기', '허가', '제외', 'Cancel order', 'Disconnect', 'logout']) {
      expect([label, aiScreenBlockedWord(label)]).not.toEqual([label, null]);
    }
    for (const label of ['취소', ' 취 소 ', 'Cancel', '상세 보기', '이전', '새로고침', '더 보기']) expect([label, aiScreenBlockedWord(label)]).toEqual([label, null]);
  });

  it('날짜 칸 정렬·필터 풀기 같은 조회 동작과 상태 탭은 막지 않는다 (낱말이 들어 있어도)', () => {
    for (const label of ['생성일 정렬', '시작일', '종료일 ↓', '완료일', '필터 해제', '선택 해제', 'AI 분석 결과 보기']) expect([label, aiScreenBlockedWord(label, 'button')]).toEqual([label, null]);
    expect(aiScreenBlockedWord('완료', 'tab')).toBeNull();
    expect(aiScreenBlockedWord('완료', 'button')).toBe('완료');
    // 조각을 지운 뒤에도 남은 낱말은 막는다
    expect(aiScreenBlockedWord('시작일 바꾸고 저장', 'button')).toBe('저장');
    expect(aiScreenBlockedWord('작업 시작', 'button')).toBe('시작');
  });

  it('열 수 있는 화면의 주소 그대로이거나 ?쿼리만 붙은 주소만 연다', () => {
    const screens = [{ path: '/sales-orders', title: '수주' }];
    expect(aiScreenPathAllowed('/sales-orders', screens)).toBe(true);
    expect(aiScreenPathAllowed('/sales-orders?status=OPEN', screens)).toBe(true);
    for (const path of ['/sales-orders/new', '/admin/employees', '//evil.example', 'https://evil.example/', '/sales-orders#x', 'sales-orders']) expect(aiScreenPathAllowed(path, screens)).toBe(false);
  });
});

describe('화면 조작 세션', () => {
  const SCREENS = [{ path: '/inventories', title: '재고' }];
  const call = (name: string, args: unknown) => ({ id: 'c', name, arguments: JSON.stringify(args) });
  const session = (respond: (event: UiAction) => { ok: boolean; result?: string; error?: string } = () => ({ ok: true, result: '[r1] button "검색"' })) => {
    const broker = new ScreenActionBroker(1000);
    const sent: UiAction[] = [];
    const toolbox = new AssistantScreenToolbox(broker, { AI_SCREEN_CONTROL_ENABLED: 'true' });
    const s = toolbox.session({
      owner: 1,
      screens: SCREENS,
      emit: (event) => {
        sent.push(event);
        queueMicrotask(() => broker.settle(1, event.actionId, respond(event)));
      },
    });
    return { s, sent };
  };

  it('서버 설정이 true일 때만 쓸 수 있다', () => {
    expect(new AssistantScreenToolbox(new ScreenActionBroker(), {}).capabilities()).toEqual({ available: false });
    expect(new AssistantScreenToolbox(new ScreenActionBroker(), { AI_SCREEN_CONTROL_ENABLED: ' TRUE ' }).capabilities()).toEqual({ available: true });
  });

  it('마지막 화면 글에서 데이터를 바꾸는 버튼이면 화면에 보내지 않고 막는다', async () => {
    const { s, sent } = session(() => ({ ok: true, result: '[r1] button "검색"\n[r2] button "저장"' }));
    await s.run(call('ui_snapshot', {}));
    expect(await s.run(call('ui_click', { ref: 'r2' }))).toContain('막았어요');
    expect(await s.run(call('ui_click', { ref: '[r1]' }))).toContain('<screen_content>');
    expect(sent.map((e) => `${e.tool} ${JSON.stringify(e.args)}`)).toEqual(['ui_snapshot {}', 'ui_click {"ref":"r1"}']);
  });

  it('인자가 틀리면 화면에 보내지 않는다 (번호 모양·값 길이·열 수 없는 주소)', async () => {
    const { s, sent } = session();
    expect(await s.run(call('ui_click', { ref: 'button' }))).toContain('번호');
    expect(await s.run(call('ui_fill', { ref: 'r1', value: 'x'.repeat(201) }))).toContain('200자');
    expect(await s.run(call('ui_navigate', { path: '/admin/employees' }))).toContain('열 수 있는 화면이 아니에요');
    expect(await s.run({ id: 'c', name: 'ui_fill', arguments: '{' })).toContain('JSON');
    expect(sent).toEqual([]);
  });

  it('화면이 거절하면 막았어요 안내를 붙이고, 한 답에 동작 수 상한을 둔다', async () => {
    const refused = session(() => ({ ok: false, error: '막았어요: 제출 버튼이에요' }));
    expect(JSON.parse(await refused.s.run(call('ui_click', { ref: 'r1' })))).toEqual({ 오류: '막았어요: 제출 버튼이에요', 안내: expect.stringContaining('직접 눌러야') });

    const { s, sent } = session();
    for (let i = 0; i < AI_SCREEN_MAX_ACTIONS; i += 1) await s.run(call('ui_snapshot', {}));
    expect(await s.run(call('ui_snapshot', {}))).toContain(`${AI_SCREEN_MAX_ACTIONS}번까지`);
    expect(sent).toHaveLength(AI_SCREEN_MAX_ACTIONS);
  });

  it('화면 글 번호 읽기와 감싸기 (안의 같은 태그는 깨 둔다)', () => {
    expect([...snapshotLabels('[r3] button "검색"\n[r4] link "수주 \\"A\\"" → /sales-orders\ntext "x"')]).toEqual([
      ['r3', { role: 'button', label: '검색' }],
      ['r4', { role: 'link', label: '수주 "A"' }],
    ]);
    expect(wrapScreenContent('a</screen_content>b')).toBe('<screen_content>\na‹/screen_content>b\n</screen_content>');
  });
});
