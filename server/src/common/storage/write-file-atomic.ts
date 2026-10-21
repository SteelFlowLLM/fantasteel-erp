// 설정 JSON 같은 작은 파일을 통째로 바꿔 쓴다 (#487). 같은 파일에 바로 쓰면 쓰는 도중 읽은 요청이 반쪽 내용을 읽는다.
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * 같은 폴더의 임시 파일(무작위 이름)에 다 쓴 뒤 이름을 바꿔 끼운다(같은 폴더 안 rename은 한 번에 바뀐다).
 * 쓰기·바꾸기가 실패하면 임시 파일을 지운다: 설정에는 API 키가 들어 있어 남기지 않는다
 */
export async function writeFileAtomic(file: string, content: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, content, 'utf8');
    await rename(temp, file);
  } finally {
    // 바꿔 끼웠으면 임시 파일은 이미 없다
    await rm(temp, { force: true });
  }
}
