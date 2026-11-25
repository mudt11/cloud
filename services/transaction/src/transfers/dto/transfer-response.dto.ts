import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TransferResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: ['PENDING', 'SUCCEEDED', 'REJECTED'] })
  status: string;

  @ApiProperty({ format: 'uuid' })
  fromAccountId: string;

  @ApiProperty({ format: 'uuid' })
  toAccountId: string;

  @ApiProperty({ example: '1234567890' })
  fromAccountNumber: string;

  @ApiProperty({ example: '0987654321' })
  toAccountNumber: string;

  @ApiProperty({ format: 'uuid' })
  fromUserId: string;

  @ApiProperty({ format: 'uuid' })
  toUserId: string;

  @ApiProperty({
    description: 'Số tiền (VND, dạng chuỗi để tránh mất độ chính xác BIGINT)',
    example: '500000',
    type: 'string',
  })
  amount: string;

  @ApiProperty({ example: 'VND' })
  currency: string;

  @ApiProperty({ example: 'Thanh toán tiền thuê' })
  description: string;

  @ApiPropertyOptional({ example: 'M05', nullable: true })
  reasonCode: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  committedAt: string | null;
}
