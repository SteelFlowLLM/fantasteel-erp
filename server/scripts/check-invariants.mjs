// 업무 불변식 점검: 재고 수량·LOT 잔량·생산 실적·예약이 서로 맞는지 SELECT로만 확인한다 (DB를 바꾸지 않는다).
// 고아 데이터는 check-orphans가 본다. 위반이 있으면 항목마다 건수와 앞 5행을 보이고 종료 코드 1.
//   npm run check-invariants -w @fantasteel/server            ← DATABASE_URL (없으면 로컬 DB)
//   npm run check-invariants -w @fantasteel/server -- --all   ← 위반 행을 모두
import pg from 'pg';
import { databaseUrl, describeDatabase } from './db-target.mjs';

const showAll = process.argv.includes('--all');
const SAMPLE = 5;
const seoul = (column) => `to_char(${column} AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS')`;

// 적격 = 자기 검사 PASS + 상위 히트 PASS (슬래브는 부모 히트, 코일은 슬래브를 거친 히트). countEligibleAvailableLots.sql과 같은 조건
const eligible = (l) => `(
  EXISTS (SELECT 1 FROM quality_inspection q WHERE q.lot_id = ${l}.id AND q.inspection_result = 'PASS')
  AND EXISTS (
    SELECT 1 FROM lot_relation r
    JOIN lot h ON h.id = r.parent_lot_id AND h.lot_type = 'HEAT'
    JOIN quality_inspection hq ON hq.lot_id = h.id AND hq.inspection_result = 'PASS'
    WHERE r.child_lot_id = ${l}.id
       OR r.child_lot_id IN (SELECT r2.parent_lot_id FROM lot_relation r2 JOIN lot s ON s.id = r2.parent_lot_id AND s.lot_type = 'SLAB' WHERE r2.child_lot_id = ${l}.id)
  ))`;

