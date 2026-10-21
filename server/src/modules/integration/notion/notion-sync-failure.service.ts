import { Injectable } from '@nestjs/common';
import { NOTION_SYNC_TARGET, type NotionSyncFailureView, type NotionSyncRetryResult, type NotionSyncTargetType } from '@fantasteel/shared';
import { AppException } from '../../../common/errors/app.exception';
import { PrismaService } from '../../../prisma/prisma.service';
import type { NotionSyncFailure } from '../../../generated/prisma/client';
import { NotionSyncRepository } from './notion-sync.repository';
import { NotionWorkspaceService } from './notion-workspace.service';

function isTargetType(value: string): value is NotionSyncTargetType {
  return (Object.values(NOTION_SYNC_TARGET) as string[]).includes(value);
}

/**
 * Notion 반영 실패 목록과 다시 시도 (이슈 #518, 문서에 없는 기능). 목록은 DB(notion_sync_failure)에 있어 서버를 다시 띄워도 남는다.
 * 다시 시도는 미룬 시각을 지금으로 당긴 뒤 반영을 한 번 돌려 결과를 기다린다 (자동 반영과 같은 길을 쓰므로 같은 줄·같은 규칙이다).
 * 권한 확인(ORG_MANAGE)은 controller가 한다.
 */
@Injectable()
export class NotionSyncFailureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: NotionSyncRepository,
    private readonly workspace: NotionWorkspaceService,
  ) {}

  /**
   * 반영에 실패해 남은 행, 최근에 실패한 것이 먼저. 행이 지워졌으면 그 줄은 목록에 보이지 않고 치운다
   * (자동 반영도 다음에 치우지만 지워진 행을 화면에 두지 않으려고 읽을 때 정리한다).
   */
  async list(): Promise<NotionSyncFailureView[]> {
    const rows = (await this.repository.findFailures(this.prisma)).filter((row) => isTargetType(row.targetType));
    if (rows.length === 0) return [];
    const idsOf = (type: NotionSyncTargetType) => rows.filter((row) => row.targetType === type).map((row) => row.targetId);
    const titles = await this.repository.findTargetTitles(this.prisma, {
      scheduleEvent: idsOf(NOTION_SYNC_TARGET.SCHEDULE_EVENT),
      meetingMinutes: idsOf(NOTION_SYNC_TARGET.MEETING_MINUTES),
      task: idsOf(NOTION_SYNC_TARGET.TASK),
    });
    const views: NotionSyncFailureView[] = [];
    const orphans: number[] = [];
    for (const row of rows) {
      const title = titles[row.targetType as NotionSyncTargetType].get(row.targetId);
      if (title === undefined) orphans.push(row.id);
      else views.push(toView(row, title));
    }
    if (orphans.length > 0) await this.repository.deleteFailuresByIds(this.prisma, orphans);
    return views;
  }

  /**
   * 다시 시도. failureId를 주면 그 한 건, 주지 않으면 지금 남은 것 전부(단, '결과 모름' 건은 뺀다). 미룬 시각을 지금으로 당기고 반영을 한 번 돌려 끝나기를 기다린다.
   * 만들어졌는지 알 수 없었던 건(isResultUnknown)은 다시 만들면 Notion에 같은 페이지가 둘 생길 수 있어 전체 다시 시도가 건너뛰고(응답의 skipped),
   * 사람이 Notion을 확인한 뒤 그 건만 다시 시도할 때만 다시 만든다(화면이 확인을 묻는다).
   * 한 번에 종류마다 100행까지 반영하므로 남은 것은 다음 반영(1분 안)이 이어 한다.
   * Notion이 연결돼 있지 않거나 업무 공간이 없으면 INT-002, 없는(이미 처리된) 건이면 COM-003.
   */
  async retry(failureId: number | null): Promise<NotionSyncRetryResult> {
    if (!(await this.workspace.isReady())) throw new AppException('INT-002', 'Notion 업무 공간을 쓸 수 없어요. 관리자가 연결과 업무 공간을 확인해 주세요');
    const current = await this.repository.findFailures(this.prisma);
    const targets = failureId === null ? current.filter((row) => !row.isResultUnknown) : current.filter((row) => row.id === failureId);
    // 건너뛴 '결과 모름' 건 (지워진 행의 줄은 목록을 읽을 때 치워지므로 남은 것만 센다)
    const skippedIds = new Set(failureId === null ? current.filter((row) => row.isResultUnknown).map((row) => row.id) : []);
    if (failureId !== null && targets.length === 0) throw new AppException('COM-003', '이미 처리됐거나 없는 반영 실패 항목이에요. 목록을 새로 불러와 주세요');
    if (targets.length > 0) {
      await this.repository.makeFailuresDue(this.prisma, targets.map((row) => row.id), new Date());
      await this.workspace.runNow();
    }
    const failures = await this.list();
    const remaining = new Set(failures.map((view) => view.id));
    const failed = targets.filter((row) => remaining.has(row.id)).length;
    const skipped = failures.filter((view) => skippedIds.has(view.id)).length;
    return { requested: targets.length, succeeded: targets.length - failed, failed, skipped, failures };
  }
}

function toView(row: NotionSyncFailure, title: string): NotionSyncFailureView {
  return {
    id: row.id,
    targetType: row.targetType as NotionSyncTargetType,
    targetId: row.targetId,
    title,
    failureCount: row.failureCount,
    lastError: row.lastError,
    isResultUnknown: row.isResultUnknown,
    retryAfter: row.retryAfter.toISOString(),
    firstFailedAt: row.firstFailedAt.toISOString(),
    lastFailedAt: row.lastFailedAt.toISOString(),
  };
}
