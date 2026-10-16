import { BUSINESS_EVENT_TYPE, type AuthUser, type ScheduleEventInput } from '@fantasteel/shared';
import type { BusinessEventRecorder } from '../../../common/business-event/business-event.recorder';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { AiAssistantRepository } from '../ai-assistant.repository';
import type { ScheduleEventService } from '../../schedule-event/schedule-event.service';
import { optionalString, requiredString, ToolArgumentError } from './assistant-tool';
import type { AssistantWriteTool } from './assistant-write-tool';

const DATE = '^\\d{4}-\\d{2}-\\d{2}$';
const TIME = '^([01]\\d|2[0-3]):[0-5]\\d$';
/** 끝 시각을 말하지 않은 일정의 길이 (가정값). 카드에 보이므로 사용자가 보고 거부할 수 있다 */
export const DEFAULT_SCHEDULE_MINUTES = 60;
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
const DAY_MS = 86_400_000;

const isRealDate = (value: string): boolean => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

/** 서울 날짜·시각 → ISO (UTC) */
const seoulIso = (date: string, time: string): string => new Date(`${date}T${time}:00+09:00`).toISOString();

/** 내 일정 화면이 여는 주: 그 날이 속한 주의 월요일 (알림 링크와 같은 규칙) */
function scheduleWeekPath(date: string): string {
  const day = new Date(`${date}T00:00:00.000Z`);
  const monday = new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS);
  return `/schedule?week=${monday.toISOString().slice(0, 10)}`;
}

/** 'HH:mm'에 분을 더한다. 자정을 넘으면 null */
function addMinutes(time: string, minutes: number): string | null {
  const total = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + minutes;
  if (total >= 24 * 60) return null;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export interface ScheduleEventWriteToolDeps {
  prisma: PrismaService;
  recorder: BusinessEventRecorder;
  scheduleEvents: ScheduleEventService;
  repository: AiAssistantRepository;
}

/**
 * 내 일정 추가. "내 일정 직접 추가"(POST schedule-events)와 같은 service로 만든다: 등록자·참석자 = 묻는 사원 본인, 알림 없음.
 * 일정 등록은 REQ-LOG-002 대상이 아니지만 AI 실행 카드 확정은 대상이라, 공통 코드 정의서대로 DRAFT_CONFIRMED + AI 경유로 남긴다.
 */
export function scheduleEventWriteTool(deps: ScheduleEventWriteToolDeps): AssistantWriteTool {
  return {
    definition: {
      name: 'add_my_schedule_event',
      description:
        '사용자 본인의 "내 일정"에 일정을 하나 추가해요. 사용자가 일정 추가를 분명히 부탁했을 때만 불러요. 실행 전에 사용자가 승인 카드에서 허용해야 해요. 날짜·시각은 서울 기준이고, "내일"처럼 말하면 [사용자]의 오늘 날짜로 계산해요. 시각을 말하지 않으면 종일 일정이에요.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '일정 제목', minLength: 1, maxLength: 100 },
          date: { type: 'string', description: '날짜 YYYY-MM-DD', pattern: DATE },
          startTime: { type: 'string', description: '시작 시각 HH:mm (24시간). 비우면 종일 일정', pattern: TIME },
          endTime: { type: 'string', description: `끝 시각 HH:mm. 비우면 시작 ${DEFAULT_SCHEDULE_MINUTES}분 뒤`, pattern: TIME },
          memo: { type: 'string', description: '메모 (사용자가 말한 내용만)', maxLength: 1000 },
        },
        required: ['title', 'date'],
        additionalProperties: false,
      },
    },
    permissions: [],
    async prepare(user: AuthUser, args) {
      const title = requiredString(args, 'title', 100);
      const date = requiredString(args, 'date', 10);
      if (!isRealDate(date)) throw new ToolArgumentError(`date ${date}는 없는 날짜예요`);
      const startTime = optionalString(args, 'startTime', 5);
      const endTime = optionalString(args, 'endTime', 5);
      if (endTime && !startTime) throw new ToolArgumentError('endTime만 있고 startTime이 없어요. 종일 일정이면 둘 다 비워요');
      const memo = optionalString(args, 'memo', 1000) ?? null;

      const allDay = !startTime;
      const end = startTime ? (endTime ?? addMinutes(startTime, DEFAULT_SCHEDULE_MINUTES)) : null;
      if (startTime && !end) throw new ToolArgumentError('시작이 늦어 끝 시각이 자정을 넘어요. endTime을 함께 넘겨요');
      const nextDay = new Date(Date.parse(`${date}T00:00:00.000Z`) + DAY_MS).toISOString().slice(0, 10);
      const input: ScheduleEventInput = {
        scheduleEventTitle: title,
        scheduleEventDescription: memo,
        startAt: seoulIso(date, startTime ?? '00:00'),
        endAt: allDay ? seoulIso(nextDay, '00:00') : seoulIso(date, end ?? '00:00'),
      };
      // 등록 API와 같은 검사 (끝 시각이 시작보다 뒤인지). 틀리면 COM-004
      deps.scheduleEvents.checkCreate(input);

      const weekday = WEEKDAY[new Date(`${date}T00:00:00.000Z`).getUTCDay()];
      return {
        card: {
          title: `내 일정 추가: ${title}`,
          details: [
            { label: '제목', value: title },
            { label: '날짜', value: `${date} (${weekday})` },
            { label: '시간', value: allDay ? '종일' : `${startTime}~${end}${endTime ? '' : ` (끝 시각을 말하지 않아 ${DEFAULT_SCHEDULE_MINUTES}분으로 잡았어요)`}` },
            ...(memo ? [{ label: '메모', value: memo }] : []),
            { label: '참석자', value: `${user.employeeName} (나만 보는 일정, 알림 없음)` },
          ],
        },
        execute: async (actor, approvalId) => {
          const id = await deps.prisma.$transaction(async (tx) => {
            // 같은 카드로 이미 만들었으면(COMMIT 뒤 연결이 끊겨 다시 하는 경우) 그 일정을 돌려준다
            const done = await deps.repository.findApprovalEvent(tx, approvalId);
            if (done) return done.targetId;
            const createdId = await deps.scheduleEvents.createIn(tx, actor, input);
            await deps.recorder.record(tx, {
              type: BUSINESS_EVENT_TYPE.DRAFT_CONFIRMED,
              actor,
              target: { table: 'schedule_event', id: createdId },
              after: { ...input, approvalId },
              reason: `DRAFT_CONFIRMED: 철강맨AI 승인 카드 허용 (내 일정 추가 · ${title})`,
              isAiAssisted: true,
            });
            return createdId;
          });
          return {
            message: `내 일정에 '${title}'을(를) 추가했어요 (${date}${allDay ? ' 종일' : ` ${startTime}~${end}`})`,
            result: { table: 'schedule_event', id, label: title, linkPath: scheduleWeekPath(date) },
          };
        },
      };
    },
  };
}
