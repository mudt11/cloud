import { Controller, Get, Query, Req, Res, HttpStatus } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ReportsService } from './reports.service';
import {
  ReportSummaryQueryDto,
  ReportExportQueryDto,
  ReportSummaryDto,
} from './dto/report.dto';
import { AuthenticatedUser } from '../common/guards/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('Reports')
@ApiBearerAuth('JWT')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /**
   * T04 — GET /api/v1/reports/summary
   */
  @Get('summary')
  @Roles('CUSTOMER', 'ADMIN')
  @ApiOperation({
    summary: 'T04 — Báo cáo tổng hợp giao dịch thành công',
    description:
      'Chỉ tính giao dịch SUCCEEDED theo committedAt (UTC quy đổi từ ngày Việt Nam). Tối đa 31 ngày.',
  })
  @ApiResponse({
    status: 200,
    description: 'Báo cáo tổng hợp M04',
    type: ReportSummaryDto,
  })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 401, description: 'UNAUTHENTICATED' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  @ApiResponse({ status: 404, description: 'ACCOUNT_NOT_FOUND' })
  @ApiResponse({ status: 503, description: 'SERVICE_UNAVAILABLE' })
  async getSummary(
    @Query() query: ReportSummaryQueryDto,
    @Req() req: Request,
  ) {
    const user = req.user as AuthenticatedUser;
    const requestId = req.requestId!;
    const authHeader = req.headers['authorization'] || '';

    const summary = await this.reportsService.getSummary(
      user,
      query,
      authHeader,
      requestId,
    );

    return {
      data: summary,
      requestId,
    };
  }

  /**
   * T05 — GET /api/v1/reports/export
   * Giới hạn 5 request / 60s theo sub (C04).
   * Trả CSV UTF-8 BOM, CRLF; quá 10.000 dòng trả 409 EXPORT_TOO_LARGE (JSON C03).
   */
  @Get('export')
  @Roles('CUSTOMER', 'ADMIN')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'T05 — Xuất báo cáo chi tiết CSV',
    description:
      'Xuất tối đa 10.000 dòng giao dịch SUCCEEDED dưới dạng CSV UTF-8 BOM (CRLF), chống CSV formula injection.',
  })
  @ApiResponse({ status: 200, description: 'File CSV UTF-8 có BOM' })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 401, description: 'UNAUTHENTICATED' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  @ApiResponse({ status: 404, description: 'ACCOUNT_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'EXPORT_TOO_LARGE' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED' })
  async exportCsv(
    @Query() query: ReportExportQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const user = req.user as AuthenticatedUser;
    const requestId = req.requestId!;
    const authHeader = req.headers['authorization'] || '';

    const csv = await this.reportsService.exportCsv(
      user,
      query,
      authHeader,
      requestId,
    );

    res.setHeader('X-Request-Id', requestId);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="transactions-${query.fromDate}-${query.toDate}.csv"`,
    );

    res.status(HttpStatus.OK).send(Buffer.from(csv, 'utf8'));
  }
}
