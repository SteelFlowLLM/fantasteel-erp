// 설정 JSON 같은 작은 파일을 통째로 바꿔 쓴다 (#487). 같은 파일에 바로 쓰면 쓰는 도중 읽은 요청이 반쪽 내용을 읽는다.
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** 설정 파일에는 API 키가 들어 있어 만든 사용자만 읽고 쓴다 */
export const SETTINGS_FILE_MODE = 0o600;
/** 설정 폴더를 새로 만들 때의 mode: 만든 사용자만 들어간다 (이미 있는 폴더는 그대로) */
const SETTINGS_DIR_MODE = 0o700;

/**
 * 같은 폴더의 임시 파일(무작위 이름)에 다 쓴 뒤 이름을 바꿔 끼운다(같은 폴더 안 rename은 한 번에 바뀐다).
 * 임시 파일을 처음부터 mode로 만들어 쓰는 동안에도 남이 읽지 못하고, 이미 있던 파일(예전의 0644)도 바꿔 끼우면 mode가 된다.
 * 폴더가 없어 새로 만들면 0700으로 만든다(이미 있는 폴더의 mode는 바꾸지 않는다).
 * 쓰기·바꾸기가 실패하면 임시 파일을 지운다: 설정에는 API 키가 들어 있어 남기지 않는다
 */
export async function writeFileAtomic(file: string, content: string, mode: number = SETTINGS_FILE_MODE): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: SETTINGS_DIR_MODE });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, content, { encoding: 'utf8', mode });
    await renameWithRetry(temp, file);
  } finally {
    // 바꿔 끼웠으면 임시 파일은 이미 없다
    await rm(temp, { force: true });
  }
}

/** Windows는 다른 요청이 대상 파일을 열어 둔 동안 rename을 EPERM·EACCES·EBUSY로 잠깐 막는다. 잠깐 기다렸다 다시 바꿔 끼운다 */
const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_RETRIES = 10;

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (process.platform !== 'win32' || !code || !RENAME_RETRY_CODES.has(code) || attempt >= RENAME_RETRIES) throw e;
      await new Promise((r) => setTimeout(r, 10 * (attempt + 1)));
    }
  }
}
