'use client';
// 밀시트 인쇄 ('PDF 생성' = 브라우저 인쇄, REQ-SHP-004).
// 종이를 <body> 바로 아래(포털)에 인쇄 전용으로 한 벌 더 그리고, 인쇄할 때는 그것만 A4에 찍는다.
// 셸(레일·상단 바)은 공유 파일이라 Tailwind print: 클래스를 붙일 수 없고, 셸 안의 overflow가 종이를 자르지 않게 하려는 것이다.
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const ROOT_ID = 'mill-sheet-print-root';
const PRINT_CSS = `
#${ROOT_ID} { display: none; }
@page { size: A4; margin: 12mm; }
@media print {
  html, body { background: #fff !important; height: auto !important; overflow: visible !important; }
  body > *:not(#${ROOT_ID}) { display: none !important; }
  #${ROOT_ID} { display: block !important; }
}
`;

export function MillSheetPrintPortal({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => setTarget(document.body), []);
  return (
    <>
      <style>{PRINT_CSS}</style>
      {target ? createPortal(<div id={ROOT_ID}>{children}</div>, target) : null}
    </>
  );
}
