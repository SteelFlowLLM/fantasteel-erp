/** 업무 매뉴얼 한 업무 (docs/manual/업무-매뉴얼-초안.md의 `## N. 이름 (BP-…)` 한 절). 화면에서 어디를 눌러 하는지 */
export interface ManualGuide {
  /** MAN-SO-01 (업무 ID의 BP-를 MAN-으로) */
  id: string;
  /** 같은 업무의 업무 프로세스 ID (BP-SO-01) */
  processId: string;
  /** 업무 이름 (예: 수주 등록) */
  name: string;
  /** 모델에 넘길 본문 (절차·확정 뒤 일어나는 일·막히는 곳) */
  text: string;
}
