import { TransferStatus } from '../entities/transfer.entity';

/**
 * Response body chuẩn của Transfer theo hợp đồng T01, T03
 * amount là string (chuỗi số nguyên) để tránh mất độ chính xác với BIGINT
 */
export class TransferResponseDto {
  id: string;
  status: TransferStatus;
  fromAccountId: string;
  toAccountId: string;
  fromAccountNumber: string;
  toAccountNumber: string;
  fromUserId: string;
  toUserId: string;
  amount: string;
  currency: string;
  description: string;
  reasonCode: string | null;
  createdAt: string;
  updatedAt: string;
  committedAt: string | null;
}
