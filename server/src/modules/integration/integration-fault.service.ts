import { Injectable, Logger } from '@nestjs/common';
import { NOTIFICATION_TYPE, PERMISSION, type IntegrationFaultKind } from '@fantasteel/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { AppException } from '../../common/errors/app.exception';
import { NotificationService } from '../notification/notification.service';
import { IntegrationFaultRepository } from './integration-fault.repository';
import {
  CONNECTION_FAULT_KINDS,
  FAULT_ALERT_AFTER,
  FAULT_MESSAGE_MAX,
  FAULT_REPEAT_MS,
  INTEGRATION_ALERT_LINK,
  faultAlertContent,
  faultKindOf,
  faultRecoveredContent,
} from './integration-fault.rules';
import { isProviderKey, providerPresets } from './integration-providers';

function displayNameOf(providerKey: string): string {
  return isProviderKey(providerKey) ? providerPresets()[providerKey].displayName : providerKey;
}

/** 풀 장애가 없다는 확인을 이만큼 기억한다. 성공한 호출마다 DB를 읽지 않으려는 것이고, 다른 서버가 그 사이 기록한 장애는 이 서버의 다음 확인(최대 이 시간 뒤)에 풀린다 */
const CLEAN_CACHE_MS = 30_000;

function messageOf(error: AppException): string {
  return (error.getResponse() as { message: string }).message;
}

/**
 * 외부 연결 장애 기록과 알림 (이슈 #518, 문서에 없는 기능). 연결 호출이 실패하면 `report`로 (연결 대상, 종류)마다 한 줄에 횟수를 더하고,
 * 알릴 만큼 이어졌으면 연동 관리 권한자(ORG_MANAGE 사용)에게 알림을 한 번 보낸다. 풀리지 않은 같은 장애는 하루(FAULT_REPEAT_MS)에 한 번만 알린다.
 * 다시 정상이 되면 `resolve`가 줄을 지우고, 알렸던 장애면 복구 알림을 한 번 보낸다.
 *
 * 알림 여부는 DB에서 조건부 UPDATE(claimIntegrationFaultAlert)로 정해 서버가 여러 대여도 같은 알림이 두 번 가지 않는다.
 * 알림은 장애 줄을 고치는 트랜잭션과 같은 tx에서 만들어 알림만 사라지거나 알리지 않은 채 알린 것으로 적히지 않는다.
 * 기록하다 실패해도 본 호출(내보내기·Drive 읽기 등)의 결과를 바꾸지 않도록 어떤 함수도 던지지 않는다.
 *
 * 성공한 호출마다 `resolve`가 불리므로 '풀 장애가 없다'는 확인을 30초 기억한다(`cleanUntil`). 이 서버가 장애를 기록하면 바로 잊는다.
 * 다른 서버가 장애를 기록한 직후라면 이 서버의 복구는 최대 30초 늦을 뿐이다(복구 알림이 빠지지는 않는다).
 */
