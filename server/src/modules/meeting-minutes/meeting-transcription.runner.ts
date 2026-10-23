import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { MEETING_MINUTES_STATUS, type MeetingTranscriptionProgress } from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { SttClient, SttRequestError, type SttProgress } from '../stt/stt.client';
import { SttSettingsStore } from '../stt/stt-settings.store';
import { MeetingJobLease } from './meeting-job.lease';
import { MeetingMinutesRepository } from './meeting-minutes.repository';
import { buildSttPrompt } from './meeting-stt-prompt';

export const TRANSCRIPTION_INTERRUPTED_REASON = '전사하던 서버가 멈춰 전사가 중단됐어요. 음성을 다시 올려 주세요';
const TRANSCRIPTION_ERROR_REASON = '전사 중 오류가 났어요';
const AUDIO_LOAD_ERROR_REASON = 'Drive에서 녹음을 받지 못했어요';
/** 받아쓴 글이 없으면 빈 회의록으로 두지 않고 실패로 끝낸다 (이슈 #522) */
export const NO_SPEECH_REASON = '말소리를 찾지 못했어요. 녹음에 목소리가 담겼는지 확인하고 다시 올려 주세요';

const PHASE_OF: Record<SttProgress['stage'], MeetingTranscriptionProgress['phase']> = { diarize: 'DIARIZE', transcribe: 'TRANSCRIBE' };

export interface TranscriptionJob {
  meetingMinutesId: number;
  /** 원본 음성은 디스크·DB에 두지 않는다: 이 메모리 참조가 전부이고 작업이 끝나면 놓는다 */
  audio: Buffer | null;
  /**
   * audio가 없을 때 차례가 오면 음성을 받아 온다 (Drive 녹음). 줄 안에서 받으므로 큰 녹음 여러 개가 한꺼번에 메모리에 오르지 않는다.
   * 실패하면 AppException 문구가 실패 이유가 된다.
   */
  loadAudio?: () => Promise<Buffer>;
  fileName: string;
  mimeType: string;
  /** 참석자 수. 화자 분리 엔진에 최대 화자 수로 알려 준다 (말하지 않은 참석자가 있을 수 있다) */
  speakerCount?: number;
}

/**
 * 회의 음성을 백그라운드로 글로 바꾼다 (BP-VOC-01). 요청은 기다리지 않고, 작업은 한 번에 하나씩만 돈다
 * (whisper 서버 하나를 겹쳐 부르지 않는다). 서버가 꺼지면 메모리의 음성도 사라지므로, 맡은 서버의 표시가
 * 끊긴 TRANSCRIBING 행을 켤 때와 주기적으로 실패로 돌린다 (MeetingJobLease).
 */
