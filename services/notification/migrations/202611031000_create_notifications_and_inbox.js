"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateNotificationsAndInbox202611031000 = void 0;
class CreateNotificationsAndInbox202611031000 {
    name = 'CreateNotificationsAndInbox202611031000';
    async up(queryRunner) {
        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id UUID NOT NULL,
        event_id UUID NOT NULL,
        recipient_user_id UUID NOT NULL,
        type VARCHAR(50) NOT NULL DEFAULT 'TRANSFER_SUCCEEDED',
        transfer_id UUID NOT NULL,
        direction VARCHAR(10) NOT NULL,
        amount BIGINT NOT NULL,
        currency VARCHAR(3) NOT NULL DEFAULT 'VND',
        message TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        read_at TIMESTAMPTZ NULL,
        CONSTRAINT pk_notifications PRIMARY KEY (id),
        CONSTRAINT uq_notifications_event_recipient_type UNIQUE (event_id, recipient_user_id, type),
        CONSTRAINT chk_notifications_direction CHECK (direction IN ('OUTGOING', 'INCOMING')),
        CONSTRAINT chk_notifications_currency CHECK (currency = 'VND'),
        CONSTRAINT chk_notifications_amount CHECK (amount > 0)
      );
    `);
        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created ON notifications (recipient_user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread ON notifications (recipient_user_id, created_at DESC) WHERE read_at IS NULL;
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
        await queryRunner.query(`DROP TABLE IF EXISTS notifications;`);
    }
}
exports.CreateNotificationsAndInbox202611031000 = CreateNotificationsAndInbox202611031000;
//# sourceMappingURL=202611031000_create_notifications_and_inbox.js.map