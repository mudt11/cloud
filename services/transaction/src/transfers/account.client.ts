import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TransferContextRequest,
  TransferContextResponse,
  PostingRequest,
  PostingResponse,
  PostingStatusResponse,
} from './dto/account-client.dto';
import {
  ServiceUnavailableException,
  ResourceNotFoundException,
  ForbiddenException,
  ValidationException,
} from '../common/exceptions/app.exception';

/**
 * Client giao tiếp nội bộ với Account Service theo hợp đồng I01, I02, I03
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
  private readonly timeoutMs = 10_000; // 10 giây theo C01

  constructor(private readonly configService: ConfigService) {
    this.baseUrl =
      configService.get<string>('ACCOUNT_BASE_URL') ||
      'http://localhost:3002';
    this.serviceKey =
      configService.get<string>('ACCOUNT_SERVICE_KEY') || '';
  }

  private buildHeaders(requestId: string): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'X-Service-Name': this.serviceName,
      'X-Service-Key': this.serviceKey,
      'X-Request-Id': requestId,
    };
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
    requestId: string,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

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
        `[${requestId}] Account Service network error: ${err.message}`,
      );
      throw new ServiceUnavailableException(
        'Không thể kết nối đến Account Service',
      );
    }
  }

  /**
   * I01 — Lấy thông tin chuyển khoản: xác minh quyền sở hữu tài khoản nguồn
   * và lấy thông tin tài khoản đích theo số tài khoản
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
        headers: this.buildHeaders(requestId),
        body: JSON.stringify(payload),
      },
      requestId,
    );

    if (response.ok) {
      const data = (await response.json()) as any;
      return data.data as TransferContextResponse;
    }

    const errorBody = await response.json().catch(() => ({})) as any;
    const code = errorBody?.error?.code || 'UNKNOWN';
    const message = errorBody?.error?.message || 'Lỗi từ Account Service';

    switch (response.status) {
      case 400:
        throw new ValidationException(message);
      case 403:
        throw new ForbiddenException(
          'Bạn không có quyền thực hiện chuyển tiền từ tài khoản này',
        );
      case 404:
        if (code === 'FROM_ACCOUNT_NOT_FOUND') {
          throw new ResourceNotFoundException(
            'Tài khoản nguồn không tồn tại',
            'FROM_ACCOUNT_NOT_FOUND',
          );
        }
        throw new ResourceNotFoundException(
          'Tài khoản đích không tìm thấy với số tài khoản này',
          'TO_ACCOUNT_NOT_FOUND',
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
   * I02 — Thực hiện ghi tiền nguyên tử (posting)
   * Trả về null nếu timeout (caller nên giữ trạng thái PENDING, trả HTTP 202)
   */
  async createPosting(
    payload: PostingRequest,
    requestId: string,
  ): Promise<PostingResponse | null> {
    const url = `${this.baseUrl}/internal/v1/postings`;
    this.logger.log(
      `[${requestId}] I02 POST ${url} transferId=${payload.transferId}`,
    );

    try {
      const response = await this.fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: this.buildHeaders(requestId),
          body: JSON.stringify(payload),
        },
        requestId,
      );

      if (response.ok) {
        const data = (await response.json()) as any;
        return data.data as PostingResponse;
      }

      const errorBody = await response.json().catch(() => ({})) as any;
      const message = errorBody?.error?.message || 'Lỗi từ Account Service';

      if (response.status === 503) {
        throw new ServiceUnavailableException(message);
      }

      this.logger.error(
        `[${requestId}] I02 unexpected status ${response.status}: ${message}`,
      );
      return null;
    } catch (err: any) {
      if (err instanceof ServiceUnavailableException) throw err;
      // Timeout: giữ PENDING và trả 202
      this.logger.warn(`[${requestId}] I02 timeout — keeping PENDING`);
      return null;
    }
  }

  /**
   * I03 — Polling trạng thái sau khi I02 timeout
   */
  async getPostingStatus(
    transferId: string,
    requestId: string,
  ): Promise<PostingStatusResponse | null> {
    const url = `${this.baseUrl}/internal/v1/postings/${transferId}`;
    this.logger.log(`[${requestId}] I03 GET ${url}`);

    try {
      const response = await this.fetchWithTimeout(
        url,
        {
          method: 'GET',
          headers: this.buildHeaders(requestId),
        },
        requestId,
      );

      if (response.ok) {
        const data = (await response.json()) as any;
        return data.data as PostingStatusResponse;
      }
      if (response.status === 404) {
        return null;
      }

      this.logger.warn(`[${requestId}] I03 status=${response.status}`);
      return null;
    } catch {
      return null;
    }
  }
}
