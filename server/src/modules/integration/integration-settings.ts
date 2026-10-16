import type { IntegrationSettings } from '@fantasteel/shared';
import type { Prisma } from '../../generated/prisma/client';

/** settings(jsonb)를 읽는다. 모르는 칸·모양이 틀린 값은 버린다 */
export function readSettings(value: Prisma.JsonValue): IntegrationSettings {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const settings: IntegrationSettings = {};
  if (typeof record.parentPageId === 'string') settings.parentPageId = record.parentPageId;
  if (typeof record.folderId === 'string') settings.folderId = record.folderId;
  return settings;
}
