import { Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { INTEGRATION_PROVIDER, type DriveFileKind, type DriveFilePage, type IntegrationTestResult } from '@fantasteel/shared';
import { AppException } from '../../../common/errors/app.exception';
import { PrismaService } from '../../../prisma/prisma.service';
import { IntegrationConnectionRepository } from '../integration-connection.repository';
import { readSettings } from '../integration-settings';
import { GoogleDriveClient, readStreamToBuffer } from './google-drive.client';
import {
  buildDriveFolderQuery,
  buildDriveListQuery,
  DRIVE_COUNT_PAGE_SIZE,
  DRIVE_FILE_FIELDS,
  DRIVE_FOLDER_MIME,
  DRIVE_PAGE_SIZE,
  driveFileKind,
  driveMaxBytes,
  isDriveId,
  toDriveFileView,
  type DriveFileMeta,
} from './google-drive.query';

const KEY = INTEGRATION_PROVIDER.GOOGLE_DRIVE;

/** 확인을 마친 파일: 종류와 그 종류의 크기 상한 */
export interface CheckedDriveFile extends DriveFileMeta {
  kind: DriveFileKind;
  maxBytes: number;
}

function megabytes(bytes: number): string {
  return `${Math.floor(bytes / 1024 / 1024)}MB`;
}

/**
 * 회사 Google Drive의 정해 둔 폴더(관리자가 연결 설정에서 고름)에서 녹음·사진을 읽는다 (이슈 #361).
 * 그 폴더 바로 아래 파일만 다룬다: 목록은 검색어로, 내용·전사는 메타데이터의 parents로 다시 확인한다.
 */
@Injectable()
export class GoogleDriveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: IntegrationConnectionRepository,
    private readonly client: GoogleDriveClient,
  ) {}

  /** 연결(토큰)·폴더 설정을 본다. 토큰 자체가 쓸 수 있는지는 요청할 때 안다 */
  async assertReady(): Promise<string> {
    const row = await this.repository.findByProviderKey(this.prisma, KEY);
    if (!row?.oauthTokens) {
      if (row?.connectedAt) throw new AppException('INT-003', 'Google Drive 연결이 끊겼어요. 관리자가 다시 연결해 주세요');
      throw new AppException('INT-002', 'Google Drive가 연결되어 있지 않아요. 관리자가 먼저 연결해 주세요');
    }
    const folderId = readSettings(row.settings).folderId;
    if (!folderId) throw new AppException('INT-011');
    return folderId;
  }

  /** 폴더 안 녹음 또는 사진, 최신 수정순 50개씩 */
  async listFiles(kind: DriveFileKind, pageToken?: string): Promise<DriveFilePage> {
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
    const files = page.files.filter((f) => !f.trashed && f.parents.includes(folderId) && driveFileKind(f.mimeType, f.name) === kind).map(toDriveFileView);
    return { files, nextPageToken: page.nextPageToken };
  }

  /**
   * 내용을 받기 전 확인: 설정한 폴더 바로 아래, 휴지통 아님, 녹음·사진(expected를 주면 그 종류), 크기 상한.
   * 폴더 밖이거나 없는 파일은 같은 INT-012로 답한다 (폴더 밖 파일이 있는지 알려 주지 않는다).
   */
  async checkFile(fileId: string, expected?: DriveFileKind): Promise<CheckedDriveFile> {
    if (!isDriveId(fileId)) throw new AppException('INT-012');
    const folderId = await this.assertReady();
    const meta = await this.client.getFile(fileId, DRIVE_FILE_FIELDS);
    if (meta.trashed || !meta.parents.includes(folderId)) throw new AppException('INT-012', '설정한 Drive 폴더에 그 파일이 없어요');
    const kind = driveFileKind(meta.mimeType, meta.name);
    if (!kind || (expected && kind !== expected)) {
      throw new AppException('INT-013', expected === 'audio' ? '녹음(오디오) 파일만 가져올 수 있어요' : '녹음이나 사진 파일만 가져올 수 있어요');
    }
    const maxBytes = driveMaxBytes(kind);
    if (meta.size !== null && meta.size > maxBytes) {
      throw new AppException('INT-014', `파일이 너무 커요 (${kind === 'audio' ? '녹음' : '사진'}은 ${megabytes(maxBytes)}까지)`);
    }
    return { ...meta, kind, maxBytes };
  }

  /** 확인한 뒤 내용을 스트림으로 연다 (GET …/files/:fileId/content) */
  async openContent(fileId: string, signal?: AbortSignal): Promise<{ file: CheckedDriveFile; stream: Readable }> {
    const file = await this.checkFile(fileId);
    return { file, stream: await this.client.openMedia(file.id, file.maxBytes, signal) };
  }

  /** 회의 녹음을 메모리로 받는다. 받기 직전에 다시 확인한다 (그 사이 옮겨졌거나 바뀌었을 수 있다) */
  async downloadAudio(fileId: string): Promise<{ buffer: Buffer; file: CheckedDriveFile }> {
    const file = await this.checkFile(fileId, 'audio');
    const buffer = await readStreamToBuffer(await this.client.openMedia(file.id, file.maxBytes));
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

  /** 폴더를 볼 수 없을 때(404) 파일이 아니라 폴더 설정을 고치라고 알린다 */
  private folderMissing(error: unknown): unknown {
    if (error instanceof AppException && error.code === 'INT-012') {
      return new AppException('INT-012', '설정한 Drive 폴더를 찾을 수 없어요. 연결한 Google 계정이 그 폴더를 볼 수 있는지, 폴더 주소가 맞는지 확인해 주세요');
    }
    return error;
  }
}
