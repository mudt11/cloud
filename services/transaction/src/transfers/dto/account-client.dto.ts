/**
 * Hợp đồng I01: POST /internal/v1/transfer-context (Tài liệu 06 I01 & I01a)
 */
export interface TransferContextRequest {
  requesterUserId: string;
  fromAccountId: string;
  toAccountNumber: string;
}

export interface AccountRef {
  id: string;
  userId: string;
  accountNumber: string;
  accountName: string;
  currency: string;
  status: 'ACTIVE' | 'FROZEN';
}

export interface TransferContextResponse {
  from: AccountRef;
  to: AccountRef;
}

/**
 * Hợp đồng I02: POST /internal/v1/postings (PostingCommand theo Tài liệu 06 I02)
 */
export interface PostingRequest {
  transferId: string;
  requesterUserId: string;
  fromAccountId: string;
  toAccountId: string;
  amount: string;
  currency: string;
  description: string;
}

/**
 * Hợp đồng M02b / I02 / I03 / I04: PostingReceipt
 */
export interface PostingReceipt {
  transferId: string;
  requesterUserId: string;
  fromAccountId: string;
  toAccountId: string;
  fromUserId: string | null;
  toUserId: string | null;
  fromAccountNumber: string | null;
  toAccountNumber: string | null;
  amount: string;
  currency: string;
  description: string;
  status: 'APPLIED' | 'REJECTED';
  reasonCode: string | null;
  decidedAt: string;
  committedAt: string | null;
  eventId: string | null;
}

/**
 * Hợp đồng I04: GET /internal/v1/postings?limit=...&cursor=...
 */
export interface ListPostingsResponse {
  items: PostingReceipt[];
  meta: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
}

/**
 * Hợp đồng M01 / A02 / A05: Account
 */
export interface AccountInfo {
  id: string;
  userId: string;
  accountNumber: string;
  accountName: string;
  currency: string;
  balance: string;
  status: 'ACTIVE' | 'FROZEN';
  createdAt: string;
  updatedAt: string;
}
