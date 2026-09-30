import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import { notFound } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { ListMasterDto } from './dto/list-master.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { MasterChangeRecorder } from './master-change.recorder';
import { duplicate, parseActive, referenced } from './master-data.util';
import { PartyRepository } from './party.repository';

@Injectable()
export class SupplierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: PartyRepository,
    private readonly changes: MasterChangeRecorder,
  ) {}

  list(q: ListMasterDto) {
    const active = parseActive(q.active);
    const where: Prisma.SupplierWhereInput = {
      ...(active !== undefined ? { isActive: active } : {}),
      ...(q.q ? { OR: [{ supplierCode: { contains: q.q, mode: 'insensitive' } }, { supplierName: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    return this.repo.findSuppliers(this.prisma, where);
  }

  async get(id: number) {
    const row = await this.repo.findSupplier(this.prisma, id);
    if (!row) throw notFound('공급업체');
    return row;
  }

  create(dto: CreateSupplierDto, user: AuthUser) {
    return this.prisma.tx(async (tx) => {
      if (await this.repo.findSupplierByCode(tx, dto.supplierCode)) throw duplicate(`이미 등록된 공급업체 코드입니다 (${dto.supplierCode})`);
      const row = await this.repo.createSupplier(tx, { supplierCode: dto.supplierCode, supplierName: dto.supplierName });
      await this.changes.record(tx, user, { targetNo: row.supplierCode, targetId: row.id, summary: `공급업체 ${row.supplierCode}(${row.supplierName}) 등록`, after: row });
      return row;
    });
  }

  update(id: number, dto: UpdateSupplierDto, user: AuthUser) {
    return this.prisma.tx(async (tx) => {
      const before = await this.repo.findSupplier(tx, id);
      if (!before) throw notFound('공급업체');
      const row = await this.repo.updateSupplier(tx, id, {
        ...(dto.supplierName !== undefined ? { supplierName: dto.supplierName } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      });
      const verb = dto.isActive !== undefined && dto.isActive !== before.isActive ? (dto.isActive ? '사용' : '사용 중지') : '수정';
      await this.changes.record(tx, user, { targetNo: row.supplierCode, targetId: row.id, summary: `공급업체 ${row.supplierCode}(${row.supplierName}) ${verb}`, before, after: row });
      return row;
    });
  }

  /** 품목의 기본 공급업체·발주·LOT가 참조하면 지우지 않고 사용 중지로 안내한다. */
  remove(id: number, user: AuthUser) {
    return this.prisma.tx(async (tx) => {
      const before = await this.repo.findSupplier(tx, id);
      if (!before) throw notFound('공급업체');
      if ((await this.repo.supplierReferences(tx, id)) > 0) throw referenced(`품목·발주·LOT에서 사용 중인 공급업체는 삭제할 수 없습니다 (${before.supplierCode}). 사용 중지로 바꿔 주세요`);
      await this.repo.deleteSupplier(tx, id);
      await this.changes.record(tx, user, { targetNo: before.supplierCode, targetId: id, summary: `공급업체 ${before.supplierCode}(${before.supplierName}) 삭제`, before });
      return { id, deleted: true };
    });
  }
}
