import { ArrowRightLeft, Landmark, LayoutGrid, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router';
import { useSession } from '../../shared/session/SessionProvider';

type WorkspaceKind = 'customer' | 'admin';

export function WorkspaceLayout({ kind }: { kind: WorkspaceKind }) {
  const { session, signOut } = useSession();
  const isAdmin = kind === 'admin';
  const home = isAdmin ? '/quan-tri' : '/tong-quan';
  const profile = isAdmin ? '/quan-tri/ho-so' : '/ho-so';
  const workspaceTitle = isAdmin ? 'Không gian quản trị' : 'Ngân hàng cá nhân';
  const WorkspaceIcon = isAdmin ? ShieldCheck : LayoutGrid;

  return (
    <div className="workspace">
      <a className="skip-link" href="#main-content">Đến nội dung chính</a>
      <aside className="workspace-sidebar">
        <NavLink to={home} end className="brand-lockup">
          <span className="brand-mark"><Landmark size={22} aria-hidden="true" /></span>
          <span>MiniBank</span>
        </NavLink>
        <nav aria-label="Điều hướng chính" className="workspace-nav">
          <NavLink to={home} end>
            <WorkspaceIcon aria-hidden="true" size={19} />
            <span>{isAdmin ? 'Quản trị' : 'Tổng quan'}</span>
          </NavLink>
          {!isAdmin && (
            <NavLink to="/chuyen-tien">
              <ArrowRightLeft aria-hidden="true" size={19} />
              <span>Chuyển tiền</span>
            </NavLink>
          )}
          <NavLink to={profile}>
            <UserRound aria-hidden="true" size={19} />
            <span>Hồ sơ cá nhân</span>
          </NavLink>
        </nav>
        <button type="button" className="workspace-signout" onClick={signOut}>
          <LogOut aria-hidden="true" size={18} />
          Đăng xuất
        </button>
      </aside>

      <div className="workspace-body">
        <header className="workspace-topbar">
          <p>{workspaceTitle}</p>
          <div className="workspace-topbar-actions">
            <span className="simulation-label">Môi trường mô phỏng</span>
            {session && (
              <Link to={profile} className="workspace-identity">
                <span className="workspace-avatar" aria-hidden="true">
                  {Array.from(session.user.displayName)[0]?.toLocaleUpperCase('vi-VN')}
                </span>
                <span>
                  <strong>{session.user.displayName}</strong>
                  <small>{isAdmin ? 'Quản trị viên' : 'Khách hàng'}</small>
                </span>
              </Link>
            )}
          </div>
        </header>
        <main className="workspace-content" id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
