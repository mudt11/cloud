import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationEntity } from './entities/notification.entity';
import {
  NotificationResponseDto,
  NotificationListResponseDto,
} from './dto/notification-response.dto';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import {
  ResourceNotFoundException,
  ForbiddenException,
} from '../common/exceptions/app.exception';
import { AuthenticatedUser } from '../common/guards/jwt-auth.guard';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(NotificationEntity)
    private readonly notificationRepo: Repository<NotificationEntity>,
  ) {}

  private toDto(entity: NotificationEntity): NotificationResponseDto {
    return {
      id: entity.id,
      eventId: entity.eventId,
      recipientUserId: entity.recipientUserId,
      type: entity.type,
      transferId: entity.transferId,
      direction: entity.direction,
      amount: entity.amount,
      currency: entity.currency,
      message: entity.message,
      createdAt: entity.createdAt.toISOString(),
      readAt: entity.readAt ? entity.readAt.toISOString() : null,
      isRead: entity.readAt !== null,
    };
  }

  /**
   * N01 — GET /api/v1/notifications
   * Danh sách thông báo của user hiện tại, phân trang, có unreadCount.
   */
  async findAll(
    user: AuthenticatedUser,
    query: ListNotificationsQueryDto,
  ): Promise<NotificationListResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const unreadOnly = query.unreadOnly === 'true';
    const skip = (page - 1) * limit;

    const qb = this.notificationRepo
      .createQueryBuilder('n')
      .where('n.recipient_user_id = :userId', { userId: user.sub })
      .orderBy('n.created_at', 'DESC');

    if (unreadOnly) {
      qb.andWhere('n.read_at IS NULL');
    }

    const [items, total] = await qb.skip(skip).take(limit).getManyAndCount();

    // Đếm unread riêng (luôn theo toàn bộ, không phụ thuộc filter)
    const unreadCount = await this.notificationRepo
      .createQueryBuilder('n')
      .where('n.recipient_user_id = :userId', { userId: user.sub })
      .andWhere('n.read_at IS NULL')
      .getCount();

    return {
      items: items.map((item) => this.toDto(item)),
      total,
      page,
      limit,
      unreadCount,
    };
  }

  /**
   * N02 — PATCH /api/v1/notifications/:id/read
   * Đánh dấu đã đọc. Chỉ chủ sở hữu mới được đánh dấu.
   */
  async markAsRead(
    notificationId: string,
    user: AuthenticatedUser,
  ): Promise<NotificationResponseDto> {
    const notification = await this.notificationRepo.findOne({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new ResourceNotFoundException(
        'Thông báo không tồn tại',
        'NOTIFICATION_NOT_FOUND',
      );
    }

    if (notification.recipientUserId !== user.sub) {
      throw new ForbiddenException(
        'Bạn không có quyền cập nhật thông báo này',
      );
    }

    // Idempotent: đã đọc rồi thì giữ nguyên readAt
    if (!notification.readAt) {
      notification.readAt = new Date();
      await this.notificationRepo.save(notification);
      this.logger.log(
        `Notification ${notificationId} marked as read by user ${user.sub}`,
      );
    }

    return this.toDto(notification);
  }
}
