import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotificationService } from './notification.service';
import { NotificationEntity } from './entities/notification.entity';
import { ResourceNotFoundException } from '../common/exceptions/app.exception';
import { AuthenticatedUser } from '../common/guards/jwt-auth.guard';

const MOCK_USER: AuthenticatedUser = {
  sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  role: 'CUSTOMER',
};

const OTHER_USER: AuthenticatedUser = {
  sub: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  role: 'CUSTOMER',
};

function makeNotification(
  overrides: Partial<NotificationEntity> = {},
): NotificationEntity {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    eventId: '44444444-4444-4444-8444-444444444444',
    recipientUserId: MOCK_USER.sub,
    type: 'TRANSFER_SUCCEEDED',
    transferId: '33333333-3333-4333-8333-333333333333',
    direction: 'INCOMING',
    amount: '500000',
    currency: 'VND',
    message: 'Bạn đã nhận 500.000 VND từ tài khoản 1000000001',
    createdAt: new Date('2026-11-01T10:00:00Z'),
    readAt: null,
    ...overrides,
  } as NotificationEntity;
}

describe('NotificationService', () => {
  let service: NotificationService;
  let mockRepo: any;

  beforeEach(async () => {
    const mockQb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      getCount: jest.fn().mockResolvedValue(0),
    };

    mockRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(mockQb),
      _mockQb: mockQb,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        {
          provide: getRepositoryToken(NotificationEntity),
          useValue: mockRepo,
        },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
  });

  describe('findAll (N01)', () => {
    it('should return items and C05 meta with pageSize and unreadCount', async () => {
      const notification = makeNotification();
      mockRepo._mockQb.getManyAndCount.mockResolvedValue([[notification], 1]);
      mockRepo._mockQb.getCount.mockResolvedValue(1);

      const result = await service.findAll(MOCK_USER, {
        page: 1,
        pageSize: 20,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual({
        id: notification.id,
        transferId: notification.transferId,
        type: 'TRANSFER_SUCCEEDED',
        direction: 'INCOMING',
        amount: '500000',
        currency: 'VND',
        message: notification.message,
        createdAt: '2026-11-01T10:00:00.000Z',
        readAt: null,
      });
      expect(result.meta).toEqual({
        page: 1,
        pageSize: 20,
        totalItems: 1,
        totalPages: 1,
        unreadCount: 1,
      });
    });

    it('should return totalPages=0 when no notifications', async () => {
      mockRepo._mockQb.getManyAndCount.mockResolvedValue([[], 0]);
      mockRepo._mockQb.getCount.mockResolvedValue(0);

      const result = await service.findAll(MOCK_USER, {
        page: 1,
        pageSize: 20,
      });
      expect(result.items).toHaveLength(0);
      expect(result.meta.totalPages).toBe(0);
    });
  });

  describe('markAsRead (N02)', () => {
    it('should mark a notification as read', async () => {
      const notification = makeNotification();
      mockRepo.findOne.mockResolvedValue(notification);
      mockRepo.save.mockImplementation(async (n: NotificationEntity) => n);

      const result = await service.markAsRead(notification.id, MOCK_USER);

      expect(result.readAt).not.toBeNull();
      expect(mockRepo.save).toHaveBeenCalled();
    });

    it('should be idempotent — keep original readAt if already read', async () => {
      const readAt = new Date('2026-11-01T12:00:00Z');
      const notification = makeNotification({ readAt });
      mockRepo.findOne.mockResolvedValue(notification);

      const result = await service.markAsRead(notification.id, MOCK_USER);

      expect(result.readAt).toBe('2026-11-01T12:00:00.000Z');
      expect(mockRepo.save).not.toHaveBeenCalled();
    });

    it('should throw ResourceNotFoundException when notification not found', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.markAsRead('ffffffff-ffff-4fff-8fff-ffffffffffff', MOCK_USER),
      ).rejects.toThrow(ResourceNotFoundException);
    });

    it('should throw ResourceNotFoundException (404) when user is not recipient', async () => {
      const notification = makeNotification({
        recipientUserId: OTHER_USER.sub,
      });
      mockRepo.findOne.mockResolvedValue(notification);

      await expect(
        service.markAsRead(notification.id, MOCK_USER),
      ).rejects.toThrow(ResourceNotFoundException);
    });
  });
});
