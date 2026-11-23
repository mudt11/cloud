import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Req,
  Res,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { TransferService } from './transfer.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { AuthenticatedUser } from '../common/guards/jwt-auth.guard';
import { ValidationException } from '../common/exceptions/app.exception';

@Controller('transfers')
export class TransferController {
  constructor(private readonly transferService: TransferService) {}

  /**
   * T01 — POST /api/v1/transfers
   * Header bắt buộc: Idempotency-Key (UUID v4)
   * Response: 201 Created (mới), 200 OK (replayed), 202 Accepted (pending)
   */
  @Post()
  async createTransfer(
    @Body() dto: CreateTransferDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = req.user as AuthenticatedUser;
    const requestId = req.requestId!;

    // Validate Idempotency-Key header (bắt buộc, phải là UUID)
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

    // Validate định dạng UUID
    const UUID_REGEX =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(idempotencyKey.trim())) {
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

    // HTTP 202 Accepted — Account Service chưa phản hồi (PENDING)
    if (result.pending) {
      res.status(HttpStatus.ACCEPTED);
      res.setHeader(
        'Location',
        `/api/v1/transfers/${result.transfer.id}`,
      );
      res.setHeader('Retry-After', '2');
      return {
        data: result.transfer,
        requestId,
      };
    }

    // HTTP 200 OK — Idempotency replay
    if (result.replayed) {
      res.status(HttpStatus.OK);
      res.setHeader('Idempotency-Replayed', 'true');
      return {
        data: result.transfer,
        requestId,
      };
    }

    // HTTP 201 Created — Lệnh mới đã xử lý xong
    res.status(HttpStatus.CREATED);
    res.setHeader(
      'Location',
      `/api/v1/transfers/${result.transfer.id}`,
    );
    return {
      data: result.transfer,
      requestId,
    };
  }

  /**
   * T03 — GET /api/v1/transfers/:transferId
   * CUSTOMER: xem lệnh mình tạo hoặc lệnh SUCCEEDED mình nhận
   * ADMIN: xem tất cả
   */
  @Get(':transferId')
  async getTransfer(
    @Param('transferId', new ParseUUIDPipe({ version: '4' }))
    transferId: string,
    @Req() req: Request,
  ) {
    const user = req.user as AuthenticatedUser;
    const requestId = req.requestId!;

    const transfer = await this.transferService.findOne(transferId, user);
    return {
      data: transfer,
      requestId,
    };
  }
}
