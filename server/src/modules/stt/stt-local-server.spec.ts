// 같은 Mac의 음성 서버(LaunchAgent) 켜고 끄기: launchctl 출력 해석, 운영체제·등록 여부, 정해진 명령만 실행.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SttLocalServerService, VOICE_AGENT_LABEL, parseLaunchctlPrint, type RunCommand } from './stt-local-server.service';

const RUNNING = `gui/501/com.fantasteel.voice = {\n\tactive count = 1\n\tstate = running\n\tpid = 4242\n}`;
const STOPPED = `gui/501/com.fantasteel.voice = {\n\tactive count = 0\n\tstate = not running\n}`;

class TestService extends SttLocalServerService {
  constructor(run: RunCommand, platform: NodeJS.Platform, plistPath: string) {
    super();
    this.run = run;
    this.platform = platform;
    this.plistPath = plistPath;
  }
}

describe('parseLaunchctlPrint', () => {
  it('state·pid 줄을 읽는다', () => {
    expect(parseLaunchctlPrint(RUNNING)).toEqual({ running: true, pid: 4242 });
    expect(parseLaunchctlPrint(STOPPED)).toEqual({ running: false, pid: null });
    expect(parseLaunchctlPrint('')).toEqual({ running: false, pid: null });
    expect(parseLaunchctlPrint('\tstate = not running\n\tpid = 4242\n')).toEqual({ running: false, pid: null });
  });
});

describe('SttLocalServerService', () => {
  let dir: string;
  let plist: string;
  const fetchMock = jest.spyOn(globalThis, 'fetch');

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'voice-agent-'));
    plist = join(dir, `${VOICE_AGENT_LABEL}.plist`);
    fetchMock.mockResolvedValue(new Response('{"status":"ok"}', { status: 200 }));
  });
  afterEach(async () => {
    fetchMock.mockReset();
    await rm(dir, { recursive: true, force: true });
  });
  afterAll(() => fetchMock.mockRestore());

  it('macOS가 아니면 명령을 실행하지 않고 쓸 수 없다고 알린다', async () => {
    const run = jest.fn();
    const status = await new TestService(run, 'linux', plist).status();
    expect(status).toMatchObject({ supported: false, installed: false, running: false });
    expect(run).not.toHaveBeenCalled();
    await expect(new TestService(run, 'linux', plist).start()).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it('등록 전이면 --install 안내를 주고 켜지 않는다', async () => {
    const run = jest.fn();
    const status = await new TestService(run, 'darwin', plist).status();
    expect(status).toMatchObject({ supported: true, installed: false });
    expect(status.message).toContain('start.sh --install');
    await expect(new TestService(run, 'darwin', plist).start()).rejects.toThrow('start.sh --install');
    expect(run).not.toHaveBeenCalled();
  });

  it('켜져 있고 응답하면 켜짐·pid를 보인다', async () => {
    await writeFile(plist, '<plist/>');
    const run: RunCommand = jest.fn().mockResolvedValue({ stdout: RUNNING });
    expect(await new TestService(run, 'darwin', plist).status()).toMatchObject({ installed: true, running: true, healthy: true, pid: 4242, message: null });
  });

  it('켜졌지만 아직 응답이 없으면 켜는 중이라고 한다', async () => {
    await writeFile(plist, '<plist/>');
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const run: RunCommand = jest.fn().mockResolvedValue({ stdout: RUNNING });
    const status = await new TestService(run, 'darwin', plist).status();
    expect(status).toMatchObject({ running: true, healthy: false });
    expect(status.message).toContain('켜는 중');
  });

  it('꺼져 있으면 켜기는 등록 파일로 bootstrap, 끄기는 bootout만 한다', async () => {
    await writeFile(plist, '<plist/>');
    const calls: string[][] = [];
    let running = false;
    const run: RunCommand = async (file, args) => {
      expect(file).toBe('/bin/launchctl');
      calls.push(args);
      if (args[0] === 'print') {
        if (!running) throw new Error('Could not find service');
        return { stdout: RUNNING };
      }
      if (args[0] === 'bootstrap') running = true;
      if (args[0] === 'bootout') running = false;
      return { stdout: '' };
    };
    const service = new TestService(run, 'darwin', plist);
    expect((await service.start()).running).toBe(true);
    const bootstrap = calls.find((c) => c[0] === 'bootstrap');
    expect(bootstrap?.[2]).toBe(plist);
    expect(bootstrap?.[1]).toMatch(/^gui\/\d+$/);
    expect((await service.stop()).running).toBe(false);
    expect(calls.find((c) => c[0] === 'bootout')?.[1]).toMatch(new RegExp(`^gui/\\d+/${VOICE_AGENT_LABEL.replace(/\./g, '\\.')}$`));
    expect(calls.map((c) => c[0]).every((c) => ['print', 'bootstrap', 'bootout', 'kickstart'].includes(c))).toBe(true);
  });

  it('이미 켜져 있으면 다시 시작(kickstart -k)한다', async () => {
    await writeFile(plist, '<plist/>');
    const run = jest.fn<Promise<{ stdout: string }>, [string, string[]]>().mockResolvedValue({ stdout: RUNNING });
    await new TestService(run, 'darwin', plist).start();
    expect(run.mock.calls.some(([, args]) => args[0] === 'kickstart' && args[1] === '-k')).toBe(true);
    expect(run.mock.calls.some(([, args]) => args[0] === 'bootstrap')).toBe(false);
  });
});
