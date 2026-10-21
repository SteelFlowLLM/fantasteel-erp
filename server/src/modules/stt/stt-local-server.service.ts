import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { SttLocalServerView } from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';

/** tools/voice-sidecar/start.sh --install이 등록하는 LaunchAgent와 같은 이름 */
export const VOICE_AGENT_LABEL = 'com.fantasteel.voice';
const LAUNCHCTL = '/bin/launchctl';
const SIDECAR_HEALTH_URL = 'http://127.0.0.1:8001/health';
const COMMAND_TIMEOUT_MS = 10_000;

export type RunCommand = (file: string, args: string[]) => Promise<{ stdout: string }>;

const execFileAsync = promisify(execFile);
const defaultRun: RunCommand = (file, args) => execFileAsync(file, args, { timeout: COMMAND_TIMEOUT_MS });

/** `launchctl print`의 state·pid 줄 */
export function parseLaunchctlPrint(output: string): { running: boolean; pid: number | null } {
  const state = /^\s*state = (\S+)/m.exec(output)?.[1];
  const pid = /^\s*pid = (\d+)/m.exec(output)?.[1];
  const running = state === 'running';
  // 끄는 중에는 state가 바뀐 뒤에도 pid 줄이 잠시 남는다
  return { running, pid: running && pid ? Number(pid) : null };
}

/**
 * ERP 서버와 같은 Mac에 있는 음성 서버(LaunchAgent)를 켜고 끈다 (문서에 없는 기능, 이슈 #450).
 * 화면에서 받은 값은 명령에 넣지 않고, 정해진 launchctl 명령만 사용자 자신의 gui 영역에서 실행한다.
 * 다른 컴퓨터의 음성 서버는 켤 수 없다(그런 길은 그 자체가 보안 구멍이다) — 그쪽은 그 컴퓨터의 자동 켜기를 쓴다.
 */
@Injectable()
export class SttLocalServerService {
  // 시험에서 명령 실행·운영체제·등록 파일 위치를 바꿔 끼운다 (Nest 주입 대상이 아니다)
  protected run: RunCommand = defaultRun;
  protected platform: NodeJS.Platform = process.platform;
  protected plistPath = join(homedir(), 'Library', 'LaunchAgents', `${VOICE_AGENT_LABEL}.plist`);

  async status(): Promise<SttLocalServerView> {
    const base = { logPath: join(homedir(), 'Library', 'Logs', 'fantasteel-voice.log') };
    if (this.platform !== 'darwin') {
      return { supported: false, installed: false, running: false, healthy: false, pid: null, ...base, message: 'ERP 서버가 macOS가 아니라 이 화면에서 켤 수 없어요. 음성 서버 컴퓨터에서 자동 켜기를 써요' };
    }
    const installed = await access(this.plistPath).then(
      () => true,
      () => false,
    );
    if (!installed) {
      return { supported: true, installed: false, running: false, healthy: false, pid: null, ...base, message: '자동 켜기가 등록되지 않았어요. 터미널에서 tools/voice-sidecar/start.sh --install을 한 번 실행해 주세요' };
    }
    const { running, pid } = await this.print();
    const healthy = running && (await this.healthy());
    return { supported: true, installed: true, running, healthy, pid, ...base, message: running && !healthy ? '켜는 중이에요. 모델을 올리는 데 몇 초 걸려요' : null };
  }

  async start(): Promise<SttLocalServerView> {
    await this.requireInstalled();
    const { running } = await this.print();
    // 끈 뒤(bootout)에는 등록이 내려가 있어 다시 올리고, 올라가 있으면 다시 시작만 한다
    if (running) await this.run(LAUNCHCTL, ['kickstart', '-k', this.target()]);
    else await this.bootstrap();
    return this.status();
  }

  /** 지금만 끈다. 등록 파일은 남아 다음 로그인 때 다시 켜진다 */
  async stop(): Promise<SttLocalServerView> {
    await this.requireInstalled();
    await this.run(LAUNCHCTL, ['bootout', this.target()]).catch(() => undefined);
    return this.status();
  }

  private async requireInstalled(): Promise<void> {
    const current = await this.status();
    if (!current.supported || !current.installed) throw new AppException('COM-004', current.message ?? '이 화면에서 켤 수 없어요');
  }

  private async bootstrap(): Promise<void> {
    try {
      await this.run(LAUNCHCTL, ['bootstrap', `gui/${this.uid()}`, this.plistPath]);
    } catch {
      // 이미 올라가 있는데 멈춘 상태면 bootstrap이 실패한다. 그때는 바로 시작한다
      await this.run(LAUNCHCTL, ['kickstart', this.target()]);
    }
  }

  private async print(): Promise<{ running: boolean; pid: number | null }> {
    try {
      const { stdout } = await this.run(LAUNCHCTL, ['print', this.target()]);
      return parseLaunchctlPrint(stdout);
    } catch {
      return { running: false, pid: null };
    }
  }

  private async healthy(): Promise<boolean> {
    try {
      const res = await fetch(SIDECAR_HEALTH_URL, { signal: AbortSignal.timeout(2_000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  private uid(): number {
    return process.getuid?.() ?? 0;
  }

  private target(): string {
    return `gui/${this.uid()}/${VOICE_AGENT_LABEL}`;
  }
}
