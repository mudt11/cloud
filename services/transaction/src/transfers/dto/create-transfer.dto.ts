import { IsNotEmpty, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

/**
 * T01 - Request body theo Tài liệu 06 C03
 * amount: chuỗi biểu diễn số nguyên dương VND (1 đến 1_000_000_000)
 */
export class CreateTransferDto {
  @IsNotEmpty({ message: 'fromAccountId là bắt buộc' })
  @IsUUID('4', { message: 'fromAccountId phải là UUID v4 hợp lệ' })
  fromAccountId: string;

  @IsNotEmpty({ message: 'toAccountNumber là bắt buộc' })
  @IsString()
  @Matches(/^\d{10}$/, { message: 'toAccountNumber phải đúng 10 chữ số' })
  toAccountNumber: string;

  @IsNotEmpty({ message: 'amount là bắt buộc' })
  @IsString()
  @Matches(/^[1-9]\d{0,9}$/, {
    message:
      'amount phải là chuỗi số nguyên dương VND, tối thiểu 1 và tối đa 1000000000',
  })
  amount: string;

  @IsString()
  @MaxLength(140, { message: 'description tối đa 140 ký tự' })
  description: string = '';
}
