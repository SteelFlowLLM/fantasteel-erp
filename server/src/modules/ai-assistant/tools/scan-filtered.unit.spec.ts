// 거를 칸이 API에 없는 조회 도구가 100건 넘는 목록을 끝까지 읽어 세는지 (이슈 #479, DB 없음)
import { SCAN_MAX_PAGES, SCAN_PAGE_SIZE, scanFiltered, unscannedField } from './assistant-tool';

/** 1부터 total까지 번호가 붙은 행을 쪽으로 나눠 주는 가짜 목록 API */
const fakeList = (total: number) => {
  const reads: number[] = [];
  const read = async (page: number, size: number) => {
    reads.push(page);
    const from = (page - 1) * size;
    return { items: Array.from({ length: Math.max(0, Math.min(size, total - from)) }, (_, i) => from + i + 1), total };
  };
  return { read, reads };
};

describe('scanFiltered', () => {
  it('100건이 넘어도 다음 쪽을 읽어 맞는 행을 모두 센다', async () => {
    const list = fakeList(250);
    const scan = await scanFiltered(list.read, (n) => n % 10 === 0);
    expect(scan).toMatchObject({ total: 250, unscanned: 0 });
    expect(scan.rows).toHaveLength(25);
    expect(list.reads).toEqual([1, 2, 3]);
  });

  it(`${SCAN_MAX_PAGES}쪽(${SCAN_MAX_PAGES * SCAN_PAGE_SIZE}건)까지만 읽고 읽지 못한 수를 알린다`, async () => {
    const list = fakeList(1_234);
    const scan = await scanFiltered(list.read, (n) => n > 1_100);
    expect(scan.rows).toEqual([]);
    expect(scan.unscanned).toBe(234);
    expect(list.reads).toHaveLength(SCAN_MAX_PAGES);
    expect(unscannedField('출하요청', scan.unscanned)).toEqual({ '확인하지 못한 출하요청 수': 234 });
    expect(unscannedField('출하요청', 0)).toEqual({});
  });

  it('first면 찾는 즉시 멈춘다', async () => {
    const list = fakeList(900);
    const scan = await scanFiltered(list.read, (n) => n === 150, { first: true });
    expect(scan.rows).toEqual([150]);
    expect(list.reads).toEqual([1, 2]);
  });
});
