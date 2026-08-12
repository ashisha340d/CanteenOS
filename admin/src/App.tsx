import { BrowserRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { RootErrorBoundary } from './components/ErrorBoundary';
import { AppRoutes } from './routes';
import { AuthProvider } from './services/AuthContext';
import { ThemeProvider } from './theme/ThemeProvider';

export function App(): JSX.Element {
  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={350}>
        <BrowserRouter>
          <RootErrorBoundary>
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          </RootErrorBoundary>
        </BrowserRouter>
        {/* Bottom-centre on mobile keeps toasts clear of the thumb bar and the sticky
            header; top-right is the desktop convention. */}
        <Toaster position="bottom-center" className="md:hidden" richColors closeButton />
        <Toaster position="top-right" className="max-md:hidden" richColors closeButton />
      </TooltipProvider>
    </ThemeProvider>
  );
}
