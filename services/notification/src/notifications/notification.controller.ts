import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { NotificationService } from './notification.service';
import {
  ListNotificationsQueryDto,
  EmptyBodyDto,
} from './dto/list-notifications-query.dto';
import { NotificationResponseDto } from './dto/notification-response.dto';
import { AuthenticatedUser } from '../common/guards/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  ParseUuidParamPipe,
  assertNoExtraQuery,
} from '../common/pipes/uuid-param.pipe';

@ApiTags('Notifications')
@ApiBearerAuth('JWT')
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  /**
   * N01 — GET /api/v1/notifications
   * Query params: page, pageSize, unreadOnly
   * Response envelope: { data: { items }, meta: { page, pageSize, totalItems, totalPages, unreadCount }, requestId }
   */
  @Get()
  @Roles('CUSTOMER', 'ADMIN')
  @ApiOperation({
    summary: 'N01 — Xem hộp thông báo của mình',
    description:
      'Lấy danh sách thông báo của người gọi, phân trang chuẩn C05 và meta.unreadCount.',
  })
  @ApiResponse({
    status: 200,
    description: 'Danh sách thông báo',
    headers: {
      'X-Total-Count': {
        description: 'Tổng số thông báo khớp filter',
        schema: { type: 'integer' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 401, description: 'UNAUTHENTICATED' })
  async listNotifications(
    @Query() query: ListNotificationsQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = req.user as AuthenticatedUser;
    const requestId = req.requestId!;

    const result = await this.notificationService.findAll(user, query);
    res.setHeader('X-Total-Count', String(result.meta.totalItems));

    return {
      data: { items: result.items },
      meta: result.meta,
      requestId,
    };
  }

  /**
   * N02 — PATCH /api/v1/notifications/:notificationId/read
   * Body đúng {}; không có hoặc khác chủ trả 404 RESOURCE_NOT_FOUND.
   */
  @Patch(':notificationId/read')
  @Roles('CUSTOMER', 'ADMIN')
  @ApiOperation({
    summary: 'N02 — Đánh dấu thông báo đã đọc',
    description: 'Idempotent: giữ nguyên readAt lần đầu. Ngoài quyền trả 404 RESOURCE_NOT_FOUND.',
  })
  @ApiParam({
    name: 'notificationId',
    description: 'UUID của notification',
    format: 'uuid',
  })
  @ApiResponse({
    status: 200,
    description: 'Thông báo sau cập nhật',
    type: NotificationResponseDto,
  })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 401, description: 'UNAUTHENTICATED' })
  @ApiResponse({ status: 404, description: 'RESOURCE_NOT_FOUND' })
  async markAsRead(
    @Param('notificationId', ParseUuidParamPipe) notificationId: string,
    @Body() _body: EmptyBodyDto,
    @Req() req: Request,
  ) {
    assertNoExtraQuery(req.query as Record<string, any>);

    const user = req.user as AuthenticatedUser;
    const requestId = req.requestId!;

    const notification = await this.notificationService.markAsRead(
      notificationId,
      user,
    );
    return {
      data: notification,
      requestId,
    };
  }
}
