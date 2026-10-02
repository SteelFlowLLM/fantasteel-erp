// 준비 중 화면(Agent·과거 사례)의 작업 로그 이벤트 표시명. 확정 코드(BUSINESS_EVENT_TYPE)와 🟡 제안 코드(PROPOSED_BUSINESS_EVENT_TYPE)를 함께 받는다.
import {
  BUSINESS_EVENT_TYPE_LABEL,
  PROPOSED_BUSINESS_EVENT_TYPE_LABEL,
  type BusinessEventType,
  type ProposedBusinessEventType,
} from '@/codes';

export type ExampleBusinessEventType = BusinessEventType | ProposedBusinessEventType;

const isProposed = (businessEventType: ExampleBusinessEventType): businessEventType is ProposedBusinessEventType =>
  businessEventType in PROPOSED_BUSINESS_EVENT_TYPE_LABEL;

export const businessEventLabelOf = (businessEventType: ExampleBusinessEventType): string =>
  isProposed(businessEventType) ? PROPOSED_BUSINESS_EVENT_TYPE_LABEL[businessEventType] : BUSINESS_EVENT_TYPE_LABEL[businessEventType];
