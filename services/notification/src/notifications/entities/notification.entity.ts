import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
  Unique,
  ValueTransformer,
} from 'typeorm';

export type NotificationDirection = 'OUTGOING' | 'INCOMING';

export const bigintStringTransformer: ValueTransformer = {
  to: (value: string | number | undefined | null) => {
    if (value === null || value === undefined) return value;
    return String(value);
  },
  from: (value: string | number | undefined | null) => {
    if (value === null || value === undefined) return value;
    return String(value);
  },
};

@Entity('notifications')
@Unique('uq_notifications_event_recipient_type', [
  'eventId',
  'recipientUserId',
  'type',
])
export class NotificationEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId: string;

  @Index('idx_notifications_recipient')
  @Column({ name: 'recipient_user_id', type: 'uuid' })
  recipientUserId: string;

  @Column({ type: 'varchar', length: 50, default: 'TRANSFER_SUCCEEDED' })
  type: string;

  @Column({ name: 'transfer_id', type: 'uuid' })
  transferId: string;

  @Column({ type: 'varchar', length: 10 })
  direction: NotificationDirection;

  @Column({
    type: 'bigint',
    transformer: bigintStringTransformer,
  })
  amount: string;

  @Column({ type: 'varchar', length: 3, default: 'VND' })
  currency: string;

  @Column({ type: 'text' })
  message: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt: Date | null;
}
