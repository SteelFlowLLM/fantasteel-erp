// 거래·협업 시드 등록부. createSeedTables(mock/seed.ts)가 조직·기준정보 시드를 만든 뒤 아래 순서대로 실행한다.
// - 영역마다 `mock/seeds/<영역>.ts`에 `seed<영역>(tx: MockTx): void`를 만들고 여기에 한 줄로 등록한다.
// - 순서가 중요하다: 거래 시드(core)가 먼저 수주·LOT·검사 등을 만들고, 그 뒤 영역 시드가 그것을 참조한다.
// - 시드 안에서 날짜를 바꿀 때는 seedTxAt(tx, '2026-09-15T09:00:00+09:00')처럼 같은 테이블을 쓰는 다른 시각의 tx를 만든다.
// - 시드는 매번 같은 결과가 나와야 한다(고정 날짜·고정 난수 시드).
import type { MockTx } from '@/mock/store';
import { seedCollab } from '@/mock/seeds/collab';
import { seedCore } from '@/mock/seeds/core';
import { seedDashboard } from '@/mock/seeds/dashboard';
import { seedInspectionStandards } from '@/mock/seeds/inspectionStandards';

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
  // 검사 기준(품질 기준정보)은 거래 시드가 검사 판정에 쓰므로 먼저 넣는다.
  { key: 'inspectionStandards', run: seedInspectionStandards },
  { key: 'core', run: seedCore },
  // ── 영역 시드 (core가 만든 수주·업무방·LOT을 참조하므로 그 뒤에 실행) ──
  { key: 'collab', run: seedCollab },
  { key: 'dashboard', run: seedDashboard },
];

/** include로 일부 영역 시드만 돌릴 수 있다(테스트: 조직·기준정보만 있는 상태, 특정 시드를 뺀 상태) */
export function runAreaSeeders(tx: MockTx, include: (key: string) => boolean = () => true): void {
  for (const seeder of AREA_SEEDERS) if (include(seeder.key)) seeder.run(tx);
}
