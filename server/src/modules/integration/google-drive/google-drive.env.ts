import { createPrivateKey, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { normalizeDriveFolderId } from './google-drive.query';

/**
 * 서버 .env로 정하는 Google Drive 값 (이슈 #395). 순수 함수만 둔다.
 *   GOOGLE_SERVICE_ACCOUNT_KEY_FILE  서비스 계정 키 JSON 파일 경로 (상대 경로는 서버 폴더 기준)
 *   GOOGLE_SERVICE_ACCOUNT_KEY       키 JSON 자체 또는 그 base64. 둘 다 있으면 파일을 쓴다
 *   GOOGLE_DRIVE_FOLDER              읽을 폴더 주소·id. 있으면 화면에서 저장한 폴더보다 먼저다
 */

/** 서비스 계정 키에서 쓰는 값. 개인 키는 KeyObject로만 들고 있어 문자열로 새지 않는다 */
export interface ServiceAccountKey {
  clientEmail: string;
  privateKey: KeyObject;
}

export type ServiceAccountConfig =
  /** 키를 넣지 않았다: OAuth 연결을 쓴다 */
  | { configured: false }
  | { configured: true; key: ServiceAccountKey; error: null }
  /** 키를 넣었지만 읽을 수 없다. error는 화면에 보여도 되는 문구다 (키 내용 없음) */
  | { configured: true; key: null; error: string };

/** 키를 읽을 수 없음. 문구에 키 내용을 담지 않는다 */
export class ServiceAccountKeyError extends Error {}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function decodeKeyText(raw: string): unknown {
  const text = raw.trim();
  // JSON이 아니면 base64로 본다: .env 한 줄에 여러 줄 개인 키를 넣기 어려워서
  const json = text.startsWith('{') ? text : Buffer.from(text, 'base64').toString('utf8').trim();
  if (!json.startsWith('{')) throw new ServiceAccountKeyError('서비스 계정 키를 읽지 못했어요. Cloud Console에서 받은 JSON 파일 내용(또는 그 base64)을 그대로 넣어 주세요');
  try {
    return JSON.parse(json) as unknown;
  } catch {
    throw new ServiceAccountKeyError('서비스 계정 키가 올바른 JSON이 아니에요. Cloud Console에서 받은 JSON 파일을 고치지 말고 그대로 써 주세요');
  }
}

/** 서비스 계정 키(JSON 또는 그 base64)를 읽는다. type·client_email·private_key를 확인하고 개인 키를 미리 열어 본다 */
export function parseServiceAccountKey(raw: string): ServiceAccountKey {
  const value = decodeKeyText(raw);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ServiceAccountKeyError('서비스 계정 키가 JSON 객체가 아니에요');
  const record = value as Record<string, unknown>;
  if (record.type !== 'service_account') {
    throw new ServiceAccountKeyError('서비스 계정 키가 아니에요 ("type": "service_account"인 JSON이어야 해요). OAuth 클라이언트 JSON을 넣지 않았는지 확인해 주세요');
  }
  const clientEmail = typeof record.client_email === 'string' ? record.client_email.trim() : '';
  if (!clientEmail || clientEmail.length > 320 || !EMAIL_PATTERN.test(clientEmail)) throw new ServiceAccountKeyError('서비스 계정 키에 client_email이 없거나 올바르지 않아요');
  const pem = typeof record.private_key === 'string' ? record.private_key : '';
  if (!pem.trim()) throw new ServiceAccountKeyError('서비스 계정 키에 private_key가 없어요');
  let privateKey: KeyObject;
  try {
    // 줄바꿈이 글자 "\n"으로 두 번 이스케이프된 채 들어오는 일이 있다 (셸·.env에 붙여 넣으며)
    privateKey = createPrivateKey(pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem);
  } catch {
    throw new ServiceAccountKeyError('서비스 계정 키의 private_key를 읽지 못했어요. 파일을 고치지 말고 Cloud Console에서 새 키를 받아 주세요');
  }
  if (privateKey.asymmetricKeyType !== 'rsa') throw new ServiceAccountKeyError('서비스 계정 키의 private_key가 RSA 키가 아니에요');
  return { clientEmail, privateKey };
}

function envValue(env: NodeJS.ProcessEnv, name: string): string {
  return env[name]?.trim() ?? '';
}

/** 키를 넣었는지만 본다 (값은 읽지 않는다) */
export function serviceAccountSignature(env: NodeJS.ProcessEnv = process.env): string {
  return `${envValue(env, 'GOOGLE_SERVICE_ACCOUNT_KEY_FILE')}\u0000${envValue(env, 'GOOGLE_SERVICE_ACCOUNT_KEY')}`;
}

/**
 * .env의 서비스 계정 키를 읽는다. 파일과 값이 둘 다 있으면 파일을 쓴다.
 * 상대 경로는 서버를 띄운 폴더(npm 작업 공간이라 server/) 기준이다: STORAGE_DIR(./storage)과 같다.
 */
export function loadServiceAccountConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
  readFile: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): ServiceAccountConfig {
  const file = envValue(env, 'GOOGLE_SERVICE_ACCOUNT_KEY_FILE');
  const inline = envValue(env, 'GOOGLE_SERVICE_ACCOUNT_KEY');
  if (!file && !inline) return { configured: false };
  const source = file ? 'GOOGLE_SERVICE_ACCOUNT_KEY_FILE' : 'GOOGLE_SERVICE_ACCOUNT_KEY';
  let raw: string;
  if (file) {
    const path = isAbsolute(file) ? file : resolve(cwd, file);
    try {
      raw = readFile(path);
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
      return { configured: true, key: null, error: `${source}: ${missing ? '키 파일을 찾을 수 없어요' : '키 파일을 읽지 못했어요'} (${path})` };
    }
  } else {
    raw = inline;
  }
  try {
    return { configured: true, key: parseServiceAccountKey(raw), error: null };
  } catch (error) {
    if (error instanceof ServiceAccountKeyError) return { configured: true, key: null, error: `${source}: ${error.message}` };
    throw error;
  }
}

/**
 * GOOGLE_DRIVE_FOLDER. 넣지 않았으면 null(화면에서 저장한 폴더를 쓴다).
 * 넣었는데 폴더 주소·id로 읽을 수 없으면 folderId가 null이다 (화면 폴더로 넘어가지 않는다: 관리자가 정한 값이 무시되면 안 되므로).
 */
export function readEnvDriveFolder(env: NodeJS.ProcessEnv = process.env): { folderId: string | null } | null {
  const raw = envValue(env, 'GOOGLE_DRIVE_FOLDER');
  if (!raw) return null;
  return { folderId: normalizeDriveFolderId(raw) };
}

export const ENV_FOLDER_INVALID_MESSAGE = 'GOOGLE_DRIVE_FOLDER 값을 Drive 폴더 주소나 id로 읽지 못했어요. Drive에서 폴더를 열고 주소창의 주소(…/drive/folders/…)를 넣어 주세요';

/** 실제로 읽을 폴더: .env가 있으면 그것, 없으면 화면에서 저장한 폴더 */
export function effectiveDriveFolder(savedFolderId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): { folderId: string | null; fromEnv: boolean; error: string | null } {
  const fromEnv = readEnvDriveFolder(env);
  if (fromEnv) return { folderId: fromEnv.folderId, fromEnv: true, error: fromEnv.folderId ? null : ENV_FOLDER_INVALID_MESSAGE };
  return { folderId: savedFolderId ?? null, fromEnv: false, error: null };
}
