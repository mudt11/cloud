import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { HealthService } from './health.service';
import { IsPublic } from '../common/decorators/public.decorator';

@ApiTags('Health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  @IsPublic()
  @ApiOperation({ summary: 'H01 — Liveness probe' })
  @ApiResponse({ status: 200, description: 'Service is live' })
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
  @ApiOperation({ summary: 'H01 — Readiness probe' })
  @ApiResponse({ status: 200, description: 'Service is ready' })
  @ApiResponse({ status: 503, description: 'Service is not ready' })
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
