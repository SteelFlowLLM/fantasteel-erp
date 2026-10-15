import { Injectable } from '@nestjs/common';
import {
  BUSINESS_EVENT_TYPE,
  MEETING_ANALYSIS_MAX_CHARS,
  MEETING_MINUTES_STATUS,
  missingFieldsOf,
  NOTIFICATION_TYPE,
  type AuthUser,
  type MeetingAnalysis,
  type MeetingCandidate,
  type MeetingCandidateRegistered,
  type MeetingRegisterResult,
  type MeetingMinutesListItem,
  type MeetingMinutesPage,
  type MeetingMinutesStatus,
  type MeetingMinutesView,
  type Role,
  type TranscriptSegment,
} from '@fantasteel/shared';
import { BusinessEventRecorder } from '../../common/business-event/business-event.recorder';
import { AppException } from '../../common/errors/app.exception';
import { MessageActionService } from '../message-action/message-action.service';
import { NotificationService } from '../notification/notification.service';
import { TaskService } from '../notification/task.service';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import type { CreateMeetingMinutesAudioDto, CreateMeetingMinutesDto, ListMeetingMinutesQuery, UpdateMeetingCandidateDto, UpdateMeetingSpeakersDto, UpdateMeetingSummaryDto } from './dto/meeting-minutes.dto';
import { applyCandidateEdit, employeeIdsIn } from './meeting-candidate.rules';
import { MeetingAnalysisRunner } from './meeting-analysis.runner';
import { isMeetingAudio } from './meeting-audio';
import { readAnalysis, readSegments, summarizeSpeakers } from './meeting-minutes.json';
import { MeetingTranscriptionRunner } from './meeting-transcription.runner';
import { MeetingMinutesRepository, type MeetingMinutesDetailRow, type MeetingMinutesListRow } from './meeting-minutes.repository';

const DEFAULT_PAGE_SIZE = 20;

/** multer가 넘기는 업로드 파일 중 쓰는 값 */
export interface UploadedMeetingAudio {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}


/** multer는 파일 이름을 latin1로 읽어서 한글이 깨진다 */
function decodeFileName(name: string): string {
  return Buffer.from(name, 'latin1').toString('utf8') || 'audio';
}

/** multipart 글 칸은 문자열이라 attendeeIds는 JSON 배열 문자열로 받는다 */
function parseAttendeeIds(value: string): number[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new AppException('COM-004', '참석자 id가 올바르지 않아요');
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 100 || !parsed.every((v) => Number.isInteger(v))) {
    throw new AppException('COM-004', '참석자를 1명 이상 골라 주세요');
  }
  return parsed as number[];
}

