// 음성 서버 주소 종류 분류, 방식 짐작·기본값.
import { describe, expect, it } from 'vitest';
import { classifySttHost, sameOriginUrl, sttModeDefaults, sttModeOf } from '@/lib/sttHost';

const kindOf = (url: string) => classifySttHost(url).kind;

describe('classifySttHost', () => {
  it.each([
    ['http://127.0.0.1:8000/v1', 'self'],
    ['http://localhost:8001/v1', 'self'],
    ['http://[::1]:8000/v1', 'self'],
    ['http://192.168.0.20:8000/v1', 'lan'],
    ['http://10.1.2.3:8000/v1', 'lan'],
    ['http://172.16.0.5:8000/v1', 'lan'],
    ['http://172.31.255.1:8000/v1', 'lan'],
    ['http://voice-pc:8000/v1', 'lan'],
    ['http://voice-pc.local:8000/v1', 'lan'],
    ['http://100.64.0.1:8000/v1', 'tailscale'],
    ['http://100.101.102.103:8001/v1', 'tailscale'],
    ['http://100.127.255.255:8000/v1', 'tailscale'],
    ['http://my-pc.tail1234.ts.net:8000/v1', 'tailscale'],
    ['https://api.openai.com/v1', 'internet'],
    ['http://172.32.0.1:8000/v1', 'internet'],
    ['http://8.8.8.8:8000/v1', 'internet'],
    ['http://[fd12:3456::1]:8000/v1', 'lan'],
    ['http://[fe80::1]:8000/v1', 'blocked'],
    ['http://169.254.169.254/v1', 'blocked'],
    ['http://voice.corp.example.kr:8000/v1', 'unknown'],
    ['https://stt.groq.com/v1', 'unknown'],
    ['http://100.128.0.1:8000/v1', 'internet'],
    ['http://0.0.0.0:8000/v1', 'unspecified'],
    ['192.168.0.20:8000/v1', 'invalid'],
    ['ftp://192.168.0.20/v1', 'invalid'],
    ['', 'invalid'],
  ])('%s → %s', (url, kind) => {
    expect(kindOf(url)).toBe(kind);
  });

  it('모르는 이름은 단정하지 않고 부드러운 문구를 쓴다', () => {
    const info = classifySttHost('http://voice.corp.example.kr:8000/v1');
    expect(info.warn).toBe(false);
    expect(info.note).toContain('인터넷 주소라면');
  });

  it('암호화 없는 인터넷 주소만 경고한다', () => {
    expect(classifySttHost('http://8.8.8.8/v1').warn).toBe(true);
    expect(classifySttHost('http://example.com/v1').warn).toBe(false);
    expect(classifySttHost('https://example.com/v1').warn).toBe(false);
    expect(classifySttHost('http://192.168.0.20:8000/v1').warn).toBe(false);
  });
});

describe('방식', () => {
  it('주소로 방식을 짐작한다', () => {
    expect(sttModeOf('http://127.0.0.1:8000/v1')).toBe('server');
    expect(sttModeOf('http://100.101.102.103:8001/v1')).toBe('server');
    expect(sttModeOf('https://api.openai.com/v1')).toBe('api');
    expect(sttModeOf('http://voice.corp.example.kr:8000/v1')).toBe('server');
    expect(sttModeOf('https://stt.groq.com/v1')).toBe('api');
  });

  it('방식을 바꾸면 주소·모델 기본값을 준다', () => {
    expect(sttModeDefaults('api')).toEqual({ baseUrl: 'https://api.openai.com/v1', model: 'whisper-1' });
    expect(sttModeDefaults('server')).toEqual({ baseUrl: 'http://127.0.0.1:8000/v1', model: '' });
  });
});

describe('sameOriginUrl', () => {
  it('프로토콜·호스트·포트가 같으면 경로가 달라도 같은 출처', () => {
    expect(sameOriginUrl('https://api.openai.com/v1', 'https://api.openai.com/v1/')).toBe(true);
    expect(sameOriginUrl('https://api.openai.com/v1', 'http://192.168.0.20:8000/v1')).toBe(false);
    expect(sameOriginUrl('http://192.168.0.20:8000/v1', 'http://192.168.0.20:8001/v1')).toBe(false);
    expect(sameOriginUrl('이상한 주소', 'http://127.0.0.1:8000/v1')).toBe(false);
  });
});
