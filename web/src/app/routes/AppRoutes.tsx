import { Link, Navigate, Outlet, Route, Routes } from 'react-router';
import { AccountHomePage } from '../../features/accounts/AccountHomePage';
import { LoginPage } from '../../features/auth/LoginPage';
import { ProfilePage } from '../../features/auth/ProfilePage';
import { RegisterPage } from '../../features/auth/RegisterPage';
import { TransferPage } from '../../features/transfers/TransferPage';
import type { UserRole } from '../../shared/api/contracts';
import { destinationForRole, useSession } from '../../shared/session/SessionProvider';
import { PageState } from '../../shared/ui/PageState';
import { PublicLayout } from '../layouts/PublicLayout';
import { WorkspaceLayout } from '../layouts/WorkspaceLayout';

function SignedOutOnly() {
  const { session } = useSession();
  return session ? <Navigate replace to={destinationForRole(session.user.role)} /> : <Outlet />;
}

function RequireRole({ role }: { role: UserRole }) {
  const { session } = useSession();
  if (!session) return <Navigate replace to="/dang-nhap" />;
  if (session.user.role === role) return <Outlet />;

  return (
    <main className="route-fallback">
      <h1>Không đủ quyền truy cập</h1>
      <PageState
        variant="error"
        title="Trang dành cho vai trò khác"
        description="Bạn có thể quay về khu vực dùng cho tài khoản hiện tại."
        action={
          <Link className="primary-link" to={destinationForRole(session.user.role)}>
            Về khu vực của bạn
          </Link>
        }
      />
    </main>
  );
}

function WorkspacePreview({ title, description }: { title: string; description: string }) {
  return (
    <section>
      <h1>{title}</h1>
      <PageState variant="empty" title="Màn hình đang được chuẩn bị" description={description} />
    </section>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<Navigate replace to="/dang-nhap" />} />
        <Route element={<SignedOutOnly />}>
          <Route path="dang-nhap" element={<LoginPage />} />
          <Route path="dang-ky" element={<RegisterPage />} />
        </Route>
        <Route
          path="*"
          element={
            <div className="identity-view">
              <PageState
                variant="error"
                title="Không tìm thấy trang"
                description="Đường dẫn bạn mở hiện không có trên MiniBank."
                action={<Link className="primary-link" to="/dang-nhap">Về trang đăng nhập</Link>}
              />
            </div>
          }
        />
      </Route>

      <Route element={<RequireRole role="CUSTOMER" />}>
        <Route element={<WorkspaceLayout kind="customer" />}>
          <Route path="tong-quan" element={<AccountHomePage />} />
          <Route path="chuyen-tien" element={<TransferPage />} />
          <Route path="ho-so" element={<ProfilePage />} />
        </Route>
      </Route>

      <Route element={<RequireRole role="ADMIN" />}>
        <Route path="quan-tri" element={<WorkspaceLayout kind="admin" />}>
          <Route
            index
            element={<WorkspacePreview
              title="Không gian quản trị"
              description="Khu vực dành cho các chức năng quản lý tài khoản và giao dịch."
            />}
          />
          <Route path="ho-so" element={<ProfilePage />} />
        </Route>
      </Route>
    </Routes>
  );
}
