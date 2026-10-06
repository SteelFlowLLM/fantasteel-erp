import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { SHIPMENT_REQUEST_STATUS, millSheetPdfFileName } from '@fantasteel/shared';
import { CommonModule } from '../../common/common.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { renderMillSheetPdf } from './mill-sheet-pdf';
import { buildMillSheetSnapshot } from './mill-sheet-snapshot';
import { ShipmentModule } from './shipment.module';
import { ShipmentService } from './shipment.service';

const inspection = (code: string) => ({
  inspectionResult: 'PASS',
  inspectedAt: new Date('2026-10-02T03:00:00.000Z'),
  processType: 'STEELMAKING',
  inspectionStandardCode: code,
  versionNo: 1,
  values: [
    { inspectionItemCode: 'C', inspectionItemName: '탄소', unit: '%', minValue: null, maxValue: '0.2000', measuredValue: '0.1000' },
    { inspectionItemCode: 'SI', inspectionItemName: '규소', unit: '%', minValue: null, maxValue: '0.5500', measuredValue: '0.6000' },
  ],
});

/** 슬래브 lotCount개짜리 스냅샷 (LOT마다 히트가 다르다) */
const sampleSnapshot = (millSheetNo: string, lotCount = 3) =>
  buildMillSheetSnapshot({
    millSheetNo,
    issuedAt: new Date('2026-10-06T05:30:00.000Z'),
    customer: { id: 1, customerCode: 'CUS-01', customerName: '나래조선' },
    salesOrder: { id: 1, salesOrderNo: 'SO-2610-001' },
    shipmentRequest: { id: 1, shipmentRequestNo: 'DR-2610-0028', shipDate: new Date('2026-10-20T00:00:00.000Z'), issuedEmployeeName: '박물류' },
    items: [
      {
        salesOrderItemId: 1,
        item: {
          id: 1,
          itemCode: 'SL-SM355A-250x1500x10000',
          itemName: '슬래브 SM355A',
          itemType: 'SLAB',
          steelGradeCode: 'SM355A',
          standardNo: 'KS D 3515',
          thicknessMm: '250.00',
          widthMm: '1500.00',
          lengthMm: '10000.00',
          theoreticalWeightTon: '29.438',
        },
        lots: Array.from({ length: lotCount }, (_, i) => ({
          id: i + 1,
          lotNo: `SL-261002-${String(i + 1).padStart(3, '0')}`,
          lotType: 'SLAB',
          producedDate: new Date('2026-10-02T00:00:00.000Z'),
          slabNo: null,
          inspection: inspection('QS-SM355A-CC'),
          heat: { id: 100 + i, lotNo: `HT-BOF1-261002-${String(i + 1).padStart(3, '0')}`, producedDate: new Date('2026-10-02T00:00:00.000Z'), converterCode: 'BOF1', steelGradeCode: 'SM355A', inspection: inspection('QS-SM355A-ST') },
        })),
      },
    ],
  });

const pageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;

describe('밀시트 PDF 저장 이름 (millSheetPdfFileName)', () => {
  const name = (millSheetNo: string, customerName: string, issuedDate = '2026-10-06') => millSheetPdfFileName({ millSheetNo, issuedDate, customer: { customerName } });

  it('{밀시트 번호}_{고객사}_{발행일 YYYYMMDD}.pdf', () => {
    expect(name('MS-2610-0028-1', '나래조선')).toBe('MS-2610-0028-1_나래조선_20261006.pdf');
  });

  it('고객사 이름의 공백·사용할 수 없는 글자는 _로 바꾸고 앞뒤 _는 지운다', () => {
    expect(name('MS-2610-0028-2', '(주) 한강/철강: "본사"?')).toBe('MS-2610-0028-2_(주)_한강_철강_본사_20261006.pdf');
    expect(name('MS-2610-0028-2', '  나래  조선  ')).toBe('MS-2610-0028-2_나래_조선_20261006.pdf');
  });

  it('고객사 이름이 길면 30자까지만 쓴다', () => {
    expect(name('MS-2610-0028-1', '가'.repeat(50))).toBe(`MS-2610-0028-1_${'가'.repeat(30)}_20261006.pdf`);
  });

  it('고객사 이름이 비어도 이름이 깨지지 않는다', () => {
    expect(name('MS-2610-0028-1', ' / ')).toBe('MS-2610-0028-1_20261006.pdf');
  });
});

describe('밀시트 PDF 렌더링 (REQ-SHP-004)', () => {
  it('스냅샷으로 PDF를 만들고 한글 폰트를 내장한다', async () => {
    const pdf = await renderMillSheetPdf(sampleSnapshot('MS-2610-0028-1'));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('/FontFile2');
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(1);
  });

  it('LOT이 많으면 쪽이 늘어난다', async () => {
    const short = await renderMillSheetPdf(sampleSnapshot('MS-2610-0028-1', 1));
    const long = await renderMillSheetPdf(sampleSnapshot('MS-2610-0028-1', 25));
    expect(pageCount(long)).toBeGreaterThan(pageCount(short));
  });

  it('폰트를 못 읽으면 오류를 던진다', async () => {
    await expect(renderMillSheetPdf(sampleSnapshot('MS-2610-0028-1'), join(tmpdir(), 'no-such-font.ttf'))).rejects.toThrow();
  });
});

