import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Hợp đồng M04 / N01 / N02 — Notification response model
 */
export class NotificationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  transferId: string;

  @ApiProperty({ example: 'TRANSFER_SUCCEEDED' })
  type: string;

  @ApiProperty({ enum: ['OUTGOING', 'INCOMING'] })
  direction: 'OUTGOING' | 'INCOMING';

  @ApiProperty({ example: '100000', type: 'string' })
  amount: string;

  @ApiProperty({ example: 'VND' })
  currency: string;

  @ApiProperty({ example: 'Bạn đã chuyển 100.000 VND' })
  message: string;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  readAt: string | null;
}

export class NotificationMetaDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  pageSize: number;

  @ApiProperty({ example: 1 })
  totalItems: number;

  @ApiProperty({ example: 1 })
  totalPages: number;

  @ApiProperty({ example: 1 })
  unreadCount: number;
}

export class NotificationListResultDto {
  items: NotificationResponseDto[];
  meta: NotificationMetaDto;
}
