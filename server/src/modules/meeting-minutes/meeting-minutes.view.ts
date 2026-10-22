import { MEETING_MINUTES_STATUS, type MeetingMinutesStatus, type MeetingMinutesView, type Role } from '@fantasteel/shared';
import { readAnalysis, readProgress, readSegments, readTranscriptionProgress, summarizeSpeakers } from './meeting-minutes.json';
import type { MeetingMinutesDetailRow } from './meeting-minutes.repository';

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

/** 회의록 상세 응답. 회의록 화면과 Notion 업무 공간 반영(integration/notion)이 같이 쓴다 */
export function toMeetingMinutesView(row: MeetingMinutesDetailRow): MeetingMinutesView {
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
    // 끝난 분석의 진행 칸이 남아 있어도 보이지 않게 한다
    analysisProgress: row.meetingMinutesStatus === MEETING_MINUTES_STATUS.ANALYZING ? readProgress(row.analysisProgress) : null,
    transcriptionProgress: row.meetingMinutesStatus === MEETING_MINUTES_STATUS.TRANSCRIBING ? readTranscriptionProgress(row.transcriptionProgress) : null,
    failureReason: row.failureReason,
    creator: { id: row.creator.id, name: row.creator.employeeName },
    attendees: row.attendees.map((a) => ({
      employeeId: a.employeeId,
      employeeName: a.employee.employeeName,
      departmentName: a.employee.department.departmentName,
      roleCode: a.employee.role.roleCode as Role,
    })),
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    notionPageUrl: row.notionPageUrl,
    // 주소 없이 시각만 있으면 내보내는 중이라 화면에는 내보내지 않은 것으로 보인다
    notionExportedAt: row.notionPageUrl ? (row.notionExportedAt?.toISOString() ?? null) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
