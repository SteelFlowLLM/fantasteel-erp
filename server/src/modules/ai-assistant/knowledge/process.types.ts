/** 업무 프로세스 정의서 6.0 '한눈에 보기' 표 한 줄 (docs/notion/04-업무-프로세스-정의서.md) */
export interface ProcessStep {
  /** BP-SO-01 */
  id: string;
  /** 업무 이름 (예: 수주 등록·예약·계획) */
  name: string;
  /** 주체 (예: 영업) */
  actor: string;
  /** 핵심 흐름 (→로 이어진 단계) */
  flow: string;
  /** 결과물 */
  output: string;
}
