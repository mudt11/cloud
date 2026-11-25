import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { randomUUID, createHash } from 'node:crypto';
import { TransferEntity, TransferStatus } from './entities/transfer.entity';
import { AccountClient } from './account.client';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { TransferResponseDto } from './dto/transfer-response.dto';
import { ListTransfersQueryDto } from './dto/list-transfers-query.dto';
import {
  IdempotencyConflictException,
  ResourceNotFoundException,
  ValidationException,
} from '../common/exceptions/app.exception';
import { AuthenticatedUser } from '../common/guards/jwt-auth.guard';
import { normalizeNfcTrim } from '../common/pipes/uuid-param.pipe';
import { parseVietnamDateRange } from '../common/utils/date-range.util';

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

export interface ListTransfersResult {
  items: TransferResponseDto[];
  meta: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
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

  // ─── Helper: map entity → response DTO (M02 / M03) ────────────────────────
  toDto(entity: TransferEntity): TransferResponseDto {
    return {
      id: entity.id,
      requesterUserId: entity.requesterUserId,
      fromAccountId: entity.fromAccountId,
      toAccountId: entity.toAccountId,
      fromAccountNumber: entity.fromAccountNumber,
      toAccountNumber: entity.toAccountNumber,
      amount: entity.amount,
      currency: entity.currency,
      description: entity.description,
      status: entity.status,
      reasonCode: entity.reasonCode,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
      committedAt: entity.committedAt?.toISOString() ?? null,
    };
  }

  /**
   * Tính SHA-256 hex lowercase của body chuẩn hóa theo Tài liệu 06 C05:
   * đúng thứ tự key: fromAccountId, toAccountNumber, amount, description.
   */
  computeRequestHash(dto: CreateTransferDto): string {
    const canonical = JSON.stringify({
      fromAccountId: dto.fromAccountId.trim().toLowerCase(),
      toAccountNumber: dto.toAccountNumber.trim(),
      amount: dto.amount.trim(),
      description: normalizeNfcTrim(dto.description ?? ''),
    });
    return createHash('sha256').update(canonical, 'utf8').digest('hex');
  }

