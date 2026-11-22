import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService } from './health.service';
import { IsPublic } from '../common/decorators/public.decorator';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  @IsPublic()
  getLive() {
    return {
      service: this.healthService.getServiceName(),
      status: 'LIVE',
      version: this.healthService.getAppVersion(),
      checkedAt: new Date().toISOString(),
    };
  }

  @Get('ready')
  @IsPublic()
  async getReady(@Res({ passthrough: true }) res: Response) {
    const result = await this.healthService.checkReady();
    if (result.status === 'NOT_READY') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    } else {
      res.status(HttpStatus.OK);
    }
    return result;
  }
}
