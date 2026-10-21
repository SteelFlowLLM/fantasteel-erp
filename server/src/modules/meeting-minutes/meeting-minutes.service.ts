import { Injectable, Logger } from '@nestjs/common';
import {
  BUSINESS_EVENT_TYPE,
  MEETING_ANALYSIS_MAX_CHARS,
  MEETING_MINUTES_STATUS,
  missingFieldsOf,
  notionSyncOf,
  NOTIFICATION_TYPE,
  PERMISSION,
  ROLE_LABEL,
  type AuthUser,
  type MeetingAnalysis,
  type MeetingCandidate,
  type MeetingCandidateRegistered,
  type MeetingRegisterResult,
  type MeetingMinutesListItem,
  type MeetingMinutesPage,
  type MeetingMinutesStatus,
  type MeetingMinutesView,
  type MeetingNotionExportResult,
  type MeetingSpeakerSuggestResult,
  type Role,
  type TranscriptSegment,
} from '@fantasteel/shared';
import { hasPermission } from '../../common/auth/auth.guard';
import { BusinessEventRecorder } from '../../common/business-event/business-event.recorder';
import { AppException } from '../../common/errors/app.exception';
import { NOTION_EXPORT_STALE_MS } from '../integration/mcp/mcp.client';
import { GoogleDriveService } from '../integration/google-drive/google-drive.service';
import { NotionPageService } from '../integration/notion/notion-page.service';
import { NotionWorkspaceService } from '../integration/notion/notion-workspace.service';
import { MessageActionService } from '../message-action/message-action.service';
import { NotificationService } from '../notification/notification.service';
import { scheduleWeekLink, shortSeoulTime } from '../schedule-event/schedule-notice';
import { TaskService } from '../notification/task.service';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import type { CreateMeetingMinutesAudioDto, CreateMeetingMinutesDto, CreateMeetingMinutesFromDriveDto, ListMeetingMinutesQuery, UpdateMeetingAttendeesDto, UpdateMeetingCandidateDto, UpdateMeetingSpeakersDto, UpdateMeetingSummaryDto } from './dto/meeting-minutes.dto';
import { MeetingCandidateContextService } from './meeting-candidate.context';
import { applyCandidateEdit, employeeIdsIn } from './meeting-candidate.rules';
import { MeetingAnalysisRunner } from './meeting-analysis.runner';
import { isMeetingAudio } from './meeting-audio';
import { readAnalysis, readSegments } from './meeting-minutes.json';
import { buildMeetingNotionMarkdown, meetingNotionTitle } from './meeting-notion.markdown';
import { MeetingSpeakerSuggester } from './meeting-speaker-suggest';
import { MeetingTranscriptionRunner } from './meeting-transcription.runner';
import { MeetingMinutesRepository, type MeetingMinutesDetailRow, type MeetingMinutesListRow } from './meeting-minutes.repository';
import { toMeetingMinutesView as toView } from './meeting-minutes.view';

const DEFAULT_PAGE_SIZE = 20;
/** 화자를 연결·추정할 수 있는 상태: 전사가 끝났고 확정 전 */
const SPEAKER_OPEN_STATUSES: readonly string[] = [MEETING_MINUTES_STATUS.TRANSCRIBED, MEETING_MINUTES_STATUS.REVIEW, MEETING_MINUTES_STATUS.FAILED];
/**
 * 지우기·참석자 고치기를 할 수 있는 상태 (이슈 #449). 확정한 회의록은 업무·일정·구매요청 초안·작업 로그·Notion 페이지가 이어져 있고,
 * 전사·분석 중에는 백그라운드 작업이 결과를 쓰러 돌아온다
 */
const EDIT_OPEN_STATUSES: readonly string[] = [MEETING_MINUTES_STATUS.TRANSCRIBED, MEETING_MINUTES_STATUS.REVIEW, MEETING_MINUTES_STATUS.FAILED];

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

const editClosedMessage = (action: string) => `확정했거나 전사·AI 정리 중인 회의록은 ${action} 수 없어요`;

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


