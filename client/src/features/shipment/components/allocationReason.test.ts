// 배정 변경·해제 사유 입력칸의 상한은 서버와 같은 shared 상수다 (이슈 #476)
import { ALLOCATION_REASON_MAX } from '@fantasteel/shared';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('배정 사유 길이', () => {
  it('화면 상한은 서버와 같은 200자이고 따로 500을 두지 않는다', () => {
    expect(ALLOCATION_REASON_MAX).toBe(200);
    const source = readFileSync(fileURLToPath(new URL('./AllocationLineCard.tsx', import.meta.url)), 'utf8');
    expect(source).toContain('const REASON_MAX = ALLOCATION_REASON_MAX;');
    expect(source).not.toMatch(/REASON_MAX\s*=\s*500/);
  });
});
