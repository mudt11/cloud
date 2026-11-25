/**
 * Hợp đồng sự kiện TransferPosted v1 theo Tài liệu 06 E01
 */
export interface TransferPostedPayload {
  transferId: string;
  requesterUserId: string;
  fromAccountId: string;
  toAccountId: string;
  fromUserId: string;
  toUserId: string;
  fromAccountNumber: string;
  toAccountNumber: string;
  amount: string;
  currency: string;
  description: string;
  committedAt: string;
}

export interface TransferPostedEvent {
  eventId: string;
  eventType: 'TransferPosted';
  schemaVersion: number;
  occurredAt: string;
  producer: string;
  correlationId: string;
  payload: TransferPostedPayload;
}
