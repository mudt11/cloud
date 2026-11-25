import { useState } from 'react';
import type { FormEvent } from 'react';
import { ChevronDown, LoaderCircle } from 'lucide-react';
import { ApiError } from '../api/client';
import type { RegisterInput } from '../api/contracts';
import { useRetryAfter } from '../api/useRetryAfter';
import { validateUserField } from '../api/user-validation';
import type { UserField } from '../api/user-validation';
import { demoAccounts } from '../mocks/mock-user';
import { FormField } from './FormField';
import { PasswordField } from './PasswordField';
import { RequestNotice } from './RequestNotice';

type FieldErrors = Partial<Record<UserField, string>>;

interface AuthFormProps {
  mode: 'login' | 'register';
  initialEmail?: string;
  submit: (values: RegisterInput) => Promise<void>;
}

const loginFields: UserField[] = ['email', 'password'];
const registrationFields: UserField[] = ['displayName', ...loginFields];

function focusFirstError(form: HTMLFormElement, fields: UserField[], errors: FieldErrors) {
  const first = fields.find((field) => errors[field]);
  if (!first) return;
  const input = form.elements.namedItem(first);
  if (input instanceof HTMLInputElement) window.requestAnimationFrame(() => input.focus());
}

export function AuthForm({ mode, initialEmail = '', submit }: AuthFormProps) {
  const isRegistration = mode === 'register';
  const fields = isRegistration ? registrationFields : loginFields;
  const [values, setValues] = useState({ displayName: '', email: initialEmail, password: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState('');
  const [pending, setPending] = useState(false);
  const retry = useRetryAfter();

  function change(field: UserField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field]) {
      setErrors((current) => ({ ...current, [field]: validateUserField(field, value, mode) }));
    }
    if (problem && !retry.seconds) setProblem('');
  }

  function checkField(field: UserField) {
    setErrors((current) => ({
      ...current,
      [field]: validateUserField(field, values[field], mode) ?? current[field],
    }));
  }

  function useDemoAccount(email: string, password: string) {
    setValues((current) => ({ ...current, email, password }));
    setErrors({});
    if (!retry.seconds) setProblem('');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || retry.seconds) return;

    const form = event.currentTarget;
    const nextErrors: FieldErrors = {};
    for (const field of fields) {
      const message = validateUserField(field, values[field], mode);
      if (message) nextErrors[field] = message;
    }

    setProblem('');
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      focusFirstError(form, fields, nextErrors);
      return;
    }

    setPending(true);
    try {
      await submit(values);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'EMAIL_ALREADY_EXISTS') {
          const duplicate = { email: 'Email này đã được đăng ký.' };
          setErrors(duplicate);
          focusFirstError(form, fields, duplicate);
          return;
        }

        if (error.code === 'VALIDATION_ERROR') {
          const serverErrors: FieldErrors = {};
          for (const field of fields) {
            const issue = error.details.find((detail) => detail.field === field);
            if (issue) serverErrors[field] = issue.message;
          }
          if (Object.keys(serverErrors).length) {
            setErrors(serverErrors);
            focusFirstError(form, fields, serverErrors);
            return;
          }
        }

        if (error.retryAfterSeconds) retry.start(error.retryAfterSeconds);
        setProblem(error.code === 'INVALID_CREDENTIALS' ? 'Email hoặc mật khẩu không đúng.' : error.message);
      } else {
        setProblem('Không thể hoàn tất yêu cầu. Vui lòng thử lại.');
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <form className="identity-form" noValidate onSubmit={handleSubmit} aria-busy={pending}>
        {problem && <RequestNotice tone="error">{problem}</RequestNotice>}
        {isRegistration && (
          <FormField
            label="Tên hiển thị"
            name="displayName"
            autoComplete="name"
            value={values.displayName}
            placeholder="Nguyễn Văn A"
            error={errors.displayName}
            readOnly={pending}
            required
            onChange={(event) => change('displayName', event.target.value)}
            onBlur={() => checkField('displayName')}
          />
        )}
        <FormField
          label="Email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={values.email}
          placeholder="ten@example.test"
          error={errors.email}
          readOnly={pending}
          required
          onChange={(event) => change('email', event.target.value)}
          onBlur={() => checkField('email')}
        />
        <PasswordField
          name="password"
          autoComplete={isRegistration ? 'new-password' : 'current-password'}
          value={values.password}
          hint={isRegistration ? 'Từ 12 đến 128 ký tự.' : undefined}
          error={errors.password}
          readOnly={pending}
          required
          onChange={(event) => change('password', event.target.value)}
          onBlur={() => checkField('password')}
        />
        <button type="submit" className="primary-link form-submit" disabled={pending || retry.seconds > 0}>
          {pending && <LoaderCircle size={18} className="progress-icon" aria-hidden="true" />}
          {pending
            ? isRegistration ? 'Đang tạo tài khoản…' : 'Đang đăng nhập…'
            : retry.seconds ? 'Thử lại sau ' + retry.seconds + ' giây'
            : isRegistration ? 'Tạo tài khoản đăng nhập' : 'Đăng nhập'}
        </button>
      </form>
      {!isRegistration && (
        <details className="demo-access">
          <summary>
            Dùng tài khoản mẫu <ChevronDown size={16} aria-hidden="true" />
          </summary>
          <div className="demo-access-options">
            {demoAccounts.map((account) => (
              <button
                key={account.email}
                type="button"
                className="secondary-button"
                disabled={pending}
                onClick={() => useDemoAccount(account.email, account.password)}
              >
                {account.label}
              </button>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
