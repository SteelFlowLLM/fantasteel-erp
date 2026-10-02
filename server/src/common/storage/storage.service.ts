import { Injectable } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * 파일 저장소: 메시지 첨부(REQ-MSG-003)·밀시트 PDF(REQ-SHP-004). DB에는 여기서 돌려준 경로만 저장한다.
 * 지금은 로컬 폴더(STORAGE_DIR, 기본 server/storage)에 둔다. Supabase Storage로 옮길 때는 이 파일만 바꾼다 (컨벤션 3장).
 */
@Injectable()
export class StorageService {
  private readonly root = process.env.STORAGE_DIR ?? join(process.cwd(), 'storage');

  /** folder 예: 'messages', 'mill-sheets'. 같은 이름 충돌을 피하려고 앞에 임의 id를 붙인다 */
  async save(folder: string, fileName: string, content: Buffer): Promise<string> {
    const safeName = fileName.replace(/[\\/:*?"<>|]/g, '_');
    const path = `${folder}/${randomUUID()}-${safeName}`;
    const full = this.resolve(path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
    return path;
  }

  read(path: string): Promise<Buffer> {
    return readFile(this.resolve(path));
  }

  /** 저장소 밖 경로(../ 등)를 막는다 */
  private resolve(path: string): string {
    const full = normalize(join(this.root, path));
    if (!full.startsWith(normalize(this.root) + sep)) throw new Error(`저장소 밖 경로입니다: ${path}`);
    return full;
  }
}
