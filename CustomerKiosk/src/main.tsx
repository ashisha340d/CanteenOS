import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A tablet on a hall's wifi drops out; refetching when it comes back is the difference
      // between a stale menu and a working one, and there is nobody there to press reload.
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: 2,
    },
  },
});

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    {/* Outermost, so a failure in a provider is still caught: an unattended tablet showing a
        white screen in a public hall is the one failure nobody is present to notice. */}
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
