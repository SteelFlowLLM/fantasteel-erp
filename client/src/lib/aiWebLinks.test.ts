// 웹 검색 답의 링크: 이번 질문의 웹 출처에 있는 주소만 링크가 되고, 나머지는 전부 글이다.
import { describe, expect, it } from 'vitest';
import { MAX_WEB_URL_LENGTH, normalizeWebUrl, openableWebSources, safeWebHref, tokenizeAnswerLinks, webHostOf, webSourceTitle } from '@/lib/aiWebLinks';

const SOURCES = [
  { title: '철강 시황', url: 'https://example.com/steel/' },
  { title: '위키', url: 'https://ko.wikipedia.org/wiki/A_(b)' },
];

const links = (answer: string) => tokenizeAnswerLinks(answer, SOURCES).filter((token) => token.kind === 'link');
const joined = (answer: string) => tokenizeAnswerLinks(answer, SOURCES).map((token) => token.text).join('');

describe('normalizeWebUrl', () => {
  it('스킴·호스트를 소문자로, 조각과 끝 슬래시를 뺀다', () => {
    expect(normalizeWebUrl('HTTPS://Example.COM/steel/#top')).toBe('https://example.com/steel');
    expect(normalizeWebUrl('https://example.com/')).toBe('https://example.com');
    expect(normalizeWebUrl('https://example.com/a?q=1')).toBe('https://example.com/a?q=1');
  });

  it('http·https가 아니거나 상대 주소·스킴 없는 주소·아이디가 든 주소는 null', () => {
    for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,x', 'ftp://example.com', '//evil.tld', 'www.evil.tld', '/path', '', 'https://user:pw@example.com', 'https://']) {
      expect(normalizeWebUrl(bad), bad).toBeNull();
    }
  });

  it('너무 긴 주소는 null', () => {
    expect(normalizeWebUrl(`https://example.com/${'a'.repeat(MAX_WEB_URL_LENGTH)}`)).toBeNull();
  });
});

describe('safeWebHref · webHostOf', () => {
  it('http·https만 href가 되고 호스트는 www를 뺀다', () => {
    expect(safeWebHref('https://www.example.com/a')).toBe('https://www.example.com/a');
    expect(safeWebHref('javascript:alert(1)')).toBeNull();
    expect(webHostOf('https://www.example.com/a')).toBe('example.com');
    expect(webHostOf('javascript:alert(1)')).toBeNull();
  });
});

