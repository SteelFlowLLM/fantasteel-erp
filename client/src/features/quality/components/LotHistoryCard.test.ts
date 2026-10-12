// 이력 카드의 측정값 줄: 처음 넣은 값은 값만, 고친 값은 이전 → 이후 (서버 렌더 결과를 읽어 확인)
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TimelineEvent } from '@/api/businessEvents';
import { dispositionApi } from '@/api/dispositions';
import { LotHistoryCard } from '@/features/quality/components/LotHistoryCard';
import { actAs, SEED_EMPLOYEE_NO } from '@/test/actors';

const render = (events: readonly TimelineEvent[], itemNames: Readonly<Record<string, string>>) =>
  renderToString(createElement(LotHistoryCard, { lotId: 1, events, itemNames }));

describe('이력 카드 측정값 줄', () => {
  it('처음 등록한 측정값은 "— →" 없이 값만 보인다', async () => {
    actAs(SEED_EMPLOYEE_NO.quality);
    const rows = await dispositionApi.list();
    const heat = rows.find((r) => r.lotType === 'HEAT' && r.reason === 'FAILED');
    if (!heat) throw new Error('검사 불합격 히트가 시드에 없어요');
    const detail = await dispositionApi.detail(heat.lotId);
    if (!detail) throw new Error('불합격 히트 상세가 없어요');
    const registered = detail.history.filter((e) => e.businessEventType === 'INSPECTION_REGISTERED');
    expect(registered.length).toBeGreaterThan(0);

    const html = render(registered, detail.inspectionItemNames);
    expect(html).not.toContain('— →');
    // 불합격 항목(측정값)은 이름과 값이 한 덩어리로 보인다
    const failed = heat.failedItems[0];
    if (failed) expect(html).toContain(`${failed.inspectionItemName} ${Number(failed.measuredValue)}`);
  });

  it('값을 고친 기록은 이전 → 이후로 보인다', () => {
    const event = {
      id: 1,
      eventNo: 'EV-261012-001',
      businessEventType: 'INSPECTION_REGISTERED',
      occurredAt: '2026-10-12T01:00:00.000Z',
      beforeData: { inspectionResult: 'PASS', values: [{ inspectionItemCode: 'P', measuredValue: '0.030' }] },
      afterData: { inspectionResult: 'FAIL', values: [{ inspectionItemCode: 'P', measuredValue: '0.058' }] },
    } as unknown as TimelineEvent;
    const html = render([event], { P: '인(P)' });
    expect(html).toContain('인(P) 0.03 → 0.058');
  });
});
