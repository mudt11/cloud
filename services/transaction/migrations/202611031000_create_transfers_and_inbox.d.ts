import { MigrationInterface, QueryRunner } from 'typeorm';
export declare class CreateTransfersAndInbox202611031000 implements MigrationInterface {
    name: string;
    up(queryRunner: QueryRunner): Promise<void>;
    down(queryRunner: QueryRunner): Promise<void>;
}