describe('tokenizeAnswerLinks', () => {
  it('출처에 있는 마크다운 링크는 링크가 된다 (주소의 대소문자·끝 슬래시·조각이 달라도)', () => {
    expect(links('자세히는 [철강 시황](https://example.com/steel)을 보세요.')).toEqual([{ kind: 'link', text: '철강 시황', href: 'https://example.com/steel' }]);
    expect(links('[x](HTTPS://EXAMPLE.com/steel/#a)')).toHaveLength(1);
  });

  it('출처에 있는 맨 주소는 링크가 되고 끝의 문장부호는 뺀다', () => {
    expect(links('보세요 https://example.com/steel, 그리고')).toEqual([{ kind: 'link', text: 'https://example.com/steel', href: 'https://example.com/steel' }]);
    expect(links('(https://example.com/steel).')).toHaveLength(1);
    expect(links('https://ko.wikipedia.org/wiki/A_(b)')).toEqual([{ kind: 'link', text: 'https://ko.wikipedia.org/wiki/A_(b)', href: 'https://ko.wikipedia.org/wiki/A_(b)' }]);
    expect(links('주소는https://example.com/steel입니다')).toHaveLength(1);
  });

  it('출처에 없는 주소는 대문자 스킴이어도 글이다', () => {
    const answer = 'HTTPS://evil.tld/x 와 [눌러](HTTPS://evil.tld/x)';
    expect(links(answer)).toEqual([]);
    expect(joined(answer)).toBe(answer);
  });

  it('javascript:·data:·//host·www.·HTML은 링크가 되지 않고 원문이 그대로 글로 남는다', () => {
    for (const answer of ['[a](javascript:alert(1))', '[a](JAVASCRIPT:alert(1))', '[a](data:text/html;base64,AAAA)', '[a](//evil.tld)', '[a](www.evil.tld)', 'www.evil.tld 와 //evil.tld', '<img src="https://evil.tld/x.png" onerror="x()">', '<a href="https://evil.tld/x">x</a>', '<script>alert(1)</script>']) {
      const tokens = tokenizeAnswerLinks(answer, SOURCES);
      expect(
        tokens.filter((token) => token.kind === 'link'),
        answer,
      ).toEqual([]);
      expect(tokens.map((token) => token.text).join(''), answer).toBe(answer);
    }
  });

  it('출처가 없으면(빈 목록) 어떤 링크도 만들지 않는다', () => {
    expect(tokenizeAnswerLinks('[a](https://example.com/steel) https://example.com/steel', [])).toEqual([{ kind: 'text', text: '[a](https://example.com/steel) https://example.com/steel' }]);
    expect(tokenizeAnswerLinks('[a](https://example.com/steel)', undefined).every((token) => token.kind === 'text')).toBe(true);
  });

  it('이미지는 그리지 않고 alt 글만 남긴다 (출처에 있는 주소여도)', () => {
    const tokens = tokenizeAnswerLinks('앞 ![로고](https://example.com/steel) 뒤 ![](https://evil.tld/p.png)', SOURCES);
    expect(tokens).toEqual([{ kind: 'text', text: '앞 로고 뒤 ' }]);
  });

  it('겹친 대괄호·링크 글 안의 이미지·주소 뒤 제목을 다룬다', () => {
    expect(links('[[1] 철강](https://example.com/steel)')).toEqual([{ kind: 'link', text: '[1] 철강', href: 'https://example.com/steel' }]);
    expect(links('[![로고](https://evil.tld/a.png) 시황](https://example.com/steel)')[0]).toMatchObject({ text: '로고 시황' });
    expect(links('[시황](https://example.com/steel "제목")')).toHaveLength(1);
    // 공백이 든 모양은 마크다운 링크가 아니라서 '시황' 링크는 없다 (주소 자체는 출처에 있으니 맨 주소 링크만)
    expect(links('[시황](https://example.com/steel 그리고 나머지)').map((token) => token.text)).toEqual(['https://example.com/steel']);
    // 출처에 있는 주소가 HTML 안에 있어도 HTML은 해석되지 않고 글 조각으로만 나온다
    expect(joined('<img src="https://example.com/steel" onerror="x()">')).toBe('<img src="https://example.com/steel" onerror="x()">');
  });

  it('링크 글은 HTML이 아니라 글 조각으로만 나온다', () => {
    const tokens = tokenizeAnswerLinks('[<b onclick=x()>굵게</b>](https://example.com/steel)', SOURCES);
    expect(tokens).toEqual([{ kind: 'link', text: '<b onclick=x()>굵게</b>', href: 'https://example.com/steel' }]);
  });

  it('닫히지 않은 대괄호·괄호는 글이고, 아주 긴 주소와 반복 입력에도 빠르게 끝난다', () => {
    expect(joined('[열고 (닫지 않음')).toBe('[열고 (닫지 않음');
    expect(joined('[a](https://example.com/steel')).toBe('[a](https://example.com/steel');
    const longUrl = `https://example.com/${'a'.repeat(100_000)}`;
    const started = Date.now();
    expect(links(`[x](${longUrl}) ${longUrl}`)).toEqual([]);
    expect(joined(`[x](${longUrl})`)).toBe(`[x](${longUrl})`);
    const pathological = '[a]('.repeat(20_000) + '[['.repeat(20_000);
    expect(joined(pathological)).toBe(pathological);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('원문 글자는 하나도 잃지 않는다 (링크 문법 밖의 글)', () => {
    const answer = '**굵게** 와 `코드` 와 [MAN-SO-01] 와\n줄바꿈 https://example.com/steel 끝';
    expect(joined(answer)).toBe(answer);
  });
});

describe('웹 출처 목록', () => {
  it('http·https 주소만, 같은 주소는 하나만 열 수 있는 출처가 된다', () => {
    const items = openableWebSources([
      { title: 'A', url: 'https://example.com/a' },
      { title: 'A 또', url: 'HTTPS://EXAMPLE.com/a/' },
      { title: '나쁨', url: 'javascript:alert(1)' },
      { title: 'B', url: 'http://www.b.com/x' },
    ]);
    expect(items).toEqual([
      { title: 'A', href: 'https://example.com/a', host: 'example.com' },
      { title: 'B', href: 'http://www.b.com/x', host: 'b.com' },
    ]);
    expect(openableWebSources(undefined)).toEqual([]);
  });

  it('제목은 제어·방향 문자를 빼고 줄이며, 비면 호스트를 보인다', () => {
    expect(webSourceTitle('좋은‮글\n제목\u0007', 'https://a.com')).toBe('좋은 글 제목');
    expect(webSourceTitle('가'.repeat(500), 'https://a.com')).toHaveLength(121);
    expect(webSourceTitle('  ', 'https://www.a.com/x')).toBe('a.com');
    expect(webSourceTitle('<script>alert(1)</script>', 'https://a.com')).toBe('<script>alert(1)</script>');
  });
});
