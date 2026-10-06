import { Injectable } from '@nestjs/common';
import type { CustomerView, ItemType, ItemView, UnitType } from '@fantasteel/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { MasterDataRepository } from './master-data.repository';

/**
 * 업무 로직·트랜잭션·데이터에 따른 권한 검사 (컨벤션 6장).
 * 지금은 수주 등록 화면이 쓰는 조회(고객사·품목)만 있다. 등록·수정은 기준정보 담당이 채운다.
 */
@Injectable()
export class MasterDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: MasterDataRepository,
  ) {}

  async listCustomers(): Promise<CustomerView[]> {
    return this.repository.findCustomers(this.prisma);
  }

  async listItems(itemType?: ItemType): Promise<ItemView[]> {
    const rows = await this.repository.findItems(this.prisma, itemType);
    return rows.map((r) => ({
      id: r.id,
      itemCode: r.itemCode,
      itemName: r.itemName,
      itemType: r.itemType as ItemType,
      unitType: r.unitType as UnitType,
      steelGradeId: r.steelGradeId,
      steelGradeCode: r.steelGrade?.steelGradeCode ?? null,
      thicknessMm: r.thicknessMm?.toFixed(2) ?? null,
      widthMm: r.widthMm?.toFixed(2) ?? null,
      lengthMm: r.lengthMm?.toFixed(2) ?? null,
      theoreticalWeightTon: r.theoreticalWeightTon?.toFixed(3) ?? null,
      defaultYardId: r.defaultYardId,
    }));
  }
}
