import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { TransferEntity } from './entities/transfer.entity';
import { AccountClient } from './account.client';

/**
 * T01b / E03 — Worker Retry PENDING
 *
 * Theo Tài liệu 06 T01b bước 6:
 * - Quét các transfer PENDING mà leaseUntil đã hết hạn (mỗi 2s quét để kịp backoff 1,2,4,8,16..30s).
 * - Truy vấn I03 GET /internal/v1/postings/{transferId}:
 *   + Nếu có receipt (APPLIED/REJECTED) → cập nhật SUCCEEDED/REJECTED, giải phóng lease.
 *   + Nếu I03 trả 404 POSTING_NOT_FOUND → gửi lại I02 POST /internal/v1/postings cùng payload bất biến.
 *   + Nếu chưa xác định → backoff 1, 2, 4, 8, 16, tối đa 30 giây có jitter (±20%) vào leaseUntil.
 * - Nếu PENDING quá 5 phút → ghi log cảnh báo PENDING_OVERDUE_5M, không tự đổi REJECTED.
 */
@Injectable()
export class TransferRetryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TransferRetryWorker.name);
  private readonly POLL_INTERVAL_MS = 2_000;
  private readonly BASE_BACKOFF_STEPS_SEC = [1, 2, 4, 8, 16, 30];
  private readonly MAX_LEASE_MS = 30_000;
  private readonly OVERDUE_WARN_MS = 5 * 60_000;

  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private readonly attemptCounts = new Map<string, number>();

  constructor(
    @InjectRepository(TransferEntity)
    private readonly transferRepo: Repository<TransferEntity>,
    private readonly accountClient: AccountClient,
  ) {}

  onModuleInit() {
    // Không chạy background interval khi đang chạy unit/e2e test
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
      return;
    }

    this.intervalHandle = setInterval(() => {
      void this.pollPendingTransfers();
    }, this.POLL_INTERVAL_MS);
    this.intervalHandle.unref?.();

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

  private computeNextLeaseMs(transferId: string): number {
    const prevAttempts = this.attemptCounts.get(transferId) ?? 0;
    const stepIndex = Math.min(prevAttempts, this.BASE_BACKOFF_STEPS_SEC.length - 1);
    const baseSec = this.BASE_BACKOFF_STEPS_SEC[stepIndex];
    this.attemptCounts.set(transferId, prevAttempts + 1);

    // Thêm jitter ±20% để tránh thundering herd
    const jitterFactor = 0.8 + Math.random() * 0.4;
    const delayMs = Math.round(baseSec * 1000 * jitterFactor);
    return Math.min(this.MAX_LEASE_MS, Math.max(1_000, delayMs));
  }

  async pollPendingTransfers(): Promise<void> {
    try {
      const now = new Date();
      const stalePending = await this.transferRepo.find({
        where: {
          status: 'PENDING',
          leaseUntil: LessThan(now),
        },
        take: 50,
        order: { createdAt: 'ASC' },
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

  async processOne(transfer: TransferEntity): Promise<void> {
    const { id: transferId } = transfer;

    // Kiểm tra cảnh báo quá 5 phút (T01b bước 6)
    const ageMs = Date.now() - transfer.createdAt.getTime();
    if (ageMs >= this.OVERDUE_WARN_MS) {
      this.logger.error(
        JSON.stringify({
          level: 'error',
          event: 'PENDING_OVERDUE_5M',
          service: process.env.SERVICE_NAME || 'transaction',
          transferId,
          ageSeconds: Math.round(ageMs / 1000),
          message:
            'Transfer đang ở trạng thái PENDING quá 5 phút, tiếp tục retry theo E03',
        }),
      );
    }

    try {
      // Giành lease tạm 30s trong khi gọi mạng để replica khác không chạy đè
      const processingLease = new Date(Date.now() + this.MAX_LEASE_MS);
      if (transfer.leaseUntil !== null) {
        const updateRes = await this.transferRepo
          .createQueryBuilder()
          .update(TransferEntity)
          .set({ leaseUntil: processingLease })
          .where('id = :id AND status = :status AND lease_until = :oldLease', {
            id: transferId,
            status: 'PENDING',
            oldLease: transfer.leaseUntil,
          })
          .execute();
        if (updateRes.affected === 0) {
          return; // Worker khác đã giành quyền
        }
      } else {
        await this.transferRepo.update(
          { id: transferId, status: 'PENDING' },
          { leaseUntil: processingLease },
        );
      }

      const internalRequestId = randomUUID();

      // Bước 1: I03 — Tra cứu receipt tại Account Service
      const lookup = await this.accountClient.getPostingStatus(
        transferId,
        internalRequestId,
      );

      if (lookup.found) {
        await this.applyReceipt(transferId, lookup.receipt);
        return;
      }

      // Bước 2: Nếu I03 trả 404 POSTING_NOT_FOUND → gửi lại I02 cùng payload bất biến
      if (lookup.notFound) {
        this.logger.log(
          `[RetryWorker] I03 POSTING_NOT_FOUND for transferId=${transferId} — retrying I02`,
        );
        const receipt = await this.accountClient.createPosting(
          {
            transferId: transfer.id,
            requesterUserId: transfer.requesterUserId,
            fromAccountId: transfer.fromAccountId,
            toAccountId: transfer.toAccountId,
            amount: transfer.amount,
            currency: transfer.currency,
            description: transfer.description,
          },
          internalRequestId,
          10_000,
        );

        if (receipt) {
          await this.applyReceipt(transferId, receipt);
          return;
        }
      }

      // Chưa có kết quả cuối → đặt backoff vào leaseUntil cho lần thử kế tiếp
      const nextDelayMs = this.computeNextLeaseMs(transferId);
      await this.transferRepo.update(
        { id: transferId, status: 'PENDING' },
        { leaseUntil: new Date(Date.now() + nextDelayMs) },
      );
      this.logger.warn(
        `[RetryWorker] transferId=${transferId} still PENDING — next retry in ${nextDelayMs}ms`,
      );
    } catch (err) {
      this.logger.error(
        `[RetryWorker] Error processing transferId=${transferId}`,
        err,
      );
      const nextDelayMs = this.computeNextLeaseMs(transferId);
      await this.transferRepo
        .update(
          { id: transferId, status: 'PENDING' },
          { leaseUntil: new Date(Date.now() + nextDelayMs) },
        )
        .catch(() => undefined);
    }
  }

  private async applyReceipt(
    transferId: string,
    receipt: {
      status: 'APPLIED' | 'REJECTED';
      reasonCode?: string | null;
      committedAt?: string | null;
    },
  ): Promise<void> {
    const finalStatus = receipt.status === 'APPLIED' ? 'SUCCEEDED' : 'REJECTED';
    const committedAt =
      receipt.status === 'APPLIED'
        ? receipt.committedAt
          ? new Date(receipt.committedAt)
          : new Date()
        : null;

    await this.transferRepo.update(
      { id: transferId, status: 'PENDING' },
      {
        status: finalStatus,
        committedAt,
        reasonCode: receipt.reasonCode ?? null,
        leaseUntil: null,
      },
    );

    this.attemptCounts.delete(transferId);
    this.logger.log(
      `[RetryWorker] transferId=${transferId} resolved to ${finalStatus}`,
    );
  }
}
