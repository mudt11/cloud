import { Link, useLocation, useNavigate } from 'react-router';
import { destinationForRole, useSession } from '../../shared/session/SessionProvider';
import { AuthForm } from '../../shared/ui/AuthForm';
import { RequestNotice } from '../../shared/ui/RequestNotice';
import { loginUser } from './auth-api';

export function LoginPage() {
  const { expired, signIn } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const registration = location.state as { registeredEmail?: string } | null;
  const registeredEmail = registration?.registeredEmail;

  return (
    <section className="identity-view">
      <h1>Đăng nhập MiniBank</h1>
      <p className="page-description">Xem và quản lý tài khoản VND của bạn.</p>
      {registeredEmail && (
        <RequestNotice tone="success">
          Đã tạo tài khoản đăng nhập. Đăng nhập để mở tài khoản VND.
        </RequestNotice>
      )}
      {expired && <RequestNotice tone="error">Phiên đã hết hạn. Vui lòng đăng nhập lại.</RequestNotice>}
      <AuthForm
        mode="login"
        initialEmail={registeredEmail}
        submit={async ({ email, password }) => {
          const result = await loginUser({ email, password });
          signIn(result);
          navigate(destinationForRole(result.user.role), { replace: true });
        }}
      />
      <p className="identity-footer">Chưa có tài khoản? <Link to="/dang-ky">Đăng ký</Link></p>
    </section>
  );
}
