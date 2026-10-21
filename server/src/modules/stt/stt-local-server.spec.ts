// 같은 Mac의 음성 서버(LaunchAgent) 켜고 끄기: launchctl 출력 해석, 운영체제·등록 여부, 정해진 명령만 실행.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SttLocalServerService, VOICE_AGENT_LABEL, parseLaunchctlPrint, sidecarPortOf, tildePath, type RunCommand } from './stt-local-server.service';

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

describe('plist 포트·경로 줄이기', () => {
  it('start.sh가 적은 SIDECAR_PORT를 읽고, 없거나 이상하면 8001', () => {
    expect(sidecarPortOf('<dict>\n    <key>SIDECAR_PORT</key><string>8123</string>\n</dict>')).toBe(8123);
    expect(sidecarPortOf('<plist/>')).toBe(8001);
    expect(sidecarPortOf('<key>SIDECAR_PORT</key><string>99999</string>')).toBe(8001);
  });

  it('홈 폴더를 ~로 줄인다', () => {
    expect(tildePath('/Users/kim/Library/Logs/fantasteel-voice.log', '/Users/kim')).toBe('~/Library/Logs/fantasteel-voice.log');
    expect(tildePath('/var/log/x.log', '/Users/kim')).toBe('/var/log/x.log');
    expect(tildePath('/Users/kimberly/x.log', '/Users/kim')).toBe('/Users/kimberly/x.log');
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

  it('켜져 있고 응답하면 켜짐·pid를 보이고, plist의 포트로 응답을 본다', async () => {
    await writeFile(plist, '<key>SIDECAR_PORT</key><string>8123</string>');
    const run: RunCommand = jest.fn().mockResolvedValue({ stdout: RUNNING });
    const status = await new TestService(run, 'darwin', plist).status();
    expect(status).toMatchObject({ installed: true, running: true, healthy: true, pid: 4242, message: null });
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8123/health');
    expect(status.logPath?.startsWith('~/')).toBe(true);
  });

  it('켜기·끄기를 동시에 눌러도 차례로 하나씩 실행한다', async () => {
    await writeFile(plist, '<plist/>');
    const log: string[] = [];
    let running = false;
    const run: RunCommand = async (_file, args) => {
      log.push(`${args[0]}:start`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      log.push(`${args[0]}:end`);
      if (args[0] === 'print') {
        if (!running) throw new Error('not found');
        return { stdout: RUNNING };
      }
      if (args[0] === 'bootstrap') running = true;
      if (args[0] === 'bootout') running = false;
      return { stdout: '' };
    };
    const service = new TestService(run, 'darwin', plist);
    const [started, stopped] = await Promise.all([service.start(), service.stop()]);
    expect(started.running).toBe(true);
    expect(stopped.running).toBe(false);
    // 어느 명령도 다른 명령이 끝나기 전에 시작하지 않는다
    for (let i = 0; i < log.length; i += 2) expect(log[i + 1]).toBe(log[i].replace(':start', ':end'));
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
