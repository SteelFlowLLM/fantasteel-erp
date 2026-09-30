import { Inject, Injectable } from '@nestjs/common';
import { badInput } from '../../common/errors/app.exception';
import { ACTION_DEFINITIONS, type ActionDefinition } from './action-definition';

/** 업무 유형 → 정의(검증기·확정 주체·실행 핸들러) 레지스트리 (REQ-ACT-004). */
@Injectable()
export class ActionRegistry {
  private readonly definitions = new Map<string, ActionDefinition>();

  constructor(@Inject(ACTION_DEFINITIONS) definitions: ActionDefinition[]) {
    for (const def of definitions) {
      if (this.definitions.has(def.type)) throw new Error(`업무 유형이 중복 등록되었습니다: ${def.type}`);
      this.definitions.set(def.type, def);
    }
  }

  get(type: string): ActionDefinition {
    const def = this.definitions.get(type);
    if (!def) throw badInput(`지원하지 않는 업무 유형입니다: ${type}`);
    return def;
  }

  list(): ActionDefinition[] {
    return [...this.definitions.values()];
  }
}