@Injectable()
export class MeetingTranscriptionRunner implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MeetingTranscriptionRunner.name);
  private tail: Promise<void> = Promise.resolve();
  private readonly lease: MeetingJobLease;

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: MeetingMinutesRepository,
    private readonly sttClient: SttClient,
    private readonly sttSettings: SttSettingsStore,
  ) {
    this.lease = new MeetingJobLease(prisma, repository, MEETING_MINUTES_STATUS.TRANSCRIBING, TRANSCRIPTION_INTERRUPTED_REASON, this.logger, '전사');
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.recoverInterrupted();
    this.lease.start();
  }

  onModuleDestroy(): void {
    this.lease.stop();
  }

  /** 맡은 서버가 멈춘 전사 행을 실패로 (테스트에서 시각을 넘겨 부른다) */
  recoverInterrupted(now?: Date): Promise<number> {
    return this.lease.recoverStale(now);
  }

  /** 줄 세우고 바로 돌려준다. 돌려주는 약속은 이 작업이 끝나면 풀리고 절대 거절되지 않는다 */
  enqueue(job: TranscriptionJob): Promise<void> {
    this.lease.hold(job.meetingMinutesId);
    const run = this.tail.then(() => this.run(job));
    this.tail = run;
    return run;
  }

  /** 줄 선 작업이 모두 끝날 때까지 (테스트용) */
  drain(): Promise<void> {
    return this.tail;
  }

  private async run(job: TranscriptionJob): Promise<void> {
    let loading = false;
    try {
      let audio = job.audio;
      if (!audio && job.loadAudio) {
        loading = true;
        audio = await job.loadAudio();
        loading = false;
      }
      if (!audio) return;
      const settings = await this.sttSettings.read();
      const progress = new ProgressWriter((value) => this.repository.setTranscriptionProgress(this.prisma, job.meetingMinutesId, { ...value }), this.logger, job.meetingMinutesId);
      const result = await this.sttClient
        .transcribe(settings, {
          audio,
          fileName: job.fileName,
          mimeType: job.mimeType,
          model: settings.model,
          maxSpeakers: job.speakerCount,
          prompt: (await this.promptFor(job.meetingMinutesId)) ?? undefined,
          onProgress: (p) => progress.push({ phase: PHASE_OF[p.stage], current: p.current, total: p.total }),
        })
        .finally(() => progress.settled());
      const segments = result.segments.filter((s) => s.text.trim() !== '');
      const transcript = segments.length > 0 ? segments.map((s) => s.text.trim()).join('\n') : result.text.trim();
      if (transcript === '') {
        this.logger.warn(`회의록 ${job.meetingMinutesId} 전사 결과가 비어 실패로 끝내요`);
        await this.finish(job.meetingMinutesId, { meetingMinutesStatus: MEETING_MINUTES_STATUS.FAILED, failureReason: NO_SPEECH_REASON, transcriptionProgress: Prisma.DbNull });
        return;
      }
      const data: Prisma.MeetingMinutesUncheckedUpdateManyInput = {
        meetingMinutesStatus: MEETING_MINUTES_STATUS.TRANSCRIBED,
        transcript,
        transcriptSegments: segments.map((s) => ({ start: s.start, end: s.end, text: s.text.trim(), ...(s.speaker ? { speaker: s.speaker } : {}) })),
        failureReason: null,
        transcriptionProgress: Prisma.DbNull,
      };
      await this.finish(job.meetingMinutesId, data);
    } catch (error) {
      // 음성·전사 내용은 로그에 남기지 않는다
      const detail = error instanceof SttRequestError || error instanceof AppException ? error.message : error instanceof Error ? error.name : 'unknown';
      this.logger.error(`회의록 ${job.meetingMinutesId} ${loading ? '녹음 받기' : '전사'} 실패: ${detail}`);
      const reason =
        error instanceof SttRequestError
          ? error.publicMessage
          : loading
            ? `${AUDIO_LOAD_ERROR_REASON}: ${error instanceof AppException ? (error.getResponse() as { message: string }).message : '알 수 없는 오류'}`.slice(0, 500)
            : TRANSCRIPTION_ERROR_REASON;
      await this.finish(job.meetingMinutesId, { meetingMinutesStatus: MEETING_MINUTES_STATUS.FAILED, failureReason: reason, transcriptionProgress: Prisma.DbNull }).catch((e: unknown) =>
        this.logger.error(`회의록 ${job.meetingMinutesId} 실패 상태를 저장하지 못했어요: ${e instanceof Error ? e.name : 'unknown'}`),
      );
    } finally {
      job.audio = null;
      job.loadAudio = undefined;
      this.lease.release(job.meetingMinutesId);
    }
  }

  /** 용어 힌트는 덤이다: 읽지 못하면 힌트 없이 받아쓴다 */
  private async promptFor(id: number): Promise<string | null> {
    try {
      return buildSttPrompt(await this.repository.findSttHints(this.prisma, id));
    } catch (error) {
      this.logger.warn(`회의록 ${id} 용어 힌트를 만들지 못했어요: ${error instanceof Error ? error.name : 'unknown'}`);
      return null;
    }
  }

  private async finish(id: number, data: Prisma.MeetingMinutesUncheckedUpdateManyInput): Promise<void> {
    const { count } = await this.repository.finishTranscription(this.prisma, id, data);
    if (count === 0) this.logger.warn(`회의록 ${id}는 더 이상 전사 중이 아니라 결과를 버렸어요`);
  }
}

/**
 * 음성 서버가 알려 준 진행을 차례로 DB에 적는다. 앞의 쓰기가 끝나기 전에 온 값은 마지막 것만 남겨 늦게 끝난 옛 값이 새 값을 덮지 않게 하고,
 * 같은 값은 다시 쓰지 않는다. 쓰기 실패는 전사를 멈추지 않는다 (진행 표시는 덤이다)
 */
export class ProgressWriter {
  private pending: MeetingTranscriptionProgress | null = null;
  private last = '';
  private running: Promise<void> = Promise.resolve();
  private busy = false;

  constructor(
    private readonly write: (value: MeetingTranscriptionProgress) => Promise<unknown>,
    private readonly logger: Logger,
    private readonly id: number,
  ) {}

  push(value: MeetingTranscriptionProgress): void {
    if (JSON.stringify(value) === this.last) return;
    this.pending = value;
    if (!this.busy) this.running = this.drain();
  }

  /** 남은 쓰기가 끝날 때까지 (결과를 적기 전에 기다려 진행 칸이 결과 뒤에 남지 않게 한다) */
  settled(): Promise<void> {
    return this.running;
  }

  private async drain(): Promise<void> {
    this.busy = true;
    try {
      while (this.pending) {
        const value = this.pending;
        this.pending = null;
        const key = JSON.stringify(value);
        if (key === this.last) continue;
        this.last = key;
        await this.write(value).catch((e: unknown) => this.logger.warn(`회의록 ${this.id} 전사 진행을 남기지 못했어요: ${e instanceof Error ? e.name : 'unknown'}`));
      }
    } finally {
      this.busy = false;
    }
  }
}
