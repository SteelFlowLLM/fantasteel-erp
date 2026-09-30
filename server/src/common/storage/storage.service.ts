import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, type ReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

/**
 * 파일 저장소. 코드 컨벤션은 Supabase Storage(첨부·밀시트 PDF)지만 로컬에서는 서버 폴더에 저장한다.
 * Supabase로 옮길 때 이 클래스만 바꾸면 된다.
 */
@Injectable()
export class StorageService {
  private readonly root = resolve(process.env.STORAGE_DIR ?? './storage');

  /** 저장하고 저장 경로(키)를 돌려준다. */
  async save(bucket: 'attachments' | 'mill-sheets', originalName: string, data: Buffer): Promise<string> {
    const dir = join(this.root, bucket);
    mkdirSync(dir, { recursive: true });
    const key = `${bucket}/${randomUUID()}${extname(originalName).slice(0, 12)}`;
    await writeFile(join(this.root, key), data);
    return key;
  }

  exists(key: string): boolean {
    return existsSync(this.pathOf(key));
  }

  read(key: string): ReadStream {
    return createReadStream(this.pathOf(key));
  }

  private pathOf(key: string): string {
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root)) throw new Error('잘못된 파일 경로');
    return p;
  }
}
