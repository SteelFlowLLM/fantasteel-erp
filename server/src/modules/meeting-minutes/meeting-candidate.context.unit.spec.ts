// 후보 옆 ERP 현황의 순수 판단·문구 (DB 없음).
import {
  candidateDate,
  eventOverlapContext,
  incomingTonOf,
  purchaseContext,
  salesOrderContext,
  seoulClock,
  shortDate,
  weekStartOf,
  withoutContextIssues,
  workloadContext,
  type SalesOrderContextInput,
} from './meeting-candidate.context';

const order: SalesOrderContextInput = {
  customerName: '동해철강',
  items: [
    { itemName: '슬래브 A', orderedQty: 10, shippedQty: 4, dueDate: '2026-10-30', open: true },
    { itemName: '코일 B', orderedQty: 5, shippedQty: 5, dueDate: '2026-10-20', open: false },
    { itemName: '코일 C', orderedQty: 6, shippedQty: 0, dueDate: '2026-10-25', open: true },
  ],
};

describe('날짜 도우미', () => {
  it('M/D 문구, 주 시작(월요일), 후보 날짜', () => {
    expect(shortDate('2026-10-05')).toBe('10/5');
    expect(weekStartOf('2026-10-18')).toBe('2026-10-12'); // 일요일은 그 주의 마지막 날
    expect(weekStartOf('2026-10-19')).toBe('2026-10-19');
    expect(candidateDate({ kind: 'TASK', dueDate: '2026-10-22', startAt: null })).toBe('2026-10-22');
    expect(candidateDate({ kind: 'EVENT', dueDate: null, startAt: '2026-10-20T14:00:00+09:00' })).toBe('2026-10-20');
    expect(candidateDate({ kind: 'PURCHASE', dueDate: null, startAt: null })).toBeNull();
  });

  it('서울 시각 HH:mm', () => {
    expect(seoulClock(new Date('2026-10-20T05:30:00.000Z'))).toBe('14:30');
  });
});

describe('salesOrderContext', () => {
  it('고객사·열린 품목 납기(빠른 순)·출하/수주 매수를 보인다', () => {
    const r = salesOrderContext(order, null);
    expect(r.lines).toEqual([
      { label: '수주 고객사', value: '동해철강', tone: 'info' },
      { label: '수주 납기', value: '코일 C 10/25, 슬래브 A 10/30', tone: 'info' },
      { label: '수주 진행', value: '출하 9매 / 수주 21매', tone: 'info' },
    ]);
    expect(r.issues).toEqual([]);
  });

  it('가장 빠른 열린 납기보다 늦은 날짜면 경고와 확인 사유, 같은 날은 괜찮다', () => {
    const late = salesOrderContext(order, '2026-10-26');
    expect(late.lines[1].tone).toBe('warn');
    expect(late.issues).toEqual(['수주 납기(10/25)보다 늦어요']);
    expect(salesOrderContext(order, '2026-10-25').issues).toEqual([]);
    expect(salesOrderContext(order, '2026-10-24').lines[1].tone).toBe('info');
  });

  it('열린 품목이 없으면 납기 줄이 없고 경고도 없다', () => {
    const done = salesOrderContext({ customerName: 'X', items: [{ itemName: 'a', orderedQty: 1, shippedQty: 1, dueDate: '2026-10-01', open: false }] }, '2026-12-01');
    expect(done.lines.map((l) => l.label)).toEqual(['수주 고객사', '수주 진행']);
    expect(done.issues).toEqual([]);
  });

  it('품목이 많으면 세 개까지만 보이고 나머지는 건수로', () => {
    const many = { customerName: 'X', items: [1, 2, 3, 4, 5].map((n) => ({ itemName: `품목${n}`, orderedQty: 1, shippedQty: 0, dueDate: `2026-11-0${n}`, open: true })) };
    expect(salesOrderContext(many, null).lines[1].value).toBe('품목1 11/1, 품목2 11/2, 품목3 11/3 외 2건');
  });
});

