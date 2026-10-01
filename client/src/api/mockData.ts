// 가짜 데이터 관리 (SPEC 1장): 불러오기·탭 동기화·"시드로 초기화". 실제 API로 바꾸면 없어지는 부분이다.
import { MOCK_LATENCY_MS } from '@/api/client';
import { getMockDb, resetToSeed as resetMockDbToSeed } from '@/mock/db';
import type { MockDbChangeSource } from '@/mock/store';

export const mockDataApi = {
  /**
   * 가짜 DB를 불러오고(없으면 시드로 만들고) 변경 알림을 받는다.
   * local = 이 탭의 변경, external = 다른 탭의 변경, reset = 시드로 초기화. 반환값은 구독 해제 함수.
   */
  start: (onChange: (source: MockDbChangeSource) => void): (() => void) => {
    const db = getMockDb();
    db.load();
    return db.subscribe((change) => onChange(change.source));
  },

  /** 이 브라우저의 가짜 데이터를 시드 상태로 되돌린다. 다른 탭에도 바로 반영된다. */
  resetToSeed: async (): Promise<void> => {
    await new Promise<void>((resolve) => setTimeout(resolve, MOCK_LATENCY_MS));
    resetMockDbToSeed();
  },
};
