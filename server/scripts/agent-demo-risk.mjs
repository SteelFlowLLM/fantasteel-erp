// AI Factory Agent를 화면에서 시연·확인할 수 있게 개발 DB에 위험 조건을 만든다 (docs/backend/factory-agent.md 9장).
//   npm run agent:demo-risk -w @fantasteel/server
// 데모 데이터(npm run seed:demo)는 원료가 충분하고 납기에 여유가 있어서 Agent가 아무것도 감지하지 않는다. 그래서
//   1) 가까운 필요일(30일 이내)의 열린 생산계획 하나의 히트 수를 400으로 키워 원료 부족을 만들고
//   2) 진행 중인 수주 품목 하나의 납기를 오늘 + 2일로 당겨 납기 위험을 만든다.
// 바꾸기 전 값을 보여 주니 되돌리려면 그 값으로 UPDATE 하면 된다. 로컬 DB(npm run db)에서만 돈다. 끝낸 뒤 서버를 다시 시작하면 감지된다.
import pg from 'pg';
import { databaseUrl, describeDatabase, remoteUrl } from './db-target.mjs';

if (remoteUrl) {
  process.stderr.write(`[agent] 공용 DB(${describeDatabase(remoteUrl)})를 가리키고 있어 실행하지 않습니다. 시연용 데이터 변경은 로컬 DB에서만 합니다\n`);
  process.exit(1);
}

const RAW_SHORTAGE_HEAT_COUNT = 400;
const DUE_IN_DAYS = 2;
/** 서버가 원료 부족을 보는 기간(RAW_SHORTAGE_HORIZON_DAYS)과 같게 둔다 */
const HORIZON_DAYS = 30;

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const plan = (
    await client.query(
      `SELECT pp.id, pp.production_plan_no, pp.heat_count
       FROM production_plan pp
       JOIN sales_order_item soi ON soi.id = pp.sales_order_item_id
       WHERE pp.production_plan_status IN ('PLANNED', 'IN_PROGRESS')
         AND soi.sales_order_item_status IN ('OPEN', 'PARTIALLY_SHIPPED')
         AND soi.due_date <= CURRENT_DATE + $1::int
       ORDER BY pp.id DESC LIMIT 1`,
      [HORIZON_DAYS],
    )
  ).rows[0];
  const item = (
    await client.query(
      `SELECT soi.id, so.sales_order_no, soi.due_date
       FROM sales_order_item soi JOIN sales_order so ON so.id = soi.sales_order_id
       WHERE soi.sales_order_item_status = 'OPEN'
       ORDER BY soi.id LIMIT 1`,
    )
  ).rows[0];

  if (!plan && !item) {
    process.stdout.write('[agent] 바꿀 데이터가 없어요. 먼저 npm run seed:demo -w @fantasteel/server 로 데모 데이터를 넣어 주세요\n');
    process.exit(0);
  }

  if (plan) {
    await client.query('UPDATE production_plan SET heat_count = $2 WHERE id = $1', [plan.id, RAW_SHORTAGE_HEAT_COUNT]);
    process.stdout.write(`[agent] 원료 부족: 생산계획 ${plan.production_plan_no} 히트 수 ${plan.heat_count} → ${RAW_SHORTAGE_HEAT_COUNT}\n`);
    process.stdout.write(`        되돌리기: UPDATE production_plan SET heat_count = ${plan.heat_count} WHERE id = ${plan.id};\n`);
  } else {
    process.stdout.write(`[agent] 원료 부족: 필요일이 ${HORIZON_DAYS}일 이내인 열린 생산계획이 없어 건너뜀\n`);
  }
  if (item) {
    await client.query(`UPDATE sales_order_item SET due_date = CURRENT_DATE + $2::int WHERE id = $1`, [item.id, DUE_IN_DAYS]);
    process.stdout.write(`[agent] 납기 위험: 수주 ${item.sales_order_no} 품목 납기 ${item.due_date.toISOString().slice(0, 10)} → 오늘 + ${DUE_IN_DAYS}일\n`);
    process.stdout.write(`        되돌리기: UPDATE sales_order_item SET due_date = '${item.due_date.toISOString().slice(0, 10)}' WHERE id = ${item.id};\n`);
  }
  process.stdout.write('[agent] 서버를 다시 시작하면 감지돼요 (npm run dev 를 껐다 켜기). 화면: /agent\n');
} finally {
  await client.end();
}
