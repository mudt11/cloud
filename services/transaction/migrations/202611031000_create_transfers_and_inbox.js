"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateTransfersAndInbox202611031000 = void 0;
class CreateTransfersAndInbox202611031000 {
    name = 'CreateTransfersAndInbox202611031000';
    async up(queryRunner) {
        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS transfers (
        id UUID NOT NULL,
        requester_user_id UUID NOT NULL,
        idempotency_key UUID NOT NULL,
        request_hash VARCHAR(64) NOT NULL,
        from_account_id UUID NOT NULL,
        to_account_id UUID NOT NULL,
        from_account_number VARCHAR(10) NOT NULL,
        to_account_number VARCHAR(10) NOT NULL,
        from_user_id UUID NOT NULL,
        to_user_id UUID NOT NULL,
        amount BIGINT NOT NULL,
        currency VARCHAR(3) NOT NULL DEFAULT 'VND',
        description VARCHAR(140) NOT NULL DEFAULT '',
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        reason_code VARCHAR(50) NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        committed_at TIMESTAMPTZ NULL,
        lease_until TIMESTAMPTZ NULL,
        CONSTRAINT pk_transfers PRIMARY KEY (id),
        CONSTRAINT uq_transfers_requester_idempotency UNIQUE (requester_user_id, idempotency_key),
        CONSTRAINT chk_transfers_status CHECK (status IN ('PENDING', 'SUCCEEDED', 'REJECTED')),
        CONSTRAINT chk_transfers_currency CHECK (currency = 'VND'),
        CONSTRAINT chk_transfers_amount CHECK (amount > 0 AND amount <= 1000000000)
      );
    `);
        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_transfers_from_user ON transfers (from_user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_transfers_to_user ON transfers (to_user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_transfers_from_account ON transfers (from_account_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_transfers_to_account ON transfers (to_account_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_transfers_committed_at ON transfers (committed_at DESC) WHERE committed_at IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_transfers_pending_lease ON transfers (status, lease_until) WHERE status = 'PENDING';
    `);
        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS consumer_inbox (
        consumer_name VARCHAR(100) NOT NULL,
        event_id UUID NOT NULL,
        processed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT pk_consumer_inbox PRIMARY KEY (consumer_name, event_id)
      );
    `);
    }
    async down(queryRunner) {
        await queryRunner.query(`DROP TABLE IF EXISTS consumer_inbox;`);
        await queryRunner.query(`DROP TABLE IF EXISTS transfers;`);
    }
}
exports.CreateTransfersAndInbox202611031000 = CreateTransfersAndInbox202611031000;
//# sourceMappingURL=202611031000_create_transfers_and_inbox.js.map