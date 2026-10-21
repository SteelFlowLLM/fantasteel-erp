import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import {
  INTEGRATION_PROVIDER,
  NOTION_WORKSPACE_DATABASES,
  type IntegrationSettings,
  type NotionCalendarOption,
  type NotionCalendarSettings,
  type NotionCalendarSettingsInput,
  type NotionDatabaseRef,
  type NotionWorkspaceDatabaseKey,
  type NotionWorkspaceView,
  type ScheduleNotionStatus,
  type TaskStatus,
} from '@fantasteel/shared';
import { AppException } from '../../../common/errors/app.exception';
import { PrismaService } from '../../../prisma/prisma.service';
import type { Prisma } from '../../../generated/prisma/client';
import { buildMeetingNotionMarkdown, meetingNotionTitle } from '../../meeting-minutes/meeting-notion.markdown';
import { toMeetingMinutesView } from '../../meeting-minutes/meeting-minutes.view';
import { scheduleWeekLink } from '../../schedule-event/schedule-notice';
import { IntegrationConnectionRepository } from '../integration-connection.repository';
import { readSettings, readyWorkspace, type ReadyNotionWorkspace } from '../integration-settings';
import { clientBaseUrl } from '../integration-urls';
import { isAuthFailure, isRejectedBeforeRun, McpClientService, NOTION_EXPORT_STALE_MS, type McpSession, type McpToolInfo } from '../mcp/mcp.client';
import { NOTION_CREATE_PAGES_TOOL, notionPageUrlOf, parentPageNotFound } from './notion.tools';
import { NotionPageService } from './notion-page.service';
import { NotionSyncRepository, type NotionMeetingRow, type NotionScheduleEventRow, type NotionTaskRow } from './notion-sync.repository';
import {
  buildCreateCalendarEventArgs,
  buildUpdateCalendarEventArgs,
  NOTION_CALENDAR_CREATE_TOOL,
  NOTION_CALENDAR_LIST_TOOL,
  NOTION_CALENDAR_UPDATE_TOOL,
  readCalendarList,
  readCalendarUpdateResult,
  readCreatedCalendarEvents,
  type CalendarEventDraft,
} from './notion-calendar.tools';
import {
  buildCreateDatabaseArgs,
  buildCreateRowsArgs,
  buildCreateViewArgs,
  buildFetchDataSourceArgs,
  missingViews,
  NOTION_FETCH_TOOL,
  readDatabaseOfDataSource,
  workspaceNeedsRepair,
  buildReplaceContentArgs,
  buildUpdatePropertiesArgs,
  erpUrl,
  meetingProperties,
  NOTION_CREATE_DATABASE_TOOL,
  NOTION_CREATE_VIEW_TOOL,
  NOTION_DATABASE_TITLES,
  NOTION_UPDATE_PAGE_TOOL,
  notionDatabaseDefs,
  readCreatedDatabase,
  readCreatedPages,
  readUpdateResult,
  readViewResult,
  scheduleEventProperties,
  seoulIso,
  taskProperties,
  type NotionProperties,
} from './notion-workspace.tools';

/** 자동 반영 주기. 저장 직후에도 한 번 돌지만(kick), 그때 실패했거나 서버 밖에서 바뀐 행을 이 주기로 다시 본다 */
const SYNC_INTERVAL_MS = 60_000;
/** 처음 반영할 때(페이지가 아직 없는 행) 이 기간보다 오래된 일정·끝난 업무는 옮기지 않는다 */
export const NOTION_BACKFILL_DAYS = 30;
/** notion-create-pages 한 번에 만드는 페이지 수 */
const CREATE_BATCH_SIZE = 20;
/** 한 번 돌 때 종류마다 읽는 행 수. 남으면 이어서 다시 돈다 (Notion 연결 줄을 오래 붙잡지 않게) */
const ROWS_PER_RUN = 100;
/** 실패한 행을 다시 해 보기까지 기다리는 시간: 1분에서 두 배씩, 1시간까지 */
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MAX_MS = 60 * 60_000;
/** 만들어졌는지 알 수 없는 페이지는 Notion에 생겼는지 사람이 볼 시간을 두고 다시 만든다 */
const UNCERTAIN_BACKOFF_MS = 30 * 60_000;
const DAY_MS = 86_400_000;
const REPAIR_RETRY_MS = 60 * 60_000;

type SyncKind = NotionWorkspaceDatabaseKey;
type ReadyWorkspace = ReadyNotionWorkspace;
/** 캘린더 도구는 Notion 캘린더를 쓰지 않는 계정에는 없을 수 있어 고른 캘린더가 있을 때만 확인한다 */
type SyncTools = { createPages: McpToolInfo; updatePage: McpToolInfo; createEvents: McpToolInfo | undefined; updateEvents: McpToolInfo | undefined };

/** 성공으로 답했지만 만든 페이지를 읽지 못함: 만들어졌을 수 있다 */
class UncertainCreateError extends Error {}

interface RowFailure {
  until: number;
  failures: number;
}

function messageOf(error: unknown): string {
  if (error instanceof AppException) return (error.getResponse() as { message: string }).message;
  return error instanceof Error ? error.message : String(error);
}

