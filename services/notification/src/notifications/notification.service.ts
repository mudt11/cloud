import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationEntity } from './entities/notification.entity';
import {
  NotificationResponseDto,
  NotificationListResultDto,
} from './dto/notification-response.dto';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { ResourceNotFoundException } from '../common/exceptions/app.exception';
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
      transferId: entity.transferId,
      type: entity.type,
      direction: entity.direction,
      amount: entity.amount,
      currency: entity.currency,
      message: entity.message,
      createdAt: entity.createdAt.toISOString(),
      readAt: entity.readAt ? entity.readAt.toISOString() : null,
    };
  }

  /**
   * N01 — GET /api/v1/notifications
   * Danh sách thông báo của chính sub, sort createdAt DESC, id DESC,
   * trả meta phân trang C05 + unreadCount toàn hộp thư.
   */
  async findAll(
    user: AuthenticatedUser,
    query: ListNotificationsQueryDto,
  ): Promise<NotificationListResultDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const unreadOnly = query.unreadOnly === 'true';
    const skip = (page - 1) * pageSize;

    const qb = this.notificationRepo
      .createQueryBuilder('n')
      .where('n.recipient_user_id = :userId', { userId: user.sub })
      .orderBy('n.created_at', 'DESC')
      .addOrderBy('n.id', 'DESC');

    if (unreadOnly) {
      qb.andWhere('n.read_at IS NULL');
    }

    const [items, totalItems] = await qb
      .skip(skip)
      .take(pageSize)
      .getManyAndCount();

    const unreadCount = await this.notificationRepo
      .createQueryBuilder('n')
      .where('n.recipient_user_id = :userId', { userId: user.sub })
      .andWhere('n.read_at IS NULL')
      .getCount();

    const totalPages =
      totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize);

    return {
      items: items.map((item) => this.toDto(item)),
      meta: {
        page,
        pageSize,
        totalItems,
        totalPages,
        unreadCount,
      },
    };
  }

  /**
   * N02 — PATCH /api/v1/notifications/:notificationId/read
   * Đánh dấu đã đọc (idempotent). Không tồn tại hoặc khác chủ cùng trả 404 RESOURCE_NOT_FOUND.
   */
  async markAsRead(
    notificationId: string,
    user: AuthenticatedUser,
  ): Promise<NotificationResponseDto> {
    const notification = await this.notificationRepo.findOne({
      where: { id: notificationId },
    });

    if (!notification || notification.recipientUserId !== user.sub) {
      throw new ResourceNotFoundException(
        'Thông báo không tồn tại',
        'RESOURCE_NOT_FOUND',
      );
    }

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
