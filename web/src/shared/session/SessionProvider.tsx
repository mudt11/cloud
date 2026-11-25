import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { sessionEvents } from '../api/client';
import type { LoginData, User, UserRole } from '../api/contracts';

interface Session {
  accessToken: string;
  expiresAt: number;
  user: User;
}

interface SessionContextValue {
  session: Session | null;
  expired: boolean;
  signIn: (data: LoginData) => void;
  signOut: () => void;
  updateUser: (user: User) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function destinationForRole(role: UserRole) {
  return role === 'ADMIN' ? '/quan-tri' : '/tong-quan';
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ session: Session | null; expired: boolean }>({
    session: null,
    expired: false,
  });

  useEffect(() => {
    const currentSession = state.session;
    if (!currentSession) return;

    const expire = () => setState((current) =>
      current.session?.accessToken === currentSession.accessToken
        ? { session: null, expired: true }
        : current,
    );
    const timeout = window.setTimeout(expire, Math.max(0, currentSession.expiresAt - Date.now()));
    const handleUnauthorized = (event: Event) => {
      if ((event as CustomEvent<string>).detail === currentSession.accessToken) expire();
    };
    sessionEvents.addEventListener('expired', handleUnauthorized);

    return () => {
      window.clearTimeout(timeout);
      sessionEvents.removeEventListener('expired', handleUnauthorized);
    };
  }, [state.session?.accessToken, state.session?.expiresAt]);

  const context: SessionContextValue = {
    ...state,
    signIn: ({ accessToken, expiresIn, user }) => setState({
      session: { accessToken, expiresAt: Date.now() + expiresIn * 1_000, user },
      expired: false,
    }),
    signOut: () => setState({ session: null, expired: false }),
    updateUser: (user) => setState((current) =>
      current.session?.user.id === user.id
        ? { ...current, session: { ...current.session, user } }
        : current,
    ),
  };

  return <SessionContext.Provider value={context}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('A MiniBank session requires SessionProvider.');
  return context;
}
