import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import { notFound } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateYardDto } from './dto/create-yard.dto';
import { ListYardsDto } from './dto/list-yards.dto';
import { UpdateYardDto } from './dto/update-yard.dto';
import { MasterChangeRecorder } from './master-change.recorder';
import { duplicate, parseActive, referenced } from './master-data.util';
import { PartyRepository } from './party.repository';

@Injectable()
export class YardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: PartyRepository,
    private readonly changes: MasterChangeRecorder,
  ) {}

  list(q: ListYardsDto) {
    const active = parseActive(q.active);
    const where: Prisma.YardWhereInput = {
      ...(q.yardType ? { yardType: q.yardType } : {}),
      ...(active !== undefined ? { isActive: active } : {}),
      ...(q.q ? { OR: [{ yardCode: { contains: q.q, mode: 'insensitive' } }, { yardName: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    return this.repo.findYards(this.prisma, where);
  }

  async get(id: number) {
    const row = await this.repo.findYard(this.prisma, id);
    if (!row) throw notFound('야드');
    return row;
  }

  create(dto: CreateYardDto, user: AuthUser) {
    return this.prisma.tx(async (tx) => {
      if (await this.repo.findYardByCode(tx, dto.yardCode)) throw duplicate(`이미 등록된 야드 코드입니다 (${dto.yardCode})`);
      const row = await this.repo.createYard(tx, { yardCode: dto.yardCode, yardName: dto.yardName, yardType: dto.yardType });
      await this.changes.record(tx, user, { targetNo: row.yardCode, targetId: row.id, summary: `야드 ${row.yardCode}(${row.yardName}) 등록`, after: row });
      return row;
    });
  }

  update(id: number, dto: UpdateYardDto, user: AuthUser) {
    return this.prisma.tx(async (tx) => {
      const before = await this.repo.findYard(tx, id);
      if (!before) throw notFound('야드');
      const row = await this.repo.updateYard(tx, id, {
        ...(dto.yardName !== undefined ? { yardName: dto.yardName } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      });
      const verb = dto.isActive !== undefined && dto.isActive !== before.isActive ? (dto.isActive ? '사용' : '사용 중지') : '수정';
      await this.changes.record(tx, user, { targetNo: row.yardCode, targetId: row.id, summary: `야드 ${row.yardCode}(${row.yardName}) ${verb}`, before, after: row });
      return row;
    });
  }

  /** 원료·규격·LOT·입고가 참조하면 지우지 않고 사용 중지로 안내한다. */
  remove(id: number, user: AuthUser) {
    return this.prisma.tx(async (tx) => {
      const before = await this.repo.findYard(tx, id);
      if (!before) throw notFound('야드');
      if ((await this.repo.yardReferences(tx, id)) > 0) throw referenced(`원료·규격·LOT에서 사용 중인 야드는 삭제할 수 없습니다 (${before.yardCode}). 사용 중지로 바꿔 주세요`);
      await this.repo.deleteYard(tx, id);
      await this.changes.record(tx, user, { targetNo: before.yardCode, targetId: id, summary: `야드 ${before.yardCode}(${before.yardName}) 삭제`, before });
      return { id, deleted: true };
    });
  }
}
