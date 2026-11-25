import type { ReactNode } from 'react';
import { CircleAlert, Inbox, LoaderCircle } from 'lucide-react';

const stateIcons = {
  loading: LoaderCircle,
  empty: Inbox,
  error: CircleAlert,
} as const;

interface PageStateProps {
  variant: keyof typeof stateIcons;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function PageState({ variant, title, description, action }: PageStateProps) {
  const Icon = stateIcons[variant];

  return (
    <div className={'state-panel state-panel--' + variant} aria-busy={variant === 'loading'}>
      <span className="state-icon">
        <Icon size={21} aria-hidden="true" />
      </span>
      <div className="state-copy" role={variant === 'error' ? 'alert' : 'status'}>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="state-action">{action}</div>}
    </div>
  );
}
