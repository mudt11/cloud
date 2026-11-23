import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { randomUUID, createHash } from 'node:crypto';
import { TransferEntity, TransferStatus } from './entities/transfer.entity';
import { AccountClient } from './account.client';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { TransferResponseDto } from './dto/transfer-response.dto';
import {
  IdempotencyConflictException,
  ResourceNotFoundException,
  ForbiddenException,
} from '../common/exceptions/app.exception';
import { AuthenticatedUser } from '../common/guards/jwt-auth.guard';

export interface CreateTransferResult {
  transfer: TransferResponseDto;
  /**
   * true  → lệnh đã xử lý trước đó, trả Idempotency-Replayed: true
   * false → lệnh mới, xử lý lần đầu
   */
  replayed: boolean;
  /**
   * true  → đang chờ Account xác nhận (ghi PENDING, HTTP 202)
   */
  pending: boolean;
}

@Injectable()
export class TransferService {
  private readonly logger = new Logger(TransferService.name);

  constructor(
    @InjectRepository(TransferEntity)
    private readonly transferRepo: Repository<TransferEntity>,
    private readonly accountClient: AccountClient,
    private readonly dataSource: DataSource,
  ) {}

  // ─── Helper: map entity → response DTO ───────────────────────────────────
  private toDto(entity: TransferEntity): TransferResponseDto {
    return {
      id: entity.id,
      status: entity.status,
      fromAccountId: entity.fromAccountId,
      toAccountId: entity.toAccountId,
      fromAccountNumber: entity.fromAccountNumber,
      toAccountNumber: entity.toAccountNumber,
      fromUserId: entity.fromUserId,
      toUserId: entity.toUserId,
      amount: entity.amount,
      currency: entity.currency,
      description: entity.description,
      reasonCode: entity.reasonCode,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
      committedAt: entity.committedAt?.toISOString() ?? null,
    };
  }

  /**
   * Tính SHA-256 của body chuẩn hóa để chống replay với body khác nhau.
   * Canonical form: sort keys + trim whitespace.
   */
  private computeRequestHash(dto: CreateTransferDto): string {
    const canonical = JSON.stringify({
      fromAccountId: dto.fromAccountId,
      toAccountNumber: dto.toAccountNumber,
      amount: dto.amount,
      description: dto.description ?? '',
    });
    return createHash('sha256').update(canonical).digest('hex');
  }

  // ─── T01: Tạo lệnh chuyển tiền ─────────────────────────────────────────
  async create(
    dto: CreateTransferDto,
    idempotencyKey: string,
    user: AuthenticatedUser,
    requestId: string,
  ): Promise<CreateTransferResult> {
    const requestHash = this.computeRequestHash(dto);

    // 1. Kiểm tra idempotency
    const existing = await this.transferRepo.findOne({
      where: { requesterUserId: user.sub, idempotencyKey },
    });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new IdempotencyConflictException(
          'Idempotency-Key đã được sử dụng với nội dung yêu cầu khác nhau',
        );
      }
      this.logger.log(
        `[${requestId}] Idempotency replay: transferId=${existing.id}`,
      );
      return { transfer: this.toDto(existing), replayed: true, pending: false };
    }

    // 2. Gọi I01 → xác minh quyền sở hữu và lấy context tài khoản
    const context = await this.accountClient.getTransferContext(
      {
        fromAccountId: dto.fromAccountId,
        toAccountNumber: dto.toAccountNumber,
        requesterUserId: user.sub,
      },
      requestId,
    );

    // 3. Tạo bản ghi PENDING trong DB (trong transaction để đảm bảo atomicity)
    const transferId = randomUUID();
    const leaseUntil = new Date(Date.now() + 30_000); // 30s lease cho worker retry

    const transfer = this.transferRepo.create({
      id: transferId,
      requesterUserId: user.sub,
      idempotencyKey,
      requestHash,
      fromAccountId: context.fromAccountId,
      toAccountId: context.toAccountId,
      fromAccountNumber: context.fromAccountNumber,
      toAccountNumber: context.toAccountNumber,
      fromUserId: context.fromUserId,
      toUserId: context.toUserId,
      amount: dto.amount,
      currency: 'VND',
      description: dto.description ?? '',
      status: 'PENDING',
      reasonCode: null,
      committedAt: null,
      leaseUntil,
    });

    await this.transferRepo.save(transfer);
    this.logger.log(
      `[${requestId}] PENDING saved transferId=${transferId}`,
    );

    // 4. Gọi I02 → ghi tiền nguyên tử ở Account Service
    const postingResult = await this.accountClient.createPosting(
      {
        transferId,
        fromAccountId: context.fromAccountId,
        toAccountId: context.toAccountId,
        amount: dto.amount,
        currency: 'VND',
        description: dto.description ?? '',
        idempotencyKey,
      },
      requestId,
    );

    // 5. Xử lý kết quả từ Account Service
    if (postingResult === null) {
      // Timeout → giữ PENDING, caller trả HTTP 202
      this.logger.warn(
        `[${requestId}] I02 no response — keeping PENDING transferId=${transferId}`,
      );
      const saved = (await this.transferRepo.findOne({
        where: { id: transferId },
      }))!;
      return { transfer: this.toDto(saved), replayed: false, pending: true };
    }

    // 6. Cập nhật trạng thái cuối từ kết quả Account
    const finalStatus: TransferStatus =
      postingResult.result === 'APPLIED' ? 'SUCCEEDED' : 'REJECTED';
    const committedAt =
      postingResult.result === 'APPLIED'
        ? postingResult.committedAt
          ? new Date(postingResult.committedAt)
          : new Date()
        : null;

    await this.transferRepo.update(
      { id: transferId },
      {
        status: finalStatus,
        committedAt,
        reasonCode: postingResult.reasonCode ?? null,
        leaseUntil: null,
      },
    );

    this.logger.log(
      `[${requestId}] Transfer ${finalStatus} transferId=${transferId}`,
    );

    const updated = (await this.transferRepo.findOne({
      where: { id: transferId },
    }))!;

    return { transfer: this.toDto(updated), replayed: false, pending: false };
  }

  // ─── T03: Tra cứu chi tiết một giao dịch ─────────────────────────────────
  async findOne(
    transferId: string,
    user: AuthenticatedUser,
  ): Promise<TransferResponseDto> {
    const transfer = await this.transferRepo.findOne({
      where: { id: transferId },
    });

    if (!transfer) {
      throw new ResourceNotFoundException(
        'Giao dịch không tồn tại',
        'TRANSFER_NOT_FOUND',
      );
    }

    // Kiểm tra quyền truy cập theo hợp đồng T03
    if (user.role !== 'ADMIN') {
      const isOwner = transfer.requesterUserId === user.sub;
      const isSucceededRecipient =
        transfer.status === 'SUCCEEDED' && transfer.toUserId === user.sub;

      if (!isOwner && !isSucceededRecipient) {
        throw new ForbiddenException(
          'Bạn không có quyền xem giao dịch này',
        );
      }
    }

    return this.toDto(transfer);
  }
}
