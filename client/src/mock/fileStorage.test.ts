import { describe, expect, it } from 'vitest';
import { clearMockFiles, getMockFile, putMockFile, removeMockFile } from '@/mock/fileStorage';

describe('첨부 파일 가짜 저장소', () => {
  it('경로로 넣고 꺼내고 지운다. 시드 파일은 코드에 있는 내용을 쓴다', () => {
    putMockFile('chat/1/2/a.txt', 'data:text/plain;base64,QQ==');
    expect(getMockFile('chat/1/2/a.txt')).toBe('data:text/plain;base64,QQ==');
    expect(getMockFile('seed/x.csv', { 'seed/x.csv': 'data:text/csv;base64,eA==' })).toBe('data:text/csv;base64,eA==');
    removeMockFile('chat/1/2/a.txt');
    expect(getMockFile('chat/1/2/a.txt')).toBeNull();
    putMockFile('chat/1/3/b.txt', 'data:,b');
    clearMockFiles();
    expect(getMockFile('chat/1/3/b.txt')).toBeNull();
  });
});
