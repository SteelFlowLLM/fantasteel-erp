import { Injectable } from '@nestjs/common';
import { AI_IMAGE_MAX_BYTES, INTEGRATION_PROVIDER, type DriveFileKind, type DriveFileListKind, type DriveFilePage, type DriveFileView, type IntegrationTestResult } from '@fantasteel/shared';
import { AppException } from '../../../common/errors/app.exception';
import { PrismaService } from '../../../prisma/prisma.service';
import { IntegrationConnectionRepository } from '../integration-connection.repository';
import { readSettings } from '../integration-settings';
import { GoogleDriveClient, readStreamToBuffer, serviceAccountShareMessage, type DriveMedia } from './google-drive.client';
import { effectiveDriveFolder } from './google-drive.env';
import { GoogleServiceAccount } from './google-service-account';
import {
  buildDriveFolderQuery,
  buildDriveListQuery,
  buildDriveSearchQuery,
  driveSearchTerms,
  type DriveSearchMatch,
  driveReadPlan,
  type DriveReadPlan,
  DRIVE_COUNT_PAGE_SIZE,
  DRIVE_FILE_FIELDS,
  DRIVE_FOLDER_MIME,
  DRIVE_PAGE_SIZE,
  driveDelivery,
  driveFileKind,
  driveMaxBytes,
  isDriveGoogleDoc,
  isDriveId,
  parseRangeHeader,
  toDriveFileView,
  DRIVE_PDF_MIME,
  type DriveFileMeta,
} from './google-drive.query';

const KEY = INTEGRATION_PROVIDER.GOOGLE_DRIVE;

/** 확인을 마친 파일: 종류와 그 종류의 크기 상한. Google 문서류는 PDF로 내보내므로 보낼 MIME·이름이 원본과 다르다 */
export interface CheckedDriveFile extends DriveFileMeta {
  kind: DriveFileKind;
  maxBytes: number;
  /** 응답으로 보낼 MIME */
  contentType: string;
  /** 응답으로 보낼 파일 이름 */
  contentName: string;
  /** Google 문서류를 내보낼 형식. 그대로 받는 파일은 null */
  exportMimeType: string | null;
}

/** 원본도 미리보기도 모델에 붙일 수 없는 사진. 상한은 상수에서 그대로 적는다 (모델이 숫자를 지어내지 않게) */
export const DRIVE_PHOTO_UNREADABLE = `사진 원본이 철강맨AI가 바로 볼 수 있는 크기(${AI_IMAGE_MAX_BYTES / 1_000_000}MB)·형식(PNG·JPEG·WebP)이 아니고, Drive 미리보기도 받지 못했어요. 사용자에게 입력칸에서 @로 이 사진을 붙여 달라고 해요(화면이 줄여서 보내요)`;

const KIND_LABEL: Record<DriveFileKind, string> = { audio: '녹음', image: '사진', document: '문서' };

function megabytes(bytes: number): string {
  return `${Math.floor(bytes / 1024 / 1024)}MB`;
}

/**
 * 회사 Google Drive의 정해 둔 폴더(관리자가 연결 설정에서 고름)에서 녹음·사진·문서를 읽는다 (이슈 #361).
 * 그 폴더 바로 아래 파일만 다룬다: 목록은 검색어로, 내용·전사는 메타데이터의 parents로 다시 확인한다.
 */
