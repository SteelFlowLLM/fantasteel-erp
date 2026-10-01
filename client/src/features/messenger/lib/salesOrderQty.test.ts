import { describe, expect, it } from 'vitest';
import { formatItemQty } from '@/features/messenger/lib/salesOrderQty';

describe('업무방 수주 매수 문구 (04 4.1 슬래브 매, 코일 개)', () => {
  it('슬래브는 매', () => {
    expect(formatItemQty({ itemType: 'SLAB', orderedQty: 12, shippedQty: 4 })).toEqual({ ordered: '12매', shipped: '4매' });
  });

  it('코일은 개', () => {
    expect(formatItemQty({ itemType: 'COIL', orderedQty: 6, shippedQty: 0 })).toEqual({ ordered: '6개', shipped: '0개' });
  });

  it('천 단위 쉼표', () => {
    expect(formatItemQty({ itemType: 'SLAB', orderedQty: 1200, shippedQty: 1000 }).ordered).toBe('1,200매');
  });
});
