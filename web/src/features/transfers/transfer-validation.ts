export const accountNumberPattern = /^[0-9]{10}$/;

const groupedAmountPattern = /^[1-9][0-9]{0,2}(?:\.[0-9]{3})+$/;

export function formatTransferAmountInput(digits: string) {
  return digits.replace(/\B(?=(?:[0-9]{3})+(?![0-9]))/g, '.');
}

export function digitsFromPastedAmount(input: string) {
  const amount = input.trim();
  if (/^[0-9]+$/.test(amount)) return amount;
  return groupedAmountPattern.test(amount) ? amount.replaceAll('.', '') : undefined;
}

export function editTransferAmount(previous: string, input: string, selection: number, inputType = '') {
  if (!/^[0-9.]*$/.test(input)) return undefined;

  let digits = input.replaceAll('.', '');
  let digitsBeforeCaret = input.slice(0, selection).replaceAll('.', '').length;
  const removedSeparator = digits === previous && input.length < formatTransferAmountInput(previous).length;
  const deletingBackward = inputType === 'deleteContentBackward';

  if (removedSeparator && (deletingBackward || inputType === 'deleteContentForward')) {
    const digitToRemove = digitsBeforeCaret - (deletingBackward ? 1 : 0);
    if (digitToRemove >= 0 && digitToRemove < digits.length) {
      digits = digits.slice(0, digitToRemove) + digits.slice(digitToRemove + 1);
      digitsBeforeCaret = digitToRemove;
    }
  }

  const amount = digits.replace(/^0+(?=[0-9])/, '');
  const display = formatTransferAmountInput(amount);
  const caretDigit = Math.max(0, digitsBeforeCaret - (digits.length - amount.length));
  let caret = 0;
  let seenDigits = 0;
  while (caret < display.length && seenDigits < caretDigit) {
    if (display[caret] !== '.') seenDigits += 1;
    caret += 1;
  }

  return { amount, display, caret };
}

export function amountExceedsBalance(amount: string, balance: string) {
  return amount.length > balance.length || (amount.length === balance.length && amount > balance);
}

export function normalizeTransferAmount(input: string) {
  const raw = input.trim();
  const amount = groupedAmountPattern.test(raw) ? raw.replaceAll('.', '') : raw;
  if (!/^[1-9][0-9]{0,9}$/.test(amount) || BigInt(amount) > 1_000_000_000n) return undefined;
  return amount;
}

export function normalizeTransferDescription(value: string) {
  return value.normalize('NFC').trim();
}