@Injectable()
export class GoogleDriveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: IntegrationConnectionRepository,
    private readonly client: GoogleDriveClient,
    private readonly serviceAccount: GoogleServiceAccount,
  ) {}

  /**
   * 연결·폴더 설정을 본다. 토큰 자체가 쓸 수 있는지는 요청할 때 안다.
   * .env에 서비스 계정 키가 있으면 DB 토큰은 보지 않는다. 폴더는 .env(GOOGLE_DRIVE_FOLDER)가 화면 설정보다 먼저다.
   */
  async assertReady(): Promise<string> {
    const row = await this.repository.findByProviderKey(this.prisma, KEY);
    if (this.serviceAccount.isActive()) {
      const error = this.serviceAccount.configError();
      if (error) throw new AppException('INT-015', error);
    } else if (!row?.oauthTokens) {
      if (row?.connectedAt) throw new AppException('INT-003', 'Google Drive 연결이 끊겼어요. 관리자가 다시 연결해 주세요');
      throw new AppException('INT-002', 'Google Drive가 연결되어 있지 않아요. 관리자가 먼저 연결해 주세요');
    }
    const folder = effectiveDriveFolder(readSettings(row?.settings ?? null).folderId);
    if (folder.error) throw new AppException('INT-015', folder.error);
    if (!folder.folderId) throw new AppException('INT-011');
    return folder.folderId;
  }

  /** 폴더 안 녹음·사진·문서(kind=all이면 모두), 최신 수정순 50개씩 */
  async listFiles(kind: DriveFileListKind, pageToken?: string): Promise<DriveFilePage> {
    const folderId = await this.assertReady();
    let page: { files: DriveFileMeta[]; nextPageToken: string | null };
    try {
      page = await this.client.listFiles({
        q: buildDriveListQuery(folderId, kind),
        fields: `nextPageToken,files(${DRIVE_FILE_FIELDS})`,
        pageSize: DRIVE_PAGE_SIZE,
        orderBy: 'modifiedTime desc',
        pageToken,
      });
    } catch (error) {
      throw this.folderMissing(error);
    }
    // 검색어로 이미 걸렀지만 종류 판정을 내용 받기와 맞춘다
    const files: DriveFileView[] = [];
    for (const f of page.files) {
      const fileKind = driveFileKind(f.mimeType, f.name);
      if (f.trashed || !f.parents.includes(folderId) || !fileKind || (kind !== 'all' && fileKind !== kind)) continue;
      files.push(toDriveFileView(f, fileKind));
    }
    return { files, nextPageToken: page.nextPageToken };
  }

  /**
   * 내용을 받기 전 확인: 설정한 폴더 바로 아래, 휴지통 아님, 녹음·사진·문서(expected를 주면 그 종류), 크기 상한.
   * 폴더 밖이거나 없는 파일은 같은 INT-012로 답한다 (폴더 밖 파일이 있는지 알려 주지 않는다).
   */
  async checkFile(fileId: string, expected?: DriveFileKind): Promise<CheckedDriveFile> {
    if (!isDriveId(fileId)) throw new AppException('INT-012');
    const folderId = await this.assertReady();
    const meta = await this.client.getFile(fileId, DRIVE_FILE_FIELDS);
    if (meta.trashed || !meta.parents.includes(folderId)) throw new AppException('INT-012', '설정한 Drive 폴더에 그 파일이 없어요');
    const kind = driveFileKind(meta.mimeType, meta.name);
    if (!kind || (expected && kind !== expected)) {
      throw new AppException('INT-013', expected === 'audio' ? '녹음(오디오) 파일만 가져올 수 있어요' : '녹음·사진·문서(PDF, Google 문서, Office, 글 파일) 파일만 열 수 있어요');
    }
    const maxBytes = driveMaxBytes(kind, meta.mimeType);
    if (meta.size !== null && meta.size > maxBytes) {
      throw new AppException('INT-014', `파일이 너무 커요 (${KIND_LABEL[kind]}은 ${megabytes(maxBytes)}까지)`);
    }
    const delivery = driveDelivery(meta);
    return { ...meta, kind, maxBytes, contentType: delivery.mimeType, contentName: delivery.name, exportMimeType: isDriveGoogleDoc(meta.mimeType) ? DRIVE_PDF_MIME : null };
  }

  /**
   * 폴더 안 파일의 이름만 확인한다 (사진 출처용). checkFile과 같이 폴더 밖·휴지통·없는 파일은 INT-012지만 종류·크기는 보지 않는다.
   * signal은 호출한 쪽이 끊는 짧은 제한이라, 끊겨도 Drive 연결 문제(last_error)로 기록되지 않는다
   */
  async fileName(fileId: string, signal: AbortSignal): Promise<{ id: string; name: string }> {
    if (!isDriveId(fileId)) throw new AppException('INT-012');
    const folderId = await this.assertReady();
    const meta = await this.client.getFile(fileId, DRIVE_FILE_FIELDS, signal);
    if (meta.trashed || !meta.parents.includes(folderId)) throw new AppException('INT-012', '설정한 Drive 폴더에 그 파일이 없어요');
    return { id: meta.id, name: meta.name };
  }

  /**
   * 확인한 뒤 내용을 스트림으로 연다 (GET …/files/:fileId/content). Range는 한 구간만 Drive로 넘기고(206),
   * 파일 크기를 넘는 범위면 열지 않고 unsatisfiable로 돌려준다(416). Google 문서류는 PDF로 내보낸 것을 통째로 준다 (Range 없음).
   */
  async openContent(fileId: string, options: { signal?: AbortSignal; range?: string } = {}): Promise<{ file: CheckedDriveFile; media: DriveMedia } | { file: CheckedDriveFile; unsatisfiable: true }> {
    const file = await this.checkFile(fileId);
    if (file.exportMimeType) {
      return { file, media: await this.client.openMedia(file.id, file.maxBytes, { signal: options.signal, exportMimeType: file.exportMimeType }) };
    }
    const range = parseRangeHeader(options.range, file.size);
    if (range === 'unsatisfiable') return { file, unsatisfiable: true };
    return { file, media: await this.client.openMedia(file.id, file.maxBytes, { signal: options.signal, range: range?.range }) };
  }

  /**
   * 철강맨AI의 drive_search (이슈 #398, 내용 검색 #473): 이름이나 내용에 query의 낱말이 든 파일(없으면 모두), 최신 수정순 limit개.
   * 낱말이 여럿이면 모두 든 파일을 먼저 찾고, 하나도 없으면 하나라도 든 파일을 찾는다. content를 false로 하면 이름만 본다.
   * 폴더·휴지통·종류는 목록과 같이 다시 거른다.
   */
  async searchFiles(query: string | null, kind: DriveFileListKind, limit: number, content = true): Promise<DriveFileView[]> {
    const folderId = await this.assertReady();
    const list = async (match: DriveSearchMatch): Promise<DriveFileView[]> => {
      let page: { files: DriveFileMeta[] };
      try {
        page = await this.client.listFiles({ q: buildDriveSearchQuery(folderId, kind, query, match, content), fields: `files(${DRIVE_FILE_FIELDS})`, pageSize: limit, orderBy: 'modifiedTime desc' });
      } catch (error) {
        throw this.folderMissing(error);
      }
      return page.files.flatMap((f) => {
        const fileKind = driveFileKind(f.mimeType, f.name);
        if (f.trashed || !f.parents.includes(folderId) || !fileKind || (kind !== 'all' && fileKind !== kind)) return [];
        return [toDriveFileView(f, fileKind)];
      });
    };
    const strict = await list('all');
    if (strict.length > 0 || driveSearchTerms(query).length < 2) return strict;
    return list('any');
  }

  /**
   * 철강맨AI가 읽을 파일을 메모리로 받는다 (이슈 #398). 폴더·종류는 checkFile로 확인하고, 읽는 방법(PDF·글·Google 문서 글 내보내기·사진)과
   * 그 상한은 driveReadPlan이 정한다. 읽지 않는 종류(녹음·Office·그 밖의 사진)는 받지 않고 이유만 돌려준다.
   */
  async readForAssistant(fileId: string): Promise<{ file: CheckedDriveFile; plan: DriveReadPlan; buffer: Buffer | null }> {
    const file = await this.checkFile(fileId);
    const plan = driveReadPlan(file.mimeType, file.kind);
    // 원본을 모델에 붙일 수 없는 사진(상한을 넘거나 크기를 모름, HEIC 등)은 서버가 줄이지 못해(사진 처리 의존성 없음) Drive 미리보기(긴 변 1568px)를 쓴다
    if (file.kind === 'image' && !(plan.mode === 'image' && file.size !== null && file.size <= plan.maxBytes)) {
      const thumbnail = file.thumbnailLink ? await this.client.fetchThumbnail(file.thumbnailLink, AI_IMAGE_MAX_BYTES) : null;
      if (thumbnail) return { file, plan: { mode: 'image', maxBytes: AI_IMAGE_MAX_BYTES, mediaType: thumbnail.mediaType }, buffer: thumbnail.buffer };
      return { file, plan: { mode: 'unsupported', reason: DRIVE_PHOTO_UNREADABLE }, buffer: null };
    }
    if (plan.mode === 'unsupported') return { file, plan, buffer: null };
    if (file.size !== null && file.size > plan.maxBytes) throw new AppException('INT-014', `파일이 너무 커서 철강맨AI가 읽지 않아요 (${megabytes(plan.maxBytes)}까지)`);
    const exportMimeType = plan.mode === 'text' ? (plan.exportMimeType ?? undefined) : undefined;
    const media = await this.client.openMedia(file.id, plan.maxBytes, { exportMimeType });
    return { file, plan, buffer: await readStreamToBuffer(media.stream, media.length) };
  }

  /** 회의 녹음을 메모리로 받는다. 받기 직전에 다시 확인한다 (그 사이 옮겨졌거나 바뀌었을 수 있다) */
  async downloadAudio(fileId: string): Promise<{ buffer: Buffer; file: CheckedDriveFile }> {
    const file = await this.checkFile(fileId, 'audio');
    const media = await this.client.openMedia(file.id, file.maxBytes);
    // 크기를 알면 한 번에 잡아 복사해 넣는다 (500MB 녹음이 두 벌 오르지 않게)
    const buffer = await readStreamToBuffer(media.stream, media.length ?? file.size);
    return { buffer, file };
  }

  /** 연결 확인: 폴더 메타데이터와 그 안의 녹음·사진 수. 실패도 결과로 돌려준다 */
  async test(): Promise<IntegrationTestResult> {
    const started = Date.now();
    try {
      const folderId = await this.assertReady();
      const folder = await this.client.getFile(folderId, 'id,name,mimeType,trashed').catch((error: unknown) => {
        throw this.folderMissing(error);
      });
      if (folder.mimeType !== DRIVE_FOLDER_MIME) throw new AppException('INT-012', '설정한 Drive 주소가 폴더가 아니에요. 폴더 주소를 넣어 주세요');
      if (folder.trashed) throw new AppException('INT-012', '설정한 Drive 폴더가 휴지통에 있어요');
      const page = await this.client.listFiles({ q: buildDriveFolderQuery(folderId), fields: 'nextPageToken,files(id,name,mimeType)', pageSize: DRIVE_COUNT_PAGE_SIZE });
      const kinds = page.files.map((f) => driveFileKind(f.mimeType, f.name));
      return {
        ok: true,
        latencyMs: Date.now() - started,
        tools: [],
        missingTools: [],
        error: null,
        driveFolder: {
          id: folder.id,
          name: folder.name,
          audioCount: kinds.filter((k) => k === 'audio').length,
          imageCount: kinds.filter((k) => k === 'image').length,
          countLimited: page.nextPageToken !== null,
        },
      };
    } catch (error) {
      if (!(error instanceof AppException)) throw error;
      return { ok: false, latencyMs: null, tools: [], missingTools: [], error: (error.getResponse() as { message: string }).message, driveFolder: null };
    }
  }

  /** 폴더를 볼 수 없을 때(404·서비스 계정의 403) 파일이 아니라 폴더 설정·공유를 고치라고 알린다 */
  private folderMissing(error: unknown): unknown {
    if (error instanceof AppException && error.code === 'INT-012') {
      const email = this.serviceAccount.isActive() ? this.serviceAccount.email() : null;
      if (email) return new AppException('INT-012', serviceAccountShareMessage(email));
      return new AppException('INT-012', '설정한 Drive 폴더를 찾을 수 없어요. 연결한 Google 계정이 그 폴더를 볼 수 있는지, 폴더 주소가 맞는지 확인해 주세요');
    }
    return error;
  }
}
