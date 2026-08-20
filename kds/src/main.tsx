import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LanguageProvider } from './i18n';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      /**
       * Refetching when the screen comes back is right for a display that may have been asleep
       * for an hour — but with no `staleTime` it also fired for every query on every click into
       * the window, which on a board holding five or six queries is a burst of requests for
       * data fetched a second ago. A short default staleness makes the focus refetch mean
       * "you have been away a while" instead of "the mouse moved".
       */
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: 2,
    },
  },
});

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {/* Above <App/>: the language is a device choice, and sign-in, the station chooser and
            the lock screen all render before a station exists. */}
        <LanguageProvider>
          <App />
        </LanguageProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
