import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { TransferReconcileWorker } from './transfer-reconcile.worker';

/**
 * CLI chạy đối chiếu bản sao E03 thủ công (dùng trước nghiệm thu hoặc sau phục hồi DB).
 * Cách chạy: npm run reconcile (dev) hoặc npm run reconcile:prod (production).
 */
async function runReconcileCli() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const worker = app.get(TransferReconcileWorker);
    const summary = await worker.reconcileAll();
    console.log('Reconciliation Summary:', JSON.stringify(summary, null, 2));

    if (
      summary.missingTransfers.length > 0 ||
      summary.statusConflicts.length > 0 ||
      summary.immutableMismatches.length > 0
    ) {
      console.error('Reconciliation found discrepancies! Check logs above.');
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

runReconcileCli().catch((err) => {
  console.error('Reconciliation CLI failed:', err);
  process.exit(1);
});
