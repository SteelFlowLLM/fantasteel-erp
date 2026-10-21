import { MEETING_MINUTES_STATUS, MEETING_MINUTES_STATUS_LABEL, ROLE_LABEL, type MeetingMinutesStatus } from '@fantasteel/shared';
import { AppException } from '../../../common/errors/app.exception';
import type { MeetingDigest, MeetingDigestDetail, MeetingMinutesService } from '../../meeting-minutes/meeting-minutes.service';
import { codeLabelList, limitRows, OPEN_ACCESS, optionalDate, optionalEnum, optionalPositiveInt, optionalString, scanFiltered, ToolArgumentError, unscannedField, type AssistantTool } from './assistant-tool';

const STATUSES = Object.values(MEETING_MINUTES_STATUS) as MeetingMinutesStatus[];
/** 요약·결정사항은 앞부분만 보낸다 (작은 모델의 문맥을 넘지 않게) */
const SUMMARY_MAX = 400;
const DECISION_MAX = 160;
const DECISION_ROWS = 6;
/** 한 번에 요약까지 풀어 주는 회의 수. 더 있으면 제목·날짜만 주고 id로 다시 부르게 한다 */
const DETAIL_ROWS = 5;

const cut = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max)}…`);
const squeeze = (text: string): string => text.toLowerCase().replace(/\s+/g, '');

/** 낱말마다 들어 있으면 맞다 (띄어쓰기·대소문자 무시). "가격 인상 결정"처럼 문장으로 물어도 요약에 "가격 인상"이 있으면 찾는다 */
export function matchesWords(haystack: readonly (string | null | undefined)[], keyword: string): boolean {
  const text = squeeze(haystack.filter((h): h is string => typeof h === 'string').join(' '));
  const words = keyword.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((word) => text.includes(squeeze(word)));
}

function digestRow(d: MeetingDigest, withDetail: boolean) {
  return {
    회의록id: d.id,
    제목: d.meetingMinutesTitle,
    회의일: d.meetingDate,
    상태: MEETING_MINUTES_STATUS_LABEL[d.meetingMinutesStatus],
    작성자: d.creatorName,
    '참석자 수': d.attendeeCount,
    ...(withDetail ? { 요약: d.summary ? cut(d.summary, SUMMARY_MAX) : null, 결정사항: d.decisions.slice(0, DECISION_ROWS).map((t) => cut(t, DECISION_MAX)), ...(d.decisions.length > DECISION_ROWS ? { '더 있는 결정 수': d.decisions.length - DECISION_ROWS } : {}) } : {}),
  };
}

function detailOutput(meeting: MeetingDigestDetail) {
  return {
    label: `지난 회의 · ${meeting.meetingMinutesTitle}`,
    data: {
      회의록id: meeting.id,
      제목: meeting.meetingMinutesTitle,
      회의일: meeting.meetingDate,
      상태: MEETING_MINUTES_STATUS_LABEL[meeting.meetingMinutesStatus],
      작성자: meeting.creatorName,
      참석자: meeting.attendees.map((a) => `${a.employeeName}(${a.departmentName}, ${ROLE_LABEL[a.roleCode]})`),
      요약: meeting.summary ? cut(meeting.summary, SUMMARY_MAX * 2) : null,
      결정사항: meeting.decisions.slice(0, DECISION_ROWS * 2).map((text) => cut(text, DECISION_MAX)),
      안내: '전사 원문은 회의록 화면의 "이 회의에 묻기"에서 읽을 수 있어요',
    },
  };
}

/**
 * 지난 회의 검색 (GET meeting-minutes·meeting-minutes/:id, API-259, 문서에 없는 기능 이슈 #506).
 * 회의록은 전 역할이 열람하는 화면이라 권한을 따로 보지 않는다(목록·상세 API와 같다). 제목·요약·AI가 정리한 결정사항에서 낱말을 찾고,
 * 전사 원문은 읽지 않는다(한 회의를 자세히 볼 때도 전사 칸을 뺀 조회). 회의일 최신순이며 100건을 넘으면 쪽을 넘겨 읽는다(scanFiltered).
 */
export function meetingMinutesTool(meetings: MeetingMinutesService): AssistantTool {
  return {
    access: OPEN_ACCESS,
    definition: {
      name: 'search_meeting_minutes',
      description: `지난 회의록을 찾는다. keyword로 제목·요약·결정사항에서 낱말을 찾고, from·to로 회의일 범위를, status로 상태(${codeLabelList(MEETING_MINUTES_STATUS_LABEL)})를 좁힌다. 회의일 최신순으로 제목·날짜·작성자와 앞쪽 몇 건의 요약·결정사항을 준다. meetingMinutesId를 주면 그 회의 하나의 참석자·요약·결정사항을 준다. 아무것도 안 주면 가장 최근 회의들.`,
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '제목·요약·결정사항에서 찾을 낱말 (공백으로 나누면 모두 들어 있는 회의)' },
          from: { type: 'string', description: '회의일 시작 YYYY-MM-DD' },
          to: { type: 'string', description: '회의일 끝 YYYY-MM-DD' },
          status: { type: 'string', enum: STATUSES, description: '회의록 상태' },
          meetingMinutesId: { type: 'integer', description: '회의록 id. 있으면 그 회의 하나를 자세히' },
        },
      },
    },
    async run(args) {
      const id = optionalPositiveInt(args, 'meetingMinutesId');
      if (id !== undefined) {
        try {
          return detailOutput(await meetings.getDigest(id));
        } catch (error) {
          if (error instanceof AppException && error.code === 'VOC-001') throw new ToolArgumentError(`회의록 id ${id}가 없어요`);
          throw error;
        }
      }
      const keyword = optionalString(args, 'keyword', 100);
      const from = optionalDate(args, 'from');
      const to = optionalDate(args, 'to');
      if (from && to && from > to) throw new ToolArgumentError('from은 to보다 늦을 수 없어요');
      const status = optionalEnum(args, 'status', STATUSES);
      // 낱말이 없으면 앞 쪽(최신)만 읽고, 있으면 요약·결정까지 쪽을 넘겨 거른다
      const scan = keyword
        ? await scanFiltered(
            (page, size) => meetings.searchDigests({ meetingMinutesStatus: status, from, to, page, size }),
            (d) => matchesWords([d.meetingMinutesTitle, d.summary, ...d.decisions], keyword),
          )
        : await meetings.searchDigests({ meetingMinutesStatus: status, from, to, page: 1, size: DETAIL_ROWS * 3 }).then((page) => ({ rows: page.items, total: page.total, unscanned: 0 }));
      const count = keyword ? scan.rows.length : scan.total;
      const limited = limitRows(scan.rows, DETAIL_ROWS * 3);
      return {
        label: `지난 회의${keyword ? ` · ${keyword}` : ''}${from || to ? ` · ${from ?? ''}~${to ?? ''}` : ''}`,
        data: {
          '회의록 수': count,
          회의록: limited.rows.map((d, index) => digestRow(d, index < DETAIL_ROWS)),
          '생략 줄 수': keyword ? limited.omitted : Math.max(0, scan.total - limited.rows.length),
          ...unscannedField('회의록', scan.unscanned),
          ...(limited.rows.length > DETAIL_ROWS ? { 안내: `앞 ${DETAIL_ROWS}건만 요약·결정사항을 줬어요. 다른 회의가 궁금하면 meetingMinutesId로 다시 불러요` } : {}),
        },
      };
    },
  };
}
