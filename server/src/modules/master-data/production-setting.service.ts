import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import { AppException } from '../../common/errors/app.exception';
import { ERROR_CODE } from '@fantasteel/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateProductionSettingDto } from './dto/update-production-setting.dto';
import { MasterChangeRecorder } from './master-change.recorder';

const view = (s: { heatCapacityTon: Prisma.Decimal; deliveryRiskDays: number; updatedAt: Date }) => ({
  heatCapacityTon: s.heatCapacityTon,
  deliveryRiskDays: s.deliveryRiskDays,
  updatedAt: s.updatedAt,
});

/** 생산 설정값은 행 1개(id = 1)다 (REQ-MST-009). */
@Injectable()
export class ProductionSettingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly changes: MasterChangeRecorder,
  ) {}

  async get() {
    const row = await this.prisma.productionSetting.findUnique({ where: { id: 1 } });
    if (!row) throw new AppException(ERROR_CODE.MST_001, '생산 설정값이 등록되어 있지 않습니다');
    return view(row);
  }

  update(dto: UpdateProductionSettingDto, user: AuthUser) {
    return this.prisma.tx(async (tx) => {
      const before = await tx.productionSetting.findUnique({ where: { id: 1 } });
      const row = await tx.productionSetting.upsert({
        where: { id: 1 },
        create: { id: 1, heatCapacityTon: dto.heatCapacityTon, deliveryRiskDays: dto.deliveryRiskDays },
        update: { heatCapacityTon: dto.heatCapacityTon, deliveryRiskDays: dto.deliveryRiskDays },
      });
      await this.changes.record(tx, user, {
        targetNo: 'PRODUCTION_SETTING', targetId: 1,
        summary: `생산 설정값 수정: 히트 용량 ${row.heatCapacityTon.toFixed(3)}t, 납기 위험 기준일 ${row.deliveryRiskDays}일`,
        before: before ? view(before) : undefined, after: view(row),
      });
      return view(row);
    });
  }
}
