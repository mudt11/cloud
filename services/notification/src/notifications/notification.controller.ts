import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Req,
  Res,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { NotificationService } from './notification.service';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { NotificationResponseDto } from './dto/notification-response.dto';
import { AuthenticatedUser } from '../common/guards/jwt-auth.guard';

@ApiTags('Notifications')
@ApiBearerAuth('JWT')
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  /**
   * N01 — GET /api/v1/notifications
   * Query params: page, limit, unreadOnly
   * Response header: X-Total-Count
   */
  @Get()
  @ApiOperation({
    summary: 'N01 — Danh sách thông báo',
    description:
      'Lấy danh sách thông báo của người dùng hiện tại, phân trang.\n\n' +
      'Response header **X-Total-Count** chứa tổng số bản ghi.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Trang hiện tại (mặc định: 1)', example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Số bản ghi mỗi trang (mặc định: 20, tối đa: 100)', example: 20 })
  @ApiQuery({ name: 'unreadOnly', required: false, enum: ['true', 'false'], description: 'Lọc chỉ thông báo chưa đọc' })
  @ApiResponse({
    status: 200,
    description: 'Danh sách thông báo',
    headers: {
      'X-Total-Count': { description: 'Tổng số thông báo khớp filter', schema: { type: 'integer' } },
    },
    type: NotificationResponseDto,
    isArray: true,
  })
  @ApiResponse({ status: 401, description: 'UNAUTHENTICATED' })
  async listNotifications(
    @Query() query: ListNotificationsQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = req.user as AuthenticatedUser;
    const requestId = req.requestId!;

    const result = await this.notificationService.findAll(user, query);

    // X-Total-Count header theo tiêu chuẩn REST pagination
    res.setHeader('X-Total-Count', String(result.total));

    return {
      data: result,
      requestId,
    };
  }

  /**
   * N02 — PATCH /api/v1/notifications/:id/read
   */
  @Patch(':id/read')
  @ApiOperation({
    summary: 'N02 — Đánh dấu thông báo đã đọc',
    description: 'Idempotent: Nếu đã đọc rồi, giữ nguyên `readAt` gốc.',
  })
  @ApiParam({ name: 'id', description: 'UUID của notification', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Thông báo đã được đánh dấu đọc', type: NotificationResponseDto })
  @ApiResponse({ status: 401, description: 'UNAUTHENTICATED' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — không phải chủ sở hữu' })
  @ApiResponse({ status: 404, description: 'NOTIFICATION_NOT_FOUND' })
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
