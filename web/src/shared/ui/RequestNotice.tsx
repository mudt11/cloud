import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react';

export function RequestNotice({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
  const Icon = tone === 'error' ? CircleAlert : CircleCheck;

  return (
    <div className={'request-notice request-notice--' + tone} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon size={19} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}