/** 알림 문구용 `M/D HH:mm` (+09:00 ISO에서 그대로 읽는다) */
function shortSeoulTime(iso: string): string {
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))} ${iso.slice(11, 16)}`;
}

/** 알림이 여는 내 일정 주: 일정이 있는 날(+09:00 ISO의 날짜)이 속한 주의 월요일 */
function scheduleWeekLink(iso: string): string {
  const day = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  const monday = new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * 86_400_000);
  return `/schedule?week=${monday.toISOString().slice(0, 10)}`;
}

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

function parseMeetingDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || dateOnly(date) !== value) throw new AppException('COM-004', `회의일 ${value}는 없는 날짜예요`);
  return date;
}

/** 한 줄이 한 발언이다. 글로 넣은 전사라 시간이 없다 */
function splitSegments(transcript: string): Prisma.InputJsonArray {
  return transcript
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((text) => ({ start: null, end: null, text }));
}

function toListItem(row: MeetingMinutesListRow): MeetingMinutesListItem {
  return {
    id: row.id,
    meetingMinutesTitle: row.meetingMinutesTitle,
    meetingDate: dateOnly(row.meetingDate),
    meetingMinutesStatus: row.meetingMinutesStatus as MeetingMinutesStatus,
    attendeeCount: row._count.attendees,
    creatorId: row.creatorId,
    creatorName: row.creator.employeeName,
    createdAt: row.createdAt.toISOString(),
  };
}

function toView(row: MeetingMinutesDetailRow): MeetingMinutesView {
  return {
    id: row.id,
    meetingMinutesTitle: row.meetingMinutesTitle,
    meetingDate: dateOnly(row.meetingDate),
    meetingMinutesStatus: row.meetingMinutesStatus as MeetingMinutesStatus,
    transcript: row.transcript,
    transcriptSegments: readSegments(row.transcriptSegments),
    speakers: summarizeSpeakers(readSegments(row.transcriptSegments)),
    summary: row.summary,
    analysisResult: readAnalysis(row.analysisResult),
    failureReason: row.failureReason,
    creator: { id: row.creator.id, name: row.creator.employeeName },
    attendees: row.attendees.map((a) => ({
      employeeId: a.employeeId,
      employeeName: a.employee.employeeName,
      departmentName: a.employee.department.departmentName,
      roleCode: a.employee.role.roleCode as Role,
    })),
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * 회의록 (REQ-VOC-002·003, BP-VOC-01). 글·음성 전사를 저장하고, 작성자가 AI 정리를 시키면 후보를 만들어 둔다(등록은 다음 단계).
 * 작업 로그는 남기지 않는다 (REQ-LOG-002 이벤트에 회의록 생성이 없다). 전 역할이 쓰므로 권한 코드 없이 로그인만 본다.
 */
@Injectable()
export class MeetingMinutesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: MeetingMinutesRepository,
    private readonly runner: MeetingTranscriptionRunner,
    private readonly analysisRunner: MeetingAnalysisRunner,
    private readonly tasks: TaskService,
    private readonly notifications: NotificationService,
    private readonly messageActions: MessageActionService,
    private readonly businessEventRecorder: BusinessEventRecorder,
  ) {}

  /** API-258. 텍스트 입력은 STT를 건너뛰므로 TRANSCRIBED로 시작한다 */
  async create(user: AuthUser, dto: CreateMeetingMinutesDto): Promise<MeetingMinutesView> {
    if (!dto.transcript.trim()) throw new AppException('COM-004', '회의 기록을 입력해 주세요');
    const id = await this.createRecord(user, dto, {
      meetingMinutesStatus: MEETING_MINUTES_STATUS.TRANSCRIBED,
      transcript: dto.transcript,
      transcriptSegments: splitSegments(dto.transcript),
    });
    return this.get(id);
  }

  /**
   * 음성으로 만든다. TRANSCRIBING 행만 만들고 바로 돌려주며, 전사는 응답 뒤 runner가 한다.
   * 원본 음성은 메모리에서 runner로만 넘기고 디스크·DB에 두지 않는다 (BP-VOC-01).
   */
  async createFromAudio(user: AuthUser, dto: CreateMeetingMinutesAudioDto, file: UploadedMeetingAudio | undefined): Promise<MeetingMinutesView> {
    if (!file) throw new AppException('COM-004', '음성 파일을 골라 주세요 (file 필드)');
    const fileName = decodeFileName(file.originalname);
    if (!isMeetingAudio(file.mimetype, fileName)) throw new AppException('COM-004', '오디오 파일만 올릴 수 있어요');
    const attendeeIds = parseAttendeeIds(dto.attendeeIds);
    const id = await this.createRecord(
      user,
      { meetingMinutesTitle: dto.meetingMinutesTitle, meetingDate: dto.meetingDate, attendeeIds },
      { meetingMinutesStatus: MEETING_MINUTES_STATUS.TRANSCRIBING, transcript: null, transcriptSegments: Prisma.DbNull },
    );
    void this.runner.enqueue({ meetingMinutesId: id, audio: file.buffer, fileName, mimeType: file.mimetype || 'application/octet-stream', speakerCount: new Set(attendeeIds).size });
    return this.get(id);
  }

  /** 글·음성 만들기가 같이 쓰는 검증과 한 트랜잭션 저장 */
  private async createRecord(
    user: AuthUser,
    input: { meetingMinutesTitle: string; meetingDate: string; attendeeIds: number[] },
    initial: Pick<Prisma.MeetingMinutesUncheckedCreateInput, 'meetingMinutesStatus' | 'transcript' | 'transcriptSegments'>,
  ): Promise<number> {
    const title = input.meetingMinutesTitle.trim();
    if (!title) throw new AppException('COM-004', '제목을 입력해 주세요');
    const meetingDate = parseMeetingDate(input.meetingDate);
    const attendeeIds = [...new Set(input.attendeeIds)];
    if (attendeeIds.length === 0) throw new AppException('COM-004', '참석자를 1명 이상 골라 주세요');

    return this.prisma.$transaction(async (tx) => {
      const found = new Set((await this.repository.findActiveEmployeeIds(tx, attendeeIds)).map((e) => e.id));
      const missing = attendeeIds.filter((employeeId) => !found.has(employeeId));
      if (missing.length > 0) throw new AppException('VOC-002', `참석자로 고른 사원을 찾을 수 없어요 (사원 id ${missing.join(', ')})`);
      const created = await this.repository.createMeetingMinutes(tx, { meetingMinutesTitle: title, meetingDate, creatorId: user.employeeId, ...initial });
      await this.repository.createAttendees(tx, created.id, attendeeIds);
      return created.id;
    });
  }

  /**
   * API-260. 작성자가 AI 정리를 시킨다. 조건부로 ANALYZING으로 바꾸고 바로 돌려주며, 분석은 응답 뒤 runner가 한다.
   * 전사가 있는 TRANSCRIBED·REVIEW(다시 정리)·FAILED만 허용한다. 두 번 눌러도 한 번만 시작되게 UPDATE 조건에 상태를 건다.
   */
  async analyze(user: AuthUser, id: number): Promise<MeetingMinutesView> {
    const row = await this.repository.findDetail(this.prisma, id);
    if (!row) throw new AppException('VOC-001');
    if (row.creator.id !== user.employeeId) throw new AppException('VOC-003');
    if (row.transcript === null || row.transcript.trim() === '') throw new AppException('VOC-004');
    if (row.transcript.length > MEETING_ANALYSIS_MAX_CHARS) throw new AppException('VOC-005');
    const { count } = await this.repository.startAnalysis(this.prisma, id);
    if (count === 0) throw new AppException('VOC-004');
    void this.analysisRunner.enqueue({ meetingMinutesId: id });
    return this.get(id);
  }

  /**
   * 화자 이름표(SPEAKER_n)를 회의 참석자에게 연결한다 (Voice2ERP 묶음 1). 연결은 각 구간에 speakerEmployeeId·speakerName으로 적어 두므로
   * 이름표 → 사원 표는 구간에서 다시 만들 수 있다. 보내지 않은 이름표는 그대로 두고, 값이 null이면 '모름'으로 되돌린다.
   * AI 정리 전에 하는 것이 목적이라 TRANSCRIBED·REVIEW·전사가 남은 FAILED에서 할 수 있다 (정리를 다시 해야 이름이 반영된다).
   */
  async updateSpeakers(user: AuthUser, id: number, dto: UpdateMeetingSpeakersDto): Promise<MeetingMinutesView> {
    const row = await this.repository.findDetail(this.prisma, id);
    if (!row) throw new AppException('VOC-001');
    if (row.creator.id !== user.employeeId) throw new AppException('VOC-003', '회의록 작성자만 화자를 연결할 수 있어요');
    const segments = readSegments(row.transcriptSegments);
    const allowed: string[] = [MEETING_MINUTES_STATUS.TRANSCRIBED, MEETING_MINUTES_STATUS.REVIEW, MEETING_MINUTES_STATUS.FAILED];
    if (!allowed.includes(row.meetingMinutesStatus) || row.transcript === null) throw new AppException('VOC-004', '전사가 끝났고 확정 전인 회의록만 화자를 연결할 수 있어요');

    const labels = new Set(segments.flatMap((s) => (s.speaker ? [s.speaker] : [])));
    const entries = Object.entries(dto.mapping);
    if (entries.some(([, employeeId]) => employeeId !== null && !Number.isInteger(employeeId))) throw new AppException('COM-004', '화자에 연결할 사원 id가 올바르지 않아요');
    const unknown = entries.filter(([label]) => !labels.has(label)).map(([label]) => label);
    if (unknown.length > 0) throw new AppException('COM-004', `이 회의록에 없는 화자예요 (${unknown.join(', ')})`);
    const attendeeNames = new Map(row.attendees.map((a) => [a.employeeId, a.employee.employeeName]));
    for (const [label, employeeId] of entries) {
      if (employeeId !== null && !attendeeNames.has(employeeId)) throw new AppException('VOC-002', `${label}에 고른 사원은 이 회의의 참석자가 아니에요 (사원 id ${employeeId})`);
    }

    const mapping = new Map(entries);
    const updated: TranscriptSegment[] = segments.map((s) => {
      if (!s.speaker || !mapping.has(s.speaker)) return s;
      const employeeId = mapping.get(s.speaker) ?? null;
      return { ...s, speakerEmployeeId: employeeId, speakerName: employeeId === null ? null : (attendeeNames.get(employeeId) ?? null) };
    });
    const { count } = await this.repository.saveSegments(this.prisma, id, row.updatedAt, updated as unknown as Prisma.InputJsonArray);
    if (count === 0) {
      const current = await this.repository.findDetail(this.prisma, id);
      if (current && !allowed.includes(current.meetingMinutesStatus)) throw new AppException('VOC-004', '전사가 끝났고 확정 전인 회의록만 화자를 연결할 수 있어요');
      throw new AppException('COM-001', '그 사이 다른 곳에서 회의록을 고쳤어요. 새로 불러와 주세요');
    }
    return this.get(id);
  }

  /**
   * API-261 확인 단계. 작성자만 후보를 고치고 허가·제외한다 (REQ-VOC-004). AI는 어떤 것도 스스로 등록하지 않는다.
   * 허가(APPROVED)는 그 종류의 필수 칸이 모두 찬 후보만 된다. 남은 경고(끝 시각 가정·마감일 당일)는 막지 않는다: 작성자가 확인했다는 뜻이다.
   */
  async updateCandidate(user: AuthUser, id: number, key: string, dto: UpdateMeetingCandidateDto): Promise<MeetingMinutesView> {
    const { row, analysis } = await this.loadForReview(user, id);
    const index = analysis.candidates.findIndex((c) => c.key === key);
    if (index < 0) throw new AppException('COM-003', '후보를 찾을 수 없어요');
    await this.requireReferences(this.prisma, dto);

    const edited = applyCandidateEdit(analysis.candidates[index], dto, dateOnly(row.meetingDate));
    if (dto.decision !== undefined) {
      if (dto.decision === 'APPROVED') {
        const missing = missingFieldsOf(edited);
        if (missing.length > 0) throw new AppException('VOC-006', `${missing.join(', ')}을(를) 채워야 허가할 수 있어요`);
        if (edited.kind === 'PURCHASE') await this.messageActions.assertCanRequestFromMeeting(this.prisma, user);
      }
      edited.decision = dto.decision;
    }
    const candidates = analysis.candidates.map((c, i) => (i === index ? edited : c));
    await this.saveReviewEdit(id, row.updatedAt, { ...analysis, candidates });
    return this.get(id);
  }

  /** 검토 중에 AI 요약을 작성자가 고친다. 요약 칸과 분석 결과 안의 요약을 같이 바꾼다 */
  async updateSummary(user: AuthUser, id: number, dto: UpdateMeetingSummaryDto): Promise<MeetingMinutesView> {
    const { row, analysis } = await this.loadForReview(user, id);
    const summary = dto.summary.trim();
    await this.saveReviewEdit(id, row.updatedAt, { ...analysis, summary }, summary);
    return this.get(id);
  }

  /**
   * API-261. 허가한 후보를 한 트랜잭션으로 등록하고 회의록을 확정한다 (REQ-VOC-004).
   * 업무·일정·구매요청 초안·작업 로그·알림이 모두 같이 커밋되거나 모두 취소된다. 허가·제외하지 않은 후보가 있으면 하지 않는다.
   */
  async register(user: AuthUser, id: number): Promise<MeetingRegisterResult> {
    const { row, analysis } = await this.loadForReview(user, id);
    const pending = analysis.candidates.filter((c) => c.decision === 'PENDING');
    if (pending.length > 0) throw new AppException('VOC-007', `허가 또는 제외하지 않은 후보가 ${pending.length}건 남아 있어요 (${pending.map((c) => c.title).join(', ')})`);
    const approved = analysis.candidates.filter((c) => c.decision === 'APPROVED');
    for (const c of approved) {
      const missing = missingFieldsOf(c);
      if (missing.length > 0) throw new AppException('VOC-006', `"${c.title}"의 ${missing.join(', ')}을(를) 채워야 등록할 수 있어요`);
    }
    const segments = readSegments(row.transcriptSegments);
    const attendeeIds = row.attendees.map((a) => a.employeeId);

    const created = await this.prisma.$transaction(async (tx) => {
      const { count } = await this.repository.confirm(tx, id, new Date());
      if (count === 0) throw new AppException('VOC-004', '이미 확정됐거나 검토 중이 아니에요');
      // 허가한 뒤 퇴사했거나 지워진 사원·품목이 없는지 한 번 더 본다
      await this.requireReferences(tx, {
        attendeeIds: [...new Set(approved.flatMap((c) => [...c.attendeeIds, ...(c.assigneeId === null ? [] : [c.assigneeId])]))],
      });
      await this.requireItems(
        tx,
        approved.flatMap((c) => (c.purchase?.itemId == null ? [] : [c.purchase.itemId])),
      );

      const link = `/meetings?id=${id}`;
      const taskIds: number[] = [];
      const scheduleEventIds: number[] = [];
      const actionDraftIds: number[] = [];
      const registered = new Map<string, MeetingCandidateRegistered>();

      for (const c of approved) {
        if (c.kind === 'TASK' && c.assigneeId !== null && c.dueDate !== null) {
          const evidence = c.evidence.map((i) => segments[i]?.text).filter((t): t is string => t !== undefined);
          const quote = evidence.length > 0 ? `근거 발언: ${evidence.map((t) => `"${t}"`).join(' / ')}` : null;
          const taskId = await this.tasks.createInTx(tx, user.employeeId, {
            taskTitle: c.title,
            taskDescription: [c.description, quote].filter((t): t is string => t !== null).join('\n\n') || null,
            assigneeId: c.assigneeId,
            dueDate: new Date(`${c.dueDate}T00:00:00.000Z`),
            meetingMinutesId: id,
            linkPath: link,
          });
          taskIds.push(taskId);
          registered.set(c.key, { type: 'task', id: taskId });
        } else if (c.kind === 'EVENT' && c.startAt !== null && c.endAt !== null) {
          const event = await this.repository.createScheduleEvent(
            tx,
            {
              scheduleEventTitle: c.title,
              scheduleEventDescription: c.description,
              startAt: new Date(c.startAt),
              endAt: new Date(c.endAt),
              creatorId: user.employeeId,
              linkPath: link,
              meetingMinutesId: id,
            },
            c.attendeeIds,
          );
          scheduleEventIds.push(event.id);
          registered.set(c.key, { type: 'schedule_event', id: event.id });
          await this.notifications.notifyEmployees(
            tx,
            c.attendeeIds.filter((employeeId) => employeeId !== user.employeeId),
            {
              notificationType: NOTIFICATION_TYPE.SCHEDULE_EVENT_ASSIGNED,
              notificationContent: `일정 등록 · ${c.title} · ${shortSeoulTime(c.startAt)}`,
              linkPath: scheduleWeekLink(c.startAt),
            },
          );
        } else if (c.kind === 'PURCHASE' && c.purchase !== null) {
          const draftId = await this.messageActions.createFromMeeting(
            tx,
            user,
            id,
            {
              ...c.purchase,
              requestReason: c.purchase.requestReason ?? c.title,
            },
            c.salesOrderId,
          );
          actionDraftIds.push(draftId);
          registered.set(c.key, { type: 'action_draft', id: draftId });
        }
      }

      const excludedKeys = analysis.candidates.filter((c) => c.decision === 'EXCLUDED').map((c) => c.key);
      await this.businessEventRecorder.record(tx, {
        type: BUSINESS_EVENT_TYPE.MEETING_MINUTES_CONFIRMED,
        actor: user,
        target: { table: 'meeting_minutes', id },
        before: { meetingMinutesStatus: MEETING_MINUTES_STATUS.REVIEW },
        after: {
          meetingMinutesStatus: MEETING_MINUTES_STATUS.CONFIRMED,
          taskIds,
          scheduleEventIds,
          actionDraftIds,
          excludedKeys,
        },
        isAiAssisted: true,
      });
      // 알림은 작업 로그 id를 달지 않는다: (작업 로그, 받는 사람)이 유일해서 한 사람에게 여러 알림을 보낼 수 없다
      await this.notifications.notifyEmployees(
        tx,
        attendeeIds.filter((employeeId) => employeeId !== user.employeeId),
        {
          notificationType: NOTIFICATION_TYPE.MEETING_MINUTES_SHARED,
          notificationContent: `회의록 공유 · ${row.meetingMinutesTitle}`,
          linkPath: link,
        },
      );

      const withResults: MeetingAnalysis = {
        ...analysis,
        candidates: analysis.candidates.map((c) => ({
          ...c,
          registered: registered.get(c.key) ?? null,
        })),
      };
      await this.repository.saveAnalysisResult(tx, id, withResults as unknown as Prisma.InputJsonObject);
      return { taskIds, scheduleEventIds, actionDraftIds, excludedKeys };
    });
    return { meetingMinutes: await this.get(id), ...created };
  }

  /** 작성자의 검토 중(REVIEW) 회의록과 그 분석 결과. 고치기·등록이 같은 확인을 한다 */
  private async loadForReview(user: AuthUser, id: number): Promise<{ row: MeetingMinutesDetailRow; analysis: MeetingAnalysis }> {
    const row = await this.repository.findDetail(this.prisma, id);
    if (!row) throw new AppException('VOC-001');
    if (row.creator.id !== user.employeeId) throw new AppException('VOC-003', '회의록 작성자만 후보를 확인하고 등록할 수 있어요');
    if (row.meetingMinutesStatus !== MEETING_MINUTES_STATUS.REVIEW) throw new AppException('VOC-004', '검토 대기 상태의 회의록만 확인하고 등록할 수 있어요');
    const analysis = readAnalysis(row.analysisResult);
    if (!analysis) throw new AppException('VOC-004', 'AI 정리 결과를 읽을 수 없어요. 다시 정리해 주세요');
    return { row, analysis };
  }

  private async saveReviewEdit(id: number, readUpdatedAt: Date, analysis: MeetingAnalysis, summary?: string): Promise<void> {
    const { count } = await this.repository.saveReviewEdit(this.prisma, id, readUpdatedAt, {
      analysisResult: analysis as unknown as Prisma.InputJsonObject,
      summary,
    });
    if (count > 0) return;
    // 상태가 바뀌었는지(확정·재정리), 같은 회의록을 동시에 고쳤는지 가려서 알려 준다
    const current = await this.repository.findDetail(this.prisma, id);
    if (current?.meetingMinutesStatus !== MEETING_MINUTES_STATUS.REVIEW) throw new AppException('VOC-004', '검토 대기 상태의 회의록만 확인하고 등록할 수 있어요');
    throw new AppException('COM-001', '그 사이 다른 곳에서 회의록을 고쳤어요. 새로 불러와 주세요');
  }

  /** 담당자·참석자는 사용 중인 사원(회의 참석자가 아니어도 된다), 품목은 원료여야 한다 */
  private async requireReferences(
    tx: Tx,
    input: {
      assigneeId?: number;
      attendeeIds?: number[];
      purchase?: { itemId?: number };
    },
  ): Promise<void> {
    const employeeIds = employeeIdsIn(input);
    if (employeeIds.length > 0) {
      const found = new Set((await this.repository.findActiveEmployeeIds(tx, employeeIds)).map((e) => e.id));
      const missing = employeeIds.filter((employeeId) => !found.has(employeeId));
      if (missing.length > 0) throw new AppException('VOC-002', `고른 사원을 찾을 수 없거나 퇴사했어요 (사원 id ${missing.join(', ')})`);
    }
    if (input.purchase?.itemId !== undefined) await this.requireItems(tx, [input.purchase.itemId]);
  }

  private async requireItems(tx: Tx, itemIds: number[]): Promise<void> {
    const unique = [...new Set(itemIds)];
    if (unique.length === 0) return;
    const found = new Set((await this.repository.findRawMaterialIds(tx, unique)).map((i) => i.id));
    const missing = unique.filter((itemId) => !found.has(itemId));
    if (missing.length > 0) throw new AppException('COM-004', `원료 품목을 찾을 수 없어요 (품목 id ${missing.join(', ')})`);
  }

  /** API-259 목록 */
  async list(query: ListMeetingMinutesQuery): Promise<MeetingMinutesPage> {
    const page = query.page ?? 1;
    const size = query.size ?? DEFAULT_PAGE_SIZE;
    const keyword = query.keyword?.trim();
    const where: Prisma.MeetingMinutesWhereInput = {
      meetingMinutesStatus: query.meetingMinutesStatus,
      ...(keyword ? { meetingMinutesTitle: { contains: keyword, mode: 'insensitive' } } : {}),
    };
    const [total, rows] = await Promise.all([this.repository.count(this.prisma, where), this.repository.findList(this.prisma, where, { skip: (page - 1) * size, take: size })]);
    return { items: rows.map(toListItem), page, size, total };
  }

  /** API-259 상세 */
  async get(id: number): Promise<MeetingMinutesView> {
    const row = await this.repository.findDetail(this.prisma, id);
    if (!row) throw new AppException('VOC-001');
    return toView(row);
  }
}
