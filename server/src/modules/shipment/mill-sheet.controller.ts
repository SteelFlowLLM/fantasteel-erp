import { Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, StreamableFile } from '@nestjs/common';
import { PERMISSION } from '@fantasteel/shared';
import { RequireUse, RequireView } from '../../common/auth/auth.decorators';
import { ListMillSheetsDto } from './dto/list-mill-sheets.dto';
import { MillSheetService } from './mill-sheet.service';

@Controller('mill-sheets')
export class MillSheetController {
  constructor(private readonly service: MillSheetService) {}

  @Get()
  @RequireView(PERMISSION.MILLSHEET_READ)
  list(@Query() q: ListMillSheetsDto) {
    return this.service.list(q);
  }

  @Get(':id')
  @RequireView(PERMISSION.MILLSHEET_READ)
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.service.detail(id);
  }

  /** PDF 생성 버튼. 저장된 스냅샷으로만 만든다. */
  @Post(':id/pdf')
  @HttpCode(200)
  @RequireUse(PERMISSION.MILLSHEET_READ)
  generatePdf(@Param('id', ParseIntPipe) id: number) {
    return this.service.generatePdf(id);
  }

  @Get(':id/pdf')
  @RequireView(PERMISSION.MILLSHEET_READ)
  async pdf(@Param('id', ParseIntPipe) id: number): Promise<StreamableFile> {
    const { stream, fileName } = await this.service.readPdf(id);
    return new StreamableFile(stream, { type: 'application/pdf', disposition: `inline; filename="${fileName}"` });
  }
}
