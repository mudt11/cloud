import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsUUID,
  IsString,
  Matches,
  IsNotEmpty,
  MaxLength,
  IsOptional,
} from 'class-validator';

export class CreateTransferDto {
  @ApiProperty({
    description: 'UUID tài khoản nguồn của người dùng',
    example: '11111111-1111-4111-8111-111111111111',
    format: 'uuid',
  })
  @IsUUID('4', { message: 'fromAccountId phải là UUID v4 hợp lệ' })
  fromAccountId: string;

  @ApiProperty({
    description: 'Số tài khoản đích (10 chữ số)',
    example: '0987654321',
    pattern: '^[0-9]{10}$',
  })
  @IsString()
  @Matches(/^[0-9]{10}$/, {
    message: 'toAccountNumber phải gồm đúng 10 chữ số',
  })
  toAccountNumber: string;

  @ApiProperty({
    description: 'Số tiền chuyển (VND, chuỗi số nguyên, 1 – 1,000,000,000)',
    example: '500000',
    type: 'string',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[1-9][0-9]{0,9}$/, {
    message:
      'amount phải là chuỗi số nguyên dương từ 1 đến 1,000,000,000',
  })
  amount: string;

  @ApiPropertyOptional({
    description: 'Nội dung chuyển khoản (tối đa 140 ký tự)',
    example: 'Thanh toán tiền thuê tháng 11',
    maxLength: 140,
  })
  @IsOptional()
  @IsString()
  @MaxLength(140, { message: 'description không được vượt quá 140 ký tự' })
  description?: string;
}
