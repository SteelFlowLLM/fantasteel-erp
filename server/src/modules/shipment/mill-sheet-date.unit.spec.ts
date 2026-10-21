// 밀시트 히트 생산일은 제강 완료 시각을 서울 날짜로 바꾼 값이다 (#478). DB 없이 확인한다.
import { toSnapshotLotInput } from './shipment.mapper';
import type { SnapshotLotRow } from './shipment.repository';

const heat = (completedAt: string) => ({ id: 1, lotNo: 'HT-BOF1-261022-01', lotType: 'HEAT', steelGrade: { steelGradeCode: 'SS275' }, productionResult: { completedAt: new Date(completedAt), converterCode: 'BOF1' }, inspection: null, parents: [] });
const slab = (completedAt: string) =>
  ({ id: 2, lotNo: 'SL-01', lotType: 'SLAB', producedDate: new Date('2026-10-22T00:00:00.000Z'), inspection: null, parents: [heat(completedAt)] }) as unknown as SnapshotLotRow;

describe('밀시트 히트 생산일 (#478)', () => {
  it('한국 0~9시에 끝난 히트도 그 날짜로 (UTC로 자르면 전날)', () => {
    // 2026-10-22 05:00 서울 = 2026-10-21 20:00 UTC
    expect(toSnapshotLotInput(slab('2026-10-21T20:00:00.000Z')).heat?.producedDate?.toISOString().slice(0, 10)).toBe('2026-10-22');
    expect(toSnapshotLotInput(slab('2026-10-22T14:59:00.000Z')).heat?.producedDate?.toISOString().slice(0, 10)).toBe('2026-10-22');
    expect(toSnapshotLotInput(slab('2026-10-22T15:00:00.000Z')).heat?.producedDate?.toISOString().slice(0, 10)).toBe('2026-10-23');
  });
});