// 실제 DB(fs_sales)에 밀시트 행을 직접 넣고 PDF 생성을 부른다
describe('ShipmentService 밀시트 PDF 생성 (API-115)', () => {
  let prisma: PrismaService;
  let service: ShipmentService;
  let storageDir: string;
  let seq = 0;
  const originalFont = process.env.MILL_SHEET_FONT;
  const originalStorage = process.env.STORAGE_DIR;

  /** 출고된 출하요청 + 밀시트 1장 (출고 확정은 goods-issue.spec이 검증하므로 행만 만든다) */
  const millSheet = async () => {
    seq += 1;
    const customer = await prisma.customer.findUniqueOrThrow({ where: { customerCode: 'CUS-01' } });
    const employee = await prisma.employee.findFirstOrThrow({ select: { id: true } });
    const item = await prisma.item.findFirstOrThrow({ where: { itemType: 'SLAB' } });
    const salesOrder = await prisma.salesOrder.create({
      data: { salesOrderNo: `SO-PDF-${seq}`, customerId: customer.id, ownerEmployeeId: employee.id, salesOrderItems: { create: { itemId: item.id, orderedQty: 3, dueDate: new Date('2026-12-31T00:00:00.000Z') } } },
    });
    const shipmentRequestNo = `DR-26${String(10 + seq).padStart(2, '0')}-0001`;
    const request = await prisma.shipmentRequest.create({
      data: { shipmentRequestNo, customerId: customer.id, shipmentRequestStatus: SHIPMENT_REQUEST_STATUS.ISSUED, issuedAt: new Date(), issuedEmployeeId: employee.id },
    });
    const millSheetNo = `MS-${shipmentRequestNo.slice(3)}-1`;
    const snapshot = JSON.parse(JSON.stringify(sampleSnapshot(millSheetNo)));
    const row = await prisma.millSheet.create({ data: { millSheetNo, shipmentRequestId: request.id, salesOrderId: salesOrder.id, snapshot, issuedAt: new Date() } });
    return { id: row.id, millSheetNo, snapshot, shipmentRequestId: request.id };
  };

  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'fs-storage-'));
    // StorageService가 만들어질 때 읽으므로 모듈을 만들기 전에 정한다
    process.env.STORAGE_DIR = storageDir;
    const moduleRef = await Test.createTestingModule({ imports: [PrismaModule, CommonModule, ShipmentModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(ShipmentService);
  });

  afterAll(async () => {
    if (originalFont === undefined) delete process.env.MILL_SHEET_FONT;
    else process.env.MILL_SHEET_FONT = originalFont;
    if (originalStorage === undefined) delete process.env.STORAGE_DIR;
    else process.env.STORAGE_DIR = originalStorage;
    await prisma.$disconnect();
    await rm(storageDir, { recursive: true, force: true });
  });

  it('PDF를 만들어 저장하고 pdfPath를 남기며, 다시 눌러도 같은 파일을 돌려준다', async () => {
    const sheet = await millSheet();
    const first = await service.generateMillSheetPdf(sheet.id);

    expect(first.pdfPath).toMatch(new RegExp(`^mill-sheets/.+-${sheet.millSheetNo}_나래조선_20261006\\.pdf$`));
    const saved = await readFile(join(storageDir, first.pdfPath!));
    expect(saved.subarray(0, 5).toString()).toBe('%PDF-');
    expect(first.snapshot).toEqual(sheet.snapshot);

    const again = await service.generateMillSheetPdf(sheet.id);
    expect(again.pdfPath).toBe(first.pdfPath);
  });

  it('동시에 눌러도 pdfPath는 한 번만 정해진다', async () => {
    const sheet = await millSheet();
    const [a, b] = await Promise.all([service.generateMillSheetPdf(sheet.id), service.generateMillSheetPdf(sheet.id)]);
    const stored = await prisma.millSheet.findUniqueOrThrow({ where: { id: sheet.id } });
    expect([a.pdfPath, b.pdfPath]).toContain(stored.pdfPath);
  });

  it('렌더링이 실패하면 SHP-001이고 스냅샷·출고는 그대로이며, 고친 뒤 다시 누르면 PDF만 만든다', async () => {
    const sheet = await millSheet();
    process.env.MILL_SHEET_FONT = join(storageDir, 'no-such-font.ttf');
    try {
      await expect(service.generateMillSheetPdf(sheet.id)).rejects.toMatchObject({ code: 'SHP-001' });
    } finally {
      if (originalFont === undefined) delete process.env.MILL_SHEET_FONT;
      else process.env.MILL_SHEET_FONT = originalFont;
    }
    const failed = await prisma.millSheet.findUniqueOrThrow({ where: { id: sheet.id } });
    expect(failed.pdfPath).toBeNull();
    expect(failed.snapshot).toEqual(sheet.snapshot);
    expect((await prisma.shipmentRequest.findUniqueOrThrow({ where: { id: sheet.shipmentRequestId } })).shipmentRequestStatus).toBe(SHIPMENT_REQUEST_STATUS.ISSUED);

    const retried = await service.generateMillSheetPdf(sheet.id);
    expect(existsSync(join(storageDir, retried.pdfPath!))).toBe(true);
    expect(await prisma.millSheet.count({ where: { shipmentRequestId: sheet.shipmentRequestId } })).toBe(1);
  });

  it('없는 밀시트는 COM-003', async () => {
    await expect(service.generateMillSheetPdf(999999)).rejects.toMatchObject({ code: 'COM-003' });
  });
});
