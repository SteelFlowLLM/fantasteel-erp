// 검사 기준 화면 문구 (REQ-QC-001 공정별 검사, REQ-QC-002)
import { PERMISSION } from '@/codes';
import type { InspectedProcessType } from '@/features/inspectionStandards/lib/standardItems';
import { permissionNeedText } from '@/lib/permissions';

/** 공정별 검사 내용 (REQ-QC-001: 제강 히트 성분 / 연주 슬래브 표면·치수 / 열연 코일 치수·기계적 성질) */
export const PROCESS_INSPECTION_TEXT: Record<InspectedProcessType, string> = {
  STEELMAKING: '히트 성분',
  CONTINUOUS_CASTING: '슬래브 표면·치수',
  HOT_ROLLING: '코일 치수·기계적 성질',
};

/** 막힌 변경 버튼의 툴팁: "검사 기준 관리 사용 권한이 필요해요" */
export const STANDARD_LOCK_TEXT = permissionNeedText([PERMISSION.INSPECTION_STANDARD_MANAGE]);
