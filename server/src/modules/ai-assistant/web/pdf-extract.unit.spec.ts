import { SafeWebPageReader } from './assistant-web-toolbox';
import { tinyPdf } from './fixtures/tiny-pdf';
import { extractPdfIsolated, PageTooComplexError, PDF_MAX_PAGES } from './page-extract';
import { PDF_CONTENT_TYPE, type SafePageFetcher } from './safe-fetch';

// worker를 띄우고 tsx로 모듈을 불러오는 데 시간이 걸린다
jest.setTimeout(30_000);

describe('PDF 읽기 (이슈 #384)', () => {
  it('worker에서 쪽마다 글을 뽑고, 제목은 PDF 정보에서', async () => {
    const pdf = await tinyPdf(['Crude steel output 1,234 thousand tonnes in 2025', 'Second page share 56.7%'], 'Steel Report');
    expect(pdf.length).toBeLessThan(5 * 1024);
    const page = await extractPdfIsolated(pdf, 'https://stats.example.org/report.pdf', 10_000);
    expect(page.title).toBe('Steel Report');
    expect(page.text).toContain('1,234 thousand tonnes');
    expect(page.text).toContain('56.7%');
  });

  it(`앞 ${PDF_MAX_PAGES}쪽만 읽는다`, async () => {
    const pdf = await tinyPdf(Array.from({ length: PDF_MAX_PAGES + 3 }, (_, i) => `page-marker-${i + 1}`));
    const page = await extractPdfIsolated(pdf, 'https://stats.example.org/long.pdf', 10_000);
    expect(page.text).toContain(`page-marker-${PDF_MAX_PAGES}`);
    expect(page.text).not.toContain(`page-marker-${PDF_MAX_PAGES + 1}`);
    // 제목이 없으면 주소의 호스트
    expect(page.title).toBe('stats.example.org');
  });

  it('깨진 PDF·시간 초과는 페이지를 못 읽었다고 알린다', async () => {
    await expect(extractPdfIsolated(Buffer.from('%PDF-1.7 broken'), 'https://x.example/a.pdf', 10_000)).rejects.toBeInstanceOf(PageTooComplexError);
    const pdf = await tinyPdf(['slow']);
    await expect(extractPdfIsolated(pdf, 'https://x.example/b.pdf', 1)).rejects.toBeInstanceOf(PageTooComplexError);
  });

  it('페이지 읽기는 application/pdf 응답을 PDF로 뽑는다 (read_web_page·심층 조사가 함께 쓴다)', async () => {
    const pdf = await tinyPdf(['Rebar price 812 USD per tonne']);
    const fetcher = { fetch: async (url: string) => ({ url, contentType: PDF_CONTENT_TYPE, body: pdf, truncated: false }) } as unknown as SafePageFetcher;
    const read = await new SafeWebPageReader(fetcher, { extractTimeoutMs: 10_000 }).read('https://stats.example.org/price.pdf');
    expect(read.text).toContain('812 USD per tonne');
  });
});
