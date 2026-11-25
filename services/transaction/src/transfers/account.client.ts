import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TransferContextRequest,
  TransferContextResponse,
  PostingRequest,
  PostingReceipt,
  ListPostingsResponse,
  AccountInfo,
} from './dto/account-client.dto';
import {
  ServiceUnavailableException,
  ResourceNotFoundException,
  ForbiddenException,
  ValidationException,
  SameAccountException,
  UnauthenticatedException,
  AppException,
} from '../common/exceptions/app.exception';
import { HttpStatus } from '@nestjs/common';

export type PostingStatusLookupResult =
  | { found: true; receipt: PostingReceipt }
  | { found: false; notFound: boolean };

/**
 * Client giao tiếp với Account Service theo hợp đồng I01, I02, I03, I04, A02, A05.
 * Header máy trạm bắt buộc (Tài liệu 06 C04):
 *   X-Service-Name: transaction
 *   X-Service-Key: <ACCOUNT_SERVICE_KEY>
 */
@Injectable()
export class AccountClient {
  private readonly logger = new Logger(AccountClient.name);
  private readonly baseUrl: string;
  private readonly serviceKey: string;
  private readonly serviceName = 'transaction';
  private readonly defaultTimeoutMs = 10_000; // 10 giây mặc định

  constructor(private readonly configService: ConfigService) {
    this.baseUrl =
      configService.get<string>('ACCOUNT_BASE_URL') ||
      'http://localhost:3002';
    this.serviceKey =
      configService.get<string>('ACCOUNT_SERVICE_KEY') || '';
  }

