# Notification Service (`services/notification`)

Phụ trách: **Nguyễn Quốc Dương** (Nhóm 6)  
Hợp đồng áp dụng: **Tài liệu 06 v1.1** (`N01`, `N02`, `H01`, `E01`–`E02`, `C01`–`C05`)

## 1. Tổng quan & Sở hữu dữ liệu
- **Cổng mặc định:** `3004` (DNS nội bộ trong Compose/Cloud: `http://notification:3004`).
- **Database riêng:** `notification_db` (PostgreSQL), bảng `notifications` và `consumer_inbox`.
- **RabbitMQ Consumer (`E01`/`E02`):**
  - Exchange: `bank.events.v1` (`topic`, `durable`), routing key `transfer.posted.v1`.
  - Queue chính: `notification.inbox.v1` (`durable`).
  - Hàng đợi lỗi (DLQ): `notification.inbox.dlq.v1` (`durable`).
  - Trong cùng một transaction DB: chèn `consumer_inbox` (`consumer_name`, `event_id`) và 2 bản ghi thông báo (`OUTGOING` cho `fromUserId`, `INCOMING` cho `toUserId`). Lỗi tạm thời retry sau `5, 15, 30, 60, 120s` (tối đa 6 lần) trước khi vào DLQ.

## 2. Endpoints
| Mã | Method & Path | Quyền | Mô tả |
|---|---|---|---|
| **N01** | `GET /api/v1/notifications` | `CUSTOMER`, `ADMIN` | Danh sách thông báo của chính `sub` (`page`, `pageSize`, `unreadOnly`), trả `meta.unreadCount` và header `X-Total-Count` |
| **N02** | `PATCH /api/v1/notifications/:notificationId/read` | `CUSTOMER`, `ADMIN` | Đánh dấu đã đọc (body `{}`), idempotent; không có hoặc ngoài quyền trả `404 RESOURCE_NOT_FOUND` |
| **H01** | `GET /health/live` | Internal | Liveness probe (HTTP `200`) |
| **H01** | `GET /health/ready` | Internal | Readiness probe (`200` khi `database=UP`, `broker=UP`, `jwtKeys=UP`; thiếu trả `503`) |

Swagger OpenAPI UI (môi trường non-production): `/api/docs`.

## 3. Biến môi trường (`.env.example`)
Không commit `.env` lên Git.

| Biến | Mặc định local | Giá trị Docker Compose / Cloud |
|---|---|---|
| `NODE_ENV` | `development` | `production` |
| `PORT` | `3004` | `3004` |
| `SERVICE_NAME` | `notification` | `notification` |
| `APP_VERSION` | `dev` | Commit SHA ngắn (vd `cb4feba`) |
| `DATABASE_URL` | `postgresql://notification_user:change_me@localhost:5432/notification_db` | `postgresql://notification_user:<secret>@postgres:5432/notification_db` |
| `AMQP_URL` | `amqp://guest:guest@localhost:5672` | `amqp://<user>:<pass>@rabbitmq:5672` |
| `JWT_ISSUER` | `mini-bank-user` | `mini-bank-user` |
| `JWT_AUDIENCE` | `mini-bank-api` | `mini-bank-api` |
| `JWT_JWKS_URL` | `http://localhost:3001/api/v1/auth/jwks` | `http://user:3001/api/v1/auth/jwks` |
| `PUBLIC_ORIGIN` | `http://localhost:8080` | `https://<domain-chinh-thuc>` |

## 4. Build Docker Image & Vận hành (Tuần 6 / Mốc M3)
```bash
# Build image gắn tag commit SHA
SHA=$(git rev-parse --short HEAD)
docker build --build-arg APP_VERSION=$SHA -t mini-bank-notification:$SHA ./services/notification

# Chạy migration trước khi start service
docker run --rm --env-file .env.notification mini-bank-notification:$SHA node dist/database/migrate.js

# Chạy container service (non-root user 'node', port 3004)
docker run -d --name notification --env-file .env.notification -p 3004:3004 mini-bank-notification:$SHA
```

## 5. Phát triển & Kiểm thử local
```bash
npm install
npm run migrate          # Chạy TypeORM migration lên notification_db
npm run start:dev        # Chạy dev mode
npm run build            # Biên dịch TypeScript
npm run lint             # oxlint --type-aware (0 warnings/errors)
npm test                 # Unit tests
npm run test:e2e         # Integration / E2E tests
```
