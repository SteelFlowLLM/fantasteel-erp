import type { Tx } from '../../prisma/prisma.service';

// 행 잠금 도우미. 코드 컨벤션은 락 쿼리를 TypedSQL(prisma/sql)로 두라고 하지만,
// generate --sql 없이도 빌드되도록 여기 한 파일에만 모아 둔다 (다른 곳에서 $queryRaw 금지).

/** 제품 규격의 재고 풀(inventory 행)을 잠근다. 없으면 만든 뒤 잠근다. 예약·배정·출고 전에 호출 (REQ-INV-009). */
export async function lockProductInventory(tx: Tx, productSpecId: number): Promise<{ id: number; onHandQty: number; reservedQty: number }> {
  await tx.inventory.upsert({ where: { productSpecId }, create: { productSpecId }, update: {} });
  const rows = await tx.$queryRaw<{ id: number; on_hand_qty: number; reserved_qty: number }[]>`
    SELECT id, on_hand_qty, reserved_qty FROM inventory WHERE product_spec_id = ${productSpecId} FOR UPDATE`;
  return { id: rows[0].id, onHandQty: rows[0].on_hand_qty, reservedQty: rows[0].reserved_qty };
}

/** 여러 규격을 id 오름차순(고정 순서)으로 잠가 교착을 피한다. */
export async function lockProductInventories(tx: Tx, productSpecIds: number[]) {
  const out = new Map<number, { id: number; onHandQty: number; reservedQty: number }>();
  for (const id of [...new Set(productSpecIds)].sort((a, b) => a - b)) out.set(id, await lockProductInventory(tx, id));
  return out;
}

/** 원료 재고 행 잠금. */
export async function lockRawMaterialInventory(tx: Tx, rawMaterialId: number): Promise<void> {
  await tx.inventory.upsert({ where: { rawMaterialId }, create: { rawMaterialId }, update: {} });
  await tx.$queryRaw`SELECT id FROM inventory WHERE raw_material_id = ${rawMaterialId} FOR UPDATE`;
}

/** LOT 행들을 id 오름차순으로 잠근다. */
export async function lockLots(tx: Tx, lotIds: number[]): Promise<void> {
  const ids = [...new Set(lotIds)].sort((a, b) => a - b);
  if (!ids.length) return;
  await tx.$queryRaw`SELECT id FROM lot WHERE id = ANY(${ids}::int[]) ORDER BY id FOR UPDATE`;
}

/** 임의 테이블의 한 행을 잠근다 (수주 품목·구매요청·출하요청 등 상태 전이 전에). */
export async function lockRow(tx: Tx, table: 'sales_order' | 'sales_order_item' | 'purchase_requisition' | 'purchase_order_item' | 'shipment_request' | 'production_plan' | 'action_draft' | 'goods_receipt' | 'department' | 'purchase_order' | 'mill_sheet', id: number): Promise<void> {
  await tx.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE id = $1 FOR UPDATE`, id);
}
