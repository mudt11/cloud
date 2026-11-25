import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsUUID,
  IsString,
  Matches,
  IsNotEmpty,
  ValidateIf,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';
import {
  normalizeNfcTrim,
  codePointLength,
} from '../../common/pipes/uuid-param.pipe';

/**
 * Validator kiểm tra chuỗi số tiền <= 1_000_000_000 (mapping sang OUT_OF_RANGE trong ValidationPipe)
 */
function MaxAmountVnd(
  maxAmount: bigint,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'max',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) {
            return true; // để @Matches xử lý INVALID_FORMAT
          }
          try {
            const parsed = BigInt(value);
            return parsed >= 1n && parsed <= maxAmount;
          } catch {
            return false;
          }
        },
      },
    });
  };
}

/**
 * Validator kiểm tra độ dài tối đa theo Unicode code point (C02)
 */
function MaxCodePoints(maxLen: number, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'maxLength',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (value === undefined || value === null) return true;
          if (typeof value !== 'string') return false;
          return codePointLength(value) <= maxLen;
        },
      },
    });
  };
}

export class CreateTransferDto {
  @ApiProperty({
    description: 'UUID tài khoản nguồn của người dùng',
    example: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    format: 'uuid',
  })
  @IsUUID('4', { message: 'fromAccountId phải là UUID v4 hợp lệ' })
  fromAccountId: string;

  @ApiProperty({
    description: 'Số tài khoản đích (10 chữ số)',
    example: '1000000002',
    pattern: '^[0-9]{10}$',
  })
  @IsString()
  @Matches(/^[0-9]{10}$/, {
    message: 'toAccountNumber phải gồm đúng 10 chữ số',
  })
  toAccountNumber: string;

  @ApiProperty({
    description: 'Số tiền chuyển (VND, chuỗi số nguyên, 1 – 1,000,000,000)',
    example: '100000',
    type: 'string',
  })
  @IsString()
  @IsNotEmpty({ message: 'amount không được để trống' })
  @Matches(/^[1-9][0-9]*$/, {
    message: 'amount phải là chuỗi số nguyên dương không có số 0 đầu',
  })
  @MaxAmountVnd(1_000_000_000n, {
    message: 'amount phải nằm trong khoảng từ 1 đến 1.000.000.000 VND',
  })
  amount: string;

  @ApiPropertyOptional({
    description: 'Nội dung chuyển khoản (Unicode NFC trim, tối đa 140 code point)',
    example: 'Chuyen tien',
    maxLength: 140,
  })
  @ValidateIf((o: CreateTransferDto) => o.description !== undefined)
  @Transform(({ value }) =>
    typeof value === 'string' ? normalizeNfcTrim(value) : value,
  )
  @IsString({ message: 'description phải là chuỗi ký tự' })
  @MaxCodePoints(140, {
    message: 'description không được vượt quá 140 ký tự',
  })
  description?: string;
}
