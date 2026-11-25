import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';

interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  action?: ReactNode;
}

export function FormField({ label, hint, error, action, id, ...input }: FormFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const descriptionId = error || hint ? fieldId + '-description' : undefined;

  return (
    <div className="form-field">
      <label htmlFor={fieldId}>{label}</label>
      <div className="form-input-row">
        <input
          {...input}
          id={fieldId}
          className={action ? 'form-input form-input--with-action' : 'form-input'}
          aria-invalid={error ? true : undefined}
          aria-describedby={descriptionId}
        />
        {action && <div className="form-field-action">{action}</div>}
      </div>
      {descriptionId && (
        <p id={descriptionId} className={error ? 'field-message field-message--error' : 'field-message'}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
