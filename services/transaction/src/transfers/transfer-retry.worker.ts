import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { TransferEntity } from './entities/transfer.entity';
import { AccountClient } from './account.client';

/**
 * T01b / E03 — Worker Retry PENDING
 *
 * Chạy định kỳ mỗi POLL_INTERVAL_MS (15s), quét các transfer PENDING
 * mà lease đã hết hạn, gọi I03 GET /internal/v1/postings/{transferId}
 * để hỏi trạng thái từ Account Service, rồi cập nhật:
 *   - APPLIED   → SUCCEEDED
 *   - REJECTED  → REJECTED (ghi reasonCode)
 *   - PENDING   → gia hạn leaseUntil thêm 30s
 *   - Lỗi mạng  → gia hạn leaseUntil thêm 30s, retry lần sau
 */
@Injectable()
export class TransferRetryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TransferRetryWorker.name);
  private readonly POLL_INTERVAL_MS = 15_000;
  private readonly LEASE_EXTENSION_MS = 30_000;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(TransferEntity)
    private readonly transferRepo: Repository<TransferEntity>,
    private readonly accountClient: AccountClient,
  ) {}

  onModuleInit() {
    this.intervalHandle = setInterval(() => {
      void this.pollPendingTransfers();
    }, this.POLL_INTERVAL_MS);

    this.logger.log(
      `TransferRetryWorker started — polling every ${this.POLL_INTERVAL_MS / 1000}s`,
    );
  }

  onModuleDestroy() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private async pollPendingTransfers(): Promise<void> {
    try {
      // Chọn các transfer PENDING mà leaseUntil đã qua → worker được phép retry
      const stalePending = await this.transferRepo.find({
        where: {
          status: 'PENDING',
          leaseUntil: LessThan(new Date()),
        },
        take: 50, // Giới hạn batch size để tránh quá tải
      });

      if (stalePending.length === 0) return;

      this.logger.log(
        `[RetryWorker] Found ${stalePending.length} stale PENDING transfers`,
      );

      await Promise.allSettled(
        stalePending.map((transfer) => this.processOne(transfer)),
      );
    } catch (err) {
      this.logger.error('[RetryWorker] Poll loop error', err);
    }
  }

  private async processOne(transfer: TransferEntity): Promise<void> {
    const { id: transferId } = transfer;

    try {
      // Gia hạn lease ngay lập tức để tránh worker khác (nếu có) xử lý trùng
      const newLease = new Date(Date.now() + this.LEASE_EXTENSION_MS);
      // Optimistic lock: chỉ cập nhật nếu leaseUntil vẫn còn là giá trị cũ
      // (tránh race condition khi nhiều worker chạy song song)
      if (transfer.leaseUntil !== null) {
        await this.transferRepo
          .createQueryBuilder()
          .update(TransferEntity)
          .set({ leaseUntil: newLease })
          .where('id = :id AND lease_until = :oldLease', {
            id: transferId,
            oldLease: transfer.leaseUntil,
          })
          .execute();
      } else {
        await this.transferRepo.update({ id: transferId }, { leaseUntil: newLease });
      }

      // I03 — Hỏi trạng thái posting từ Account Service
      const internalRequestId = `retry-${transferId}`;
      const status = await this.accountClient.getPostingStatus(
        transferId,
        internalRequestId,
      );

      if (!status) {
        // Account Service không phản hồi → giữ PENDING, đã gia hạn lease ở trên
        this.logger.warn(
          `[RetryWorker] I03 no response for transferId=${transferId} — keeping PENDING`,
        );
        return;
      }

      if (status.result === 'PENDING') {
        // Account vẫn đang xử lý → giữ PENDING với lease mới
        this.logger.log(
          `[RetryWorker] I03 still PENDING for transferId=${transferId}`,
        );
        return;
      }

      // Kết quả cuối: APPLIED → SUCCEEDED, REJECTED → REJECTED
      const finalStatus = status.result === 'APPLIED' ? 'SUCCEEDED' : 'REJECTED';
      const committedAt =
        status.result === 'APPLIED'
          ? status.committedAt
            ? new Date(status.committedAt)
            : new Date()
          : null;

      await this.transferRepo.update(
        { id: transferId },
        {
          status: finalStatus,
          committedAt,
          reasonCode: status.reasonCode ?? null,
          leaseUntil: null, // Giải phóng lease
        },
      );

      this.logger.log(
        `[RetryWorker] transferId=${transferId} resolved to ${finalStatus}`,
      );
    } catch (err) {
      // Lỗi không mong đợi → giữ nguyên trạng thái, worker sẽ retry lần sau
      this.logger.error(
        `[RetryWorker] Error processing transferId=${transferId}`,
        err,
      );
    }
  }
}
