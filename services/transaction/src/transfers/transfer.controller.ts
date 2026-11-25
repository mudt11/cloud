import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Req,
  Res,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiHeader,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { TransferService } from './transfer.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { TransferResponseDto } from './dto/transfer-response.dto';
import { ListTransfersQueryDto } from './dto/list-transfers-query.dto';
import { AuthenticatedUser } from '../common/guards/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ValidationException } from '../common/exceptions/app.exception';
import {
  ParseUuidParamPipe,
  assertNoExtraQuery,
} from '../common/pipes/uuid-param.pipe';

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@ApiTags('Transfers')
@ApiBearerAuth('JWT')
@Controller('transfers')
export class TransferController {
  constructor(private readonly transferService: TransferService) {}

  /**
   * T01 — POST /api/v1/transfers
   * Chỉ CUSTOMER (ADMIN -> 403). Giới hạn 30 request / 60s theo sub (C04).
   * Header bắt buộc: Idempotency-Key (UUID v4)
   */
  @Post()
  @Roles('CUSTOMER')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'T01 — Tạo hoặc gửi lại yêu cầu chuyển tiền',
    description:
      'Tạo lệnh chuyển tiền với Idempotency Key (CUSTOMER).\n\n' +
      '- **201 Created**: Lệnh mới đã có kết quả cuối (SUCCEEDED hoặc REJECTED)\n' +
      '- **200 OK**: Idempotency replay của lệnh đã kết thúc\n' +
      '- **202 Accepted**: Đang chờ Account Service xác nhận (PENDING)',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    description: 'UUID v4 để đảm bảo at-most-once processing',
    required: true,
    example: '66666666-6666-4666-8666-666666666666',
  })
  @ApiResponse({
    status: 201,
    description: 'Lệnh mới đã xử lý xong',
    type: TransferResponseDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Idempotency replay — lệnh đã có kết quả cuối',
    headers: {
      'Idempotency-Replayed': { description: 'true', schema: { type: 'string' } },
    },
  })
  @ApiResponse({
    status: 202,
    description: 'PENDING — đang chờ Account Service',
    headers: {
      Location: { description: 'URL poll trạng thái', schema: { type: 'string' } },
      'Retry-After': { description: '2', schema: { type: 'string' } },
    },
  })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR hoặc SAME_ACCOUNT' })
  @ApiResponse({ status: 401, description: 'UNAUTHENTICATED' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — ADMIN không được chuyển tiền' })
  @ApiResponse({ status: 404, description: 'ACCOUNT_NOT_FOUND hoặc RECIPIENT_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'IDEMPOTENCY_CONFLICT' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED' })
  async createTransfer(
    @Body() dto: CreateTransferDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    assertNoExtraQuery(req.query as Record<string, any>);

    const user = req.user as AuthenticatedUser;
    const requestId = req.requestId!;

    const rawIdempotencyKey = req.headers['idempotency-key'];
    if (!rawIdempotencyKey) {
      throw new ValidationException('Header Idempotency-Key là bắt buộc', [
        {
          field: 'idempotency-key',
          code: 'REQUIRED',
          message: 'Header Idempotency-Key là bắt buộc',
        },
      ]);
    }

    const idempotencyKey = Array.isArray(rawIdempotencyKey)
      ? rawIdempotencyKey[0]
      : rawIdempotencyKey;

    if (!UUID_V4_REGEX.test(idempotencyKey.trim())) {
      throw new ValidationException(
        'Header Idempotency-Key phải là UUID v4 hợp lệ',
        [
          {
            field: 'idempotency-key',
            code: 'INVALID_FORMAT',
            message: 'Idempotency-Key phải là UUID v4 hợp lệ',
          },
        ],
      );
    }

    const result = await this.transferService.create(
      dto,
      idempotencyKey.trim().toLowerCase(),
      user,
      requestId,
    );

    req.transferId = result.transfer.id;
    res.setHeader(
      'Idempotency-Replayed',
      result.replayed ? 'true' : 'false',
    );

    if (result.pending) {
      res.status(HttpStatus.ACCEPTED);
      res.setHeader('Location', `/api/v1/transfers/${result.transfer.id}`);
      res.setHeader('Retry-After', '2');
      return {
        data: result.transfer,
        requestId,
      };
    }

    if (result.replayed) {
      res.status(HttpStatus.OK);
      return {
        data: result.transfer,
        requestId,
      };
    }

    res.status(HttpStatus.CREATED);
    res.setHeader('Location', `/api/v1/transfers/${result.transfer.id}`);
    return {
      data: result.transfer,
      requestId,
    };
  }

  /**
   * T02 — GET /api/v1/transfers
   * Danh sách lịch sử giao dịch theo quyền CUSTOMER / ADMIN.
   */
  @Get()
  @Roles('CUSTOMER', 'ADMIN')
  @ApiOperation({
    summary: 'T02 — Danh sách lịch sử giao dịch',
    description:
      'CUSTOMER xem lệnh mình khởi tạo (mọi trạng thái) và lệnh SUCCEEDED mình nhận.\n' +
      'ADMIN xem toàn bộ hệ thống.',
  })
  @ApiResponse({ status: 200, description: 'Danh sách giao dịch phân trang C05' })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 401, description: 'UNAUTHENTICATED' })
  @ApiResponse({ status: 404, description: 'ACCOUNT_NOT_FOUND' })
  @ApiResponse({ status: 503, description: 'SERVICE_UNAVAILABLE' })
  async listTransfers(
    @Query() query: ListTransfersQueryDto,
    @Req() req: Request,
  ) {
    const user = req.user as AuthenticatedUser;
    const requestId = req.requestId!;
    const authHeader = req.headers['authorization'] || '';

    const result = await this.transferService.findAll(
      user,
      query,
      authHeader,
      requestId,
    );

    return {
      data: { items: result.items },
      meta: result.meta,
      requestId,
    };
  }

  /**
   * T03 — GET /api/v1/transfers/:transferId
   * CUSTOMER: xem lệnh mình tạo hoặc lệnh SUCCEEDED mình nhận. ADMIN: xem tất cả.
   */
  @Get(':transferId')
  @Roles('CUSTOMER', 'ADMIN')
  @ApiOperation({
    summary: 'T03 — Tra cứu chi tiết và trạng thái một giao dịch',
    description:
      'Luôn trả HTTP 200 nếu tồn tại và thuộc quyền (kể cả PENDING). Không có hoặc ngoài quyền trả 404 RESOURCE_NOT_FOUND.',
  })
  @ApiParam({ name: 'transferId', description: 'UUID của transfer', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Chi tiết giao dịch', type: TransferResponseDto })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 401, description: 'UNAUTHENTICATED' })
  @ApiResponse({ status: 404, description: 'RESOURCE_NOT_FOUND' })
  async getTransfer(
    @Param('transferId', ParseUuidParamPipe) transferId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    assertNoExtraQuery(req.query as Record<string, any>);

    const user = req.user as AuthenticatedUser;
    const requestId = req.requestId!;
    req.transferId = transferId;

    const transfer = await this.transferService.findOne(transferId, user);
    if (transfer.status === 'PENDING') {
      res.setHeader('Retry-After', '2');
    }

    return {
      data: transfer,
      requestId,
    };
  }
}