/**
 * 회의록 (REQ-VOC-002·003, BP-VOC-01). 글·음성 전사를 저장하고, 작성자가 AI 정리를 시키면 후보를 만들어 둔다(등록은 다음 단계).
 * 작업 로그는 남기지 않는다 (REQ-LOG-002 이벤트에 회의록 생성이 없다). 전 역할이 쓰므로 권한 코드 없이 로그인만 본다.
 */
@Injectable()
export class MeetingMinutesService {
  private readonly logger = new Logger(MeetingMinutesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: MeetingMinutesRepository,
    private readonly runner: MeetingTranscriptionRunner,
    private readonly analysisRunner: MeetingAnalysisRunner,
    private readonly tasks: TaskService,
    private readonly notifications: NotificationService,
    private readonly messageActions: MessageActionService,
    private readonly contexts: MeetingCandidateContextService,
    private readonly businessEventRecorder: BusinessEventRecorder,
    private readonly notion: NotionPageService,
    private readonly drive: GoogleDriveService,
    private readonly notionWorkspace: NotionWorkspaceService,
    private readonly speakerSuggester: MeetingSpeakerSuggester,
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

  /**
   * 회사 Google Drive 폴더의 녹음으로 만든다 (이슈 #361). 연결·폴더·파일(설정한 폴더 안, 녹음, 500MB 이하)을 먼저 확인해
   * 잘못된 파일로 회의록을 남기지 않는다. 그 뒤는 음성 올리기와 같다: TRANSCRIBING으로 바로 돌려주고, 같은 전사 줄에서
   * 차례가 오면 Drive에서 받아(메모리에만) 전사한다. 받기에 실패하면 FAILED + 이유. 원본은 Drive에 그대로 있고 이 서버에는 남기지 않는다.
   */
  async createFromDrive(user: AuthUser, dto: CreateMeetingMinutesFromDriveDto): Promise<MeetingMinutesView> {
    const file = await this.drive.checkFile(dto.driveFileId, 'audio');
    const id = await this.createRecord(
      user,
      { meetingMinutesTitle: dto.meetingMinutesTitle, meetingDate: dto.meetingDate, attendeeIds: dto.attendeeIds },
      { meetingMinutesStatus: MEETING_MINUTES_STATUS.TRANSCRIBING, transcript: null, transcriptSegments: Prisma.DbNull },
    );
    void this.runner.enqueue({
      meetingMinutesId: id,
      audio: null,
      loadAudio: async () => (await this.drive.downloadAudio(file.id)).buffer,
      fileName: file.name,
      mimeType: file.mimeType || 'application/octet-stream',
      speakerCount: new Set(dto.attendeeIds).size,
    });
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
   * 참석자를 보낸 목록으로 바꾼다 (이슈 #449). 새로 넣는 사람만 사용 중 사원인지 본다: 그대로 둔 참석자는 그 사이 퇴사했어도 회의에 있었던 사실을 남긴다.
   * 빠진 참석자에게 연결한 화자 이름표는 '모름'으로 되돌린다. AI 후보는 그대로 둔다: 후보의 담당자·참석자는 회의 참석자가 아니어도 되고 검토 중에 고친다.
   * 확정 전이라 보낸 알림이 없고, 확정할 때 그때의 참석자에게 공유 알림이 간다.
   */
  async updateAttendees(user: AuthUser, id: number, dto: UpdateMeetingAttendeesDto): Promise<MeetingMinutesView> {
    const row = await this.loadForEdit(user, id, '참석자를 고칠');
    const attendeeIds = [...new Set(dto.attendeeIds)];
    const keep = new Set(attendeeIds);
    const current = new Set(row.attendees.map((a) => a.employeeId));
    const added = attendeeIds.filter((employeeId) => !current.has(employeeId));

    let unlinked = false;
    const segments = readSegments(row.transcriptSegments).map((s) => {
      if (s.speakerEmployeeId == null || keep.has(s.speakerEmployeeId)) return s;
      unlinked = true;
      return { ...s, speakerEmployeeId: null, speakerName: null };
    });

    await this.prisma.$transaction(async (tx) => {
      if (added.length > 0) {
        const found = new Set((await this.repository.findActiveEmployeeIds(tx, added)).map((e) => e.id));
        const missing = added.filter((employeeId) => !found.has(employeeId));
        if (missing.length > 0) throw new AppException('VOC-002', `참석자로 고른 사원을 찾을 수 없거나 퇴사했어요 (사원 id ${missing.join(', ')})`);
      }
      const { count } = await this.repository.saveForAttendeeEdit(tx, id, row.updatedAt, EDIT_OPEN_STATUSES, unlinked ? (segments as unknown as Prisma.InputJsonArray) : undefined);
      if (count === 0) await this.throwEditConflict(tx, id, '참석자를 고칠');
      await this.repository.deleteAttendeesExcept(tx, id, attendeeIds);
      if (added.length > 0) await this.repository.createAttendees(tx, id, added);
    });
    return this.get(id);
  }

  /**
   * 회의록을 지운다 (이슈 #449). 확정 전에는 업무·일정·구매요청 초안이 가리키지 않고 Notion 페이지도 없으며 원본 음성은 저장하지 않으므로
   * 참석자 행·이 회의에 물은 대화·회의록 행을 지운다(표시만 하는 삭제가 아니다). 작업 로그는 남기지 않는다: REQ-LOG-002에 회의록 생성·삭제가 없다.
   */
  async remove(user: AuthUser, id: number): Promise<{ id: number }> {
    await this.loadForEdit(user, id, '지울');
    await this.prisma.$transaction(async (tx) => {
      await this.repository.deleteAllAttendees(tx, id);
      await this.repository.deleteChatThreads(tx, id);
      const { count } = await this.repository.deleteMeetingMinutes(tx, id, EDIT_OPEN_STATUSES);
      if (count === 0) await this.throwEditConflict(tx, id, '지울');
    });
    return { id };
  }

  /** 지우기·참석자 고치기 공통: 작성자나 관리자(ORG_MANAGE 사용)만, 확정 전이고 전사·분석 중이 아닌 회의록만 */
  private async loadForEdit(user: AuthUser, id: number, action: string): Promise<MeetingMinutesDetailRow> {
    const row = await this.repository.findDetail(this.prisma, id);
    if (!row) throw new AppException('VOC-001');
    const isAdmin = hasPermission(user, { permission: PERMISSION.ORG_MANAGE, level: 'USE' });
    if (row.creator.id !== user.employeeId && !isAdmin) throw new AppException('VOC-003', `회의록 작성자나 관리자만 ${action} 수 있어요`);
    if (!EDIT_OPEN_STATUSES.includes(row.meetingMinutesStatus)) throw new AppException('VOC-004', editClosedMessage(action));
    return row;
  }

  /** 읽은 뒤 조건부 쓰기가 0건이면: 상태가 바뀌었는지(분석 시작·확정), 같은 회의록을 동시에 고쳤는지 가려서 알려 준다 */
  private async throwEditConflict(tx: Tx, id: number, action: string): Promise<never> {
    const current = await this.repository.findDetail(tx, id);
    if (!current) throw new AppException('VOC-001');
    if (!EDIT_OPEN_STATUSES.includes(current.meetingMinutesStatus)) throw new AppException('VOC-004', editClosedMessage(action));
    throw new AppException('COM-001', '그 사이 다른 곳에서 회의록을 고쳤어요. 새로 불러와 주세요');
  }

  /**
   * 화자 이름표(SPEAKER_n)를 회의 참석자에게 연결한다 (Voice2ERP 묶음 1). 연결은 각 구간에 speakerEmployeeId·speakerName으로 적어 두므로
   * 이름표 → 사원 표는 구간에서 다시 만들 수 있다. 보내지 않은 이름표는 그대로 두고, 값이 null이면 '모름'으로 되돌린다.
   * AI 정리 전에 하는 것이 목적이라 TRANSCRIBED·REVIEW·전사가 남은 FAILED에서 할 수 있다 (정리를 다시 해야 이름이 반영된다).
   */
  async updateSpeakers(user: AuthUser, id: number, dto: UpdateMeetingSpeakersDto): Promise<MeetingMinutesView> {
    const { row, segments } = await this.loadForSpeakers(user, id);

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
      if (current && !SPEAKER_OPEN_STATUSES.includes(current.meetingMinutesStatus)) throw new AppException('VOC-004', '전사가 끝났고 확정 전인 회의록만 화자를 연결할 수 있어요');
      throw new AppException('COM-001', '그 사이 다른 곳에서 회의록을 고쳤어요. 새로 불러와 주세요');
    }
    return this.get(id);
  }

  /**
   * AI가 화자 이름표마다 참석자 중 누구인지 추정한다 (이슈 #406, 문서에 없는 경로). 화자 연결과 같은 사람·같은 상태에서만.
   * 저장하지 않는다: 작성자가 화면에서 확인하고 화자 연결(PATCH)로 저장한다.
   */
  async suggestSpeakers(user: AuthUser, id: number): Promise<MeetingSpeakerSuggestResult> {
    const { row, segments } = await this.loadForSpeakers(user, id);
    const labels = [...new Set(segments.flatMap((s) => (s.speaker ? [s.speaker] : [])))];
    if (labels.length === 0) throw new AppException('VOC-004', '목소리로 나뉜 화자가 없는 회의록이에요');
    const attendees = row.attendees.map((a) => ({
      employeeId: a.employeeId,
      employeeName: a.employee.employeeName,
      departmentName: a.employee.department.departmentName,
      roleLabel: ROLE_LABEL[a.employee.role.roleCode as Role] ?? a.employee.role.roleCode,
    }));
    return this.speakerSuggester.suggest({ attendees, labels, segments });
  }

  /** 화자 연결·추정 공통: 작성자만, 전사가 끝났고 확정 전인 회의록만 */
  private async loadForSpeakers(user: AuthUser, id: number): Promise<{ row: MeetingMinutesDetailRow; segments: TranscriptSegment[] }> {
    const row = await this.repository.findDetail(this.prisma, id);
    if (!row) throw new AppException('VOC-001');
    if (row.creator.id !== user.employeeId) throw new AppException('VOC-003', '회의록 작성자만 화자를 연결할 수 있어요');
    if (!SPEAKER_OPEN_STATUSES.includes(row.meetingMinutesStatus) || row.transcript === null) throw new AppException('VOC-004', '전사가 끝났고 확정 전인 회의록만 화자를 연결할 수 있어요');
    return { row, segments: readSegments(row.transcriptSegments) };
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

    // 담당자·날짜·품목을 고치면 ERP 현황과 그에 따른 경고도 달라지므로 고칠 때마다 다시 계산한다
    const edited = await this.contexts.apply(this.prisma, applyCandidateEdit(analysis.candidates[index], dto, dateOnly(row.meetingDate)));
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
              notionSync: notionSyncOf(c),
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
    // 확정한 회의록과 거기서 만든 일정·업무를 Notion 업무 공간에 반영한다 (커밋 뒤, 기다리지 않음)
    this.notionWorkspace.kick();
    const wantsNotion = approved.some((c) => c.kind === 'EVENT' && notionSyncOf(c));
    // 일정은 넣기 표시를 남겨 Notion이 준비되면 그때 올라간다 (이슈 #434)
    return { meetingMinutes: await this.get(id), ...created, notionNotice: wantsNotion ? await this.notionWorkspace.scheduleNotice() : null };
  }

  /**
   * 확정한 회의록을 회사 Notion의 상위 페이지 아래 새 페이지로 내보낸다 (이슈 #358). 한 번만 내보내고 주소를 남긴다.
   * 작성자나 관리자(ORG_MANAGE 사용)만 한다. 작업 로그는 남기지 않는다 (REQ-LOG-002에 맞는 이벤트가 없다).
   */
  async exportToNotion(user: AuthUser, id: number): Promise<MeetingNotionExportResult> {
    const row = await this.repository.findDetail(this.prisma, id);
    if (!row) throw new AppException('VOC-001');
    const isAdmin = hasPermission(user, { permission: PERMISSION.ORG_MANAGE, level: 'USE' });
    if (row.creator.id !== user.employeeId && !isAdmin) throw new AppException('VOC-003', '회의록 작성자나 관리자만 Notion으로 내보낼 수 있어요');
    if (row.confirmedAt === null || row.meetingMinutesStatus !== MEETING_MINUTES_STATUS.CONFIRMED) throw new AppException('VOC-004', '확정한 회의록만 Notion으로 내보낼 수 있어요');
    if (row.notionPageUrl) throw new AppException('VOC-008');
    // 연결·상위 페이지가 없으면 회의록을 잡기 전에 알린다
    await this.notion.assertReady();
    // Notion 업무 공간(이슈 #391)이 있으면 상위 페이지가 아니라 회의록 데이터베이스에 만든다 (자동 반영과 같은 페이지)
    if (await this.notionWorkspace.isReady()) {
      const notionPageUrl = await this.notionWorkspace.exportMeeting(id);
      const meetingMinutes = await this.get(id);
      return { notionPageUrl, notionExportedAt: meetingMinutes.notionExportedAt ?? new Date().toISOString(), meetingMinutes };
    }

    // 같은 Notion 연결의 다른 호출을 기다린 뒤 도구를 부르기 바로 전에 잡는다: 줄을 오래 서도 잡기가 만료되지 않게
    const claim: { at: Date | null } = { at: null };
    const takeClaim = async () => {
      const at = new Date();
      const { count } = await this.repository.claimNotionExport(this.prisma, id, at, new Date(at.getTime() - NOTION_EXPORT_STALE_MS));
      if (count === 0) {
        const current = await this.repository.findDetail(this.prisma, id);
        if (current?.notionPageUrl) throw new AppException('VOC-008');
        throw new AppException('VOC-008', '지금 다른 곳에서 이 회의록을 Notion으로 내보내는 중이거나, 직전 내보내기 결과를 확인하지 못했어요. Notion을 확인하고 잠시 뒤 새로 불러와 주세요');
      }
      claim.at = at;
    };

    let notionPageUrl: string;
    try {
      const view = toView(row);
      notionPageUrl = await this.notion.createPage({ title: meetingNotionTitle(view), content: buildMeetingNotionMarkdown(view) }, takeClaim);
    } catch (error) {
      // 페이지가 만들어졌을 수 있으면(INT-009) 잡기를 남겨 바로 다시 눌러 중복 페이지가 생기지 않게 한다 (만료되면 다시 잡을 수 있다)
      const uncertain = error instanceof AppException && error.code === 'INT-009';
      if (claim.at && !uncertain) await this.repository.releaseNotionExport(this.prisma, id, claim.at);
      throw error;
    }
    const claimedAt = claim.at;
    const exportedAt = new Date();
    const { count } = claimedAt ? await this.repository.finishNotionExport(this.prisma, id, claimedAt, notionPageUrl, exportedAt) : { count: 0 };
    if (count === 0) {
      // 잡기가 만료돼 다른 요청이 가져갔다. 만든 페이지 주소를 잃지 않게 로그와 문구에 남긴다
      this.logger.error(`회의록 ${id}: Notion 페이지(${notionPageUrl})를 만들었지만 잡기를 잃어 주소를 저장하지 못했어요`);
      throw new AppException('COM-001', `Notion 페이지(${notionPageUrl})는 만들었지만 회의록에 주소를 남기지 못했어요. 새로 불러와 중복 페이지가 없는지 Notion에서 확인해 주세요`);
    }
    return { notionPageUrl, notionExportedAt: exportedAt.toISOString(), meetingMinutes: await this.get(id) };
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
