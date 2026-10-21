// 설정 파일 통째로 바꿔 쓰기 (#487): 실패해도 임시 파일(API 키가 든)을 남기지 않는다.
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileAtomic } from './write-file-atomic';

describe('writeFileAtomic (#487)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'atomic-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('폴더가 없으면 만들고 내용을 바꿔 쓴다', async () => {
    const file = join(dir, 'settings', 'a.json');
    await writeFileAtomic(file, '{"apiKey":"1"}');
    await writeFileAtomic(file, '{"apiKey":"2"}');
    expect(await readFile(file, 'utf8')).toBe('{"apiKey":"2"}');
    expect(await readdir(join(dir, 'settings'))).toEqual(['a.json']);
  });

  it('바꿔 끼우기가 실패하면 오류를 내고 임시 파일을 지운다', async () => {
    const file = join(dir, 'b.json');
    await mkdir(file); // 같은 이름의 폴더가 있으면 rename이 실패한다
    await expect(writeFileAtomic(file, '{"apiKey":"secret"}')).rejects.toThrow();
    expect(await readdir(dir)).toEqual(['b.json']);
  });
});
