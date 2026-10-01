// 밀시트 인쇄 CSS ('PDF 생성' = 브라우저 인쇄, REQ-SHP-004).
// 인쇄할 때 셸(레일·상단 바)과 목록을 숨기고 종이(#mill-sheet-paper)만 A4에 찍는다.
// 셸은 공유 파일이라 Tailwind print: 클래스를 붙일 수 없어서, 이 화면이 떠 있을 때만 인쇄 규칙을 넣는다.
const PRINT_CSS = `
@page { size: A4; margin: 12mm; }
@media print {
  html, body { background: #fff !important; height: auto !important; overflow: visible !important; }
  body * { visibility: hidden !important; }
  #mill-sheet-paper, #mill-sheet-paper * { visibility: visible !important; }
  #mill-sheet-paper { position: absolute; left: 0; top: 0; width: 100%; }
}
`;

export function MillSheetPrintStyle() {
  return <style>{PRINT_CSS}</style>;
}
