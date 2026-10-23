import { Matches } from 'class-validator';

/** GET mrp/requirements?from=&to= (업무 프로세스 12.2). 필요일이 to 이하인 계획을 보이고, from 전 계획은 밀린 소요로 표시한다 */
export class MrpRequirementsQuery {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '시작일은 YYYY-MM-DD로 입력해 주세요' })
  from!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '종료일은 YYYY-MM-DD로 입력해 주세요' })
  to!: string;
}