  private buildInternalHeaders(requestId: string): HeadersInit {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Service-Name': this.serviceName,
      'X-Service-Key': this.serviceKey,
      'X-Request-Id': requestId,
    };
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
    requestId: string,
    timeoutMs = this.defaultTimeoutMs,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err?.name === 'AbortError') {
        this.logger.warn(`[${requestId}] Account Service timeout: ${url}`);
        throw new ServiceUnavailableException(
          'Account Service không phản hồi trong thời gian cho phép',
        );
      }
      this.logger.warn(
        `[${requestId}] Account Service network error: ${err?.message || err}`,
      );
      throw new ServiceUnavailableException(
        'Không thể kết nối đến Account Service',
      );
    }
  }

  /**
   * I01 — POST /internal/v1/transfer-context
   * Xác minh quyền sở hữu tài khoản nguồn và phân giải tài khoản đích.
   */
  async getTransferContext(
    payload: TransferContextRequest,
    requestId: string,
  ): Promise<TransferContextResponse> {
    const url = `${this.baseUrl}/internal/v1/transfer-context`;
    this.logger.log(
      `[${requestId}] I01 POST ${url} fromAccount=${payload.fromAccountId}`,
    );

    const response = await this.fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: this.buildInternalHeaders(requestId),
        body: JSON.stringify(payload),
      },
      requestId,
    );

    if (response.ok) {
      const body = (await response.json()) as any;
      return body.data as TransferContextResponse;
    }

    const errorBody = (await response.json().catch(() => ({}))) as any;
    const code = errorBody?.error?.code || 'UNKNOWN';
    const message = errorBody?.error?.message || 'Lỗi từ Account Service';
    const details = Array.isArray(errorBody?.error?.details)
      ? errorBody.error.details
      : [];

    switch (response.status) {
      case 400:
        if (code === 'SAME_ACCOUNT') {
          throw new SameAccountException(message);
        }
        throw new ValidationException(message, details);
      case 404:
        if (code === 'RECIPIENT_NOT_FOUND') {
          throw new ResourceNotFoundException(
            'Không tìm thấy tài khoản nhận',
            'RECIPIENT_NOT_FOUND',
          );
        }
        throw new ResourceNotFoundException(
          'Không tìm thấy tài khoản nguồn',
          'ACCOUNT_NOT_FOUND',
        );
      case 401:
        this.logger.error(`[${requestId}] I01 internal authentication failed`);
        throw new ServiceUnavailableException(
          'Xác thực nội bộ với Account Service thất bại',
        );
      case 503:
        throw new ServiceUnavailableException(message);
      default:
        this.logger.error(
          `[${requestId}] I01 unexpected status ${response.status}: ${message}`,
        );
        throw new ServiceUnavailableException(
          'Account Service trả lỗi không xác định',
        );
    }
  }

  /**
   * I02 — POST /internal/v1/postings
   * Thực hiện ghi tiền nguyên tử (PostingCommand → PostingReceipt).
   * Trả về null nếu timeout/mất kết nối/5xx để caller giữ trạng thái PENDING.
   */
  async createPosting(
    payload: PostingRequest,
    requestId: string,
    timeoutMs = 2_000, // T01 cho phép chờ tối đa 2 giây rồi trả 202 PENDING
  ): Promise<PostingReceipt | null> {
    const url = `${this.baseUrl}/internal/v1/postings`;
    this.logger.log(
      `[${requestId}] I02 POST ${url} transferId=${payload.transferId}`,
    );

    try {
      const response = await this.fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: this.buildInternalHeaders(requestId),
          body: JSON.stringify(payload),
        },
        requestId,
        timeoutMs,
      );

      if (response.ok) {
        const body = (await response.json()) as any;
        return body.data as PostingReceipt;
      }

      const errorBody = (await response.json().catch(() => ({}))) as any;
      const code = errorBody?.error?.code || 'UNKNOWN';
      const message = errorBody?.error?.message || 'Lỗi từ Account Service';

      if (response.status === 409) {
        this.logger.error(
          `[${requestId}] I02 POSTING_CONFLICT transferId=${payload.transferId}: ${message}`,
        );
        throw new AppException(
          code || 'POSTING_CONFLICT',
          message,
          HttpStatus.CONFLICT,
        );
      }

      if (response.status >= 500) {
        this.logger.warn(
          `[${requestId}] I02 server error ${response.status} (${code}) — keeping PENDING`,
        );
        return null;
      }

      this.logger.error(
        `[${requestId}] I02 unexpected client status ${response.status} (${code}): ${message}`,
      );
      return null;
    } catch (err: any) {
      if (err instanceof AppException && err.getStatus() === HttpStatus.CONFLICT) {
        throw err;
      }
      // Timeout / 503 / mất kết nối → giữ PENDING
      this.logger.warn(
        `[${requestId}] I02 no definitive response (${err?.message}) — keeping PENDING`,
      );
      return null;
    }
  }

  /**
   * I03 — GET /internal/v1/postings/{transferId}
   * Phân biệt rõ: tìm thấy receipt (found=true), 404 POSTING_NOT_FOUND (notFound=true),
   * và lỗi mạng/503 (notFound=false).
   */
  async getPostingStatus(
    transferId: string,
    requestId: string,
  ): Promise<PostingStatusLookupResult> {
    const url = `${this.baseUrl}/internal/v1/postings/${transferId}`;
    this.logger.log(`[${requestId}] I03 GET ${url}`);

    try {
      const response = await this.fetchWithTimeout(
        url,
        {
          method: 'GET',
          headers: this.buildInternalHeaders(requestId),
        },
        requestId,
      );

      if (response.ok) {
        const body = (await response.json()) as any;
        return { found: true, receipt: body.data as PostingReceipt };
      }

      if (response.status === 404) {
        return { found: false, notFound: true };
      }

      this.logger.warn(`[${requestId}] I03 status=${response.status}`);
      return { found: false, notFound: false };
    } catch {
      return { found: false, notFound: false };
    }
  }

  /**
   * I04 — GET /internal/v1/postings?limit=...&cursor=...
   * Liệt kê receipt theo cursor để job đối chiếu bản sao (E03).
   */
  async listPostings(
    limit: number,
    cursor: string | null,
    requestId: string,
  ): Promise<ListPostingsResponse> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    const url = `${this.baseUrl}/internal/v1/postings?${params.toString()}`;

    const response = await this.fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers: this.buildInternalHeaders(requestId),
      },
      requestId,
    );

    if (response.ok) {
      const body = (await response.json()) as any;
      return {
        items: (body.data?.items || []) as PostingReceipt[],
        meta: body.meta as {
          limit: number;
          nextCursor: string | null;
          hasMore: boolean;
        },
      };
    }

    throw new ServiceUnavailableException(
      `Không thể đọc danh sách receipt I04 từ Account Service (status=${response.status})`,
    );
  }

  /**
   * A02 — GET /api/v1/accounts/me (chuyển tiếp Bearer token của CUSTOMER)
   */
  async getMyAccount(
    authorizationHeader: string,
    requestId: string,
  ): Promise<AccountInfo> {
    const url = `${this.baseUrl}/api/v1/accounts/me`;
    const response = await this.fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: authorizationHeader,
          'X-Request-Id': requestId,
        },
      },
      requestId,
    );

    if (response.ok) {
      const body = (await response.json()) as any;
      return body.data as AccountInfo;
    }

    if (response.status === 401) {
      throw new UnauthenticatedException('Token không hợp lệ khi xác minh tài khoản');
    }
    if (response.status === 403) {
      throw new ForbiddenException('Không có quyền truy cập tài khoản');
    }
    if (response.status === 404) {
      throw new ResourceNotFoundException(
        'Người dùng chưa mở tài khoản ngân hàng',
        'ACCOUNT_NOT_FOUND',
      );
    }

    throw new ServiceUnavailableException(
      'Không thể xác minh tài khoản từ Account Service',
    );
  }

  /**
   * A05 — GET /api/v1/admin/accounts/{accountId} (chuyển tiếp Bearer token của ADMIN)
   */
  async getAdminAccountById(
    authorizationHeader: string,
    accountId: string,
    requestId: string,
  ): Promise<AccountInfo> {
    const url = `${this.baseUrl}/api/v1/admin/accounts/${accountId}`;
    const response = await this.fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: authorizationHeader,
          'X-Request-Id': requestId,
        },
      },
      requestId,
    );

    if (response.ok) {
      const body = (await response.json()) as any;
      return body.data as AccountInfo;
    }

    if (response.status === 401) {
      throw new UnauthenticatedException('Token quản trị không hợp lệ');
    }
    if (response.status === 403) {
      throw new ForbiddenException('Không có quyền quản trị tài khoản');
    }
    if (response.status === 404) {
      throw new ResourceNotFoundException(
        'Tài khoản không tồn tại',
        'ACCOUNT_NOT_FOUND',
      );
    }

    throw new ServiceUnavailableException(
      'Không thể xác minh tài khoản từ Account Service',
    );
  }
}
