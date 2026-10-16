import type { AiApprovalDetail, AiAssistantWriteTool, AiToolExecutionResult, AuthUser, Permission } from '@fantasteel/shared';
import type { ToolParameterSchema } from './tool-schema';

/**
 * 쓰기 도구 (철강맨AI 승인 카드, REQ-AST-005·010, 이슈 #362). 업무 데이터를 바꾸므로 사용자가 카드에서 허용해야 실행한다.
 * 업무 로직은 각 모듈의 service를 그대로 부른다: 도구는 모델 인자를 service 입력으로 바꾸고 카드 문구를 만든다.
 */
export interface AssistantWriteTool {
  definition: { name: AiAssistantWriteTool; description: string; parameters: ToolParameterSchema };
  /** 이 쓰기에 필요한 사용(USE) 권한. 권한 밖일 때 할 수 있는 역할을 안내하는 데만 쓴다(확인은 service가 한다) */
  permissions: readonly Permission[];
  /**
   * 스키마를 통과한 인자로 사전 확인(dry-run)을 한다: 실제 실행과 같은 업무 검증을 하고 저장은 하지 않는다.
   * 형식이 틀리면 ToolArgumentError, 업무 규칙에 걸리면 AppException. 통과하면 카드 내용과 허용 뒤 실행할 함수
   */
  prepare(user: AuthUser, args: Record<string, unknown>, context: WriteToolContext): Promise<PreparedWrite>;
}

export interface WriteToolContext {
  /** 사용자가 철강맨AI에 한 질문 (초안의 원본 글로 남긴다) */
  question: string;
}

export interface PreparedWrite {
  card: { title: string; details: AiApprovalDetail[] };
  /** 허용 뒤 실행. 쓰기와 AI 경유 작업 로그를 한 트랜잭션에서 남긴다. 실패는 그대로 던진다 */
  execute(): Promise<WriteToolOutcome>;
}

export interface WriteToolOutcome {
  /** 화면과 모델에 보일 결과 한 줄 */
  message: string;
  result: AiToolExecutionResult;
}
