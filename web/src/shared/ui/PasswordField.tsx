import { useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { FormField } from './FormField';

interface PasswordFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  hint?: string;
  error?: string;
}

export function PasswordField(props: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;

  return (
    <FormField
      {...props}
      label="Mật khẩu"
      type={visible ? 'text' : 'password'}
      action={
        <button
          type="button"
          className="icon-button"
          aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
          onClick={() => setVisible(!visible)}
        >
          <Icon size={19} aria-hidden="true" />
        </button>
      }
    />
  );
}
