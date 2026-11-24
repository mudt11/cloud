/**
 * Payload của domain event TransferPosted
 * Hợp đồng sự kiện theo Tài liệu 06 E01
 */
export interface TransferPostedEvent {
  eventId: string;
  eventType: 'transfer.posted';
  occurredAt: string;
  transferId: string;
  fromAccountId: string;
  toAccountId: string;
  fromUserId: string;
  toUserId: string;
  fromAccountNumber: string;
  toAccountNumber: string;
  amount: string;
  currency: string;
  description: string;
  result: 'APPLIED' | 'REJECTED';
  reasonCode?: string | null;
  committedAt?: string | null;
}
