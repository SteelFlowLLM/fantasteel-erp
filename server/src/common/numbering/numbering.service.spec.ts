// NumberingService의 잠금·채번 순서를 DB 없이 확인한다. 저장소는 부른 순서만 적는 가짜로 둔다.
import type { Tx } from '../../prisma/prisma.service';
import type { NumberingRepository } from './numbering.repository';
import { NumberingService } from './numbering.service';

// 2026-10-22 03:00 서울 = 2026-10-21 18:00 UTC (작업 로그 번호는 서울 날짜)
const at = new Date('2026-10-21T18:00:00.000Z');
const tx = {} as Tx;

function fakeRepository(lastNo: string | null) {
  const calls: string[] = [];
  const repository = {
    lockPrefix: async (_tx: Tx, prefix: string) => {
      calls.push(`lock ${prefix}`);
    },
    findLastDocumentNumber: async (_tx: Tx, kind: string, prefix: string) => {
      calls.push(`last ${kind} ${prefix}`);
      return lastNo;
    },
  } as unknown as NumberingRepository;
  return { calls, service: new NumberingService(repository) };
}

describe('NumberingService.lockDocumentNumber', () => {
  it('그 날짜 앞부분 잠금만 잡고 번호는 읽지 않는다', async () => {
    const { calls, service } = fakeRepository('EV-261022-007');

    await service.lockDocumentNumber(tx, 'BUSINESS_EVENT', at);
    expect(calls).toEqual(['lock EV-261022-']);
  });

  it('먼저 잠가도 뒤의 채번은 같은 앞부분을 다시 잠그고 빈 번호 없이 다음 번호를 받는다', async () => {
    const { calls, service } = fakeRepository('EV-261022-007');

    await service.lockDocumentNumber(tx, 'BUSINESS_EVENT', at);
    expect(await service.nextDocumentNumber(tx, 'BUSINESS_EVENT', at)).toBe('EV-261022-008');
    expect(calls).toEqual(['lock EV-261022-', 'lock EV-261022-', 'last BUSINESS_EVENT EV-261022-']);
  });

  it('월 단위 번호는 월 앞부분을 잠근다', async () => {
    const { calls, service } = fakeRepository(null);

    await service.lockDocumentNumber(tx, 'GOODS_RECEIPT', at);
    expect(calls).toEqual(['lock GR-2610-']);
  });
});
