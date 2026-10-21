// 시각 목록은 Field의 label 안에 들어가므로, 항목·빈 곳을 누른 클릭의 기본 동작(label이 안의 첫 단추를 다시 누름)을 막아야
// 고른 직후 목록이 다시 열리지 않는다. DOM 없이 목록 요소의 onClick을 직접 불러 확인한다.
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Field } from '@/components/Field';
import { TimeOptionList, TimeSelect } from '@/features/schedule/TimeSelect';

type ClickEvent = { preventDefault: () => void };
type ListElement = ReactElement<{ onClick: (event: ClickEvent) => void; children: ReactElement<{ onClick: () => void; 'data-time': string }>[] }>;

const listOf = (onPick: (time: string) => void): ListElement =>
  TimeOptionList({
    listRef: null,
    label: '시작 시각',
    activeId: 'opt-0900',
    style: {},
    options: ['09:00', '09:30', '10:00'],
    value: '09:00',
    active: '09:30',
    optionId: (time) => `opt-${time.replace(':', '')}`,
    onKeyDown: () => undefined,
    onHover: () => undefined,
    onPick,
  }) as ListElement;

describe('시각 목록 (TimeSelect)', () => {
  it('목록을 누른 클릭은 기본 동작을 막아 label이 목록 여는 단추를 다시 누르지 않게 한다', () => {
    const preventDefault = vi.fn();
    listOf(() => undefined).props.onClick({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('항목을 누르면 그 시각을 고른다', () => {
    const onPick = vi.fn();
    const items = listOf(onPick).props.children;
    expect(items.map((item) => item.props['data-time'])).toEqual(['09:00', '09:30', '10:00']);
    items[1].props.onClick();
    expect(onPick).toHaveBeenCalledWith('09:30');
  });

  it('Field 안에 들어 있어도 시각 칸의 단추 이름은 칸 이름(aria-label) 그대로다', () => {
    const html = renderToStaticMarkup(
      createElement(Field, {
        label: '시작',
        required: true,
        children: createElement(TimeSelect, { value: '09:00', options: ['09:00', '09:30'], onChange: () => undefined, ariaLabel: '시작 시각' }),
      }),
    );
    expect(html).toContain('aria-label="시작 시각"');
    expect(html).toContain('aria-expanded="false"');
  });
});
