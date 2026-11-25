import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { TransferEntity } from './entities/transfer.entity';
import { AccountClient } from './account.client';
import { PostingReceipt } from './dto/account-client.dto';

export interface ReconcileSummary {
  scannedReceipts: number;
  updatedPending: number;
  alreadyMatched: number;
  missingTransfers: string[];
  statusConflicts: string[];
  immutableMismatches: string[];
}

/**
 * E03 — Job đối chiếu bản sao giữa Transaction và Account I04.
 *
 * - Quét full scan I04 GET /internal/v1/postings theo cursor mỗi 15 phút.
 * - Nếu PENDING trong transaction_db mà Account đã có receipt → cập nhật cuối.
 * - Nếu khác immutable fields hoặc trái kết quả cuối → ghi log cảnh báo (không tự sửa).
 * - Nếu có receipt nhưng thiếu trong transaction_db → cảnh báo vận hành.
 */
@Injectable()
export class TransferReconcileWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TransferReconcileWorker.name);
  private readonly RECONCILE_INTERVAL_MS = 15 * 60_000; // 15 phút theo I04
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  constructor(
    @InjectRepository(TransferEntity)
    private readonly transferRepo: Repository<TransferEntity>,
    private readonly accountClient: AccountClient,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
      return;
    }

    this.intervalHandle = setInterval(() => {
      void this.runSafe();
    }, this.RECONCILE_INTERVAL_MS);
    this.intervalHandle.unref?.();

    this.logger.log(
      'TransferReconcileWorker started — running full scan every 15 minutes',
    );
  }

  onModuleDestroy() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private async runSafe(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      await this.reconcileAll();
    } catch (err) {
      this.logger.error('[Reconcile] Scheduled reconciliation failed', err);
    } finally {
      this.isRunning = false;
    }
  }

  async reconcileAll(limitPerPage = 200): Promise<ReconcileSummary> {
    const requestId = randomUUID();
    const summary: ReconcileSummary = {
      scannedReceipts: 0,
      updatedPending: 0,
      alreadyMatched: 0,
      missingTransfers: [],
      statusConflicts: [],
      immutableMismatches: [],
    };

    let cursor: string | null = null;
    let hasMore = true;

    while (hasMore) {
      const page = await this.accountClient.listPostings(
        limitPerPage,
        cursor,
        requestId,
      );

      for (const receipt of page.items) {
        summary.scannedReceipts++;
        await this.reconcileOne(receipt, summary);
      }

      hasMore = Boolean(page.meta?.hasMore && page.meta?.nextCursor);
      cursor = page.meta?.nextCursor ?? null;
    }

    this.logger.log(
      `[Reconcile] Completed: scanned=${summary.scannedReceipts}, updatedPending=${summary.updatedPending}, missing=${summary.missingTransfers.length}, conflicts=${summary.statusConflicts.length}, mismatches=${summary.immutableMismatches.length}`,
    );

    return summary;
  }

  private async reconcileOne(
    receipt: PostingReceipt,
    summary: ReconcileSummary,
  ): Promise<void> {
    const transfer = await this.transferRepo.findOne({
      where: { id: receipt.transferId },
    });

    if (!transfer) {
      summary.missingTransfers.push(receipt.transferId);
      this.logger.error(
        `[RECONCILE_MISSING_TRANSFER] Receipt ${receipt.transferId} exists in Account but missing in transaction_db`,
      );
      return;
    }

    const immutableMatched =
      transfer.amount === receipt.amount &&
      transfer.fromAccountId === receipt.fromAccountId &&
      transfer.toAccountId === receipt.toAccountId &&
      transfer.requesterUserId === receipt.requesterUserId;

    if (!immutableMatched) {
      summary.immutableMismatches.push(receipt.transferId);
      this.logger.error(
        `[RECONCILE_IMMUTABLE_MISMATCH] Immutable fields mismatch for transferId=${receipt.transferId}`,
      );
      return;
    }

    const expectedStatus =
      receipt.status === 'APPLIED' ? 'SUCCEEDED' : 'REJECTED';

    if (transfer.status === 'PENDING') {
      await this.transferRepo.update(
        { id: transfer.id, status: 'PENDING' },
        {
          status: expectedStatus,
          committedAt:
            receipt.status === 'APPLIED' && receipt.committedAt
              ? new Date(receipt.committedAt)
              : receipt.status === 'APPLIED'
                ? new Date()
                : null,
          reasonCode: receipt.reasonCode ?? null,
          leaseUntil: null,
        },
      );
      summary.updatedPending++;
      return;
    }

    if (transfer.status !== expectedStatus) {
      summary.statusConflicts.push(receipt.transferId);
      this.logger.error(
        `[RECONCILE_STATUS_CONFLICT] transferId=${receipt.transferId} db=${transfer.status} vs receipt=${expectedStatus}`,
      );
      return;
    }

    summary.alreadyMatched++;
  }
}
