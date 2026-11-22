import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
  ValueTransformer,
} from 'typeorm';

export type TransferStatus = 'PENDING' | 'SUCCEEDED' | 'REJECTED';

// Transformer to ensure BIGINT in Postgres is treated as string in TypeScript per Document 06 C02
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

@Entity('transfers')
@Unique('uq_transfers_requester_idempotency', [
  'requesterUserId',
  'idempotencyKey',
])
export class TransferEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'requester_user_id', type: 'uuid' })
  requesterUserId: string;

  @Column({ name: 'idempotency_key', type: 'uuid' })
  idempotencyKey: string;

  @Column({ name: 'request_hash', type: 'varchar', length: 64 })
  requestHash: string;

  @Column({ name: 'from_account_id', type: 'uuid' })
  fromAccountId: string;

  @Column({ name: 'to_account_id', type: 'uuid' })
  toAccountId: string;

  @Column({ name: 'from_account_number', type: 'varchar', length: 10 })
  fromAccountNumber: string;

  @Column({ name: 'to_account_number', type: 'varchar', length: 10 })
  toAccountNumber: string;

  @Index('idx_transfers_from_user')
  @Column({ name: 'from_user_id', type: 'uuid' })
  fromUserId: string;

  @Index('idx_transfers_to_user')
  @Column({ name: 'to_user_id', type: 'uuid' })
  toUserId: string;

  @Column({
    type: 'bigint',
    transformer: bigintStringTransformer,
  })
  amount: string;

  @Column({ type: 'varchar', length: 3, default: 'VND' })
  currency: string;

  @Column({ type: 'varchar', length: 140, default: '' })
  description: string;

  @Index('idx_transfers_status')
  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status: TransferStatus;

  @Column({ name: 'reason_code', type: 'varchar', length: 50, nullable: true })
  reasonCode: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Index('idx_transfers_committed_at')
  @Column({ name: 'committed_at', type: 'timestamptz', nullable: true })
  committedAt: Date | null;

  @Index('idx_transfers_lease_until')
  @Column({ name: 'lease_until', type: 'timestamptz', nullable: true })
  leaseUntil: Date | null;
}
