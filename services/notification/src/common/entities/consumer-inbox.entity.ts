import { Entity, PrimaryColumn, CreateDateColumn } from 'typeorm';

@Entity('consumer_inbox')
export class ConsumerInboxEntity {
  @PrimaryColumn({ name: 'consumer_name', type: 'varchar', length: 100 })
  consumerName: string;

  @PrimaryColumn({ name: 'event_id', type: 'uuid' })
  eventId: string;

  @CreateDateColumn({ name: 'processed_at', type: 'timestamptz' })
  processedAt: Date;
}
