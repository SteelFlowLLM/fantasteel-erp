// 과거 사례 화면의 작업 로그 이벤트 표시명. 예전 🟡 제안 코드(AGENT_RISK_DETECTED)는 2026-10-22에 확정 코드로 옮겼다 (#496).
import { BUSINESS_EVENT_TYPE_LABEL, type BusinessEventType } from '@/codes';

export type ExampleBusinessEventType = BusinessEventType;

export const businessEventLabelOf = (businessEventType: ExampleBusinessEventType): string => BUSINESS_EVENT_TYPE_LABEL[businessEventType];
