import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BrowserSettingsStore } from './browser-settings.store';
import { UpdateLlmBrowserSettingsDto } from './dto/llm-settings.dto';
import { LlmService } from './llm.service';

describe('철강맨AI 브라우저 주소 설정 (이슈 #430)', () => {
  let dir: string;
  let previous: string | undefined;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'browser-settings-'));
    previous = process.env.STORAGE_DIR;
    process.env.STORAGE_DIR = dir;
  });
  afterEach(async () => {
    if (previous === undefined) delete process.env.STORAGE_DIR;
    else process.env.STORAGE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  });

  it('저장한 적이 없으면 목록 없음·스위치 꺼짐이고, 저장하면 그대로 읽는다', async () => {
    const store = new BrowserSettingsStore();
    expect(await store.read()).toEqual({ startSites: null, openAllSites: false });
    await store.write({ startSites: ['kosis.kr'], openAllSites: true });
    expect(await new BrowserSettingsStore().read()).toEqual({ startSites: ['kosis.kr'], openAllSites: true });
  });

  it('손으로 고친 파일의 잘못된 호스트·모양은 버린다 (열 수 있는 범위를 넓히지 않는다)', async () => {
    await mkdir(join(dir, 'settings'), { recursive: true });
    await writeFile(join(dir, 'settings', 'browser.json'), JSON.stringify({ startSites: ['ok.kr', 'Bad.KR', 'localhost', 'a b.com', 3], openAllSites: 'yes' }));
    expect(await new BrowserSettingsStore().read()).toEqual({ startSites: ['ok.kr'], openAllSites: false });
    await writeFile(join(dir, 'settings', 'browser.json'), '{깨짐');
    expect(await new BrowserSettingsStore().read()).toEqual({ startSites: null, openAllSites: false });
  });

  it('서비스: 저장한 목록이 있으면 지금 쓰는 목록이 되고, null로 저장하면 기본 목록으로 돌아간다', async () => {
    const service = new LlmService({} as never, {} as never, new BrowserSettingsStore());
    const saved = await service.updateBrowserSettings({ startSites: ['kosis.kr', 'kosis.kr', 'kita.net'], openAllSites: true });
    expect(saved).toEqual({ startSites: ['kosis.kr', 'kita.net'], effectiveStartSites: ['kosis.kr', 'kita.net'], defaultStartSites: expect.arrayContaining(['naver.com']), openAllSites: true });
    const reset = await service.updateBrowserSettings({ startSites: null, openAllSites: false });
    expect(reset.startSites).toBeNull();
    expect(reset.effectiveStartSites).toContain('naver.com');
  });

  it('입력 검사: 소문자 도메인(점 하나 이상)만, 대문자는 소문자로 바꾸고 50개까지', async () => {
    const check = async (body: unknown) => validate(plainToInstance(UpdateLlmBrowserSettingsDto, body));
    expect(await check({ startSites: ['KOSIS.kr', ' kita.net '], openAllSites: false })).toHaveLength(0);
    expect(await check({ startSites: null, openAllSites: true })).toHaveLength(0);
    expect(await check({ startSites: [], openAllSites: true })).toHaveLength(0);
    for (const bad of ['localhost', 'http://a.com', 'a.com/path', 'a b.com', '']) expect(await check({ startSites: [bad], openAllSites: false })).not.toHaveLength(0);
    expect(await check({ startSites: Array.from({ length: 51 }, (_, i) => `s${i}.kr`), openAllSites: false })).not.toHaveLength(0);
    expect(await check({ startSites: ['a.kr'] })).not.toHaveLength(0);
    const transformed = plainToInstance(UpdateLlmBrowserSettingsDto, { startSites: ['KOSIS.kr'], openAllSites: false });
    expect(transformed.startSites).toEqual(['kosis.kr']);
  });
});
