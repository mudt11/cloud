import { useState } from 'react';
import type { FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import { formatVnd } from '../../shared/format/format-vnd';
import { hasMockSmartPin, isSmartPin } from '../../shared/mocks/mock-smart-pin';
import { RequestNotice } from '../../shared/ui/RequestNotice';
import { SmartPinInput } from '../../shared/ui/SmartPinInput';
import { SmartPinSetup } from '../accounts/SmartPinSetup';
import type { TransferReview } from './transfer-intent';

interface TransferReviewProps {
  data: TransferReview;
  error?: string;
  onEdit: () => void;
  onConfirm: (pin: string) => Promise<boolean>;
}

export function TransferReviewPanel({ data, error, onEdit, onConfirm }: TransferReviewProps) {
  const [pinReady, setPinReady] = useState(() => hasMockSmartPin(data.source.id));
  const [pinJustCreated, setPinJustCreated] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [verifying, setVerifying] = useState(false);

  async function confirmWithPin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (verifying) return;

    const input = event.currentTarget.elements.namedItem('smartPin');
    const focusPin = () => {
      if (input instanceof HTMLInputElement) window.requestAnimationFrame(() => input.focus());
    };
    if (!isSmartPin(pin)) {
      setPinError('Nhập đúng 6 chữ số.');
      focusPin();
      return;
    }

    setVerifying(true);
    setPinError('');
    try {
      const accepted = await onConfirm(pin);
      setPin('');
      if (!accepted) {
        setPinError('Smart-PIN chưa đúng. Vui lòng thử lại.');
        focusPin();
      }
    } catch {
      setPin('');
      setPinError('Chưa kiểm tra được Smart-PIN. Vui lòng thử lại.');
      focusPin();
    } finally {
      setVerifying(false);
    }
  }

  return (
    <section className="transfer-card transfer-review">
      <div className="transfer-card-heading">
        <h2>Kiểm tra thông tin</h2>
        <p>Kiểm tra người nhận, số tiền và nội dung trước khi xác nhận.</p>
      </div>

      <dl className="transfer-details">
        <div><dt>Tài khoản nguồn</dt><dd>{data.source.accountName} · {data.source.accountNumber}</dd></div>
        <div><dt>Người nhận</dt><dd>{data.recipient.accountName}</dd></div>
        <div><dt>Số tài khoản nhận</dt><dd>{data.recipient.accountNumber}</dd></div>
        {data.body.description && <div><dt>Nội dung</dt><dd>{data.body.description}</dd></div>}
        <div><dt>Phí giao dịch</dt><dd>{formatVnd('0')}</dd></div>
        <div className="transfer-amount-row"><dt>Số tiền chuyển</dt><dd>{formatVnd(data.body.amount)}</dd></div>
      </dl>

      {error && <RequestNotice tone="error">{error}</RequestNotice>}

      <section className="transfer-pin" aria-labelledby="transfer-pin-heading">
        <div className="smart-pin-intro">
          <ShieldCheck aria-hidden="true" size={22} />
          <div>
            <h3 id="transfer-pin-heading">{pinReady ? 'Xác nhận bằng Smart-PIN' : 'Thiết lập Smart-PIN'}</h3>
            <p>
              {pinReady
                ? 'Nhập Smart-PIN 6 chữ số của tài khoản nguồn.'
                : 'Tạo Smart-PIN 6 chữ số cho tài khoản nguồn để xác nhận giao dịch.'}
            </p>
          </div>
        </div>
        {pinReady ? (
          <form className="smart-pin-form" noValidate onSubmit={confirmWithPin} aria-busy={verifying}>
            {pinJustCreated && <RequestNotice tone="success">Đã thiết lập Smart-PIN.</RequestNotice>}
            <div className="transfer-pin-input">
              <SmartPinInput
                label="Smart-PIN"
                name="smartPin"
                autoFocus={pinJustCreated}
                value={pin}
                error={pinError}
                readOnly={verifying}
                onChange={(value) => {
                  setPin(value);
                  setPinError('');
                }}
              />
            </div>
            <div className="transfer-actions">
              <button className="secondary-button" type="button" onClick={onEdit} disabled={verifying}>Quay lại</button>
              <button className="primary-link" type="submit" disabled={verifying}>
                {verifying ? 'Đang kiểm tra Smart-PIN…' : 'Xác nhận chuyển tiền'}
              </button>
            </div>
          </form>
        ) : (
          <SmartPinSetup
            accountId={data.source.id}
            onCancel={onEdit}
            cancelLabel="Quay lại"
            onComplete={() => {
              setPinJustCreated(true);
              setPinReady(true);
            }}
          />
        )}
      </section>
    </section>
  );
}
