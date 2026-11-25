/**
 * Hợp đồng sự kiện TransferPosted v1 theo Tài liệu 06 E01
 * Exchange: bank.events.v1 (topic, durable)
 * Routing key: transfer.posted.v1
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
  amount: string; // BIGINT dạng string
  currency: string; // 'VND'
  description: string;
  committedAt: string; // ISO 8601 UTC, bắt buộc khác null khi APPLIED
}

export interface TransferPostedEvent {
  eventId: string; // UUID outbox
  eventType: 'TransferPosted';
  schemaVersion: number; // Phải bằng 1
  occurredAt: string; // ISO 8601 UTC
  producer: string; // 'account'
  correlationId: string; // transferId
  payload: TransferPostedPayload;
}
