import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import { notFound } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { ListMasterDto } from './dto/list-master.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { MasterChangeRecorder } from './master-change.recorder';
import { duplicate, parseActive, referenced } from './master-data.util';
import { PartyRepository } from './party.repository';

@Injectable()
export class CustomerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: PartyRepository,
    private readonly changes: MasterChangeRecorder,
  ) {}

  list(q: ListMasterDto) {
    const active = parseActive(q.active);
    const where: Prisma.CustomerWhereInput = {
      ...(active !== undefined ? { isActive: active } : {}),
      ...(q.q ? { OR: [{ customerCode: { contains: q.q, mode: 'insensitive' } }, { customerName: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    return this.repo.findCustomers(this.prisma, where);
  }

  async get(id: number) {
    const row = await this.repo.findCustomer(this.prisma, id);
    if (!row) throw notFound('고객사');
    return row;
  }

  create(dto: CreateCustomerDto, user: AuthUser) {
    return this.prisma.tx(async (tx) => {
      if (await this.repo.findCustomerByCode(tx, dto.customerCode)) throw duplicate(`이미 등록된 고객사 코드입니다 (${dto.customerCode})`);
      const row = await this.repo.createCustomer(tx, { customerCode: dto.customerCode, customerName: dto.customerName });
      await this.changes.record(tx, user, { targetNo: row.customerCode, targetId: row.id, summary: `고객사 ${row.customerCode}(${row.customerName}) 등록`, after: row });
      return row;
    });
  }

  update(id: number, dto: UpdateCustomerDto, user: AuthUser) {
    return this.prisma.tx(async (tx) => {
      const before = await this.repo.findCustomer(tx, id);
      if (!before) throw notFound('고객사');
      const row = await this.repo.updateCustomer(tx, id, {
        ...(dto.customerName !== undefined ? { customerName: dto.customerName } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      });
      const verb = dto.isActive !== undefined && dto.isActive !== before.isActive ? (dto.isActive ? '사용' : '사용 중지') : '수정';
      await this.changes.record(tx, user, { targetNo: row.customerCode, targetId: row.id, summary: `고객사 ${row.customerCode}(${row.customerName}) ${verb}`, before, after: row });
      return row;
    });
  }

  /** 수주·출하요청·밀시트가 참조하면 지우지 않고 사용 중지로 안내한다. */
  remove(id: number, user: AuthUser) {
    return this.prisma.tx(async (tx) => {
      const before = await this.repo.findCustomer(tx, id);
      if (!before) throw notFound('고객사');
      if ((await this.repo.customerReferences(tx, id)) > 0) throw referenced(`수주 등에서 사용 중인 고객사는 삭제할 수 없습니다 (${before.customerCode}). 사용 중지로 바꿔 주세요`);
      await this.repo.deleteCustomer(tx, id);
      await this.changes.record(tx, user, { targetNo: before.customerCode, targetId: id, summary: `고객사 ${before.customerCode}(${before.customerName}) 삭제`, before });
      return { id, deleted: true };
    });
  }
}
