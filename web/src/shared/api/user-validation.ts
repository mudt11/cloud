export type UserField = 'displayName' | 'email' | 'password';
export type UserOperation = 'register' | 'login' | 'profile';

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeDisplayName(value: string) {
  return value.normalize('NFC').trim();
}

function validEmail(value: string) {
  const email = normalizeEmail(value);
  const parts = email.split('@');
  if (email.length > 254 || parts.length !== 2) return false;

  const [local, domain] = parts;
  const labels = domain.split('.');
  return (
    /^[a-z0-9._%+-]{1,64}$/.test(local)
    && !local.startsWith('.')
    && !local.endsWith('.')
    && !local.includes('..')
    && labels.length >= 2
    && labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  );
}

export function validateUserField(field: UserField, value: string, operation: UserOperation) {
  if (field === 'email') {
    if (!normalizeEmail(value)) return 'Vui lòng nhập email.';
    return validEmail(value) ? undefined : 'Nhập email hợp lệ, ví dụ ten@example.test.';
  }

  if (field === 'displayName') {
    const length = Array.from(normalizeDisplayName(value)).length;
    if (length === 0) return 'Vui lòng nhập tên hiển thị.';
    return length >= 2 && length <= 100 ? undefined : 'Tên hiển thị cần từ 2 đến 100 ký tự.';
  }

  const length = Array.from(value).length;
  if (length === 0) return 'Vui lòng nhập mật khẩu.';
  if (operation === 'register' && (length < 12 || length > 128)) {
    return 'Mật khẩu cần từ 12 đến 128 ký tự.';
  }
  return length <= 128 ? undefined : 'Mật khẩu tối đa 128 ký tự.';
}
