// 접근성 이름 점검(정적): 화면 코드(.tsx)를 읽어 이름 없는 입력칸·아이콘뿐인 단추·링크를 찾는다.
// - 입력칸(input·select·textarea와 Input·Select·Textarea·DateInput): aria-label · aria-labelledby · title · 감싼 label/Field(첫 입력칸) · 같은 파일의 label htmlFor=id 중 하나가 있어야 한다.
// - 단추·링크(button·Button·a·Link·ButtonLink): 안에 글자(또는 값이 정해지는 식)나 aria-label · title이 있어야 한다. 아이콘만 있으면 안 된다.
// 아이콘만 있는 단추는 IconButton(label 필수)을 쓴다.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

type JsxNode = ts.JsxElement | ts.JsxSelfClosingElement;

const NAME_ATTRS = ['aria-label', 'aria-labelledby', 'title', 'ariaLabel'];
const FIELD_LIKE = new Set(['input', 'select', 'textarea', 'Input', 'Select', 'Textarea', 'DateInput']);
const NO_NAME_NEEDED_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);
/** 입력칸 부품 자체 (이름은 쓰는 곳에서 준다) */
const PRIMITIVE_FILES = new Set(['components/Input.tsx']);

const isJsxNode = (node: ts.Node): node is JsxNode => ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);
const openingOf = (node: JsxNode): ts.JsxOpeningLikeElement => (ts.isJsxElement(node) ? node.openingElement : node);
const tagOf = (node: JsxNode): string => openingOf(node).tagName.getText();

function attrsOf(node: JsxNode): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const attr of openingOf(node).attributes.properties) {
    if (ts.isJsxAttribute(attr)) attrs.set(attr.name.getText(), attr.initializer ? attr.initializer.getText() : 'true');
    else attrs.set('...spread', attr.getText());
  }
  return attrs;
}

const hasNameAttr = (attrs: ReadonlyMap<string, string>): boolean => NAME_ATTRS.some((name) => attrs.has(name));

/** 안에 글자(또는 값이 정해지는 식·알 수 없는 부품)가 있는지. Icon·svg만 있으면 false */
function hasTextual(node: ts.Node): boolean {
  if (!ts.isJsxElement(node) && !ts.isJsxFragment(node)) return false;
  return node.children.some((child) => {
    if (ts.isJsxText(child)) return child.getText().trim() !== '';
    if (ts.isJsxExpression(child)) return child.expression !== undefined;
    if (ts.isJsxSelfClosingElement(child)) return !['Icon', 'svg', 'path'].includes(tagOf(child));
    if (ts.isJsxElement(child) && tagOf(child) === 'svg') return false;
    return hasTextual(child);
  });
}

interface Finding {
  file: string;
  line: number;
  kind: string;
  code: string;
}

