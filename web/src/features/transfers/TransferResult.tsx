import { Check, CircleAlert, Clock, LoaderCircle } from 'lucide-react';
import { Link } from 'react-router';
import { formatVnd } from '../../shared/format/format-vnd';
import { RequestNotice } from '../../shared/ui/RequestNotice';
import type { TransferIntent } from './transfer-intent';

interface TransferResultProps {
  intent: TransferIntent;
  sending: boolean;
  retrySeconds: number;
  checking: boolean;
  automaticCheckEnded: boolean;
  problem?: string;
  onRetry: () => void;
  onCheck: () => void;
  onNewTransfer: () => void;
}

const rejectedMessages: Record<string, string> = {
  INSUFFICIENT_FUNDS: 'Số dư tài khoản nguồn không đủ để thực hiện giao dịch.',
  ACCOUNT_FROZEN: 'Tài khoản nguồn hoặc tài khoản nhận đang bị khóa.',
  ACCOUNT_NOT_FOUND: 'Tài khoản nguồn hoặc tài khoản nhận không còn khả dụng.',
};

export function TransferResult({
  intent, sending, retrySeconds, checking, automaticCheckEnded, problem, onRetry, onCheck, onNewTransfer,
}: TransferResultProps) {
  const transfer = intent.transfer;
  const status = transfer?.status;
  const finished = status === 'SUCCEEDED' || status === 'REJECTED';
  const Icon = status === 'SUCCEEDED' ? Check : status === 'REJECTED' ? CircleAlert : sending ? LoaderCircle : Clock;
  const presentation = status === 'SUCCEEDED'
    ? { title: 'Chuyển tiền thành công', tone: 'success', caption: 'Giao dịch nội bộ đã hoàn tất.' }
    : status === 'REJECTED'
    ? {
        title: 'Giao dịch bị từ chối',
        tone: 'error',
        caption: rejectedMessages[transfer?.reasonCode ?? ''] ?? 'MiniBank đã từ chối giao dịch này.',
      }
    : status === 'PENDING'
    ? {
        title: 'Giao dịch đang xử lý',
        tone: 'pending',
        caption: automaticCheckEnded
          ? 'Giao dịch vẫn đang xử lý. Bạn có thể quay lại đây để kiểm tra trạng thái.'
          : 'MiniBank đang kiểm tra trạng thái giao dịch. Yêu cầu đã được ghi nhận.',
      }
    : sending
    ? { title: 'Đang gửi yêu cầu', tone: 'pending', caption: 'MiniBank đang tiếp nhận thông tin chuyển tiền.' }
    : { title: 'Chưa xác định kết quả', tone: 'pending', caption: 'Kiểm tra lại yêu cầu đã gửi để tìm kết quả.' };

  const retryLabel = retrySeconds ? 'Thử lại sau ' + retrySeconds + ' giây' : undefined;

  return (
    <section className="transfer-card transfer-result">
      <div className="transfer-result-heading" role="status">
        <span className={'transfer-result-icon transfer-result-icon--' + presentation.tone}>
          <Icon className={sending ? 'progress-icon' : undefined} aria-hidden="true" size={26} />
        </span>
        <h2>{presentation.title}</h2>
        <p>{presentation.caption}</p>
      </div>

      <dl className="transfer-details">
        <div><dt>Người nhận</dt><dd>{intent.recipient.accountName}</dd></div>
        <div><dt>Số tài khoản nhận</dt><dd>{intent.body.toAccountNumber}</dd></div>
        <div><dt>Số tiền chuyển</dt><dd className="transfer-result-amount">{formatVnd(intent.body.amount)}</dd></div>
        {transfer && <div><dt>Mã giao dịch</dt><dd className="transfer-reference">{transfer.id}</dd></div>}
      </dl>

      {problem && <RequestNotice tone="error">{problem}</RequestNotice>}
      {finished ? (
        <div className="transfer-actions">
          <Link className="secondary-button" to="/tong-quan">Về Tổng quan</Link>
          <button type="button" className="primary-link" onClick={onNewTransfer}>Chuyển tiền mới</button>
        </div>
      ) : status === 'PENDING' ? (
        <div className="transfer-actions">
          {automaticCheckEnded && <Link className="secondary-button" to="/tong-quan">Về Tổng quan</Link>}
          <button type="button" className="secondary-button" onClick={onCheck} disabled={checking || retrySeconds > 0}>
            {checking ? 'Đang kiểm tra…' : retryLabel ?? 'Kiểm tra trạng thái'}
          </button>
        </div>
      ) : !sending && (
        <div className="transfer-actions">
          <button type="button" className="primary-link" onClick={onRetry} disabled={retrySeconds > 0}>
            {retryLabel ?? 'Kiểm tra lại yêu cầu'}
          </button>
        </div>
      )}
    </section>
  );
}
