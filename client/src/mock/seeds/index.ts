// 거래·협업 시드 등록부. createSeedTables(mock/seed.ts)가 조직·기준정보 시드를 만든 뒤 아래 순서대로 실행한다.
// - 영역마다 `mock/seeds/<영역>.ts`에 `seed<영역>(tx: MockTx): void`를 만들고 여기에 한 줄로 등록한다.
// - 순서가 중요하다: 거래 시드(core)가 먼저 수주·LOT·검사 등을 만들고, 그 뒤 영역 시드가 그것을 참조한다.
// - 시드 안에서 날짜를 바꿀 때는 seedTxAt(tx, '2026-09-15T09:00:00+09:00')처럼 같은 테이블을 쓰는 다른 시각의 tx를 만든다.
// - 시드는 매번 같은 결과가 나와야 한다(고정 날짜·고정 난수 시드).
import type { MockTx } from '@/mock/store';

export type AreaSeeder = (tx: MockTx) => void;

export interface AreaSeederEntry {
  key: string;
  run: AreaSeeder;
}

/** 같은 테이블 위에서 시각만 다른 tx (시드에서 여러 날짜의 기록을 만들 때) */
export function seedTxAt(tx: MockTx, isoDateTime: string): MockTx {
  const now = new Date(isoDateTime);
  return { tables: tx.tables, now, nowIso: now.toISOString() };
}

export const AREA_SEEDERS: readonly AreaSeederEntry[] = [
  // ── 거래 시드 (core-domain이 등록) ──
  // ── 영역 시드 (병합 단계에서 등록) ──
];

export function runAreaSeeders(tx: MockTx): void {
  for (const seeder of AREA_SEEDERS) seeder.run(tx);
}
