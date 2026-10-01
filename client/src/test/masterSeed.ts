// 테스트용: 거래·협업 시드 없이 조직·기준정보 시드만 있는 상태로 바꾼다.
// 협업(업무·알림·메신저) api 시험과 LOT 추적 고정 데이터는 빈 거래 상태를 전제로 쓰였다.
// 병합 뒤 setup.ts가 모든 영역 시드를 넣으므로, 그 전제가 필요한 시험만 이것을 부른다.
import { getMockDb } from '@/mock/db';
import { createSeedTables } from '@/mock/seed';

export function resetToMasterSeed(): void {
  const master = createSeedTables({ areaSeeders: () => false });
  getMockDb().transact((tx) => {
    Object.assign(tx.tables, master);
  });
}
