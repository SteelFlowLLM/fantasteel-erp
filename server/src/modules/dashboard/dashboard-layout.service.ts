import { Injectable } from '@nestjs/common';
import type { AuthUser, WidgetPlacement } from '@fantasteel/shared';
import { badInput } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { buildDefaultLayout, parseStoredLayout, validatePlacements } from './dashboard-layout';
import { DashboardRepository } from './dashboard.repository';
import type { SaveLayoutDto } from './dto/save-layout.dto';

export interface DashboardLayoutResponse {
  placements: WidgetPlacement[];
  /** 저장한 배치가 없어 기본 배치를 돌려준 경우 true */
  isDefault: boolean;
}

@Injectable()
export class DashboardLayoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: DashboardRepository,
  ) {}

  /** 로그인 사원 본인의 배치. 저장한 것이 없으면(또는 깨져 있으면) 기본 배치. */
  async get(user: AuthUser): Promise<DashboardLayoutResponse> {
    const row = await this.repo.findLayout(this.prisma, user.employeeId);
    const stored = row ? parseStoredLayout(row.layout) : null;
    return stored ? { placements: stored, isDefault: false } : { placements: buildDefaultLayout(), isDefault: true };
  }

  async save(dto: SaveLayoutDto, user: AuthUser): Promise<DashboardLayoutResponse> {
    const error = validatePlacements(dto.placements);
    if (error) throw badInput(error);
    const placements: WidgetPlacement[] = dto.placements.map((p) => ({ widgetCode: p.widgetCode as WidgetPlacement['widgetCode'], x: p.x, y: p.y, w: p.w, h: p.h }));
    await this.repo.saveLayout(this.prisma, user.employeeId, placements as unknown as object[]);
    return { placements, isDefault: false };
  }
}
