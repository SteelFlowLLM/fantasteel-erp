// 아직 만들지 않은 화면의 자리 표시 (화면 재작업 단계는 docs/rework/PLAN.md 3장)
import { ComingSoon } from '@/components/ComingSoon';
import { PageMain } from '@/components/Page';
import { StateView } from '@/components/StateView';

export const REWORK_STAGE_NAME = {
  1: '기반',
  2: '조직·기준정보·협업',
  3: '수주에서 구매까지',
  4: '생산·품질',
  5: '출하·추적',
  6: '마무리',
} as const;
export type ReworkStage = keyof typeof REWORK_STAGE_NAME;

export interface StagePlaceholderProps {
  stage: ReworkStage;
  /** P2·EX 기능이면 '준비 중' 화면으로 만든다는 것을 함께 밝힌다 */
  soon?: { grade: 'P2' | 'EX'; title: string };
}

export function StagePlaceholder({ stage, soon }: StagePlaceholderProps) {
  return (
    <PageMain>
      <StateView
        kind="empty"
        icon="widget"
        title={`이 화면은 ${stage}단계에서 만들어요`}
        text={
          soon ? (
            <>
              <b className="font-semibold">{soon.title}</b>은(는) {soon.grade === 'P2' ? '2등급(AI) 기능' : '추가 기능'}이라 {stage}단계(
              {REWORK_STAGE_NAME[stage]})에서 디자인만 있는 &lsquo;준비 중&rsquo; 화면으로 만들어요.
            </>
          ) : (
            `화면 재작업 ${stage}단계(${REWORK_STAGE_NAME[stage]})에서 기능을 넣어요.`
          )
        }
        actions={soon ? <ComingSoon grade={soon.grade} /> : undefined}
      />
    </PageMain>
  );
}