describe('purchaseContext · incomingTonOf', () => {
  it('재고·입고 예정 줄과 지난 희망 입고일 경고', () => {
    const r = purchaseContext({ stock: { onHandTon: '12.500', incomingTon: '30.000' }, desiredReceiptDate: '2026-10-10', today: '2026-10-15' });
    expect(r.lines).toEqual([
      { label: '현재 재고', value: '12.500 톤', tone: 'info' },
      { label: '입고 예정', value: '30.000 톤', tone: 'info' },
      { label: '희망 입고일', value: '2026-10-10는 이미 지난 날짜예요', tone: 'warn' },
    ]);
  });

  it('오늘 날짜는 지난 날짜가 아니고, 품목을 모르면 재고 줄이 없다', () => {
    expect(purchaseContext({ stock: null, desiredReceiptDate: '2026-10-15', today: '2026-10-15' }).lines).toEqual([]);
  });

  it('입고 예정 = 발주 톤 − 입고 톤, 행마다 0 아래로 내려가지 않는다', () => {
    expect(
      incomingTonOf([
        { orderedTon: '20.000', receivedTons: ['5.500', '4.250'] },
        { orderedTon: '10.000', receivedTons: [] },
        { orderedTon: '3.000', receivedTons: ['3.500'] },
      ]),
    ).toBe('20.250');
    expect(incomingTonOf([])).toBe('0.000');
  });
});

describe('workloadContext', () => {
  it('같은 주 마감이 3건 이상이면 경고', () => {
    const open = ['2026-10-19', '2026-10-21', '2026-10-25', '2026-10-26', '2026-11-02'];
    const r = workloadContext(open, '2026-10-22');
    expect(r.lines).toEqual([{ label: '담당자 업무', value: '진행 중 5건 (그중 같은 주 마감 3건)', tone: 'warn' }]);
    expect(r.issues).toEqual(['이번 주 업무가 많아요']);
  });

  it('2건까지는 정보, 마감일을 모르면 같은 주 수를 세지 않는다', () => {
    expect(workloadContext(['2026-10-21', '2026-10-22'], '2026-10-23')).toMatchObject({ lines: [{ tone: 'info', value: '진행 중 2건 (그중 같은 주 마감 2건)' }], issues: [] });
    expect(workloadContext(['2026-10-21'], null).lines[0]).toMatchObject({ value: '진행 중 1건', tone: 'info' });
  });
});

describe('eventOverlapContext', () => {
  const at = (hhmm: string) => new Date(`2026-10-20T${hhmm}:00+09:00`);

  it('겹치는 일정이 없으면 겹치지 않는다는 한 줄', () => {
    expect(eventOverlapContext([])).toEqual({ lines: [{ label: '일정 겹침', value: '참석자의 같은 시간대 일정이 없어요', tone: 'info' }], issues: [] });
  });

  it('사람마다 첫 겹침만 경고하고 확인 사유에 이름과 시작 시각을 담는다', () => {
    const r = eventOverlapContext([
      { employeeName: '최준혁', title: '품질 회의', startAt: at('14:30'), endAt: at('15:30') },
      { employeeName: '최준혁', title: '또 다른 회의', startAt: at('14:45'), endAt: at('15:00') },
      { employeeName: '박서영', title: '고객 방문', startAt: at('13:00'), endAt: at('14:30') },
    ]);
    expect(r.issues).toEqual(['최준혁 일정과 겹쳐요 (14:30)', '박서영 일정과 겹쳐요 (13:00)']);
    expect(r.lines).toEqual([
      { label: '일정 겹침', value: '최준혁 · 14:30~15:30 품질 회의', tone: 'warn' },
      { label: '일정 겹침', value: '박서영 · 13:00~14:30 고객 방문', tone: 'warn' },
    ]);
  });
});

describe('withoutContextIssues', () => {
  it('현황이 붙인 확인 사유만 지운다', () => {
    expect(withoutContextIssues(['마감일을 확인해 주세요', '수주 납기(10/25)보다 늦어요', '이번 주 업무가 많아요', '최준혁 일정과 겹쳐요 (14:30)', '2차 검토: 담당자가 달라요'])).toEqual([
      '마감일을 확인해 주세요',
      '2차 검토: 담당자가 달라요',
    ]);
  });
});
