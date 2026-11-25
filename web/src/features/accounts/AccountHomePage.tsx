import { useEffect, useEffectEvent, useState } from 'react';
import { ArrowRightLeft, Check, Copy, Landmark, LoaderCircle, ShieldCheck, Wallet, WalletCards } from 'lucide-react';
import { Link } from 'react-router';
import { ApiError } from '../../shared/api/client';
import type { Account } from '../../shared/api/contracts';
import { useRetryAfter } from '../../shared/api/useRetryAfter';
import { formatVnd } from '../../shared/format/format-vnd';
import { hasMockSmartPin } from '../../shared/mocks/mock-smart-pin';
import { useSession } from '../../shared/session/SessionProvider';
import { PageState } from '../../shared/ui/PageState';
import { RequestNotice } from '../../shared/ui/RequestNotice';
import { getMyAccount, openMyAccount } from './account-api';
import { SmartPinSetup } from './SmartPinSetup';

type AccountView =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'ready'; account: Account }
  | { kind: 'error'; message: string };

interface OpeningIssue {
  message: string;
  shouldCheckAccount: boolean;
}

const vietnamDate = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'medium',
  timeZone: 'Asia/Ho_Chi_Minh',
});

function AccountSummary({ account }: { account: Account }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [pinReady, setPinReady] = useState(() => hasMockSmartPin(account.id));
  const [showPinSetup, setShowPinSetup] = useState(false);
  const active = account.status === 'ACTIVE';

  async function copyAccountNumber() {
    try {
      await navigator.clipboard.writeText(account.accountNumber);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  return (
    <div className="account-summary">
      <section className="balance-card" aria-labelledby="balance-heading">
        <div className="balance-card-top">
          <span className="balance-icon"><Wallet aria-hidden="true" size={22} /></span>
          <span className={'account-status account-status--' + (active ? 'active' : 'frozen')}>
            {active ? 'Hoạt động' : 'Bị khóa'}
          </span>
        </div>
        <div>
          <h2 id="balance-heading">Số dư hiện tại</h2>
          <p className="account-balance">{formatVnd(account.balance)}</p>
        </div>
        <dl className="balance-account">
          <div>
            <dt>Số tài khoản</dt>
            <dd className="account-number">{account.accountNumber}</dd>
          </div>
          <div className="account-copy">
            <dt className="visually-hidden">Thao tác với số tài khoản</dt>
            <dd>
              <button
                className="account-copy-button"
                type="button"
                onClick={copyAccountNumber}
                aria-label="Sao chép số tài khoản"
              >
                {copyState === 'copied'
                  ? <Check aria-hidden="true" size={17} />
                  : <Copy aria-hidden="true" size={17} />}
                <span>{copyState === 'copied' ? 'Đã sao chép' : 'Sao chép'}</span>
              </button>
            </dd>
          </div>
        </dl>
        <p className="account-copy-feedback" role="status">
          {copyState === 'copied' && 'Đã sao chép số tài khoản.'}
          {copyState === 'failed' && 'Bạn có thể chọn số tài khoản để sao chép.'}
        </p>
      </section>

      <section className="account-detail-card" aria-labelledby="account-detail-heading">
        <div className="account-detail-heading">
          <Landmark aria-hidden="true" size={21} />
          <h2 id="account-detail-heading">Thông tin tài khoản</h2>
        </div>
        <dl className="account-detail-list">
          <div><dt>Chủ tài khoản</dt><dd>{account.accountName}</dd></div>
          <div><dt>Loại tiền</dt><dd>{account.currency}</dd></div>
          <div>
            <dt>Ngày mở</dt>
            <dd><time dateTime={account.createdAt}>{vietnamDate.format(new Date(account.createdAt))}</time></dd>
          </div>
        </dl>
        <section className="account-pin" aria-labelledby="account-pin-heading">
          <div className="smart-pin-intro">
            <ShieldCheck aria-hidden="true" size={20} />
            <div>
              <h3 id="account-pin-heading">Smart-PIN</h3>
              {pinReady
                ? <p className="smart-pin-ready" role="status">Đã thiết lập cho tài khoản này.</p>
                : <p>Dùng 6 chữ số để xác nhận giao dịch.</p>}
            </div>
          </div>
          {showPinSetup ? (
            <SmartPinSetup
              accountId={account.id}
              onCancel={() => setShowPinSetup(false)}
              onComplete={() => {
                setPinReady(true);
                setShowPinSetup(false);
              }}
            />
          ) : !pinReady && (
            <button type="button" className="secondary-button account-pin-button" onClick={() => setShowPinSetup(true)}>
              Thiết lập Smart-PIN
            </button>
          )}
        </section>
        {active && (
          <Link className="secondary-button account-transfer-link" to="/chuyen-tien">
            <ArrowRightLeft aria-hidden="true" size={18} />
            Chuyển tiền
          </Link>
        )}
      </section>
    </div>
  );
}

export function AccountHomePage() {
  const { session } = useSession();
  const accessToken = session?.accessToken;
  const [view, setView] = useState<AccountView>({ kind: 'loading' });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [opening, setOpening] = useState(false);
  const [openingIssue, setOpeningIssue] = useState<OpeningIssue>();
  const [opened, setOpened] = useState(false);
  const retry = useRetryAfter();

  const rememberReadRateLimit = useEffectEvent((error: ApiError) => {
    if (error.retryAfterSeconds) retry.start(error.retryAfterSeconds);
  });

  useEffect(() => {
    if (!accessToken) return;
    let active = true;

    getMyAccount(accessToken).then(
      (account) => { if (active) setView({ kind: 'ready', account }); },
      (error: unknown) => {
        if (!active) return;

        if (error instanceof ApiError && error.status === 404 && error.code === 'ACCOUNT_NOT_FOUND') {
          setView({ kind: 'missing' });
          return;
        }

        if (error instanceof ApiError) rememberReadRateLimit(error);
        setView({
          kind: 'error',
          message: error instanceof ApiError ? error.message : 'Vui lòng kiểm tra kết nối rồi thử lại.',
        });
      },
    );

    return () => { active = false; };
  }, [accessToken, loadAttempt]);

  function reloadAccount() {
    setOpeningIssue(undefined);
    setView({ kind: 'loading' });
    setLoadAttempt((previous) => previous + 1);
  }

  async function confirmOpening() {
    if (!accessToken || view.kind !== 'missing' || opening || retry.seconds) return;

    setOpening(true);
    setOpeningIssue(undefined);
    try {
      const account = await openMyAccount(accessToken);
      setView({ kind: 'ready', account });
      setOpened(true);
    } catch (error) {
      if (error instanceof ApiError && error.retryAfterSeconds) retry.start(error.retryAfterSeconds);

      if (!(error instanceof ApiError) || error.status >= 500) {
        setOpeningIssue({
          message: 'Chưa nhận được kết quả. Hãy kiểm tra tài khoản trước khi gửi lại yêu cầu.',
          shouldCheckAccount: true,
        });
      } else {
        setOpeningIssue({ message: error.message, shouldCheckAccount: false });
      }
    } finally {
      setOpening(false);
    }
  }

  const retryText = retry.seconds ? 'Thử lại sau ' + retry.seconds + ' giây' : undefined;

  return (
    <section className="account-home">
      <header className="account-home-heading">
        <h1>Tổng quan</h1>
        {session && <p className="page-description">Xin chào, {session.user.displayName}.</p>}
      </header>

      {view.kind === 'loading' && (
        <PageState variant="loading" title="Đang tải thông tin tài khoản" />
      )}
      {view.kind === 'error' && (
        <PageState
          variant="error"
          title="Không tải được tài khoản"
          description={view.message}
          action={<button type="button" className="secondary-button" onClick={reloadAccount} disabled={retry.seconds > 0}>
            {retryText ?? 'Thử lại'}
          </button>}
        />
      )}
      {view.kind === 'missing' && (
        <section className="open-account-card" aria-labelledby="open-account-heading">
          <span className="open-account-icon"><WalletCards size={25} aria-hidden="true" /></span>
          <div className="open-account-intro">
            <h2 id="open-account-heading">Mở tài khoản VND</h2>
            <p>Tạo tài khoản mô phỏng để bắt đầu sử dụng các tính năng ngân hàng của MiniBank.</p>
          </div>

          <dl className="open-account-details">
            <div><dt>Loại tiền</dt><dd>VND</dd></div>
            <div><dt>Số dư ban đầu</dt><dd>{formatVnd('0')}</dd></div>
          </dl>

          {openingIssue && <RequestNotice tone="error">{openingIssue.message}</RequestNotice>}

          {openingIssue?.shouldCheckAccount ? (
            <button className="primary-link" type="button" onClick={reloadAccount} disabled={retry.seconds > 0}>
              {retryText ?? 'Kiểm tra tài khoản'}
            </button>
          ) : (
            <button
              type="button"
              className="primary-link"
              onClick={confirmOpening}
              disabled={opening || retry.seconds > 0}
              aria-busy={opening}
            >
              {opening && <LoaderCircle className="progress-icon" aria-hidden="true" size={18} />}
              {opening ? 'Đang mở tài khoản…' : retryText ?? 'Xác nhận mở tài khoản'}
            </button>
          )}
        </section>
      )}
      {view.kind === 'ready' && (
        <>
          {opened && <RequestNotice tone="success">Tài khoản VND đã sẵn sàng.</RequestNotice>}
          <AccountSummary key={view.account.id} account={view.account} />
        </>
      )}
    </section>
  );
}
