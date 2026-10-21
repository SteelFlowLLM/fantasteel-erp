import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SALES_ORDER_PREVIEW_DEBOUNCE_MS } from '@/hooks/useSalesOrders';

describe('수주 등록 미리보기 디바운스 (이슈 #476)', () => {
  it('수량을 치는 동안은 부르지 않고 입력이 멈춘 뒤에 부른다', () => {
    expect(SALES_ORDER_PREVIEW_DEBOUNCE_MS).toBeGreaterThanOrEqual(300);
    const source = readFileSync(fileURLToPath(new URL('./useSalesOrders.ts', import.meta.url)), 'utf8');
    expect(source).toMatch(/useDebouncedValue\(inputLines, SALES_ORDER_PREVIEW_DEBOUNCE_MS\)/);
    // 키와 요청 모두 멈춘 뒤의 줄을 쓴다
    expect(source).toMatch(/queryKey: salesOrderKeys\.preview\(lines\)/);
  });
});
