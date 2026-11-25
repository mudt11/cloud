import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsOptional,
  IsInt,
  Min,
  Max,
  IsIn,
  IsUUID,
  IsString,
  Matches,
} from 'class-validator';

/**
 * Query DTO cho T02 — GET /api/v1/transfers (Tài liệu 06 C05 & T02)
 */
export class ListTransfersQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page phải là số nguyên' })
  @Min(1, { message: 'page phải lớn hơn hoặc bằng 1' })
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'pageSize phải là số nguyên' })
  @Min(1, { message: 'pageSize phải nằm trong khoảng 1..100' })
  @Max(100, { message: 'pageSize phải nằm trong khoảng 1..100' })
  pageSize?: number = 20;

  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'fromDate phải có định dạng YYYY-MM-DD',
  })
  fromDate?: string;

  @ApiPropertyOptional({ example: '2026-11-02' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'toDate phải có định dạng YYYY-MM-DD',
  })
  toDate?: string;

  @ApiPropertyOptional({ enum: ['PENDING', 'SUCCEEDED', 'REJECTED'] })
  @IsOptional()
  @IsIn(['PENDING', 'SUCCEEDED', 'REJECTED'], {
    message: 'status phải là PENDING, SUCCEEDED hoặc REJECTED',
  })
  status?: 'PENDING' | 'SUCCEEDED' | 'REJECTED';

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all', { message: 'accountId phải là UUID hợp lệ' })
  accountId?: string;

  @ApiPropertyOptional({ enum: ['INCOMING', 'OUTGOING'] })
  @IsOptional()
  @IsIn(['INCOMING', 'OUTGOING'], {
    message: 'direction phải là INCOMING hoặc OUTGOING',
  })
  direction?: 'INCOMING' | 'OUTGOING';
}
