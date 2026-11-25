import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Hợp đồng M02 / M03 — Transfer response model
 */
export class TransferResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  requesterUserId: string;

  @ApiProperty({ format: 'uuid' })
  fromAccountId: string;

  @ApiProperty({ format: 'uuid' })
  toAccountId: string;

  @ApiProperty({ example: '1000000001' })
  fromAccountNumber: string;

  @ApiProperty({ example: '1000000002' })
  toAccountNumber: string;

  @ApiProperty({
    description: 'Số tiền (VND, dạng chuỗi để tránh mất độ chính xác BIGINT)',
    example: '100000',
    type: 'string',
  })
  amount: string;

  @ApiProperty({ example: 'VND' })
  currency: string;

  @ApiProperty({ example: 'Chuyen tien' })
  description: string;

  @ApiProperty({ enum: ['PENDING', 'SUCCEEDED', 'REJECTED'] })
  status: string;

  @ApiPropertyOptional({ example: 'INSUFFICIENT_FUNDS', nullable: true })
  reasonCode: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  committedAt: string | null;
}
