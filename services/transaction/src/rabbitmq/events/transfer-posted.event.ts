/**
 * Payload của domain event TransferPosted được publish bởi Account Service
 * lên exchange bank.events.v1 với routing key transfer.posted
 *
 * Hợp đồng sự kiện theo Tài liệu 06 E01
 */
export interface TransferPostedEvent {
  eventId: string;       // UUID v4 — dùng để chống xử lý trùng qua consumer_inbox
  eventType: 'transfer.posted';
  occurredAt: string;    // ISO 8601
  transferId: string;
  fromAccountId: string;
  toAccountId: string;
  fromUserId: string;
  toUserId: string;
  fromAccountNumber: string;
  toAccountNumber: string;
  amount: string;        // BIGINT dạng string
  currency: string;      // 'VND'
  description: string;
  result: 'APPLIED' | 'REJECTED';
  reasonCode?: string | null;
  committedAt?: string | null;
}