const checks = [
  {
    name: '① 재고 on_hand = 적격·재고 상태 제품 LOT 수',
    basis: 'ERD Project Note',
    sql: `WITH counted AS (
            SELECT l.item_id, count(*)::int AS eligible_qty FROM lot l
            WHERE l.lot_type IN ('SLAB', 'COIL') AND l.lot_status = 'AVAILABLE' AND ${eligible('l')}
            GROUP BY l.item_id)
          SELECT i.item_code, coalesce(inv.on_hand_qty, 0) AS on_hand_qty, coalesce(c.eligible_qty, 0) AS eligible_qty
          FROM (SELECT item_id FROM inventory UNION SELECT item_id FROM counted) k
          JOIN item i ON i.id = k.item_id
          LEFT JOIN inventory inv ON inv.item_id = k.item_id
          LEFT JOIN counted c ON c.item_id = k.item_id
          WHERE coalesce(inv.on_hand_qty, 0) <> coalesce(c.eligible_qty, 0)
          ORDER BY i.item_code`,
  },
  {
    name: '② 재고 reserved = ACTIVE 예약 합계',
    basis: 'ERD Project Note',
    sql: `SELECT i.item_code, inv.reserved_qty, coalesce(r.active_qty, 0) AS active_reserved_qty
          FROM inventory inv JOIN item i ON i.id = inv.item_id
          LEFT JOIN (SELECT item_id, sum(reserved_qty)::int AS active_qty FROM reservation WHERE reservation_status = 'ACTIVE' GROUP BY item_id) r ON r.item_id = inv.item_id
          WHERE inv.reserved_qty <> coalesce(r.active_qty, 0)
          ORDER BY i.item_code`,
  },
  {
    name: '③ 재고 rolling = 열연 확정 배정 수',
    basis: 'ERD Project Note',
    sql: `SELECT i.item_code, inv.rolling_allocated_qty, coalesce(a.confirmed_qty, 0) AS confirmed_rolling_qty
          FROM inventory inv JOIN item i ON i.id = inv.item_id
          LEFT JOIN (
            SELECT l.item_id, count(*)::int AS confirmed_qty FROM allocation a JOIN lot l ON l.id = a.lot_id
            WHERE a.allocation_purpose = 'HOT_ROLLING' AND a.allocation_status = 'CONFIRMED' GROUP BY l.item_id
          ) a ON a.item_id = inv.item_id
          WHERE inv.rolling_allocated_qty <> coalesce(a.confirmed_qty, 0)
          ORDER BY i.item_code`,
  },
  {
    name: '④ 원료·용선 잔량은 0 ~ 초기량, 잔량 0이면 소진·남으면 재고 상태',
    basis: 'BP-PRD-02 예외(음수 잔량)',
    sql: `SELECT l.lot_no, l.lot_status, l.initial_ton, l.remaining_ton FROM lot l
          WHERE l.lot_type IN ('RAW_MATERIAL', 'HOT_METAL')
            AND (l.remaining_ton IS NULL OR l.remaining_ton < 0 OR l.remaining_ton > l.initial_ton
                 OR (l.remaining_ton = 0 AND l.lot_status <> 'CONSUMED') OR (l.remaining_ton > 0 AND l.lot_status <> 'AVAILABLE'))
          ORDER BY l.lot_no`,
  },
  {
    name: '⑤ 히트 톤 ≤ 히트 용량 (지금 설정값 기준)',
    basis: 'REQ-MST-009, BP-PRD-02',
    sql: `SELECT h.lot_no, h.initial_ton AS heat_ton, s.heat_capacity_ton
          FROM lot h CROSS JOIN (SELECT heat_capacity_ton FROM production_setting ORDER BY id LIMIT 1) s
          WHERE h.lot_type = 'HEAT' AND h.initial_ton > s.heat_capacity_ton
          ORDER BY h.lot_no`,
  },
  {
    name: '⑥ 히트당 슬래브 ≤ floor(히트 톤 × 연주 수율 ÷ 1매 이론중량) (지금 수율 기준)',
    basis: 'BP-PRD-02 예외(히트 생산량 초과 산출)',
    sql: `SELECT h.lot_no, h.initial_ton AS heat_ton, count(*)::int AS slab_qty,
                 floor(h.initial_ton * rt.planned_yield_rate / si.theoretical_weight_ton)::int AS max_slab_qty
          FROM lot h
          JOIN lot_relation r ON r.parent_lot_id = h.id
          JOIN lot s ON s.id = r.child_lot_id AND s.lot_type = 'SLAB'
          JOIN item si ON si.id = s.item_id
          JOIN production_result pr ON pr.id = s.production_result_id
          JOIN production_plan pp ON pp.id = pr.production_plan_id
          JOIN item pi ON pi.id = pp.item_id
          JOIN routing rt ON rt.item_type = pi.item_type AND rt.process_type = 'CONTINUOUS_CASTING'
          WHERE h.lot_type = 'HEAT'
          GROUP BY h.id, h.lot_no, h.initial_ton, rt.planned_yield_rate, si.theoretical_weight_ton
          HAVING count(*) > floor(h.initial_ton * rt.planned_yield_rate / si.theoretical_weight_ton)
          ORDER BY h.lot_no`,
  },
  {
    name: '⑦ 실적 완료 일시 ≥ 시작 일시',
    basis: 'REQ-PRD-003',
    sql: `SELECT pr.id AS production_result_id, pr.process_type, ${seoul('pr.started_at')} AS started_at, ${seoul('pr.completed_at')} AS completed_at
          FROM production_result pr WHERE pr.completed_at < pr.started_at
          ORDER BY pr.id`,
  },
  {
    name: '⑧ 투입 LOT의 실적 완료 ≤ 이 실적 시작 (용선→히트→슬래브→코일)',
    basis: 'BP-PRD-02, BP-INV-01',
    // 히트 하나가 슬래브 수십 매로 이어지므로 투입 LOT × 실적으로 묶는다
    sql: `SELECT p.lot_no AS input_lot, ${seoul('pp.completed_at')} AS input_completed_at,
                 cp.id AS production_result_id, cp.process_type, ${seoul('cp.started_at')} AS started_at,
                 min(c.lot_no) AS first_output_lot, count(*)::int AS output_lots
          FROM lot_relation r
          JOIN lot p ON p.id = r.parent_lot_id JOIN production_result pp ON pp.id = p.production_result_id
          JOIN lot c ON c.id = r.child_lot_id JOIN production_result cp ON cp.id = c.production_result_id
          WHERE pp.completed_at > cp.started_at
          GROUP BY p.lot_no, pp.completed_at, cp.id, cp.process_type, cp.started_at
          ORDER BY cp.started_at, p.lot_no`,
  },
  {
    name: '⑨ 같은 고로·전로의 작업 시간이 겹치지 않음',
    basis: 'BP-PRD-02 예외(동일 실적 중복)',
    sql: `SELECT coalesce(a.blast_furnace_code, a.converter_code) AS equipment,
                 a.id AS result_a, ${seoul('a.started_at')} || ' ~ ' || coalesce(${seoul('a.completed_at')}, '작업 중') AS time_a,
                 b.id AS result_b, ${seoul('b.started_at')} || ' ~ ' || coalesce(${seoul('b.completed_at')}, '작업 중') AS time_b
          FROM production_result a
          JOIN production_result b ON b.id > a.id
            AND ((a.blast_furnace_code IS NOT NULL AND a.blast_furnace_code = b.blast_furnace_code)
              OR (a.converter_code IS NOT NULL AND a.converter_code = b.converter_code))
          WHERE a.started_at < coalesce(b.completed_at, 'infinity'::timestamptz)
            AND b.started_at < coalesce(a.completed_at, 'infinity'::timestamptz)
          ORDER BY 1, a.started_at, b.started_at`,
  },
  {
    name: '⑩ 확정 배정·출고된 LOT은 적격 (확정 배정은 재고 상태)',
    basis: 'REQ-INV-003, BP-SHP-01',
    sql: `SELECT l.lot_no, l.lot_status, a.allocation_purpose AS used_by FROM allocation a JOIN lot l ON l.id = a.lot_id
          WHERE a.allocation_status = 'CONFIRMED' AND (l.lot_status <> 'AVAILABLE' OR NOT ${eligible('l')})
          UNION ALL
          SELECT l.lot_no, l.lot_status, 'SHIPPED' FROM lot l WHERE l.lot_status = 'SHIPPED' AND NOT ${eligible('l')}
          ORDER BY 1`,
  },
  {
    name: '⑪ 수주 품목의 ACTIVE 예약 + 출고 ≤ 주문 매수, 취소 품목은 ACTIVE 예약 없음',
    basis: 'REQ-SO-003, BP-SO-02',
    sql: `SELECT so.sales_order_no, i.item_code, soi.sales_order_item_status, soi.ordered_qty,
                 coalesce(sum(r.reserved_qty) FILTER (WHERE r.reservation_status = 'ACTIVE'), 0)::int AS active_qty,
                 coalesce(sum(r.reserved_qty) FILTER (WHERE r.reservation_status = 'CONVERTED'), 0)::int AS shipped_qty
          FROM sales_order_item soi
          JOIN sales_order so ON so.id = soi.sales_order_id
          JOIN item i ON i.id = soi.item_id
          LEFT JOIN reservation r ON r.sales_order_item_id = soi.id
          GROUP BY soi.id, so.sales_order_no, i.item_code, soi.sales_order_item_status, soi.ordered_qty
          HAVING coalesce(sum(r.reserved_qty) FILTER (WHERE r.reservation_status IN ('ACTIVE', 'CONVERTED')), 0) > soi.ordered_qty
              OR (soi.sales_order_item_status = 'CANCELLED' AND coalesce(sum(r.reserved_qty) FILTER (WHERE r.reservation_status = 'ACTIVE'), 0) > 0)
          ORDER BY so.sales_order_no, i.item_code`,
  },
];

const row = (r) => Object.entries(r).map(([k, v]) => `${k}=${v ?? '-'}`).join(' · ');

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
process.stdout.write(`점검 대상: ${describeDatabase(databaseUrl)}\n\n`);
let failed = 0;
for (const c of checks) {
  const { rows } = await client.query(c.sql);
  if (rows.length === 0) {
    process.stdout.write(`✓ ${c.name}\n`);
    continue;
  }
  failed += 1;
  process.stdout.write(`✗ ${c.name} — ${rows.length}건 (${c.basis})\n`);
  for (const r of showAll ? rows : rows.slice(0, SAMPLE)) process.stdout.write(`    ${row(r)}\n`);
  if (!showAll && rows.length > SAMPLE) process.stdout.write(`    … 외 ${rows.length - SAMPLE}건 (--all로 모두)\n`);
}
await client.end();
process.stdout.write(`\n불변식 ${checks.length}개 점검, 위반 ${failed}개\n`);
process.exit(failed > 0 ? 1 : 0);
