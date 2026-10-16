// 외부 서비스 연결 (문서에 없는 기능, 이슈 #358, docs/backend/integration.md). 회사 계정 하나를 모든 사원이 함께 쓴다.
// 목록은 로그인한 사원 누구나 읽고(회의록 화면이 내보내기 버튼을 보일지 정한다), 설정·연결·끊기·확인은 ORG_MANAGE 사용 권한이 필요하다.
import type {
  IntegrationConnectResult,
  IntegrationConnectionView,
  IntegrationProviderKey,
  IntegrationSettingsInput,
  IntegrationTestResult,
} from '@fantasteel/shared';
import { serverRequest } from '@/api/http';

export type { IntegrationConnectResult, IntegrationConnectionView, IntegrationProviderKey, IntegrationSettingsInput, IntegrationTestResult } from '@fantasteel/shared';

export const integrationKeys = {
  all: ['integrations'] as const,
  list: () => ['integrations', 'list'] as const,
};

export const integrationApi = {
  list: (): Promise<IntegrationConnectionView[]> => serverRequest('GET', '/integrations'),
  updateSettings: ({ providerKey, input }: { providerKey: IntegrationProviderKey; input: IntegrationSettingsInput }): Promise<IntegrationConnectionView> =>
    serverRequest('PUT', `/integrations/${providerKey}/settings`, { body: input }),
  /** 돌려받은 authorizationUrl로 브라우저를 옮겨 관리자가 허용하게 한다 */
  connect: (providerKey: IntegrationProviderKey): Promise<IntegrationConnectResult> => serverRequest('POST', `/integrations/${providerKey}/connect`),
  disconnect: (providerKey: IntegrationProviderKey): Promise<IntegrationConnectionView> => serverRequest('POST', `/integrations/${providerKey}/disconnect`),
  test: (providerKey: IntegrationProviderKey): Promise<IntegrationTestResult> => serverRequest('POST', `/integrations/${providerKey}/test`),
};
