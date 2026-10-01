// 작업 로그 점 색 한 곳에서 정한다 (보고서 4 A-4 "화면마다 다른 색" 통일).
// 사용자 = 파랑, 시스템 = 회색, 불합격(검사 등록·판정의 불합격, 불합격 처리 상태 지정) = 빨강.
import type { ActorType, BusinessEventType } from '@/codes';
import type { JsonValue } from '@/mock/schema';

export type EventTone = 'run' | 'neutral' | 'danger';

export interface ToneSource {
  businessEventType: BusinessEventType;
  actorType: ActorType;
  afterData: JsonValue | null;
}

const isRecord = (value: JsonValue | null): value is { [key: string]: JsonValue } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 불합격과 이어진 이벤트인지: 검사 판정 결과(inspectionResult)가 FAIL이거나 불합격 처리 상태 지정 */
export function isFailureEvent(event: ToneSource): boolean {
  if (event.businessEventType === 'DISPOSITION_SET') return true;
  if (event.businessEventType !== 'INSPECTION_REGISTERED' || !isRecord(event.afterData)) return false;
  return event.afterData.inspectionResult === 'FAIL';
}

export function eventTone(event: ToneSource): EventTone {
  if (isFailureEvent(event)) return 'danger';
  return event.actorType === 'USER' ? 'run' : 'neutral';
}

export const EVENT_TONE_DOT: Record<EventTone, string> = {
  run: 'border-run bg-run-bg',
  neutral: 'border-line-strong bg-surface',
  danger: 'border-danger bg-danger-bg',
};
