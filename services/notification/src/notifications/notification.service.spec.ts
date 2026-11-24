import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotificationService } from './notification.service';
import { NotificationEntity } from './entities/notification.entity';
import {
  ResourceNotFoundException,
  ForbiddenException,
} from '../common/exceptions/app.exception';
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
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    eventId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    recipientUserId: MOCK_USER.sub,
    type: 'TRANSFER_SUCCEEDED',
    transferId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    direction: 'INCOMING',
    amount: '500000',
    currency: 'VND',
    message: 'Bạn đã nhận 500,000 VND',
    createdAt: new Date('2026-11-01T10:00:00Z'),
    readAt: null,
    ...overrides,
  } as NotificationEntity;
}

describe('NotificationService', () => {
  let service: NotificationService;
  let mockRepo: any;

  beforeEach(async () => {
    // Mock createQueryBuilder for N01
    const mockQb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
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
    it('should return paginated notifications with unreadCount', async () => {
      const notification = makeNotification();
      mockRepo._mockQb.getManyAndCount.mockResolvedValue([[notification], 1]);
      mockRepo._mockQb.getCount.mockResolvedValue(1);

      const result = await service.findAll(MOCK_USER, { page: 1, limit: 20 });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.unreadCount).toBe(1);
      expect(result.items[0].isRead).toBe(false);
    });

    it('should return isRead=true when readAt is set', async () => {
      const notification = makeNotification({ readAt: new Date() });
      mockRepo._mockQb.getManyAndCount.mockResolvedValue([[notification], 1]);
      mockRepo._mockQb.getCount.mockResolvedValue(0);

      const result = await service.findAll(MOCK_USER, { page: 1, limit: 20 });
      expect(result.items[0].isRead).toBe(true);
      expect(result.unreadCount).toBe(0);
    });

    it('should return empty list when no notifications', async () => {
      mockRepo._mockQb.getManyAndCount.mockResolvedValue([[], 0]);
      mockRepo._mockQb.getCount.mockResolvedValue(0);

      const result = await service.findAll(MOCK_USER, { page: 1, limit: 20 });
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('markAsRead (N02)', () => {
    it('should mark a notification as read', async () => {
      const notification = makeNotification();
      mockRepo.findOne.mockResolvedValue(notification);
      mockRepo.save.mockImplementation(async (n: NotificationEntity) => n);

      const result = await service.markAsRead(notification.id, MOCK_USER);

      expect(result.isRead).toBe(true);
      expect(result.readAt).not.toBeNull();
      expect(mockRepo.save).toHaveBeenCalled();
    });

    it('should be idempotent — not update if already read', async () => {
      const readAt = new Date('2026-11-01T12:00:00Z');
      const notification = makeNotification({ readAt });
      mockRepo.findOne.mockResolvedValue(notification);

      const result = await service.markAsRead(notification.id, MOCK_USER);

      expect(result.isRead).toBe(true);
      expect(mockRepo.save).not.toHaveBeenCalled();
    });

    it('should throw ResourceNotFoundException when notification not found', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.markAsRead('ffffffff-ffff-4fff-8fff-ffffffffffff', MOCK_USER),
      ).rejects.toThrow(ResourceNotFoundException);
    });

    it('should throw ForbiddenException when user is not owner', async () => {
      const notification = makeNotification({
        recipientUserId: OTHER_USER.sub,
      });
      mockRepo.findOne.mockResolvedValue(notification);

      await expect(
        service.markAsRead(notification.id, MOCK_USER),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
