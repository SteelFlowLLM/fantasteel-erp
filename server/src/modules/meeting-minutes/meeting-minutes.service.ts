import { Injectable } from '@nestjs/common';
import {
  MEETING_MINUTES_STATUS,
  type AuthUser,
  type MeetingMinutesListItem,
  type MeetingMinutesPage,
  type MeetingMinutesStatus,
  type MeetingMinutesView,
  type Role,
  type TranscriptSegment,
} from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import type { CreateMeetingMinutesDto, ListMeetingMinutesQuery } from './dto/meeting-minutes.dto';
import { MeetingMinutesRepository, type MeetingMinutesDetailRow, type MeetingMinutesListRow } from './meeting-minutes.repository';

const DEFAULT_PAGE_SIZE = 20;

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

/** DB의 JSON을 구간 배열로 읽는다. 모양이 다르면 빈 배열 */
function readSegments(value: Prisma.JsonValue | null): TranscriptSegment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry) || typeof entry.text !== 'string') return [];
    return [{ start: typeof entry.start === 'number' ? entry.start : null, end: typeof entry.end === 'number' ? entry.end : null, text: entry.text }];
  });
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
    summary: row.summary,
    analysisResult: row.analysisResult,
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
 * 회의록 (REQ-VOC-002, BP-VOC-01). 이 단계는 글로 붙여 넣은 전사만 받는다: STT·AI 분석은 아직 없다.
 * 작업 로그는 남기지 않는다 (REQ-LOG-002 이벤트에 회의록 생성이 없다). 전 역할이 쓰므로 권한 코드 없이 로그인만 본다.
 */
@Injectable()
export class MeetingMinutesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: MeetingMinutesRepository,
  ) {}

  /** API-258. 텍스트 입력은 STT를 건너뛰므로 TRANSCRIBED로 시작한다 */
  async create(user: AuthUser, dto: CreateMeetingMinutesDto): Promise<MeetingMinutesView> {
    const title = dto.meetingMinutesTitle.trim();
    if (!title) throw new AppException('COM-004', '제목을 입력해 주세요');
    if (!dto.transcript.trim()) throw new AppException('COM-004', '회의 기록을 입력해 주세요');
    const meetingDate = parseMeetingDate(dto.meetingDate);
    const attendeeIds = [...new Set(dto.attendeeIds)];

    const id = await this.prisma.$transaction(async (tx) => {
      const found = new Set((await this.repository.findActiveEmployeeIds(tx, attendeeIds)).map((e) => e.id));
      const missing = attendeeIds.filter((employeeId) => !found.has(employeeId));
      if (missing.length > 0) throw new AppException('VOC-002', `참석자로 고른 사원을 찾을 수 없어요 (사원 id ${missing.join(', ')})`);
      const created = await this.repository.createMeetingMinutes(tx, {
        meetingMinutesTitle: title,
        meetingDate,
        meetingMinutesStatus: MEETING_MINUTES_STATUS.TRANSCRIBED,
        transcript: dto.transcript,
        transcriptSegments: splitSegments(dto.transcript),
        creatorId: user.employeeId,
      });
      await this.repository.createAttendees(tx, created.id, attendeeIds);
      return created.id;
    });
    return this.get(id);
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
