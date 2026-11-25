import { BrowserRouter } from 'react-router';
import { SessionProvider } from '../shared/session/SessionProvider';
import { AppRoutes } from './routes/AppRoutes';

export function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <AppRoutes />
      </SessionProvider>
    </BrowserRouter>
  );
}