/** 도구가 실행됐는지 알 수 없는 실패 (시간 초과·연결 끊김·5xx). 같은 Notion 연결의 다음 행도 실패할 것이라 이번 반영을 멈춘다 */
function isTransportFailure(error: unknown): boolean {
  return !(error instanceof AppException) && !(error instanceof McpError) && !(error instanceof UncertainCreateError);
}

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * Notion 업무 공간 (문서에 없는 기능, 2026-10-19 이슈 #391). 회사 Notion의 상위 페이지 아래에 일정·회의록·할 일 데이터베이스를 만들고,
 * ERP의 일정(schedule_event)·확정한 회의록(meeting_minutes)·업무(task)를 그 데이터베이스에 ERP → Notion 한 방향으로 반영한다.
 * Notion에서 고친 내용은 읽지 않는다. 반영할 행: notion_synced_at이 없거나 updated_at보다 앞인 행 (반영한 행의 updated_at을 적는다).
 * 저장 직후(kick)와 1분마다 돌고, 같은 서버 안에서는 한 번에 하나만 돈다(설정·직접 내보내기도 같은 줄). 실패한 행은 표시만 남기고 뒤로 미룬다.
 * 🟡 서버를 여러 대 띄우면 같은 행을 두 서버가 함께 만들 수 있다 (토큰 줄 integration-lock.ts와 같은 전제).
 */
@Injectable()
export class NotionWorkspaceService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(NotionWorkspaceService.name);
  private tail: Promise<unknown> = Promise.resolve();
  private queuedSweep: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private readonly failures: Record<SyncKind, Map<number, RowFailure>> = { scheduleEvents: new Map(), meetingMinutes: new Map(), tasks: new Map() };
  private lastSyncedAt: Date | null = null;
  private lastSyncError: string | null = null;
  private setupWarning: string | null = null;
  /** 1단계에서 만든 업무 공간을 고친(데이터베이스 주소·보기) 마지막 시도. 실패해도 1시간에 한 번만 다시 해 본다 */
  private lastRepairAt: number | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: IntegrationConnectionRepository,
    private readonly repository: NotionSyncRepository,
    private readonly mcp: McpClientService,
    private readonly notionPage: NotionPageService,
  ) {}

  onApplicationBootstrap(): void {
    // 테스트는 runNow로 직접 돌린다
    if (process.env.NODE_ENV === 'test') return;
    this.kick();
    this.timer = setInterval(() => this.kick(), SYNC_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  /** 일정·업무·회의록을 저장한 트랜잭션이 끝난 뒤 부른다. 기다리지 않고, 실패해도 부른 쪽에 알리지 않는다 */
  kick(): void {
    if (this.stopped) return;
    void this.runNow().catch((error: unknown) => this.logger.warn(`Notion 업무 공간 반영 실패: ${messageOf(error)}`));
  }

  /** 반영을 한 번 돌리고 끝날 때까지 기다린다. 이미 기다리는 반영이 있으면 그것과 합친다 */
  runNow(): Promise<void> {
    if (this.queuedSweep) return this.queuedSweep;
    const sweep = this.enqueue(async () => {
      this.queuedSweep = null;
      await this.sweep();
    });
    this.queuedSweep = sweep;
    return sweep;
  }

  /** 반영·설정·직접 내보내기를 한 줄로 세운다: 같은 행의 페이지를 두 번 만들지 않게 */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }

  /** 세 데이터베이스가 모두 있고 연결돼 있는지 (직접 내보내기가 데이터베이스로 갈지 정한다) */
  async isReady(): Promise<boolean> {
    return (await this.readyContext()) !== null;
  }

  /** 일정을 Notion에 넣을 수 있는지 (일정 등록 화면·카드가 본다, 이슈 #434). 연결을 부르지 않고 저장된 설정만 읽는다 */
  async scheduleStatus(): Promise<ScheduleNotionStatus> {
    const row = await this.connections.findByProviderKey(this.prisma, INTEGRATION_PROVIDER.NOTION);
    if (!row?.oauthTokens) return { ready: false, reason: 'Notion이 연결되지 않았어요. 관리자가 연결하면 넣을 수 있어요', calendarName: null };
    const ws = readyWorkspace(readSettings(row.settings));
    if (!ws) return { ready: false, reason: '관리자가 아직 Notion 업무 공간을 만들지 않았어요', calendarName: null };
    return { ready: true, reason: null, calendarName: ws.calendar?.name ?? null };
  }

  private async readyContext(): Promise<ReadyWorkspace | null> {
    const row = await this.connections.findByProviderKey(this.prisma, INTEGRATION_PROVIDER.NOTION);
    if (!row?.oauthTokens) return null;
    return readyWorkspace(readSettings(row.settings));
  }

  // ── 관리 화면 ──

  /** 관리 화면에 보일 상태. 만든 적이 없으면 null */
  async view(settings: IntegrationSettings): Promise<NotionWorkspaceView | null> {
    const ws = settings.notionWorkspace;
    if (!ws) return null;
    const ready = readyWorkspace(settings) !== null;
    return {
      ready,
      createdAt: ws.createdAt ?? null,
      databases: NOTION_WORKSPACE_DATABASES.flatMap((key) => {
        const ref = ws[key];
        return ref ? [{ key, title: NOTION_DATABASE_TITLES[key], url: ref.url }] : [];
      }),
      lastSyncedAt: this.lastSyncedAt?.toISOString() ?? null,
      failedCount: Object.values(this.failures).reduce((sum, map) => sum + map.size, 0),
      pendingCount: ready ? await this.countPending() : 0,
      lastSyncError: this.lastSyncError,
      setupWarning: this.setupWarning,
      calendar: ws.calendar ?? null,
    };
  }

  private async countPending(): Promise<number> {
    const now = Date.now();
    const since = new Date(now - NOTION_BACKFILL_DAYS * DAY_MS);
    const [events, tasks, meetings] = await Promise.all([
      this.repository.countDirtyScheduleEvents(this.prisma, since),
      this.repository.countDirtyTasks(this.prisma, since),
      this.repository.countDirtyMeetings(this.prisma, new Date(now - NOTION_EXPORT_STALE_MS)),
    ]);
    return events + tasks + meetings;
  }

  /**
   * 상위 페이지 아래에 세 데이터베이스와 보기를 만든다. 이미 만든 데이터베이스는 다시 만들지 않는다(중간에 멈췄으면 없는 것만 만든다).
   * 데이터베이스를 하나 만들 때마다 id를 저장한다. 이미 다 있으면 고칠 것(데이터베이스 주소·빠진 보기)만 고친다.
   * 다 만들면 반영을 시작한다 (지난 30일·진행 중인 일정·업무와 확정한 회의록).
   */
  async setup(): Promise<void> {
    const parentPageId = await this.notionPage.assertReady();
    await this.enqueue(async () => {
      const settings = await this.currentSettings();
      const ws = settings.notionWorkspace ?? {};
      if (readyWorkspace(settings) && !workspaceNeedsRepair(ws)) return;
      const names = (await this.repository.findActiveEmployeeNames(this.prisma)).map((e) => e.employeeName);
      const defs = notionDatabaseDefs(names);
      await this.mcp.withSession(INTEGRATION_PROVIDER.NOTION, async (session) => {
        const tools = await this.requireTools(session, [NOTION_CREATE_DATABASE_TOOL, NOTION_CREATE_VIEW_TOOL, NOTION_CREATE_PAGES_TOOL, NOTION_UPDATE_PAGE_TOOL]);
        const createDatabase = tools.get(NOTION_CREATE_DATABASE_TOOL) as McpToolInfo;
        for (const key of NOTION_WORKSPACE_DATABASES) {
          if (ws[key]) continue;
          const def = defs[key];
          const args = buildCreateDatabaseArgs(createDatabase, parentPageId, def);
          let ref: NotionDatabaseRef | null;
          try {
            ref = readCreatedDatabase(await session.callTool(createDatabase.name, args), parentPageId);
          } catch (error) {
            if (error instanceof AppException) throw error;
            if (isRejectedBeforeRun(error)) throw parentPageNotFound(error) ?? error;
            this.logger.warn(`Notion 데이터베이스(${def.title}) 만들기 결과를 알 수 없음: ${messageOf(error)}`);
            ref = null;
          }
          if (!ref) {
            throw new AppException('INT-009', `Notion에 "${def.title}" 데이터베이스가 만들어졌는지 확인하지 못했어요. 상위 페이지에 생겼으면 지운 뒤 다시 만들어 주세요`);
          }
          await this.saveWorkspace({ [key]: { ...ref, views: [] } });
        }
        await this.repairWorkspace(session, tools, parentPageId);
        if (!ws.createdAt) await this.saveWorkspace({ createdAt: new Date().toISOString() });
      });
    });
    this.kick();
  }

  /**
   * 데이터베이스 id를 모르면 데이터 소스(`collection://…`)를 읽어 찾고, 빠진 보기를 그 데이터베이스의 보기 탭으로 만든다.
   * 상위 페이지에 연결된 보기(inline)로는 만들지 않는다: 데이터베이스 id를 끝내 모르면 보기를 건너뛰고 안내를 남긴다.
   * 보기를 하나 만들 때마다 이름을 저장해 다시 돌아도 같은 보기를 또 만들지 않는다. 보기가 없어도 반영은 되므로 실패는 안내로만 남긴다.
   */
  private async repairWorkspace(session: McpSession, tools: Map<string, McpToolInfo>, parentPageId: string | null): Promise<void> {
    const createView = tools.get(NOTION_CREATE_VIEW_TOOL);
    const fetchTool = tools.get(NOTION_FETCH_TOOL);
    const warnings: string[] = [];
    for (const key of NOTION_WORKSPACE_DATABASES) {
      let ref = (await this.currentSettings()).notionWorkspace?.[key];
      if (!ref) continue;
      const title = NOTION_DATABASE_TITLES[key];
      if (!ref.databaseId && fetchTool) {
        try {
          const found = readDatabaseOfDataSource(await session.callTool(fetchTool.name, buildFetchDataSourceArgs(fetchTool, ref.dataSourceId)), ref.dataSourceId, parentPageId ?? '');
          if (found) {
            ref = { ...ref, databaseId: found.databaseId, url: found.url };
            await this.saveWorkspace({ [key]: ref });
          }
        } catch (error) {
          if (isAuthFailure(error)) throw error;
          this.logger.warn(`Notion 데이터베이스(${title}) 주소를 찾지 못했어요: ${messageOf(error)}`);
        }
      }
      const databaseId = ref.databaseId;
      if (!databaseId) {
        warnings.push(`"${title}" 데이터베이스 주소를 찾지 못해 보기를 만들지 않았어요`);
        continue;
      }
      if (!ref.url) {
        ref = { ...ref, url: notionPageUrlOf(databaseId) };
        await this.saveWorkspace({ [key]: ref });
      }
      for (const view of missingViews(key, ref)) {
        if (!createView) {
          warnings.push(`Notion MCP 서버에 ${NOTION_CREATE_VIEW_TOOL} 도구가 없어 보기를 만들지 않았어요`);
          break;
        }
        try {
          readViewResult(await session.callTool(createView.name, buildCreateViewArgs(createView, databaseId, ref.dataSourceId, view)));
          ref = { ...ref, views: [...(ref.views ?? []), view.name] };
          await this.saveWorkspace({ [key]: ref });
        } catch (error) {
          if (isAuthFailure(error)) throw error;
          warnings.push(`보기 "${title} › ${view.name}"를 만들지 못했어요: ${messageOf(error)}`.slice(0, 300));
          this.logger.warn(warnings[warnings.length - 1]);
        }
      }
    }
    this.setupWarning = warnings.length > 0 ? warnings.join(' · ').slice(0, 500) : null;
  }

  private async currentSettings(): Promise<IntegrationSettings> {
    const row = await this.connections.findByProviderKey(this.prisma, INTEGRATION_PROVIDER.NOTION);
    return readSettings(row?.settings ?? null);
  }

  /** 저장된 설정을 다시 읽어 업무 공간 칸만 더한다 (그 사이 관리자가 바꾼 상위 페이지를 덮어쓰지 않게) */
  private async saveWorkspace(patch: Partial<Record<NotionWorkspaceDatabaseKey, NotionDatabaseRef>> & { createdAt?: string; calendar?: NotionCalendarSettings | null }): Promise<void> {
    const settings = await this.currentSettings();
    const { calendar, ...rest } = patch;
    const workspace = { ...settings.notionWorkspace, ...rest };
    if (calendar === null) delete workspace.calendar;
    else if (calendar) workspace.calendar = calendar;
    const next: IntegrationSettings = { ...settings, notionWorkspace: workspace };
    await this.connections.update(this.prisma, INTEGRATION_PROVIDER.NOTION, { settings: next as Prisma.InputJsonObject });
  }

  private async requireTools(session: McpSession, names: string[]): Promise<Map<string, McpToolInfo>> {
    const tools = new Map((await session.listTools()).map((tool) => [tool.name, tool]));
    const missing = names.filter((name) => !tools.has(name));
    if (missing.length > 0) throw new AppException('INT-005', `Notion MCP 서버에 ${missing.join(', ')} 도구가 없어요`);
    return tools;
  }

  private async syncTools(session: McpSession): Promise<SyncTools> {
    const tools = await this.requireTools(session, [NOTION_CREATE_PAGES_TOOL, NOTION_UPDATE_PAGE_TOOL]);
    return {
      createPages: tools.get(NOTION_CREATE_PAGES_TOOL) as McpToolInfo,
      updatePage: tools.get(NOTION_UPDATE_PAGE_TOOL) as McpToolInfo,
      createEvents: tools.get(NOTION_CALENDAR_CREATE_TOOL),
      updateEvents: tools.get(NOTION_CALENDAR_UPDATE_TOOL),
    };
  }

  // ── Notion 캘린더 (이슈 #391 2단계) ──

  /** 회사 Notion 계정에 연결된 캘린더. 하나도 없으면 빈 배열 (Notion 캘린더에 Google 캘린더를 연결하지 않았다) */
  listCalendars(): Promise<NotionCalendarOption[]> {
    return this.mcp.withSession(INTEGRATION_PROVIDER.NOTION, (session) => this.readCalendars(session));
  }

  private async readCalendars(session: McpSession): Promise<NotionCalendarOption[]> {
    const tool = (await session.listTools()).find((t) => t.name === NOTION_CALENDAR_LIST_TOOL);
    if (!tool) throw new AppException('INT-005', `Notion MCP 서버에 캘린더 도구(${NOTION_CALENDAR_LIST_TOOL})가 없어요. Notion을 다시 연결해 보고, 그래도 없으면 Notion 캘린더를 쓸 수 있는 계정인지 확인해 주세요`);
    return readCalendarList(await session.callTool(tool.name, {}));
  }

  /**
   * 일정을 함께 만들 캘린더와 초대 여부를 정한다. 고른 캘린더는 목록에 있고 쓸 수 있어야 한다.
   * 캘린더를 바꾸면 옛 캘린더의 일정 id를 지우고 앞으로의 일정(지난 30일 포함)을 새 캘린더에 만든다. 옛 캘린더의 일정은 지우지 않는다.
   * 초대 여부만 바꾸면 같은 일정들을 다시 보낸다(켜면 참석자가 더해진다).
   */
  async updateCalendar(input: NotionCalendarSettingsInput): Promise<void> {
    await this.enqueue(async () => {
      const settings = await this.currentSettings();
      if (!readyWorkspace(settings)) throw new AppException('COM-004', '먼저 Notion 업무 공간을 만들어 주세요', 409);
      const current = settings.notionWorkspace?.calendar ?? null;
      let next: NotionCalendarSettings | null = current;
      if (input.accountId === null) {
        next = null;
      } else if (input.accountId !== undefined || input.calendarId !== undefined) {
        const { accountId, calendarId } = input;
        if (!accountId || !calendarId) throw new AppException('COM-004', '캘린더 계정과 캘린더를 함께 골라 주세요');
        const options = await this.mcp.withSession(INTEGRATION_PROVIDER.NOTION, (session) => this.readCalendars(session));
        const option = options.find((o) => o.accountId === accountId && o.calendarId === calendarId);
        if (!option) throw new AppException('COM-004', '고른 캘린더를 Notion에서 찾을 수 없어요. 캘린더 목록을 다시 불러와 주세요');
        if (option.writable === false) throw new AppException('COM-004', '일정을 만들 수 없는(읽기 전용) 캘린더예요. 다른 캘린더를 골라 주세요');
        next = { accountId, calendarId, name: option.name, accountEmail: option.accountEmail, sendInvites: input.sendInvites ?? current?.sendInvites ?? false };
      } else if (input.sendInvites !== undefined) {
        if (!current) throw new AppException('COM-004', '먼저 캘린더를 골라 주세요');
        next = { ...current, sendInvites: input.sendInvites };
      }
      await this.saveWorkspace({ calendar: next });
      if (!next) return;
      const moved = !current || current.accountId !== next.accountId || current.calendarId !== next.calendarId;
      if (moved || current.sendInvites !== next.sendInvites) {
        await this.repository.resetScheduleEventCalendarSync(this.prisma, new Date(Date.now() - NOTION_BACKFILL_DAYS * DAY_MS), moved);
      }
      // 관리자가 캘린더를 다시 저장하면(권한을 고친 뒤 등) 미룬 일정을 바로 다시 해 본다
      this.failures.scheduleEvents.clear();
    });
    this.kick();
  }

  // ── 회의록 직접 내보내기 ──

  /**
   * 업무 공간이 있을 때 "Notion으로 내보내기"는 상위 페이지가 아니라 회의록 데이터베이스에 페이지를 만든다. 새 페이지 주소를 돌려준다.
   * 이미 만들었거나 다른 쪽(자동 반영·다른 사람)이 만드는 중이면 VOC-008. 만들어졌는지 알 수 없으면 INT-009(잡기를 남겨 바로 다시 만들지 않는다).
   */
  exportMeeting(id: number): Promise<string> {
    return this.enqueue(async () => {
      const ws = await this.readyContext();
      if (!ws) throw new AppException('INT-002', 'Notion 업무 공간을 쓸 수 없어요. 관리자가 연결과 업무 공간을 확인해 주세요');
      const url = await this.mcp.withSession(INTEGRATION_PROVIDER.NOTION, async (session) => {
        const tools = await this.syncTools(session);
        try {
          return await this.createMeetingPage(session, tools, ws, id);
        } catch (error) {
          if (error instanceof AppException || isRejectedBeforeRun(error)) throw error;
          this.logger.warn(`회의록 ${id}: Notion 페이지 만들기 결과를 알 수 없음: ${messageOf(error)}`);
          throw new AppException('INT-009', 'Notion 페이지가 만들어졌는지 확인하지 못했어요. 회의록 데이터베이스에 이미 생겼는지 Notion에서 확인해 주세요');
        }
      });
      if (url) return url;
      const row = await this.repository.findMeeting(this.prisma, id);
      if (row?.notionPageUrl) throw new AppException('VOC-008');
      throw new AppException('VOC-008', '지금 다른 곳에서 이 회의록을 Notion으로 내보내는 중이거나, 직전 내보내기 결과를 확인하지 못했어요. Notion을 확인하고 잠시 뒤 새로 불러와 주세요');
    });
  }

  /**
   * 회의록 하나를 잡고(직접 내보내기와 같은 notion_exported_at 잡기) 회의록 데이터베이스에 페이지를 만든다. 잡지 못하면 null.
   * Notion이 만들지 않은 것이 확실한 실패면 잡기를 풀고, 결과를 알 수 없으면 잡기를 남긴다 (만료되면 다시 잡을 수 있다).
   */
  private async createMeetingPage(session: McpSession, tools: SyncTools, ws: ReadyWorkspace, id: number): Promise<string | null> {
    const claimedAt = new Date();
    const { count } = await this.repository.claimMeeting(this.prisma, id, claimedAt, new Date(claimedAt.getTime() - NOTION_EXPORT_STALE_MS));
    if (count === 0) return null;
    let page: { id: string; url: string };
    let syncedAt: Date;
    try {
      // 잡기가 updated_at을 바꿨으므로 잡은 뒤에 읽어 그 값을 반영 시각으로 적는다
      const row = await this.repository.findMeeting(this.prisma, id);
      if (!row) throw new AppException('VOC-001');
      syncedAt = row.updatedAt;
      const draft = this.meetingDraft(row);
      const result = await session.callTool(tools.createPages.name, buildCreateRowsArgs(tools.createPages, ws.meetingMinutes.dataSourceId, [draft]));
      const pages = readCreatedPages(result, 1);
      if (!pages) throw new UncertainCreateError('Notion 페이지 만들기 응답에 페이지 id가 없어요');
      page = pages[0];
    } catch (error) {
      if (error instanceof AppException || isRejectedBeforeRun(error)) await this.repository.releaseMeeting(this.prisma, id, claimedAt);
      throw error;
    }
    const finished = await this.repository.finishMeetingPage(this.prisma, id, page, new Date(), syncedAt, claimedAt);
    if (finished.length === 0) {
      this.logger.error(`회의록 ${id}: Notion 페이지(${page.url})를 만들었지만 잡기를 잃어 주소를 저장하지 못했어요`);
      throw new AppException('COM-001', `Notion 페이지(${page.url})는 만들었지만 회의록에 주소를 남기지 못했어요. 새로 불러와 중복 페이지가 없는지 Notion에서 확인해 주세요`);
    }
    return page.url;
  }

  private meetingDraft(row: NotionMeetingRow): { properties: NotionProperties; content: string } {
    const view = toMeetingMinutesView(row);
    return {
      properties: meetingProperties({
        id: row.id,
        title: meetingNotionTitle(view),
        meetingDate: row.meetingDate,
        attendeeNames: view.attendees.map((a) => a.employeeName),
        creatorName: view.creator.name,
        confirmedAt: row.confirmedAt,
        erpUrl: erpUrl(clientBaseUrl(), `/meetings?id=${row.id}`),
      }),
      content: buildMeetingNotionMarkdown(view),
    };
  }

  // ── 자동 반영 ──

  private excluded(kind: SyncKind): number[] {
    const now = Date.now();
    return [...this.failures[kind]].filter(([, failure]) => failure.until > now).map(([id]) => id);
  }

  private succeeded(kind: SyncKind, id: number): void {
    this.failures[kind].delete(id);
  }

  private failed(kind: SyncKind, ids: number[], error: unknown, uncertain: boolean): void {
    const message = messageOf(error);
    for (const id of ids) {
      const failures = (this.failures[kind].get(id)?.failures ?? 0) + 1;
      const wait = uncertain ? UNCERTAIN_BACKOFF_MS : Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_MAX_MS);
      this.failures[kind].set(id, { failures, until: Date.now() + wait });
    }
    this.lastSyncError = message.slice(0, 500);
    this.logger.warn(`Notion ${NOTION_DATABASE_TITLES[kind]} 반영 실패 (id ${ids.join(', ')}): ${message}`);
  }

  /**
   * 행 몇 개를 반영한다. 행의 실패는 표시만 남기고 넘어간다. 인증 실패와 전송 실패(시간 초과·연결 끊김)는 다음 행도 실패할 것이라
   * 다시 던져 이번 반영을 멈춘다 (withSession이 연결 오류로 남긴다). 만드는 중 결과를 알 수 없으면 오래 미룬다.
   */
  private async guard(kind: SyncKind, ids: number[], creating: boolean, task: () => Promise<void>, clearOnSuccess = true): Promise<boolean> {
    try {
      await task();
      if (clearOnSuccess) for (const id of ids) this.succeeded(kind, id);
      return true;
    } catch (error) {
      if (isAuthFailure(error)) throw error;
      const uncertain = creating && (error instanceof UncertainCreateError || isTransportFailure(error));
      this.failed(kind, ids, error, uncertain);
      if (isTransportFailure(error)) throw error;
      return false;
    }
  }

  private async sweep(): Promise<void> {
    if (this.stopped) return;
    const row = await this.connections.findByProviderKey(this.prisma, INTEGRATION_PROVIDER.NOTION);
    if (!row?.oauthTokens) return;
    const settings = readSettings(row.settings);
    const ws = readyWorkspace(settings);
    if (!ws) return;
    const now = Date.now();
    const repair = workspaceNeedsRepair(ws) && (this.lastRepairAt === null || now - this.lastRepairAt > REPAIR_RETRY_MS);
    const since = new Date(now - NOTION_BACKFILL_DAYS * DAY_MS);
    const staleBefore = new Date(now - NOTION_EXPORT_STALE_MS);
    const skip = { meetingMinutes: this.excluded('meetingMinutes'), scheduleEvents: this.excluded('scheduleEvents'), tasks: this.excluded('tasks') };
    const meetingIds = (await this.repository.findMeetingIdsToCreate(this.prisma, staleBefore, skip.meetingMinutes, ROWS_PER_RUN)).map((m) => m.id);
    const meetings = (await this.repository.findMeetingIdsToUpdate(this.prisma, skip.meetingMinutes, ROWS_PER_RUN)).map((m) => m.id);
    const events = await this.repository.findDirtyScheduleEvents(this.prisma, since, skip.scheduleEvents, ROWS_PER_RUN);
    const tasks = await this.repository.findDirtyTasks(this.prisma, since, skip.tasks, ROWS_PER_RUN);
    if (meetingIds.length + meetings.length + events.length + tasks.length === 0 && !repair) {
      this.lastSyncedAt = new Date();
      return;
    }

    let progressed = false;
    try {
      await this.mcp.withSession(INTEGRATION_PROVIDER.NOTION, async (session) => {
        if (repair) {
          this.lastRepairAt = now;
          await this.repairWorkspace(session, new Map((await session.listTools()).map((t) => [t.name, t])), settings.parentPageId ?? null);
        }
        const tools = await this.syncTools(session);
        // 회의록을 먼저 만들어 같은 회의에서 나온 일정·업무가 회의록 페이지 주소를 가리키게 한다
        for (const id of meetingIds) {
          progressed = (await this.guard('meetingMinutes', [id], true, async () => void (await this.createMeetingPage(session, tools, ws, id)))) || progressed;
        }
        for (const id of meetings) progressed = (await this.updateMeeting(session, tools, id)) || progressed;
        progressed = (await this.syncScheduleEvents(session, tools, ws, events)) || progressed;
        progressed = (await this.syncTasks(session, tools, ws, tasks)) || progressed;
      });
      this.lastSyncedAt = new Date();
      if (Object.values(this.failures).every((map) => map.size === 0)) this.lastSyncError = null;
    } catch (error) {
      this.lastSyncError = messageOf(error).slice(0, 500);
      this.logger.warn(`Notion 업무 공간 반영을 멈췄어요: ${this.lastSyncError}`);
      return;
    }
    // 한 번에 다 읽지 못했으면 이어서 돈다 (실패만 남았으면 다음 주기에)
    const full = [meetingIds, meetings, events, tasks].some((rows) => rows.length >= ROWS_PER_RUN);
    if (full && progressed) this.kick();
  }

  private async updateMeeting(session: McpSession, tools: SyncTools, id: number): Promise<boolean> {
    return this.guard('meetingMinutes', [id], false, async () => {
      const row = await this.repository.findMeeting(this.prisma, id);
      const pageId = row?.notionPageId;
      if (!row || !pageId) return;
      const draft = this.meetingDraft(row);
      readUpdateResult(await session.callTool(tools.updatePage.name, buildUpdatePropertiesArgs(tools.updatePage, pageId, draft.properties)));
      readUpdateResult(await session.callTool(tools.updatePage.name, buildReplaceContentArgs(tools.updatePage, pageId, draft.content)));
      await this.repository.markMeetingSynced(this.prisma, row.id, row.updatedAt);
    });
  }

  /** 원본 회의록: Notion 회의록 페이지가 있으면 그 주소, 없으면 ERP 회의록 화면 */
  private meetingUrlOf(meeting: { id: number; notionPageUrl: string | null } | null): string | null {
    if (!meeting) return null;
    return meeting.notionPageUrl ?? erpUrl(clientBaseUrl(), `/meetings?id=${meeting.id}`);
  }

  private scheduleEventDraft(row: NotionScheduleEventRow): NotionProperties {
    return scheduleEventProperties({
      id: row.id,
      title: row.scheduleEventTitle,
      description: row.scheduleEventDescription,
      startAt: row.startAt,
      endAt: row.endAt,
      attendeeNames: row.attendees.map((a) => a.employee.employeeName),
      creatorName: row.creator.employeeName,
      meetingUrl: this.meetingUrlOf(row.meetingMinutes),
      erpUrl: erpUrl(clientBaseUrl(), row.linkPath ?? scheduleWeekLink(seoulIso(row.startAt))),
    });
  }

  private taskDraft(row: NotionTaskRow): NotionProperties {
    return taskProperties({
      id: row.id,
      title: row.taskTitle,
      description: row.taskDescription,
      status: row.taskStatus as TaskStatus,
      assigneeName: row.assignee.employeeName,
      creatorName: row.creator.employeeName,
      dueDate: row.dueDate,
      source: row.meetingMinutes ? 'MEETING' : row.messageId !== null ? 'MESSAGE' : 'DIRECT',
      meetingUrl: this.meetingUrlOf(row.meetingMinutes),
      erpUrl: erpUrl(clientBaseUrl(), row.linkPath ?? '/tasks'),
    });
  }

  /**
   * 일정은 데이터베이스 페이지와 (고른 캘린더가 있으면) 캘린더 일정 두 곳에 반영한다. 페이지 id·일정 id는 만들자마자 적어
   * 한쪽이 실패해도 다음에 다른 쪽을 또 만들지 않는다. 두 곳 모두 반영해야 notion_synced_at을 적는다.
   */
  private async syncScheduleEvents(session: McpSession, tools: SyncTools, ws: ReadyWorkspace, rows: NotionScheduleEventRow[]): Promise<boolean> {
    const since = new Date(Date.now() - NOTION_BACKFILL_DAYS * DAY_MS);
    const pages = await this.syncRows(session, tools, ws.scheduleEvents, 'scheduleEvents', rows, (row) => this.scheduleEventDraft(row), (row, pageId) => this.repository.setScheduleEventPage(this.prisma, row.id, pageId), false);
    let progressed = pages.progressed;
    for (const row of rows) {
      if (!pages.done.has(row.id)) continue;
      const creating = ws.calendar !== null && row.notionCalendarEventId === null;
      progressed = (await this.guard('scheduleEvents', [row.id], creating, () => this.syncCalendarEvent(session, tools, ws.calendar, row, since))) || progressed;
    }
    return progressed;
  }

  private calendarDraft(row: NotionScheduleEventRow, calendar: NotionCalendarSettings): CalendarEventDraft {
    return {
      title: row.scheduleEventTitle,
      description: row.scheduleEventDescription,
      startAt: row.startAt,
      endAt: row.endAt,
      erpUrl: erpUrl(clientBaseUrl(), row.linkPath ?? scheduleWeekLink(seoulIso(row.startAt))),
      // 초대를 켰을 때만 메일이 있는 참석자를 보낸다 (Google 캘린더가 초대 메일을 보낸다)
      attendees: calendar.sendInvites ? row.attendees.flatMap((a) => (a.employee.email ? [{ email: a.employee.email, displayName: a.employee.employeeName }] : [])) : null,
    };
  }

  /** 고른 캘린더에 일정을 만들거나 고친 뒤 반영 시각을 적는다. 캘린더가 없거나 페이지만 있는 지난 일정이면 반영 시각만 적는다 */
  private async syncCalendarEvent(session: McpSession, tools: SyncTools, calendar: NotionCalendarSettings | null, row: NotionScheduleEventRow, since: Date): Promise<void> {
    if (calendar) {
      const draft = this.calendarDraft(row, calendar);
      if (row.notionCalendarEventId) {
        const tool = this.calendarTool(tools.updateEvents, NOTION_CALENDAR_UPDATE_TOOL);
        readCalendarUpdateResult(await session.callTool(tool.name, buildUpdateCalendarEventArgs(tool, calendar, row.notionCalendarEventId, draft)));
      } else if (row.endAt >= since) {
        const tool = this.calendarTool(tools.createEvents, NOTION_CALENDAR_CREATE_TOOL);
        const ids = readCreatedCalendarEvents(await session.callTool(tool.name, buildCreateCalendarEventArgs(tool, calendar, draft)), 1);
        if (!ids) throw new UncertainCreateError('Notion 캘린더 일정 만들기 응답에서 일정 id를 읽지 못했어요');
        await this.repository.setScheduleEventCalendarEvent(this.prisma, row.id, ids[0]);
      }
    }
    await this.repository.markScheduleEventSynced(this.prisma, row.id, row.updatedAt);
  }

  private calendarTool(tool: McpToolInfo | undefined, name: string): McpToolInfo {
    if (!tool) throw new AppException('INT-005', `Notion MCP 서버에 캘린더 도구(${name})가 없어요`);
    return tool;
  }

  private async syncTasks(session: McpSession, tools: SyncTools, ws: ReadyWorkspace, rows: NotionTaskRow[]): Promise<boolean> {
    const result = await this.syncRows(session, tools, ws.tasks, 'tasks', rows, (row) => this.taskDraft(row), (row, pageId) => this.repository.markTaskSynced(this.prisma, row.id, pageId, row.updatedAt));
    return result.progressed;
  }

  /**
   * 페이지가 없는 행은 여러 개씩 만들고, 있는 행은 속성만 고친다. 페이지를 반영한 행마다 mark를 부르고, 그 행과 페이지 id를 돌려준다.
   * 여러 개를 한 번에 만들다 Notion이 오류로 답하면(만들지 않았다) 어느 행 때문인지 알 수 없어 하나씩 다시 만든다.
   * clearOnSuccess가 false면 실패 표시를 지우지 않는다 (일정은 캘린더까지 반영한 뒤에 지운다).
   */
  private async syncRows<R extends { id: number; notionPageId: string | null; updatedAt: Date }>(
    session: McpSession,
    tools: SyncTools,
    ref: NotionDatabaseRef,
    kind: SyncKind,
    rows: R[],
    draft: (row: R) => NotionProperties,
    mark: (row: R, pageId: string) => Promise<unknown>,
    clearOnSuccess = true,
  ): Promise<{ progressed: boolean; done: Map<number, string> }> {
    let progressed = false;
    const done = new Map<number, string>();
    const create = async (batch: R[]) => {
      const result = await session.callTool(tools.createPages.name, buildCreateRowsArgs(tools.createPages, ref.dataSourceId, batch.map((row) => ({ properties: draft(row) }))));
      const pages = readCreatedPages(result, batch.length);
      if (!pages) throw new UncertainCreateError('Notion 페이지 만들기 응답에서 만든 페이지를 모두 읽지 못했어요');
      for (const [i, row] of batch.entries()) {
        await mark(row, pages[i].id);
        done.set(row.id, pages[i].id);
      }
    };
    for (const batch of chunks(rows.filter((row) => row.notionPageId === null), CREATE_BATCH_SIZE)) {
      try {
        await create(batch);
        if (clearOnSuccess) for (const row of batch) this.succeeded(kind, row.id);
        progressed = true;
      } catch (error) {
        if (batch.length > 1 && error instanceof AppException) {
          for (const row of batch) progressed = (await this.guard(kind, [row.id], true, () => create([row]), clearOnSuccess)) || progressed;
          continue;
        }
        // 한 개짜리이거나 결과를 알 수 없는 실패: guard와 같이 다룬다
        await this.guard(kind, batch.map((row) => row.id), true, () => Promise.reject(error));
      }
    }
    for (const row of rows) {
      const pageId = row.notionPageId;
      if (pageId === null) continue;
      progressed =
        (await this.guard(
          kind,
          [row.id],
          false,
          async () => {
            readUpdateResult(await session.callTool(tools.updatePage.name, buildUpdatePropertiesArgs(tools.updatePage, pageId, draft(row))));
            await mark(row, pageId);
            done.set(row.id, pageId);
          },
          clearOnSuccess,
        )) || progressed;
    }
    return { progressed, done };
  }
}
