export class NotificationResponseDto {
  id: string;
  eventId: string;
  recipientUserId: string;
  type: string;
  transferId: string;
  direction: 'OUTGOING' | 'INCOMING';
  amount: string;
  currency: string;
  message: string;
  createdAt: string;
  readAt: string | null;
  isRead: boolean;
}

export class NotificationListResponseDto {
  items: NotificationResponseDto[];
  total: number;
  page: number;
  limit: number;
  unreadCount: number;
}
