# Transaction Service (`services/transaction`)

Phụ trách: **Nguyễn Quốc Dương** (Nhóm 6)  
Hợp đồng áp dụng: **Tài liệu 06 v1.1** (`T01`–`T05`, `I01`–`I04`, `H01`, `E01`–`E03`, `C01`–`C05`)

## 1. Tổng quan & Sở hữu dữ liệu
- **Cổng mặc định:** `3003` (DNS nội bộ trong Compose/Cloud: `http://transaction:3003`).
- **Database riêng:** `transaction_db` (PostgreSQL), bảng `transfers` và `consumer_inbox`. Không truy cập trực tiếp DB của `user_db` hay `account_db`.
- **Giao tiếp nội bộ sang Account:** gọi `ACCOUNT_BASE_URL/internal/v1/...` kèm header `X-Service-Name: transaction` và `X-Service-Key: <ACCOUNT_SERVICE_KEY>`.
- **RabbitMQ Consumer (`E01`/`E02`):** lắng nghe exchange `bank.events.v1` (topic, durable), routing key `transfer.posted.v1`, queue `transaction.projection.v1`, DLQ `transaction.projection.dlq.v1`.

## 2. Endpoints
| Mã | Method & Path | Quyền | Mô tả |
|---|---|---|---|
| **T01** | `POST /api/v1/transfers` | `CUSTOMER` | Tạo / replay lệnh chuyển tiền (bắt buộc header `Idempotency-Key`, giới hạn `30 req/60s` theo `sub`) |
| **T02** | `GET /api/v1/transfers` | `CUSTOMER`, `ADMIN` | Danh sách lịch sử giao dịch, lọc ngày VN (`Asia/Ho_Chi_Minh`), status, accountId, direction |
| **T03** | `GET /api/v1/transfers/:transferId` | `CUSTOMER`, `ADMIN` | Tra cứu chi tiết & trạng thái giao dịch (ngoài quyền trả `404 RESOURCE_NOT_FOUND`) |
| **T04** | `GET /api/v1/reports/summary` | `CUSTOMER`, `ADMIN` | Báo cáo tổng hợp giao dịch `SUCCEEDED` theo `committedAt` |
| **T05** | `GET /api/v1/reports/export` | `CUSTOMER`, `ADMIN` | Xuất CSV UTF-8 BOM (CRLF, tối đa 10.000 dòng, chống CSV formula injection, `5 req/60s`) |
| **H01** | `GET /health/live` | Internal | Liveness probe (HTTP `200`, không phụ thuộc DB/broker) |
| **H01** | `GET /health/ready` | Internal | Readiness probe (`200` khi `database=UP` & `jwtKeys=UP`, `503` khi thiếu) |

Swagger OpenAPI UI (môi trường non-production): `/api/docs`.

## 3. Biến môi trường (`.env.example`)
Không commit `.env` lên Git. Trên Docker Compose dùng tên container nội bộ (`postgres`, `rabbitmq`, `user`, `account`).

| Biến | Mặc định local | Giá trị Docker Compose / Cloud |
|---|---|---|
| `NODE_ENV` | `development` | `production` |
| `PORT` | `3003` | `3003` |
| `SERVICE_NAME` | `transaction` | `transaction` |
| `APP_VERSION` | `dev` | Commit SHA ngắn (vd `cb4feba`) |
| `DATABASE_URL` | `postgresql://transaction_user:change_me@localhost:5432/transaction_db` | `postgresql://transaction_user:<secret>@postgres:5432/transaction_db` |
| `AMQP_URL` | `amqp://guest:guest@localhost:5672` | `amqp://<user>:<pass>@rabbitmq:5672` |
| `JWT_ISSUER` | `mini-bank-user` | `mini-bank-user` |
| `JWT_AUDIENCE` | `mini-bank-api` | `mini-bank-api` |
| `JWT_JWKS_URL` | `http://localhost:3001/api/v1/auth/jwks` | `http://user:3001/api/v1/auth/jwks` |
| `ACCOUNT_BASE_URL` | `http://localhost:3002` | `http://account:3002` |
| `ACCOUNT_SERVICE_KEY` | `change_me_internal_secret` | Secret chung khớp với `TRANSACTION_SERVICE_KEY` bên Account |
| `PUBLIC_ORIGIN` | `http://localhost:8080` | `https://<domain-chinh-thuc>` |

## 4. Build Docker Image & Vận hành (Tuần 6 / Mốc M3)
```bash
# Build image gắn tag commit SHA
SHA=$(git rev-parse --short HEAD)
docker build --build-arg APP_VERSION=$SHA -t mini-bank-transaction:$SHA ./services/transaction

# Chạy migration trước khi start service (production image không cần devDependencies)
docker run --rm --env-file .env.transaction mini-bank-transaction:$SHA node dist/database/migrate.js

# Chạy container service (non-root user 'node', port 3003)
docker run -d --name transaction --env-file .env.transaction -p 3003:3003 mini-bank-transaction:$SHA
```

### Worker & Đối chiếu E03
- **TransferRetryWorker:** tự động quét `PENDING` quá hạn `lease_until`, gọi `I03` (nếu 404 thì gửi lại `I02`), backoff `1, 2, 4, 8, 16, 30s` có jitter; cảnh báo `PENDING_OVERDUE_5M` nếu quá 5 phút.
- **TransferReconcileWorker:** tự động full scan `I04 GET /internal/v1/postings` mỗi 15 phút.
- **Chạy đối chiếu thủ công trước nghiệm thu hoặc sau phục hồi DB:**
  ```bash
  npm run reconcile        # Dev (ts-node)
  npm run reconcile:prod   # Trong container production (node dist/transfers/reconcile.cli.js)
  ```

## 5. Phát triển & Kiểm thử local
```bash
npm install
npm run migrate          # Chạy TypeORM migration lên transaction_db
npm run start:dev        # Chạy dev mode
npm run build            # Biên dịch TypeScript
npm run lint             # oxlint --type-aware (0 warnings/errors)
npm test                 # Unit tests
npm run test:e2e         # Integration / E2E tests
```
