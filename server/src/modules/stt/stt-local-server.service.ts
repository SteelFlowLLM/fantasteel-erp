import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { promisify } from 'node:util';
import type { SttLocalServerActionInput, SttLocalServerActionView, SttLocalServerView } from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';

/** tools/voice-sidecar/start.sh --install이 등록하는 LaunchAgent와 같은 이름 */
export const VOICE_AGENT_LABEL = 'com.fantasteel.voice';
const LAUNCHCTL = '/bin/launchctl';
const DEFAULT_SIDECAR_PORT = 8001;
const COMMAND_TIMEOUT_MS = 10_000;

export type RunCommand = (file: string, args: string[]) => Promise<{ stdout: string }>;

const execFileAsync = promisify(execFile);
const defaultRun: RunCommand = (file, args) => execFileAsync(file, args, { timeout: COMMAND_TIMEOUT_MS });

/** start.sh --install이 plist의 EnvironmentVariables에 적은 SIDECAR_PORT. 없거나 이상하면 기본 포트 */
export function sidecarPortOf(plist: string): number {
  const port = Number(/<key>SIDECAR_PORT<\/key>\s*<string>(\d{1,5})<\/string>/.exec(plist)?.[1]);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_SIDECAR_PORT;
}

/** 음성 서버 /health의 받아쓰는 중인 긴 녹음 수. 옛 음성 서버는 이 칸이 없어 null */
export function transcribingOf(body: unknown): number | null {
  const value = typeof body === 'object' && body !== null ? (body as { transcribing?: unknown }).transcribing : undefined;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/** 다시 켜기·끄기 전에 보이는 경고 (이슈 #522) */
export function busyWarning(transcribing: number, action: 'restart' | 'stop'): string {
  return `음성 서버가 회의 녹음 ${transcribing}건을 받아쓰는 중이에요. 지금 ${action === 'restart' ? '다시 켜면' : '끄면'} 그 전사는 실패하고 녹음을 다시 올려야 해요`;
}

/** 화면에 보일 경로: 홈 폴더를 ~로 줄인다 (Windows 개발 PC의 `\` 구분자도 본다) */
export function tildePath(path: string, home = homedir()): string {
  return home && (path.startsWith(`${home}/`) || path.startsWith(`${home}${sep}`)) ? `~${path.slice(home.length)}` : path;
}

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
  /** 켜기·끄기를 한 줄로 세운다: 두 번 눌러도 bootstrap과 bootout이 섞이지 않게 */
  private queue: Promise<unknown> = Promise.resolve();

  async status(): Promise<SttLocalServerView> {
    const base = { logPath: tildePath(join(homedir(), 'Library', 'Logs', 'fantasteel-voice.log')), transcribing: null };
    if (this.platform !== 'darwin') {
      return { supported: false, installed: false, running: false, healthy: false, pid: null, ...base, message: 'ERP 서버가 macOS가 아니라 이 화면에서 켤 수 없어요. 음성 서버 컴퓨터에서 자동 켜기를 써요' };
    }
    const plist = await readFile(this.plistPath, 'utf8').catch(() => null);
    if (plist === null) {
      return { supported: true, installed: false, running: false, healthy: false, pid: null, ...base, message: '자동 켜기가 등록되지 않았어요. 터미널에서 tools/voice-sidecar/start.sh --install을 한 번 실행해 주세요' };
    }
    const { running, pid } = await this.print();
    const health = running ? await this.health(sidecarPortOf(plist)) : { ok: false, transcribing: null };
    const healthy = running && health.ok;
    return { supported: true, installed: true, running, healthy, pid, ...base, transcribing: health.transcribing, message: running && !healthy ? '켜는 중이에요. 모델을 올리는 데 몇 초 걸려요' : null };
  }

  /**
   * 켜져 있으면 다시 켠다(kickstart -k). 받아쓰는 중인 녹음이 있으면 confirmBusy 없이는 다시 켜지 않고 경고를 돌려준다:
   * 다시 켜면 그 전사가 끊기고 원본 녹음은 저장하지 않아 다시 올려야 한다 (이슈 #522)
   */
  start(input: SttLocalServerActionInput = {}): Promise<SttLocalServerActionView> {
    return this.serial(async () => {
      const current = await this.requireInstalled();
      const busy = current.running ? this.busy(current, input, 'restart') : null;
      if (busy) return busy;
      // 끈 뒤(bootout)에는 등록이 내려가 있어 다시 올리고, 올라가 있으면 다시 시작만 한다
      if (current.running) await this.run(LAUNCHCTL, ['kickstart', '-k', this.target()]);
      else await this.bootstrap();
      return done(await this.status());
    });
  }

  /** 지금만 끈다. 등록 파일은 남아 다음 로그인 때 다시 켜진다. 받아쓰는 중이면 다시 켜기와 같이 확인을 받는다 */
  stop(input: SttLocalServerActionInput = {}): Promise<SttLocalServerActionView> {
    return this.serial(async () => {
      const current = await this.requireInstalled();
      const busy = this.busy(current, input, 'stop');
      if (busy) return busy;
      await this.run(LAUNCHCTL, ['bootout', this.target()]).catch(() => undefined);
      return done(await this.status());
    });
  }

  private busy(current: SttLocalServerView, input: SttLocalServerActionInput, action: 'restart' | 'stop'): SttLocalServerActionView | null {
    if (input.confirmBusy === true || !current.transcribing) return null;
    return { ...current, needsConfirm: true, warning: busyWarning(current.transcribing, action) };
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async requireInstalled(): Promise<SttLocalServerView> {
    const current = await this.status();
    if (!current.supported || !current.installed) throw new AppException('COM-004', current.message ?? '이 화면에서 켤 수 없어요');
    return current;
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

  private async health(port: number): Promise<{ ok: boolean; transcribing: number | null }> {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2_000) });
      if (!res.ok) return { ok: false, transcribing: null };
      return { ok: true, transcribing: transcribingOf(await res.json().catch(() => null)) };
    } catch {
      return { ok: false, transcribing: null };
    }
  }

  private uid(): number {
    return process.getuid?.() ?? 0;
  }

  private target(): string {
    return `gui/${this.uid()}/${VOICE_AGENT_LABEL}`;
  }
}

const done = (view: SttLocalServerView): SttLocalServerActionView => ({ ...view, needsConfirm: false, warning: null });
