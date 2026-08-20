import { useCallback, useEffect, useState } from 'react';
import { restoreSession, setSessionLostHandler, type SessionOutcome } from './api/client';
import { clearSession, isLocked, setLocked } from './api/session';
import { readStation, type StationSelection } from './config/station';
import { disconnectSocket } from './socket';
import { LoginPage } from './pages/LoginPage';
import { StationPage } from './pages/StationPage';
import { BoardPage } from './pages/BoardPage';
import { CdsPage } from './pages/CdsPage';
import { LockScreen } from './components/LockScreen';
import { useT } from './i18n';

const RECONNECT_AFTER_MS = 5_000;

export function App(): JSX.Element {
  const t = useT();
  const [session, setSession] = useState<SessionOutcome | 'checking'>('checking');
  const [station, setStation] = useState<StationSelection | null>(readStation);
  const [locked, setLockedState] = useState<boolean>(isLocked);

  const bootstrap = useCallback(async (): Promise<void> => {
    setSession(await restoreSession());
  }, []);

  useEffect(() => {
    setSessionLostHandler(() => setSession('signed-out'));
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (session !== 'unreachable') return;
    const timer = window.setTimeout(() => void bootstrap(), RECONNECT_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [session, bootstrap]);

  const signOut = useCallback((): void => {
    disconnectSocket();
    clearSession();
    setLockedState(false);
    setSession('signed-out');
  }, []);

  const lock = useCallback((): void => {
    setLocked(true);
    setLockedState(true);
  }, []);

  const unlock = useCallback((): void => {
    setLocked(false);
    setLockedState(false);
  }, []);

  if (session === 'checking') {
    return (
      <div className="flex min-h-full items-center justify-center bg-canvas">
        <p className="text-lg text-ink-soft">{t.starting}</p>
      </div>
    );
  }

  if (session === 'unreachable') {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-3 bg-canvas">
        <p className="text-xl">{t.cannotReach}</p>
        <p className="text-base text-ink-soft">{t.retryingSoon}</p>
      </div>
    );
  }

  if (session === 'signed-out') {
    return (
      <LoginPage
        onLoggedIn={() => {
          // A full sign-in is also an unlock — never land on the lock screen right after.
          unlock();
          setSession('ready');
        }}
      />
    );
  }

  if (locked) {
    return <LockScreen onUnlock={unlock} onSignOut={signOut} />;
  }

  if (station === null) {
    return <StationPage onSelect={setStation} onSignOut={signOut} />;
  }

  if (station.mode === 'cds') {
    return <CdsPage station={station} onChangeStation={() => setStation(null)} onSignOut={signOut} />;
  }

  return (
    <BoardPage
      station={station}
      onChangeStation={() => setStation(null)}
      onSignOut={signOut}
      onLock={lock}
    />
  );
}
