import { useId, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, MouseEvent, SyntheticEvent } from 'react';

const pinLength = 6;
const slots = Array.from({ length: pinLength }, (_, index) => index);

interface SmartPinInputProps {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  autoFocus?: boolean;
  readOnly?: boolean;
}

function digitsOnly(value: string) {
  return value.replace(/[^0-9]/g, '');
}

export function SmartPinInput({
  label, name, value, onChange, error, autoFocus, readOnly,
}: SmartPinInputProps) {
  const inputId = useId();
  const [caret, setCaret] = useState(0);
  const activeSlot = Math.min(caret, value.length, pinLength - 1);
  const errorId = error ? inputId + '-error' : undefined;

  function syncCaret(event: SyntheticEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    setCaret(input.selectionStart ?? input.value.length);
  }

  function selectSlot(event: MouseEvent<HTMLInputElement>) {
    if (event.detail !== 1 || readOnly) return;
    const input = event.currentTarget;
    const bounds = input.getBoundingClientRect();
    if (bounds.width === 0) return;

    const index = Math.max(0, Math.min(pinLength - 1, Math.floor(
      (event.clientX - bounds.left) * pinLength / bounds.width,
    )));
    const start = Math.min(index, value.length);
    input.setSelectionRange(start, Math.min(start + 1, value.length));
    setCaret(start);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const next = digitsOnly(input.value).slice(0, pinLength);
    const selection = input.selectionStart ?? input.value.length;
    setCaret(Math.min(digitsOnly(input.value.slice(0, selection)).length, next.length));
    onChange(next);
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    if (readOnly) return;
    const digits = digitsOnly(event.clipboardData.getData('text/plain'));
    if (!digits) return;

    event.preventDefault();
    const input = event.currentTarget;
    const replaceAll = digits.length >= pinLength;
    const start = replaceAll ? 0 : input.selectionStart ?? value.length;
    const end = replaceAll ? value.length : input.selectionEnd ?? start;
    const limit = pinLength - (value.length - (end - start));
    const inserted = digits.slice(0, limit);
    const cursor = start + inserted.length;

    onChange(value.slice(0, start) + inserted + value.slice(end));
    setCaret(cursor);
    window.requestAnimationFrame(() => {
      if (document.activeElement === input) input.setSelectionRange(cursor, cursor);
    });
  }

  return (
    <div className="form-field smart-pin-field">
      <label htmlFor={inputId}>{label}</label>
      <div className="smart-pin-control" data-invalid={error ? 'true' : undefined}>
        <input
          className="smart-pin-native"
          id={inputId}
          name={name}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus={autoFocus}
          maxLength={pinLength}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          readOnly={readOnly}
          required
          onFocus={syncCaret}
          onSelect={syncCaret}
          onClick={selectSlot}
          onChange={handleChange}
          onPaste={handlePaste}
        />
        <div className="smart-pin-slots" aria-hidden="true">
          {slots.map((index) => (
            <span
              className="smart-pin-slot"
              key={index}
              data-current={activeSlot === index ? 'true' : undefined}
              data-filled={index < value.length ? 'true' : undefined}
            />
          ))}
        </div>
      </div>
      {error && <p id={errorId} className="field-message field-message--error">{error}</p>}
    </div>
  );
}
