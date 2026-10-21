// 철강맨 부르기 회사 설정 파일 (이슈 #457): 기본값, 깨진 파일, 부르기를 끄면 말로 승인도 꺼짐.
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SteelmanWakeSettingsStore } from './steelman-wake-settings.store';

describe('SteelmanWakeSettingsStore', () => {
  let dir: string;
  const before = process.env.STORAGE_DIR;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wake-settings-'));
    process.env.STORAGE_DIR = dir;
  });

  afterEach(async () => {
    process.env.STORAGE_DIR = before;
    await rm(dir, { recursive: true, force: true });
  });

  it('파일이 없거나 깨졌으면 기본값: 부르기 켬, 말로 승인 끔', async () => {
    const store = new SteelmanWakeSettingsStore();
    expect(await store.read()).toEqual({ enabled: true, voiceApproval: false });
    await mkdir(join(dir, 'settings'), { recursive: true });
    await writeFile(join(dir, 'settings', 'steelman-wake.json'), '{oops', 'utf8');
    expect(await store.read()).toEqual({ enabled: true, voiceApproval: false });
  });

  it('저장한 값을 읽고, 부르기를 끄면 말로 승인도 꺼진 것으로 남는다', async () => {
    const store = new SteelmanWakeSettingsStore();
    expect(await store.write({ enabled: true, voiceApproval: true })).toEqual({ enabled: true, voiceApproval: true });
    expect(await store.read()).toEqual({ enabled: true, voiceApproval: true });
    expect(await store.write({ enabled: false, voiceApproval: true })).toEqual({ enabled: false, voiceApproval: false });
    expect(await store.read()).toEqual({ enabled: false, voiceApproval: false });
  });
});
