import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsInt, Min, Max, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query DTO cho N01 — GET /api/v1/notifications (Tài liệu 06 C05 & N01)
 */
export class ListNotificationsQueryDto {
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

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'], {
    message: 'unreadOnly chỉ nhận giá trị true hoặc false',
  })
  unreadOnly?: 'true' | 'false';
}

/**
 * Empty Body DTO cho N02 — body phải đúng {}
 */
export class EmptyBodyDto {}