/** 이름 없는 입력칸·단추·링크 */
function findUnnamed(file: string, text: string): Finding[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
  const findings: Finding[] = [];
  const labelFors = new Set<string>();
  const collect = (node: ts.Node): void => {
    if (isJsxNode(node) && ['label', 'Field'].includes(tagOf(node))) {
      const htmlFor = attrsOf(node).get('htmlFor');
      if (htmlFor) labelFors.add(htmlFor);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);

  const report = (node: JsxNode, kind: string): void =>
    void findings.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, kind, code: text.slice(node.getStart(), node.getStart() + 120).replace(/\s+/g, ' ') });

  /** 입력칸을 감싼 label(또는 htmlFor 없는 Field)이 이 입력칸을 가리키는지: label은 안의 첫 입력칸만 이름을 준다 */
  const isFirstControlOfWrapper = (wrapper: JsxNode, control: JsxNode): boolean => {
    const controls: JsxNode[] = [];
    const grab = (node: ts.Node): void => {
      if (isJsxNode(node) && FIELD_LIKE.has(tagOf(node)) && !isTypeWithoutName(node)) controls.push(node);
      ts.forEachChild(node, grab);
    };
    grab(wrapper);
    return controls[0] === control;
  };
  const isTypeWithoutName = (node: JsxNode): boolean => {
    const type = attrsOf(node).get('type')?.replace(/['"{}]/g, '');
    return tagOf(node) === 'input' && type !== undefined && NO_NAME_NEEDED_INPUT_TYPES.has(type);
  };

  const ancestors: JsxNode[] = [];
  const visit = (node: ts.Node): void => {
    const element = isJsxNode(node) ? node : null;
    if (element) {
      const tag = tagOf(element);
      const attrs = attrsOf(element);
      if (tag === 'button' || tag === 'Button') {
        if (!hasNameAttr(attrs) && !hasTextual(element)) report(element, '이름 없는 단추');
      } else if ((tag === 'a' || tag === 'Link' || tag === 'ButtonLink') && ts.isJsxElement(element)) {
        if (!hasNameAttr(attrs) && !hasTextual(element)) report(element, '이름 없는 링크');
      } else if (FIELD_LIKE.has(tag) && !isTypeWithoutName(element)) {
        const hiddenFile = tag === 'input' && attrs.get('type')?.includes('file') && (attrs.get('className') ?? '').includes('hidden');
        const wrapper = [...ancestors].reverse().find((a) => tagOf(a) === 'label' || (tagOf(a) === 'Field' && !attrsOf(a).has('htmlFor')));
        const wrapped = wrapper !== undefined && isFirstControlOfWrapper(wrapper, element);
        const id = attrs.get('id');
        const named = hasNameAttr(attrs) || wrapped || (id !== undefined && labelFors.has(id)) || hiddenFile;
        if (!named) report(element, '이름 없는 입력칸');
      }
      if (ts.isJsxElement(element)) ancestors.push(element);
    }
    ts.forEachChild(node, visit);
    if (element && ts.isJsxElement(element)) ancestors.pop();
  };
  visit(source);
  return findings;
}

describe('이름 없는 입력칸·단추를 찾는 점검 자체', () => {
  it('이름이 없으면 찾고, 이름이 있으면 지나간다', () => {
    const bad = findUnnamed(
      'bad.tsx',
      `export const A = () => (<div>
        <button type="button"><Icon name="x" /></button>
        <input type="text" />
        <select><option>가</option></select>
        <Button icon="check" />
        <label>이름 <input type="text" /><input type="text" /></label>
      </div>);`,
    );
    expect(bad.map((f) => f.kind)).toEqual(['이름 없는 단추', '이름 없는 입력칸', '이름 없는 입력칸', '이름 없는 단추', '이름 없는 입력칸']);

    const good = findUnnamed(
      'good.tsx',
      `export const A = () => (<div>
        <button type="button" aria-label="닫기"><Icon name="x" /></button>
        <button type="button">저장</button>
        <button type="button"><Icon name="x" />{label}</button>
        <input type="text" aria-label="검색" />
        <label><input type="checkbox" />전체 선택</label>
        <Field label="규격" htmlFor="spec"><Select id="spec" /></Field>
        <Field label="매수"><Input /></Field>
        <input type="hidden" />
        <input type="file" className="hidden" />
        <IconButton icon="trash" label="삭제" />
      </div>);`,
    );
    expect(good).toEqual([]);
  });
});

describe('화면 코드의 접근성 이름', () => {
  const SRC = fileURLToPath(new URL('../', import.meta.url));
  // Windows는 하위 경로를 \로 구분해 돌려줘서 PRIMITIVE_FILES(/ 구분)와 맞지 않는다. / 로 맞춘다
  const files = readdirSync(SRC, { recursive: true })
    .map((name) => String(name).replaceAll('\\', '/'))
    .filter((name) => name.endsWith('.tsx') && !name.includes('.test.') && !PRIMITIVE_FILES.has(name));

  it('모든 입력칸·단추·링크에 이름이 있다', () => {
    expect(files.length).toBeGreaterThan(100);
    const findings = files.flatMap((file) => findUnnamed(file, readFileSync(join(SRC, file), 'utf8')));
    expect(findings.map((f) => `${f.file}:${f.line} [${f.kind}] ${f.code}`)).toEqual([]);
  });
});
