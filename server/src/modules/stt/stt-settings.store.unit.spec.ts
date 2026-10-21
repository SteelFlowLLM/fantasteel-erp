// 음성 인식 설정 파일을 쓰는 중에 읽어도 반쪽 JSON을 읽지 않는다 (#487). DB 없이 임시 폴더로 확인한다.
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SttSettingsStore } from './stt-settings.store';

describe('SttSettingsStore 쓰기 (#487)', () => {
  let dir: string;
  const before = process.env.STORAGE_DIR;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'stt-settings-'));
    process.env.STORAGE_DIR = dir;
  });

  afterEach(async () => {
    process.env.STORAGE_DIR = before;
    await rm(dir, { recursive: true, force: true });
  });

  it('쓰고 읽기를 여러 번 겹쳐도 늘 온전한 설정을 읽고, 임시 파일을 남기지 않는다', async () => {
    const store = new SttSettingsStore();
    const long = 'x'.repeat(200_000);
    await store.write({ baseUrl: 'http://first', model: long, apiKey: null });
    const jobs: Promise<unknown>[] = [];
    for (let i = 0; i < 20; i++) {
      jobs.push(store.write({ baseUrl: `http://host-${i}`, model: long, apiKey: null }));
      jobs.push(store.read().then((s) => expect(s.baseUrl).toMatch(/^http:\/\/(first|host-\d+)$/)));
    }
    await Promise.all(jobs);
    expect(await readdir(join(dir, 'settings'))).toEqual(['stt.json']);
  });
});
