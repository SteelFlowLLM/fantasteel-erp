// LLM·음성 서버 주소 검사 (#497): 클라우드 메타데이터는 막고 로컬 LLM·음성 서버가 있는 곳(localhost·사설망·Tailscale)은 받는다.
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TestLlmConnectionDto, UpdateLlmSettingsDto } from '../../modules/llm/dto/llm-settings.dto';
import { TestSttConnectionDto, UpdateSttSettingsDto } from '../../modules/stt/dto/stt-settings.dto';
import { isBlockedServerHost, redactUrl, sameOrigin } from './server-url';

const BLOCKED = [
  'http://169.254.169.254/latest/meta-data',
  'http://169.254.169.254./latest/meta-data',
  'http://169.254.0.5:8000/v1',
  'http://169.254.170.2/v2/credentials',
  // WHATWG URL이 정규화하는 다른 표기
  'http://2852039166/v1',
  'http://0xa9fea9fe/v1',
  'http://0251.0376.0251.0376/v1',
  // IPv6 링크 로컬·AWS IPv6 메타데이터
  'http://[fe80::1]:8000/v1',
  'http://[febf::1]/v1',
  'http://[fd00:ec2::254]/latest/meta-data',
  'http://[FD00:EC2:0:0:0:0:0:254]/latest/meta-data',
  // IPv4를 담은 IPv6 (IPv4-mapped·NAT64·옛 IPv4-compatible)
  'http://[::ffff:169.254.169.254]/v1',
  'http://[::ffff:a9fe:a9fe]/v1',
  'http://[64:ff9b::169.254.169.254]/v1',
  'http://[::169.254.169.254]/v1',
  'http://[::ffff:100.100.100.200]/v1',
  // 이름
  'http://metadata.google.internal/computeMetadata/v1',
  'http://METADATA.GOOGLE.INTERNAL./v1',
  'http://metadata.goog/v1',
  'http://instance-data/latest/meta-data',
  'http://instance-data.ec2.internal/latest',
  'https://metadata/v1',
  // Alibaba Cloud 메타데이터
  'http://100.100.100.200/latest/meta-data',
];

const ALLOWED = [
  'http://127.0.0.1:1234/v1',
  'http://localhost:1234/v1',
  'http://[::1]:1234/v1',
  'http://10.0.0.5:1234/v1',
  'http://172.16.5.9:8001/v1',
  'http://192.168.0.20:8000/v1',
  // Tailscale(100.64.0.0/10)은 Mac의 LLM·음성 서버 주소다
  'http://100.64.0.1:8000/v1',
  'http://100.87.40.116:8001/v1',
  'http://100.100.100.100:8001/v1',
  'http://[fd7a:115c:a1e0::1]:8001/v1',
  'http://my-mac.tail1234.ts.net:8001/v1',
  'http://llm.test/v1',
  'https://api.openai.com/v1',
  // 이름에 metadata가 들어 있어도 이름 전체가 같아야 막는다
  'http://metadata.example.com/v1',
  'http://[::ffff:127.0.0.1]:1234/v1',
  'http://[::ffff:192.168.0.20]:1234/v1',
];

describe('isBlockedServerHost', () => {
  it.each(BLOCKED)('%s 는 막는다', (url) => {
    expect(isBlockedServerHost(url)).toBe(true);
  });

  it.each(ALLOWED)('%s 는 막지 않는다', (url) => {
    expect(isBlockedServerHost(url)).toBe(false);
  });

  it('주소로 읽을 수 없는 글은 막지 않는다 (주소 형식은 IsUrl이 거른다)', () => {
    expect(isBlockedServerHost('')).toBe(false);
    expect(isBlockedServerHost('not a url')).toBe(false);
  });
});

describe('서버 주소 칸 검증 (#497)', () => {
  const llmUpdate = (baseUrl: string) => validate(plainToInstance(UpdateLlmSettingsDto, { baseUrl, model: null }));
  const llmTest = (baseUrl: string) => validate(plainToInstance(TestLlmConnectionDto, { baseUrl }));
  const sttUpdate = (baseUrl: string) => validate(plainToInstance(UpdateSttSettingsDto, { baseUrl, model: null }));
  const sttTest = (baseUrl: string) => validate(plainToInstance(TestSttConnectionDto, { baseUrl }));

  it.each(['http://169.254.169.254/v1', 'http://[fd00:ec2::254]/v1', 'http://metadata.google.internal/v1', 'http://[::ffff:169.254.169.254]:1234/v1'])(
    'LLM 설정 저장과 연결 확인 모두 %s 를 받지 않는다',
    async (baseUrl) => {
      const save = await llmUpdate(baseUrl);
      const test = await llmTest(baseUrl);
      expect(save).toHaveLength(1);
      expect(save[0].constraints).toMatchObject({ isAllowedServerHost: '링크 로컬(169.254.x.x)·클라우드 메타데이터 주소는 AI 서버로 쓸 수 없어요' });
      expect(test).toHaveLength(1);
    },
  );

  it.each(['http://169.254.169.254/v1', 'http://[fd00:ec2::254]/v1', 'http://metadata.google.internal/v1'])('음성 서버 설정 저장과 연결 확인도 %s 를 받지 않는다', async (baseUrl) => {
    const save = await sttUpdate(baseUrl);
    expect(save[0].constraints).toMatchObject({ isAllowedServerHost: '링크 로컬(169.254.x.x)·클라우드 메타데이터 주소는 음성 서버로 쓸 수 없어요' });
    expect(await sttTest(baseUrl)).toHaveLength(1);
  });

  it.each(['http://127.0.0.1:1234/v1', 'http://192.168.0.20:1234/v1', 'http://100.87.40.116:1234/v1', 'http://my-mac.tail1234.ts.net:1234/v1'])('로컬 LLM·음성 서버 주소 %s 는 받는다', async (baseUrl) => {
    expect(await llmUpdate(baseUrl)).toEqual([]);
    expect(await llmTest(baseUrl)).toEqual([]);
    expect(await sttUpdate(baseUrl)).toEqual([]);
    expect(await sttTest(baseUrl)).toEqual([]);
  });
});

describe('redactUrl·sameOrigin', () => {
  it('redactUrl은 아이디·비밀번호를 뺀다', () => {
    expect(redactUrl('http://user:pw@192.168.0.20:8000/v1')).toBe('http://192.168.0.20:8000/v1');
    expect(redactUrl('http://192.168.0.20:8000/v1')).toBe('http://192.168.0.20:8000/v1');
  });

  it('sameOrigin은 프로토콜·호스트·포트가 같을 때만 참이다', () => {
    expect(sameOrigin('http://10.0.0.5:1234/v1', 'http://10.0.0.5:1234/other')).toBe(true);
    expect(sameOrigin('http://10.0.0.5:1234/v1', 'http://10.0.0.5:8001/v1')).toBe(false);
    expect(sameOrigin('http://10.0.0.5:1234/v1', 'bad')).toBe(false);
  });
});
