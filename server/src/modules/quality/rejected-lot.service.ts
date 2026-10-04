import { Injectable } from '@nestjs/common';
import {
  PERMISSION,
  type AuthUser,
  type DispositionStatus,
  type InspectionResult,
  type PageResult,
  type RejectedLotListItem,
} from '@fantasteel/shared';
import { hasPermission } from '../../common/auth/auth.guard';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import type { ListRejectedLotsDto } from './dto/list-rejected-lots.dto';
import { toInspectedLotSummary } from './quality-inspection-list';
import { RejectedLotRepository, type RejectedLot } from './rejected-lot.repository';

const DEFAULT_PAGE = 1;
const DEFAULT_SIZE = 20;

function toRejectedLotListItem(lot: RejectedLot): RejectedLotListItem {
  return {
    ...toInspectedLotSummary(lot),
    qualityInspectionId: lot.qualityInspection?.id ?? null,
    inspectionResult: (lot.qualityInspection?.inspectionResult as InspectionResult | undefined) ?? null,
    dispositionStatus: (lot.dispositionStatus as DispositionStatus | null) ?? null,
    dispositionReason: lot.dispositionReason,
  };
}

/** 불합격 LOT 조회·처리 상태 (REQ-QC-004, TRM-078·079) */
@Injectable()
export class RejectedLotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: RejectedLotRepository,
  ) {}

  /**
   * 불합격 LOT 목록 (API-123): 불합격 LOT과 불합격 히트의 하위 LOT, 처리 상태·사유.
   * 권한은 DISPOSITION_SET 또는 INSPECTION_REGISTER (VIEW 이상). "또는"이라 service에서 확인한다 (quality.md 3장)
   */
  async listRejectedLots(query: ListRejectedLotsDto, user: AuthUser): Promise<PageResult<RejectedLotListItem>> {
    const canView =
      hasPermission(user, { permission: PERMISSION.DISPOSITION_SET, level: 'VIEW' }) ||
      hasPermission(user, { permission: PERMISSION.INSPECTION_REGISTER, level: 'VIEW' });
    if (!canView) throw new AppException('COM-002');

    const page = query.page ?? DEFAULT_PAGE;
    const size = query.size ?? DEFAULT_SIZE;
    const { lots, total } = await this.repository.findRejectedLots(this.prisma, { skip: (page - 1) * size, take: size });
    return { items: lots.map(toRejectedLotListItem), page, size, total };
  }
}
