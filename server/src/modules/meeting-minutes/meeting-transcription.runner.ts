import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { MEETING_MINUTES_STATUS } from '@fantasteel/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { SttClient, SttRequestError } from '../stt/stt.client';
import { SttSettingsStore } from '../stt/stt-settings.store';
import { MeetingJobLease } from './meeting-job.lease';
import { MeetingMinutesRepository } from './meeting-minutes.repository';

export const TRANSCRIPTION_INTERRUPTED_REASON = '전사하던 서버가 멈춰 전사가 중단됐어요. 음성을 다시 올려 주세요';
const TRANSCRIPTION_ERROR_REASON = '전사 중 오류가 났어요';

export interface TranscriptionJob {
  meetingMinutesId: number;
  /** 원본 음성은 디스크·DB에 두지 않는다: 이 메모리 참조가 전부이고 작업이 끝나면 놓는다 */
  audio: Buffer | null;
  fileName: string;
  mimeType: string;
  /** 참석자 수. 화자 분리 엔진에 화자 수로 알려 준다 */
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
    try {
      const audio = job.audio;
      if (!audio) return;
      const settings = await this.sttSettings.read();
      const result = await this.sttClient.transcribe(settings, { audio, fileName: job.fileName, mimeType: job.mimeType, model: settings.model, speakerCount: job.speakerCount });
      const segments = result.segments.filter((s) => s.text.trim() !== '');
      const transcript = segments.length > 0 ? segments.map((s) => s.text.trim()).join('\n') : result.text.trim();
      const data: Prisma.MeetingMinutesUncheckedUpdateManyInput = {
        meetingMinutesStatus: MEETING_MINUTES_STATUS.TRANSCRIBED,
        transcript,
        transcriptSegments: segments.map((s) => ({ start: s.start, end: s.end, text: s.text.trim(), ...(s.speaker ? { speaker: s.speaker } : {}) })),
        failureReason: null,
      };
      await this.finish(job.meetingMinutesId, data);
    } catch (error) {
      // 음성·전사 내용은 로그에 남기지 않는다
      this.logger.error(`회의록 ${job.meetingMinutesId} 전사 실패: ${error instanceof SttRequestError ? error.message : error instanceof Error ? error.name : 'unknown'}`);
      const reason = error instanceof SttRequestError ? error.message : TRANSCRIPTION_ERROR_REASON;
      await this.finish(job.meetingMinutesId, { meetingMinutesStatus: MEETING_MINUTES_STATUS.FAILED, failureReason: reason }).catch((e: unknown) =>
        this.logger.error(`회의록 ${job.meetingMinutesId} 실패 상태를 저장하지 못했어요: ${e instanceof Error ? e.name : 'unknown'}`),
      );
    } finally {
      job.audio = null;
      this.lease.release(job.meetingMinutesId);
    }
  }

  private async finish(id: number, data: Prisma.MeetingMinutesUncheckedUpdateManyInput): Promise<void> {
    const { count } = await this.repository.finishTranscription(this.prisma, id, data);
    if (count === 0) this.logger.warn(`회의록 ${id}는 더 이상 전사 중이 아니라 결과를 버렸어요`);
  }
}
