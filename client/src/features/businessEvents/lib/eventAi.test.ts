import { describe, expect, it } from 'vitest';
import { AI_VIA_LABEL, aiViaText } from '@/features/businessEvents/lib/eventAi';

describe('작업 로그 AI 경유 표시', () => {
  it('서버가 준 값대로 보인다 (준비 중 표시 없음)', () => {
    expect(aiViaText(true)).toContain('초안·카드·후보');
    expect(aiViaText(false)).toBe('아니오');
    expect(`${AI_VIA_LABEL}${aiViaText(true)}${aiViaText(false)}`).not.toContain('준비 중');
  });
});