@Injectable()
export class IntegrationFaultService {
  private readonly logger = new Logger(IntegrationFaultService.name);
  /** `연결 대상|종류들` → 이 시각까지는 풀 장애가 없다고 본다 */
  private readonly cleanUntil = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: IntegrationFaultRepository,
    private readonly notifications: NotificationService,
  ) {}

  /** 연결 호출이 실패했다. 장애로 셀 오류(다시 연결·키·요청 실패)만 기록하고 그 밖의 사용 오류는 무시한다 */
  async reportFailure(providerKey: string, error: AppException): Promise<void> {
    const faultKind = faultKindOf(error);
    if (faultKind) await this.report(providerKey, faultKind, messageOf(error));
  }

  /** 장애 한 번을 기록하고, 알릴 때가 됐으면 연동 관리 권한자에게 알림을 보낸다 */
  async report(providerKey: string, faultKind: IntegrationFaultKind, message: string): Promise<void> {
    try {
      this.forgetClean(providerKey);
      const displayName = displayNameOf(providerKey);
      await this.prisma.$transaction(async (tx) => {
        await this.repository.record(tx, providerKey, faultKind, message.slice(0, FAULT_MESSAGE_MAX));
        // 받을 사람이 없으면 알린 것으로 적지 않는다: 나중에 권한자가 생기거나 돌아오면 다음 실패가 알린다
        const recipients = await this.repository.findActiveEmployeeIdsWithPermission(tx, PERMISSION.ORG_MANAGE);
        if (recipients.length === 0) return;
        const [claimed] = await this.repository.claimAlert(tx, providerKey, faultKind, FAULT_ALERT_AFTER[faultKind], FAULT_REPEAT_MS);
        if (!claimed) return;
        await this.notifications.notifyEmployees(tx, recipients, {
          notificationType: NOTIFICATION_TYPE.INTEGRATION_FAULT,
          notificationContent: faultAlertContent({ displayName, faultKind, message: claimed.last_message, failureCount: claimed.failure_count }),
          linkPath: INTEGRATION_ALERT_LINK,
        });
      });
    } catch (error) {
      this.logger.warn(`${providerKey} 장애(${faultKind})를 기록하지 못했어요: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** 연결(토큰·키·요청)이 다시 됐다: 연결 장애 세 종류를 푼다 */
  resolveConnection(providerKey: string): Promise<void> {
    return this.resolve(providerKey, CONNECTION_FAULT_KINDS);
  }

  /**
   * 해당 종류의 장애를 푼다. 알렸던 장애면 복구 알림을 한 번 보낸다 (알리지 않았으면 조용히 지운다).
   * 성공한 호출마다 부르므로 풀 장애가 없으면 잠그지 않고 바로 끝낸다.
   */
  async resolve(providerKey: string, kinds: readonly IntegrationFaultKind[]): Promise<void> {
    try {
      const cacheKey = `${providerKey}|${kinds.join(',')}`;
      if ((this.cleanUntil.get(cacheKey) ?? 0) > Date.now()) return;
      const open = await this.repository.findByProvider(this.prisma, providerKey);
      if (!open.some((fault) => (kinds as readonly string[]).includes(fault.faultKind))) {
        this.cleanUntil.set(cacheKey, Date.now() + CLEAN_CACHE_MS);
        return;
      }
      const displayName = displayNameOf(providerKey);
      await this.prisma.$transaction(async (tx) => {
        // 줄을 잠근 뒤 읽는다: 두 서버가 함께 풀어도 먼저 잠근 서버만 줄을 보고 복구 알림을 보낸다
        const locked = (await this.repository.lockByProvider(tx, providerKey)).filter((fault) => (kinds as readonly string[]).includes(fault.fault_kind));
        if (locked.length === 0) return;
        await this.repository.deleteByIds(tx, locked.map((fault) => fault.id));
        const alerted = locked.filter((fault) => fault.notified_at !== null);
        if (alerted.length === 0) return;
        const recipients = await this.repository.findActiveEmployeeIdsWithPermission(tx, PERMISSION.ORG_MANAGE);
        for (const fault of alerted) {
          await this.notifications.notifyEmployees(tx, recipients, {
            notificationType: NOTIFICATION_TYPE.INTEGRATION_RECOVERED,
            notificationContent: faultRecoveredContent({ displayName, faultKind: fault.fault_kind as IntegrationFaultKind }),
            linkPath: INTEGRATION_ALERT_LINK,
          });
        }
      });
    } catch (error) {
      this.logger.warn(`${providerKey} 장애를 풀지 못했어요: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** 이 연결 대상에 대해 기억한 '풀 장애 없음'을 잊는다 (장애를 기록했으니 다음 성공 호출이 풀어야 한다) */
  private forgetClean(providerKey: string): void {
    for (const key of this.cleanUntil.keys()) if (key.startsWith(`${providerKey}|`)) this.cleanUntil.delete(key);
  }

  /** 관리자가 연결을 끊었다: 일부러 끊은 것이라 장애를 알림 없이 지운다 */
  async clear(providerKey: string): Promise<void> {
    try {
      await this.repository.deleteByProvider(this.prisma, providerKey);
    } catch (error) {
      this.logger.warn(`${providerKey} 장애를 지우지 못했어요: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** 관리 화면용: 연결 대상마다 해결되지 않은 장애 */
  list() {
    return this.repository.findAll(this.prisma);
  }
}
