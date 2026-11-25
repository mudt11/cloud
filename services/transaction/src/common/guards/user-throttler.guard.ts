import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';
import { RateLimitedException } from '../exceptions/app.exception';

/**
 * Rate limiter theo JWT sub (fallback IP nếu chưa xác thực) theo Tài liệu 06 C04.
 * Trả 429 RATE_LIMITED kèm header Retry-After >= 1.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    if (req?.user?.sub) {
      return `sub:${req.user.sub}`;
    }
    return req?.ip || req?.socket?.remoteAddress || 'unknown';
  }

  protected async throwThrottlingException(
    _context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const ttlSeconds = Math.ceil(
      (throttlerLimitDetail.timeToExpire || throttlerLimitDetail.ttl || 1000) /
        1000,
    );
    throw new RateLimitedException(
      'Vượt quá giới hạn tần suất yêu cầu',
      Math.max(1, ttlSeconds),
    );
  }
}
