import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

/**
 * Express middleware kiểm tra Content-Type cho request có body (C02, C03)
 */
export function contentTypeJsonMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const method = req.method?.toUpperCase();
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    const contentLength = Number(req.headers['content-length'] || '0');
    const hasTransferEncoding = Boolean(req.headers['transfer-encoding']);
    const hasBody = contentLength > 0 || hasTransferEncoding;
    const contentType = String(req.headers['content-type'] || '').toLowerCase();

    if (hasBody && !contentType.includes('application/json')) {
      const reqIdHeader = req.headers['x-request-id'];
      const requestId =
        typeof reqIdHeader === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          reqIdHeader.trim(),
        )
          ? reqIdHeader.trim().toLowerCase()
          : randomUUID();

      res.setHeader('X-Request-Id', requestId);
      res.setHeader('Cache-Control', 'no-store');
      res.status(415).json({
        error: {
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'Content-Type phải là application/json',
          details: [],
        },
        requestId,
      });
      return;
    }
  }
  next();
}
