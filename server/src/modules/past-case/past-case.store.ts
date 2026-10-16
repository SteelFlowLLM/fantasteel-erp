import { Injectable } from '@nestjs/common';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { PastCaseView } from '@fantasteel/shared';

/** 파일에 남기는 등록 사례 (화면 모양에서 예시 표시만 뺀 것) */
export interface StoredPastCase extends Omit<PastCaseView, 'isExample'> {
  createdEmployeeId: number;
}

interface StoreFile {
  cases: StoredPastCase[];
}

/**
 * 등록한 과거 사례 저장. 기준 ERD에 past_case 테이블이 없어(2026-10-16 결정) DB가 아니라 저장소 폴더(STORAGE_DIR)의 JSON 파일에 둔다.
 * LLM 연결 설정(llm-settings.store.ts)과 같은 방식이다. past_case 테이블이 생기면 이 파일만 repository로 바꾼다.
 * 서버 1대 가정: 쓰기는 한 번에 하나씩 이어서 해 번호가 겹치지 않게 한다.
 */
@Injectable()
export class PastCaseStore {
  private writing: Promise<unknown> = Promise.resolve();

  /** 테스트가 STORAGE_DIR을 바꿀 수 있게 부를 때마다 경로를 구한다 */
  private file(): string {
    return join(process.env.STORAGE_DIR ?? join(process.cwd(), 'storage'), 'past-cases', 'cases.json');
  }

  async list(): Promise<StoredPastCase[]> {
    const raw = await readFile(this.file(), 'utf8').catch(() => null);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as Partial<StoreFile>;
    return Array.isArray(parsed.cases) ? parsed.cases : [];
  }

  /** 다음 번호(이미 쓴 가장 큰 번호 + 1, 최소 firstSeq)로 사례를 만들어 덧붙인다 */
  append(firstSeq: number, build: (seq: number) => StoredPastCase): Promise<StoredPastCase> {
    const run = this.writing.then(async () => {
      const cases = await this.list();
      const seq = Math.max(firstSeq, ...cases.map((c) => c.id + 1));
      const created = build(seq);
      const file = this.file();
      await mkdir(dirname(file), { recursive: true });
      // 쓰다가 멈춰도 파일이 반쯤 남지 않게 임시 파일에 쓴 뒤 바꾼다
      const temp = `${file}.tmp`;
      await writeFile(temp, JSON.stringify({ cases: [...cases, created] } satisfies StoreFile, null, 2), 'utf8');
      await rename(temp, file);
      return created;
    });
    this.writing = run.catch(() => undefined);
    return run;
  }
}
