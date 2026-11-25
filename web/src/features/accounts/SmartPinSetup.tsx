import { useState } from 'react';
import type { FormEvent } from 'react';
import { createMockSmartPin, hasMockSmartPin, isSmartPin } from '../../shared/mocks/mock-smart-pin';
import { RequestNotice } from '../../shared/ui/RequestNotice';
import { SmartPinInput } from '../../shared/ui/SmartPinInput';

interface SmartPinSetupProps {
  accountId: string;
  onComplete: () => void;
  onCancel: () => void;
  cancelLabel?: string;
}

export function SmartPinSetup({ accountId, onComplete, onCancel, cancelLabel = 'Hủy' }: SmartPinSetupProps) {
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pinError, setPinError] = useState('');
  const [confirmationError, setConfirmationError] = useState('');
  const [problem, setProblem] = useState('');
  const [settingUp, setSettingUp] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (settingUp) return;

    const validPin = isSmartPin(pin);
    const matches = pin === confirmation;
    setProblem('');
    setPinError(validPin ? '' : 'Nhập đúng 6 chữ số.');
    setConfirmationError(!validPin || matches ? '' : 'Smart-PIN nhập lại chưa khớp.');

    if (!validPin || !matches) {
      const field = event.currentTarget.elements.namedItem(validPin ? 'pinConfirmation' : 'newPin');
      if (field instanceof HTMLInputElement) window.requestAnimationFrame(() => field.focus());
      return;
    }

    setSettingUp(true);
    try {
      const created = await createMockSmartPin(accountId, pin);
      if (created || hasMockSmartPin(accountId)) {
        setPin('');
        setConfirmation('');
        onComplete();
      } else {
        setProblem('Chưa thiết lập được Smart-PIN. Vui lòng thử lại.');
      }
    } catch {
      setProblem('Chưa thiết lập được Smart-PIN. Vui lòng thử lại.');
    } finally {
      setSettingUp(false);
    }
  }

  return (
    <form className="smart-pin-form" noValidate onSubmit={handleSubmit} aria-busy={settingUp}>
      <div className="smart-pin-fields">
        <SmartPinInput
          label="Smart-PIN mới"
          name="newPin"
          value={pin}
          error={pinError}
          readOnly={settingUp}
          onChange={(value) => {
            setPin(value);
            setPinError('');
            setConfirmationError('');
          }}
        />
        <SmartPinInput
          label="Nhập lại Smart-PIN"
          name="pinConfirmation"
          value={confirmation}
          error={confirmationError}
          readOnly={settingUp}
          onChange={(value) => {
            setConfirmation(value);
            setConfirmationError('');
          }}
        />
      </div>

      {problem && <RequestNotice tone="error">{problem}</RequestNotice>}

      <div className="smart-pin-actions">
        <button className="secondary-button" type="button" onClick={onCancel} disabled={settingUp}>
          {cancelLabel}
        </button>
        <button className="primary-link" type="submit" disabled={settingUp}>
          {settingUp ? 'Đang thiết lập…' : 'Lưu Smart-PIN'}
        </button>
      </div>
    </form>
  );
}
