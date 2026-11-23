/**
 * Hợp đồng I01: POST /internal/v1/transfer-context
 * Request gửi sang Account Service để xác minh quyền sở hữu và lấy thông tin người nhận
 */
export interface TransferContextRequest {
  fromAccountId: string;
  toAccountNumber: string;
  requesterUserId: string;
}

/**
 * Hợp đồng I01: Response từ Account Service
 */
export interface TransferContextResponse {
  fromAccountId: string;
  fromAccountNumber: string;
  fromUserId: string;
  toAccountId: string;
  toAccountNumber: string;
  toUserId: string;
}

/**
 * Hợp đồng I02: POST /internal/v1/postings
 * Request gửi sang Account Service để ghi tiền nguyên tử
 */
export interface PostingRequest {
  transferId: string;
  fromAccountId: string;
  toAccountId: string;
  amount: string;
  currency: string;
  description: string;
  idempotencyKey: string;
}

/**
 * Hợp đồng I02: Response từ Account Service
 * result: 'APPLIED' | 'REJECTED'
 * reasonCode: mã từ chối (vd: M05 = số dư không đủ)
 */
export interface PostingResponse {
  result: 'APPLIED' | 'REJECTED';
  reasonCode?: string;
  committedAt?: string;
}

/**
 * Hợp đồng I03: GET /internal/v1/postings/{transferId}
 * Polling trạng thái sau timeout
 */
export interface PostingStatusResponse {
  transferId: string;
  result: 'APPLIED' | 'REJECTED' | 'PENDING';
  reasonCode?: string;
  committedAt?: string;
}
