import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Field } from '@/components/Field';

const html = (props: { group?: boolean; htmlFor?: string }) =>
  renderToStaticMarkup(createElement(Field, { label: '음성 서버', hint: '받아쓰기 서버', ...props, children: createElement('button', { type: 'button' }, '연결 확인') }));

describe('Field 묶음 방식', () => {
  it('기본은 label이 안의 칸을 감싼다 (label을 누르면 입력칸으로 간다)', () => {
    const out = html({});
    expect(out.startsWith('<label')).toBe(true);
    expect(out).not.toContain('role="group"');
  });

  it('group이면 label 없이 묶음에 이름만 붙여, 안의 단추 이름이 단추 글자로 남는다', () => {
    const out = html({ group: true });
    expect(out).not.toContain('<label');
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(out)?.[1];
    expect(labelledBy).toBeTruthy();
    expect(out).toContain('role="group"');
    expect(out).toContain(`<span id="${labelledBy}"`);
    expect(out).toContain('>연결 확인</button>');
  });

  it('htmlFor가 있으면 이전처럼 label for로 입력칸을 가리킨다', () => {
    const out = html({ htmlFor: 'name-input' });
    expect(out).toContain('<label for="name-input"');
    expect(out).not.toContain('role="group"');
  });
});