  // ─── T01: Tạo hoặc gửi lại yêu cầu chuyển tiền ────────────────────────────
  async create(
    dto: CreateTransferDto,
    idempotencyKey: string,
    user: AuthenticatedUser,
    requestId: string,
  ): Promise<CreateTransferResult> {
    const normalizedFromId = dto.fromAccountId.trim().toLowerCase();
    const normalizedToNumber = dto.toAccountNumber.trim();
    const normalizedAmount = dto.amount.trim();
    const normalizedDesc = normalizeNfcTrim(dto.description ?? '');
    const requestHash = this.computeRequestHash({
      fromAccountId: normalizedFromId,
      toAccountNumber: normalizedToNumber,
      amount: normalizedAmount,
      description: normalizedDesc,
    });

    // 1. Tra cứu khóa chống trùng trước khi gọi Account (C03 & T01)
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
        `[${requestId}] Idempotency replay: transferId=${existing.id} status=${existing.status}`,
      );
      return {
        transfer: this.toDto(existing),
        replayed: true,
        pending: existing.status === 'PENDING',
      };
    }

    // 2. Gọi I01 ngoài transaction DB để xác minh nguồn & phân giải đích
    const context = await this.accountClient.getTransferContext(
      {
        requesterUserId: user.sub,
        fromAccountId: normalizedFromId,
        toAccountNumber: normalizedToNumber,
      },
      requestId,
    );

    // 3. Chèn bản ghi PENDING bền vững trước khi gọi I02; xử lý cạnh tranh UNIQUE (T01b bước 3)
    const transferId = randomUUID();
    const leaseUntil = new Date(Date.now() + 30_000);

    const newTransfer = this.transferRepo.create({
      id: transferId,
      requesterUserId: user.sub,
      idempotencyKey,
      requestHash,
      fromAccountId: context.from.id,
      toAccountId: context.to.id,
      fromAccountNumber: context.from.accountNumber,
      toAccountNumber: context.to.accountNumber,
      fromUserId: context.from.userId,
      toUserId: context.to.userId,
      amount: normalizedAmount,
      currency: 'VND',
      description: normalizedDesc,
      status: 'PENDING',
      reasonCode: null,
      committedAt: null,
      leaseUntil,
    });

    try {
      await this.transferRepo.save(newTransfer);
    } catch (err: any) {
      // Nếu thua cạnh tranh UNIQUE (requester_user_id, idempotency_key) -> đọc lại bản ghi thắng
      const pgCode = err?.code || err?.driverError?.code;
      if (pgCode === '23505') {
        const winner = await this.transferRepo.findOne({
          where: { requesterUserId: user.sub, idempotencyKey },
        });
        if (winner) {
          if (winner.requestHash !== requestHash) {
            throw new IdempotencyConflictException(
              'Idempotency-Key đã được sử dụng với nội dung yêu cầu khác nhau',
            );
          }
          return {
            transfer: this.toDto(winner),
            replayed: true,
            pending: winner.status === 'PENDING',
          };
        }
      }
      throw err;
    }

    this.logger.log(
      `[${requestId}] PENDING saved transferId=${transferId}`,
    );

    // 4. Gọi I02 → ghi tiền nguyên tử tại Account Service (timeout inline tối đa 2s theo T01)
    const postingResult = await this.accountClient.createPosting(
      {
        transferId,
        requesterUserId: user.sub,
        fromAccountId: context.from.id,
        toAccountId: context.to.id,
        amount: normalizedAmount,
        currency: 'VND',
        description: normalizedDesc,
      },
      requestId,
      2_000,
    );

    // 5. Nếu chưa xác định (timeout / 5xx) → giữ PENDING, trả 202
    if (postingResult === null) {
      this.logger.warn(
        `[${requestId}] I02 no definitive response — keeping PENDING transferId=${transferId}`,
      );
      const saved =
        (await this.transferRepo.findOne({ where: { id: transferId } })) ??
        newTransfer;
      return { transfer: this.toDto(saved), replayed: false, pending: true };
    }

    // 6. Ánh xạ PostingReceipt.status (APPLIED/REJECTED) → Transfer.status (SUCCEEDED/REJECTED)
    const finalStatus: TransferStatus =
      postingResult.status === 'APPLIED' ? 'SUCCEEDED' : 'REJECTED';
    const committedAt =
      postingResult.status === 'APPLIED'
        ? postingResult.committedAt
          ? new Date(postingResult.committedAt)
          : new Date()
        : null;

    await this.transferRepo.update(
      { id: transferId, status: 'PENDING' },
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

    const updated =
      (await this.transferRepo.findOne({ where: { id: transferId } })) ??
      newTransfer;

    return { transfer: this.toDto(updated), replayed: false, pending: false };
  }

  // ─── T02: Danh sách lịch sử giao dịch ────────────────────────────────────
  async findAll(
    user: AuthenticatedUser,
    query: ListTransfersQueryDto,
    authorizationHeader: string,
    requestId: string,
  ): Promise<ListTransfersResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    // 1. Validate cặp fromDate / toDate theo C05 & T02
    const hasFrom = query.fromDate !== undefined;
    const hasTo = query.toDate !== undefined;
    if (hasFrom !== hasTo) {
      throw new ValidationException(
        'fromDate và toDate phải được truyền cùng nhau hoặc cùng bỏ trống',
        [
          {
            field: hasFrom ? 'query.toDate' : 'query.fromDate',
            code: 'REQUIRED',
            message: 'Phải cung cấp cả fromDate và toDate',
          },
        ],
      );
    }

    const utcRange =
      hasFrom && hasTo
        ? parseVietnamDateRange(query.fromDate!, query.toDate!, 31)
        : null;

    // 2. direction chỉ hợp lệ khi có accountId (T02)
    if (query.direction && !query.accountId) {
      throw new ValidationException(
        'direction chỉ hợp lệ khi có accountId',
        [
          {
            field: 'query.accountId',
            code: 'REQUIRED',
            message: 'Phải truyền accountId khi lọc theo direction',
          },
        ],
      );
    }

    // 3. Nếu có accountId: xác minh qua Account A02 (CUSTOMER) hoặc A05 (ADMIN)
    let verifiedAccountId: string | undefined;
    if (query.accountId) {
      const normalizedAccountId = query.accountId.trim().toLowerCase();
      if (user.role === 'ADMIN') {
        await this.accountClient.getAdminAccountById(
          authorizationHeader,
          normalizedAccountId,
          requestId,
        );
      } else {
        const myAccount = await this.accountClient.getMyAccount(
          authorizationHeader,
          requestId,
        );
        if (myAccount.id.toLowerCase() !== normalizedAccountId) {
          throw new ResourceNotFoundException(
            'Không tìm thấy tài khoản',
            'ACCOUNT_NOT_FOUND',
          );
        }
      }
      verifiedAccountId = normalizedAccountId;
    }

    // 4. Truy vấn lịch sử kết hợp điều kiện AND, lọc createdAt, sort createdAt DESC, id DESC
    const qb = this.transferRepo.createQueryBuilder('t');

    if (user.role !== 'ADMIN') {
      qb.andWhere(
        '(t.requester_user_id = :userId OR (t.to_user_id = :userId AND t.status = :succeededStatus))',
        { userId: user.sub, succeededStatus: 'SUCCEEDED' },
      );
    }

    if (verifiedAccountId) {
      if (query.direction === 'OUTGOING') {
        qb.andWhere('t.from_account_id = :accountId', {
          accountId: verifiedAccountId,
        });
      } else if (query.direction === 'INCOMING') {
        qb.andWhere('t.to_account_id = :accountId', {
          accountId: verifiedAccountId,
        });
      } else {
        qb.andWhere(
          '(t.from_account_id = :accountId OR t.to_account_id = :accountId)',
          { accountId: verifiedAccountId },
        );
      }
    }

    if (query.status) {
      qb.andWhere('t.status = :status', { status: query.status });
    }

    if (utcRange) {
      qb.andWhere('t.created_at >= :startUtc AND t.created_at < :endUtc', {
        startUtc: utcRange.startUtc,
        endUtc: utcRange.endUtcExclusive,
      });
    }

    qb.orderBy('t.created_at', 'DESC')
      .addOrderBy('t.id', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [entities, totalItems] = await qb.getManyAndCount();
    const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize);

    return {
      items: entities.map((e) => this.toDto(e)),
      meta: {
        page,
        pageSize,
        totalItems,
        totalPages,
      },
    };
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
        'RESOURCE_NOT_FOUND',
      );
    }

    // Quyền T03: requester xem mọi trạng thái; người nhận chỉ xem SUCCEEDED;
    // ADMIN xem tất cả; không thuộc quyền trả 404 RESOURCE_NOT_FOUND để tránh lộ tồn tại.
    if (user.role !== 'ADMIN') {
      const isRequester = transfer.requesterUserId === user.sub;
      const isSucceededRecipient =
        transfer.status === 'SUCCEEDED' && transfer.toUserId === user.sub;

      if (!isRequester && !isSucceededRecipient) {
        throw new ResourceNotFoundException(
          'Giao dịch không tồn tại',
          'RESOURCE_NOT_FOUND',
        );
      }
    }

    return this.toDto(transfer);
  }
}
