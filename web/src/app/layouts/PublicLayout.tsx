import { Landmark } from 'lucide-react';
import { Link, Outlet } from 'react-router';

export function PublicLayout() {
  return (
    <div className="public-layout">
      <aside className="brand-panel" aria-label="Giới thiệu MiniBank">
        <a className="skip-link" href="#main-content">Đến nội dung chính</a>
        <div className="brand-header">
          <Link to="/dang-nhap" className="brand-lockup">
            <span className="brand-mark"><Landmark size={22} aria-hidden="true" /></span>
            <span>MiniBank</span>
          </Link>
          <span className="simulation-label simulation-label--on-dark">Môi trường mô phỏng</span>
        </div>

        <div className="brand-copy">
          <p className="brand-title">
            Ngân hàng số
            <span>Đơn giản mỗi ngày.</span>
          </p>
          <p>Quản lý tài khoản VND và theo dõi giao dịch trong môi trường mô phỏng MiniBank.</p>
        </div>

        <footer className="brand-footer">Đồ án Điện toán đám mây</footer>
      </aside>

      <main className="public-content" id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
