import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;
  let healthService: HealthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthService,
          useValue: {
            getServiceName: () => 'transaction',
            getAppVersion: () => 'dev',
            checkReady: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    healthService = module.get<HealthService>(HealthService);
  });

  it('/health/live should return HTTP 200 with LIVE status', () => {
    const result = controller.getLive();
    expect(result).toEqual({
      service: 'transaction',
      status: 'LIVE',
      version: 'dev',
      checkedAt: expect.any(String),
    });
  });

  it('/health/ready should return HTTP 200 when all checks are UP', async () => {
    jest.spyOn(healthService, 'checkReady').mockResolvedValue({
      service: 'transaction',
      status: 'READY',
      version: 'dev',
      checkedAt: new Date().toISOString(),
      checks: {
        database: 'UP',
        jwtKeys: 'UP',
      },
    });

    const mockRes: any = {
      status: jest.fn(),
    };

    const result = await controller.getReady(mockRes);
    expect(result.status).toBe('READY');
    expect(mockRes.status).toHaveBeenCalledWith(HttpStatus.OK);
  });

  it('/health/ready should return HTTP 503 when any check is DOWN', async () => {
    jest.spyOn(healthService, 'checkReady').mockResolvedValue({
      service: 'transaction',
      status: 'NOT_READY',
      version: 'dev',
      checkedAt: new Date().toISOString(),
      checks: {
        database: 'DOWN',
        jwtKeys: 'UP',
      },
    });

    const mockRes: any = {
      status: jest.fn(),
    };

    const result = await controller.getReady(mockRes);
    expect(result.status).toBe('NOT_READY');
    expect(mockRes.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });
});
