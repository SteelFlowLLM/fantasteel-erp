import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

/** 고객사·공급업체·야드: 코드 + 이름 + 사용 여부만 가진 단순 마스터 */
@Injectable()
export class PartyRepository {
  // 고객사
  findCustomers(tx: Tx, where: Prisma.CustomerWhereInput) { return tx.customer.findMany({ where, orderBy: { id: 'asc' } }); }
  findCustomer(tx: Tx, id: number) { return tx.customer.findUnique({ where: { id } }); }
  findCustomerByCode(tx: Tx, customerCode: string) { return tx.customer.findUnique({ where: { customerCode } }); }
  createCustomer(tx: Tx, data: Prisma.CustomerCreateInput) { return tx.customer.create({ data }); }
  updateCustomer(tx: Tx, id: number, data: Prisma.CustomerUpdateInput) { return tx.customer.update({ where: { id }, data }); }
  deleteCustomer(tx: Tx, id: number) { return tx.customer.delete({ where: { id } }); }
  async customerReferences(tx: Tx, customerId: number): Promise<number> {
    const [a, b, c] = await Promise.all([
      tx.salesOrder.count({ where: { customerId } }),
      tx.shipmentRequest.count({ where: { customerId } }),
      tx.millSheet.count({ where: { customerId } }),
    ]);
    return a + b + c;
  }

  // 공급업체
  findSuppliers(tx: Tx, where: Prisma.SupplierWhereInput) { return tx.supplier.findMany({ where, orderBy: { id: 'asc' } }); }
  findSupplier(tx: Tx, id: number) { return tx.supplier.findUnique({ where: { id } }); }
  findSupplierByCode(tx: Tx, supplierCode: string) { return tx.supplier.findUnique({ where: { supplierCode } }); }
  createSupplier(tx: Tx, data: Prisma.SupplierCreateInput) { return tx.supplier.create({ data }); }
  updateSupplier(tx: Tx, id: number, data: Prisma.SupplierUpdateInput) { return tx.supplier.update({ where: { id }, data }); }
  deleteSupplier(tx: Tx, id: number) { return tx.supplier.delete({ where: { id } }); }
  async supplierReferences(tx: Tx, supplierId: number): Promise<number> {
    const [a, b, c] = await Promise.all([
      tx.item.count({ where: { defaultSupplierId: supplierId } }),
      tx.purchaseOrder.count({ where: { supplierId } }),
      tx.lot.count({ where: { supplierId } }),
    ]);
    return a + b + c;
  }

  // 야드
  findYards(tx: Tx, where: Prisma.YardWhereInput) { return tx.yard.findMany({ where, orderBy: { id: 'asc' } }); }
  findYard(tx: Tx, id: number) { return tx.yard.findUnique({ where: { id } }); }
  findYardByCode(tx: Tx, yardCode: string) { return tx.yard.findUnique({ where: { yardCode } }); }
  createYard(tx: Tx, data: Prisma.YardCreateInput) { return tx.yard.create({ data }); }
  updateYard(tx: Tx, id: number, data: Prisma.YardUpdateInput) { return tx.yard.update({ where: { id }, data }); }
  deleteYard(tx: Tx, id: number) { return tx.yard.delete({ where: { id } }); }
  async yardReferences(tx: Tx, yardId: number): Promise<number> {
    const [a, b, c, d] = await Promise.all([
      tx.rawMaterial.count({ where: { yardId } }),
      tx.productSpec.count({ where: { yardId } }),
      tx.lot.count({ where: { yardId } }),
      tx.goodsReceipt.count({ where: { yardId } }),
    ]);
    return a + b + c + d;
  }
}
