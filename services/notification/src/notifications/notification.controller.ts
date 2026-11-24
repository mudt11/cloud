import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { NotificationService } from './notification.service';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { AuthenticatedUser } from '../common/guards/jwt-auth.guard';

@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  /**
   * N01 — GET /api/v1/notifications
   * Query params: page, limit, unreadOnly
   */
  @Get()
  async listNotifications(
    @Query() query: ListNotificationsQueryDto,
    @Req() req: Request,
  ) {
    const user = req.user as AuthenticatedUser;
    const requestId = req.requestId!;

    const result = await this.notificationService.findAll(user, query);
    return {
      data: result,
      requestId,
    };
  }

  /**
   * N02 — PATCH /api/v1/notifications/:id/read
   */
  @Patch(':id/read')
  async markAsRead(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: Request,
  ) {
    const user = req.user as AuthenticatedUser;
    const requestId = req.requestId!;

    const notification = await this.notificationService.markAsRead(id, user);
    return {
      data: notification,
      requestId,
    };
  }
}
