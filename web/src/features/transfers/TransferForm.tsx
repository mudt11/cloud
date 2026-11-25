import { useId, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, FormEvent } from 'react';
import { CircleCheck, Landmark, Search } from 'lucide-react';
import { ApiError } from '../../shared/api/client';
import type { Account, RecipientLookup } from '../../shared/api/contracts';
import { useRetryAfter } from '../../shared/api/useRetryAfter';
import { formatVnd } from '../../shared/format/format-vnd';
import { FormField } from '../../shared/ui/FormField';
import { RequestNotice } from '../../shared/ui/RequestNotice';
import { lookUpRecipient } from './transfer-api';
import type { TransferReview } from './transfer-intent';
import {
  accountNumberPattern,
  amountExceedsBalance,
  digitsFromPastedAmount,
  editTransferAmount,
  formatTransferAmountInput,
  normalizeTransferAmount,
  normalizeTransferDescription,
} from './transfer-validation';

interface TransferFormProps {
  source: Account;
  accessToken: string;
  previous?: TransferReview;
  onReview: (data: TransferReview) => void;
}

export function TransferForm({ source, accessToken, previous, onReview }: TransferFormProps) {
  const descriptionId = useId();
  const [number, setNumber] = useState(previous?.body.toAccountNumber ?? '');
  const [amount, setAmount] = useState(previous?.body.amount ?? '');
  const [description, setDescription] = useState(previous?.body.description ?? '');
  const [recipient, setRecipient] = useState(previous?.recipient);
  const [numberError, setNumberError] = useState('');
  const [amountError, setAmountError] = useState('');
  const [descriptionError, setDescriptionError] = useState('');
  const [lookupProblem, setLookupProblem] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const lookupVersion = useRef(0);
  const retry = useRetryAfter();
  const descriptionLength = Array.from(normalizeTransferDescription(description)).length;
  const balanceWarning = amountExceedsBalance(amount, source.balance)
    ? 'Số tiền vượt số dư hiện có (' + formatVnd(source.balance) + ').'
    : '';

  function updateAmount(input: HTMLInputElement, value: string, caret: number, inputType?: string) {
    const next = editTransferAmount(amount, value, caret, inputType);
    if (!next) {
      setAmountError('Nhập số tiền nguyên VND, ví dụ 100.000.');
      return;
    }

    setAmount(next.amount);
    setAmountError('');
    window.requestAnimationFrame(() => {
      if (document.activeElement === input && input.value === next.display) {
        input.setSelectionRange(next.caret, next.caret);
      }
    });
  }

  function changeAmount(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    updateAmount(input, input.value, input.selectionStart ?? input.value.length, (event.nativeEvent as InputEvent).inputType);
  }

  function pasteAmount(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const pasted = digitsFromPastedAmount(event.clipboardData.getData('text/plain'));
    if (!pasted) {
      setAmountError('Nhập số tiền nguyên VND, ví dụ 100.000.');
      return;
    }

    const input = event.currentTarget;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const value = input.value.slice(0, start) + pasted + input.value.slice(end);
    updateAmount(input, value, start + pasted.length);
  }

  function validateNumber() {
    if (!accountNumberPattern.test(number)) return 'Nhập đúng 10 chữ số của tài khoản nhận.';
    if (number === source.accountNumber) return 'Chọn tài khoản nhận khác tài khoản nguồn.';
    return '';
  }

  function changeNumber(value: string) {
    lookupVersion.current += 1;
    setNumber(value);
    setRecipient(undefined);
    setNumberError('');
    setLookupProblem('');
    setLookingUp(false);
  }

  async function lookup() {
    if (lookingUp || retry.seconds) return;

    const errorMessage = validateNumber();
    setNumberError(errorMessage);
    setLookupProblem('');
    if (errorMessage) return;

    const started = ++lookupVersion.current;
    setRecipient(undefined);
    setLookingUp(true);
    try {
      const result = await lookUpRecipient(accessToken, number);
      if (started === lookupVersion.current) setRecipient(result);
    } catch (error) {
      if (started !== lookupVersion.current) return;

      if (error instanceof ApiError && error.code === 'RECIPIENT_NOT_FOUND') {
        setNumberError('Không tìm thấy số tài khoản này.');
      } else {
        if (error instanceof ApiError && error.retryAfterSeconds) retry.start(error.retryAfterSeconds);
        setLookupProblem(error instanceof ApiError ? error.message : 'Không xác minh được người nhận. Vui lòng thử lại.');
      }
    } finally {
      if (started === lookupVersion.current) setLookingUp(false);
    }
  }

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lookingUp || balanceWarning || amountError) return;

    const normalizedAmount = normalizeTransferAmount(amount);
    const normalizedDescription = normalizeTransferDescription(description);
    const invalidNumber = validateNumber() || (!recipient ? 'Kiểm tra người nhận trước khi tiếp tục.' : '');
    setNumberError(invalidNumber);
    setAmountError(normalizedAmount ? '' : 'Nhập số tiền nguyên từ 1 đến 1.000.000.000 VND.');
    setDescriptionError(descriptionLength > 140 ? 'Nội dung tối đa 140 ký tự.' : '');

    if (invalidNumber || !recipient || !normalizedAmount || descriptionLength > 140) return;

    onReview({
      source,
      recipient,
      body: {
        fromAccountId: source.id,
        toAccountNumber: recipient.accountNumber,
        amount: normalizedAmount,
        description: normalizedDescription,
      },
    });
  }

  return (
    <section className="transfer-card">
      <div className="transfer-source">
        <span className="transfer-source-icon"><Landmark aria-hidden="true" size={20} /></span>
        <div>
          <span className="transfer-muted">Tài khoản nguồn</span>
          <strong>{source.accountName}</strong>
          <span className="transfer-muted">{source.accountNumber}</span>
        </div>
        <div className="transfer-source-balance">
          <span className="transfer-muted">Số dư hiện tại</span>
          <strong>{formatVnd(source.balance)}</strong>
        </div>
      </div>

      <form className="transfer-form" onSubmit={review} noValidate>
        <div className="transfer-recipient">
          <FormField
            label="Số tài khoản nhận"
            name="toAccountNumber"
            inputMode="numeric"
            autoComplete="off"
            maxLength={10}
            value={number}
            error={numberError}
            placeholder="Nhập 10 chữ số"
            required
            onChange={(event) => changeNumber(event.target.value)}
          />
          <button
            type="button"
            className="secondary-button transfer-lookup-button"
            onClick={lookup}
            disabled={lookingUp || retry.seconds > 0}
          >
            <Search aria-hidden="true" size={17} />
            {lookingUp ? 'Đang kiểm tra…' : retry.seconds ? 'Chờ ' + retry.seconds + ' giây' : 'Kiểm tra'}
          </button>
        </div>

        {lookupProblem && <RequestNotice tone="error">{lookupProblem}</RequestNotice>}
        {recipient && (
          <div className="recipient-verified" role="status">
            <CircleCheck aria-hidden="true" size={19} />
            <span>Đã xác minh: <strong>{recipient.accountName}</strong></span>
          </div>
        )}

        <FormField
          label="Số tiền chuyển (VND)"
          name="amount"
          inputMode="numeric"
          autoComplete="off"
          value={formatTransferAmountInput(amount)}
          error={balanceWarning || amountError}
          placeholder="Ví dụ: 100.000"
          required
          onChange={changeAmount}
          onPaste={pasteAmount}
        />
        <span className="visually-hidden" role="status">{balanceWarning}</span>

        <div className="form-field">
          <label htmlFor={descriptionId}>Nội dung chuyển tiền <span className="transfer-muted">(tùy chọn)</span></label>
          <textarea
            id={descriptionId}
            name="description"
            rows={3}
            className="form-input transfer-description"
            value={description}
            aria-invalid={descriptionError ? true : undefined}
            aria-describedby={descriptionId + '-detail'}
            placeholder="Nhập nội dung"
            onChange={(event) => {
              setDescription(event.target.value);
              setDescriptionError('');
            }}
          />
          <p id={descriptionId + '-detail'} className={descriptionError ? 'field-message field-message--error' : 'field-message'}>
            {descriptionError || descriptionLength + '/140 ký tự'}
          </p>
        </div>

        <button
          type="submit"
          className="primary-link transfer-primary"
          disabled={lookingUp || Boolean(balanceWarning || amountError)}
        >
          Tiếp tục
        </button>
      </form>
    </section>
  );
}
