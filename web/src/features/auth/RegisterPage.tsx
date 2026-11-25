import { Link, useNavigate } from 'react-router';
import { AuthForm } from '../../shared/ui/AuthForm';
import { registerUser } from './auth-api';

export function RegisterPage() {
  const navigate = useNavigate();

  return (
    <section className="identity-view">
      <h1>Tạo tài khoản đăng nhập</h1>
      <p className="page-description">
        Sau khi đăng nhập, bạn có thể mở tài khoản VND mô phỏng.
      </p>
      <AuthForm
        mode="register"
        submit={async (input) => {
          const user = await registerUser(input);
          navigate('/dang-nhap', { replace: true, state: { registeredEmail: user.email } });
        }}
      />
      <p className="identity-footer">Đã có tài khoản? <Link to="/dang-nhap">Đăng nhập</Link></p>
    </section>
  );
}
