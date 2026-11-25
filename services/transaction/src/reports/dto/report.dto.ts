import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsUUID,
  IsString,
  Matches,
} from 'class-validator';

/**
 * Query DTO cho T04 — GET /api/v1/reports/summary
 */
export class ReportSummaryQueryDto {
  @ApiProperty({ example: '2026-11-01', description: 'Ngày bắt đầu (YYYY-MM-DD, giờ VN)' })
  @IsString()
  @IsNotEmpty({ message: 'fromDate là bắt buộc' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'fromDate phải có định dạng YYYY-MM-DD',
  })
  fromDate: string;

  @ApiProperty({ example: '2026-11-02', description: 'Ngày kết thúc (YYYY-MM-DD, giờ VN)' })
  @IsString()
  @IsNotEmpty({ message: 'toDate là bắt buộc' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'toDate phải có định dạng YYYY-MM-DD',
  })
  toDate: string;

  @ApiPropertyOptional({ enum: ['ACCOUNT', 'SYSTEM'] })
  @IsOptional()
  @IsIn(['ACCOUNT', 'SYSTEM'], {
    message: 'scope phải là ACCOUNT hoặc SYSTEM',
  })
  scope?: 'ACCOUNT' | 'SYSTEM';

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all', { message: 'accountId phải là UUID hợp lệ' })
  accountId?: string;
}

/**
 * Query DTO cho T05 — GET /api/v1/reports/export
 */
export class ReportExportQueryDto extends ReportSummaryQueryDto {
  @ApiPropertyOptional({ enum: ['INCOMING', 'OUTGOING'] })
  @IsOptional()
  @IsIn(['INCOMING', 'OUTGOING'], {
    message: 'direction phải là INCOMING hoặc OUTGOING',
  })
  direction?: 'INCOMING' | 'OUTGOING';
}

/**
 * Response DTO cho T04 — ReportSummary (M04)
 */
export class ReportSummaryDto {
  @ApiProperty({ enum: ['ACCOUNT', 'SYSTEM'] })
  scope: 'ACCOUNT' | 'SYSTEM';

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  accountId: string | null;

  @ApiProperty({ example: '2026-11-01' })
  fromDate: string;

  @ApiProperty({ example: '2026-11-02' })
  toDate: string;

  @ApiProperty({ example: 'Asia/Ho_Chi_Minh' })
  timeZone: 'Asia/Ho_Chi_Minh';

  @ApiProperty({ example: 'VND' })
  currency: 'VND';

  @ApiProperty({ example: 3 })
  transactionCount: number;

  @ApiPropertyOptional({ example: 1, nullable: true })
  incomingCount: number | null;

  @ApiPropertyOptional({ example: 2, nullable: true })
  outgoingCount: number | null;

  @ApiPropertyOptional({ example: '40000', nullable: true })
  totalIncoming: string | null;

  @ApiPropertyOptional({ example: '160000', nullable: true })
  totalOutgoing: string | null;

  @ApiPropertyOptional({ example: '200000', nullable: true })
  transferVolume: string | null;

  @ApiProperty({ format: 'date-time' })
  generatedAt: string;

  @ApiProperty({ example: 'EVENTUAL' })
  consistency: 'EVENTUAL';
}
