import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  KioskLanguageMode,
  KioskRecommendationMode,
  KioskSkin,
  type BillingIdentity,
  type KioskProfileDto,
  type PosOrderDetailDto,
} from '@menuboard/shared';
import { fetchKioskProfile, fetchMenuTree } from './api/kiosk';
import { restoreSession, setSessionLostHandler, type SessionOutcome } from './api/client';
import { hasSession } from './api/session';
import {
  IDLE_RESET_AFTER_MS,
  PROFILE_POLL_MS,
  readDeviceBinding,
  type KioskDeviceBinding,
} from './config/device';
import { LanguageProvider, useLanguage } from './i18n';
import { CartProvider, useCart } from './state/cart';
import { useWakeLock } from './lib/wakeLock';
import { pendingNudge, type NudgeKind } from './lib/nudge';
import { ActionLabel } from './components/Buttons';
import { FlyToCartProvider } from './components/FlyToCart';
import { Greeting } from './components/Greeting';
import { Header } from './components/Header';
import { NudgeSheet } from './components/NudgeSheet';
import { Sheet } from './components/Sheet';
import { Loading, Notice } from './components/States';
import { CartScreen } from './screens/CartScreen';
import { DoneScreen } from './screens/DoneScreen';
import { MenuScreen } from './screens/MenuScreen';
import { PaymentScreen, type KioskDraft } from './screens/PaymentScreen';
import { SetupScreen } from './screens/SetupScreen';

/** Until the organisation's own profile arrives, show both languages and the default skin. */
const FALLBACK_LANGUAGE = KioskLanguageMode.BOTH;

/**
 * What the kiosk assumes when it cannot reach its own profile.
 *
 * This is not decoration. A guest can pay while the profile request is failing, and the done
 * screen — token, bill, printer — must still exist for them; refusing to render it until a
 * settings fetch succeeds would take money and show a blank screen. The conservative values
 * are the point: the two capability flags are off, so the kiosk offers nothing it cannot
 * deliver, and the bill falls back to naming the stand rather than inventing a registration.
 */
const FALLBACK_PROFILE: KioskProfileDto = {
  skin: KioskSkin.SANDALWOOD,
  languageMode: FALLBACK_LANGUAGE,
  organisationName: '',
  legalName: '',
  addressLine: '',
  gstin: '',
  receiptFooter: '',
  whatsappBillEnabled: false,
  networkPrinterConfigured: false,
  receiptColumns: 48,
  idlePromptSeconds: 75,
  recommendations: KioskRecommendationMode.OFF,
  greeting: '',
  greetingHi: '',
  device: null,
  updatedAt: new Date(0).toISOString(),
};

/** How long to wait before trying the counter system again after it could not be reached. */
const RECONNECT_AFTER_MS = 5_000;

/**
 * The kiosk shell: session, stand, skin, language, and the four-stage loop inside them.
 *
 * The tablet's whole local state is a kiosk code. Everything that used to sit beside it in
 * local storage — the menu, the payee, the display name, the printer route — now arrives with
 * the profile, which means an operator at a desk can re-point a stand at a festival menu and
 * see it happen in the hall inside a minute.
 */
export function App(): JSX.Element {
  const queryClient = useQueryClient();
  const [binding, setBinding] = useState<KioskDeviceBinding | null>(readDeviceBinding);
  const [session, setSession] = useState<SessionOutcome | 'checking'>('checking');
  const [reconfiguring, setReconfiguring] = useState(false);

  useWakeLock();

  const bootstrap = useCallback(async (): Promise<void> => {
    setSession(await restoreSession());
  }, []);

  useEffect(() => {
    setSessionLostHandler(() => setSession('signed-out'));
    void bootstrap();
  }, [bootstrap]);

  /**
   * A hall's kiosk boots when somebody unlocks the door, often before the counter's server
   * and the access point have settled. That first failure is not a rejected session and must
   * not drop an unattended tablet onto a staff password prompt — it retries, quietly, until
   * the counter answers.
   */
  useEffect(() => {
    if (session !== 'unreachable') return;
    const timer = window.setTimeout(() => void bootstrap(), RECONNECT_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [session, bootstrap]);

  const profile = useQuery({
    queryKey: ['kiosk-profile', binding?.code ?? null],
    queryFn: () => fetchKioskProfile(binding?.code ?? null),
    enabled: session === 'ready',
    staleTime: 30_000,
    // Polled so that a skin, a language or a change of menu chosen in the Admin Portal reaches
    // every stand in the hall without anybody walking round with a tablet in their hands.
    refetchInterval: PROFILE_POLL_MS,
    retry: 3,
  });

  // Stamped on the document rather than passed down, because the tokens the whole tree reads
  // are CSS variables and a skin is a change of variables, not a change of components.
  useEffect(() => {
    document.documentElement.dataset.skin = profile.data?.skin ?? KioskSkin.SANDALWOOD;
  }, [profile.data?.skin]);

  const device = profile.data?.device ?? null;

  useEffect(() => {
    document.title = device === null ? 'Self-Service Ordering' : device.outletName;
  }, [device]);

  /**
   * A code the registry no longer answers to sends the tablet back to the picker.
   *
   * This is the one piece of self-healing the kiosk does. An operator who deletes or
   * deactivates a stand has, in effect, told the hall to stop selling from it — the tablet
   * obeying that without anybody walking over is the whole point of the registry. The profile
   * fetch must have actually succeeded first: a request that failed says nothing about whether
   * the stand still exists, and treating it as an answer would strand a working kiosk on a
   * staff password prompt every time the wifi dropped.
   */
  const unbound = profile.isSuccess && binding !== null && profile.data.device === null;
  useEffect(() => {
    if (unbound) setReconfiguring(true);
  }, [unbound]);

  const settings = profile.data ?? FALLBACK_PROFILE;
  const provisioned = binding !== null && device !== null;

  return (
    <LanguageProvider defaultMode={profile.data?.languageMode ?? FALLBACK_LANGUAGE}>
      <CartProvider>
        {!provisioned || session !== 'ready' || reconfiguring ? (
          <div id="kiosk-app" className="min-h-full">
            {session === 'checking' || session === 'unreachable' ? (
              <Booting
                unreachable={session === 'unreachable'}
                onRetry={() => void bootstrap()}
                greeting={settings}
              />
            ) : (
              <SetupScreen
                existing={binding}
                requireSignIn={reconfiguring}
                profile={profile.data ?? null}
                onReady={(next) => {
                  setBinding(next);
                  setSession(hasSession() ? 'ready' : 'signed-out');
                  setReconfiguring(false);
                  void queryClient.invalidateQueries();
                }}
                {...(reconfiguring && binding !== null && !unbound
                  ? { onCancel: () => setReconfiguring(false) }
                  : {})}
              />
            )}
          </div>
        ) : (
          <FlyToCartProvider>
            <KioskFlow
              profile={settings}
              onReconfigure={() => setReconfiguring(true)}
            />
          </FlyToCartProvider>
        )}
      </CartProvider>
    </LanguageProvider>
  );
}

/**
 * Start-up, and the one state a guest may meet where nothing is wrong with their order.
 *
 * The greeting is here rather than only on the menu because this is the longest a guest ever
 * waits at a kiosk — a cold tablet reaching a server that is still coming up — and "Loading" in
 * an empty room is the worst possible thing to be reading while you do.
 */
function Booting({
  unreachable,
  onRetry,
  greeting,
}: {
  unreachable: boolean;
  onRetry: () => void;
  greeting: KioskProfileDto;
}): JSX.Element {
  if (unreachable) return <Notice title="error.generic" body="error.offline" onRetry={onRetry} />;

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-8 bg-canvas px-8">
      <Greeting greeting={greeting.greeting} greetingHi={greeting.greetingHi} size={128} />
      <Loading k="menu.loading" />
    </div>
  );
}

interface KioskFlowProps {
  profile: KioskProfileDto;
  onReconfigure: () => void;
}

type Stage = 'menu' | 'cart' | 'pay' | 'done';

/**
 * The kiosk, as a four-stage loop that always returns to the menu.
 *
 * There is no router: a guest has no address bar, no back button and no bookmarks, and giving
 * the flow URLs would only let a stray reload strand somebody halfway through a payment. The
 * stages are held in state and every exit leads back to a clean menu for the next person.
 */
function KioskFlow({ profile, onReconfigure }: KioskFlowProps): JSX.Element {
  const { pick, resetMode } = useLanguage();
  const { lines, dispatch, count } = useCart();

  // Guarded by `provisioned` in `App`, which does not render this component until the profile
  // has resolved a stand. Narrowing here rather than threading a second prop keeps the flow
  // reading from one object.
  const device = profile.device;
  if (device === null) throw new Error('KioskFlow rendered without a resolved stand');

  const [stage, setStage] = useState<Stage>('menu');
  const [settled, setSettled] = useState<PosOrderDetailDto | null>(null);
  const [draft, setDraft] = useState<KioskDraft | null>(null);
  const [nudge, setNudge] = useState<NudgeKind | null>(null);
  const [declined, setDeclined] = useState<NudgeKind[]>([]);

  const menu = useQuery({
    queryKey: ['menu-tree', device.menuCode],
    queryFn: () => fetchMenuTree(device.menuCode),
    // Media URLs are signed and time-limited, and the hall's menu changes during the day, so
    // the tree is refreshed on a timer rather than held for the life of the page.
    staleTime: 2 * 60_000,
    refetchInterval: 5 * 60_000,
    retry: 2,
  });

  const resetToMenu = useCallback(() => {
    dispatch({ type: 'clear' });
    setDeclined([]);
    setNudge(null);
    setSettled(null);
    setDraft(null);
    setStage('menu');
    // The next guest meets the organisation's language, not the last guest's choice.
    resetMode();
  }, [dispatch, resetMode]);

  /* ---------------------------------------------------------- idle & reset */

  const idleAfterMs = profile.idlePromptSeconds * 1000;
  const [idlePrompt, setIdlePrompt] = useState(false);
  const [idleSeconds, setIdleSeconds] = useState(Math.round(IDLE_RESET_AFTER_MS / 1000));
  const lastTouch = useRef(Date.now());

  useEffect(() => {
    const mark = (): void => {
      lastTouch.current = Date.now();
      setIdlePrompt((current) => (current ? false : current));
    };
    for (const event of ['pointerdown', 'keydown', 'wheel'] as const) {
      window.addEventListener(event, mark, { passive: true });
    }
    return () => {
      for (const event of ['pointerdown', 'keydown', 'wheel'] as const) {
        window.removeEventListener(event, mark);
      }
    };
  }, []);

  // An abandoned order is the kiosk's most common failure: someone walks off mid-choice and
  // the next guest inherits their cart. The prompt is only ever raised when there is something
  // to lose, and never over a payment or a printed bill.
  useEffect(() => {
    if (count === 0 || stage === 'pay' || stage === 'done') {
      setIdlePrompt(false);
      return;
    }
    const timer = window.setInterval(() => {
      if (Date.now() - lastTouch.current > idleAfterMs) setIdlePrompt(true);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [count, stage, idleAfterMs]);

  useEffect(() => {
    if (!idlePrompt) {
      setIdleSeconds(Math.round(IDLE_RESET_AFTER_MS / 1000));
      return;
    }
    const tick = window.setInterval(() => setIdleSeconds((value) => value - 1), 1000);
    const reset = window.setTimeout(() => {
      setIdlePrompt(false);
      resetToMenu();
    }, IDLE_RESET_AFTER_MS);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(reset);
    };
  }, [idlePrompt, resetToMenu]);

  /* --------------------------------------------------------------- the loop */

  const requestPayment = (): void => {
    const kind =
      menu.data === undefined
        ? null
        : pendingNudge(menu.data, lines, declined, profile.recommendations);
    if (kind !== null) {
      setNudge(kind);
      return;
    }
    setStage('pay');
  };

  const dismissNudge = (): void => {
    if (nudge !== null) setDeclined((current) => [...current, nudge]);
    setNudge(null);
    setStage('pay');
  };

  const identity: BillingIdentity = {
    legalName: profile.legalName === '' ? device.outletName : profile.legalName,
    addressLine: profile.addressLine,
    gstin: profile.gstin,
    footer: profile.receiptFooter,
  };

  return (
    <div id="kiosk-app" className="flex h-full flex-col bg-canvas">
      <Header
        outletName={pick(device.outletName, device.outletNameHi)}
        outletNameHi={device.outletNameHi}
        onSettings={onReconfigure}
        compact={stage !== 'menu'}
      />

      {menu.data === undefined ? (
        // Error and loading are alternatives, never neighbours. Rendering both left a red
        // banner sitting above a perfectly usable menu whenever a background refetch failed.
        menu.isError ? (
          <Notice title="error.generic" body="error.offline" onRetry={() => void menu.refetch()} />
        ) : (
          <Loading k="menu.loading" />
        )
      ) : (
        <>
          {/* Keyed on the stage so React remounts on every transition: without it the incoming
              screen reuses the outgoing one's DOM and the entrance animation never plays. */}
          {stage === 'menu' && (
            <MenuScreen
              key="menu"
              tree={menu.data}
              categoryOrder={device.categoryOrder}
              greeting={profile}
              onOpenCart={() => setStage('cart')}
            />
          )}

          {stage === 'cart' && (
            <CartScreen key="cart" onBack={() => setStage('menu')} onPay={requestPayment} />
          )}

          {stage === 'pay' && (
            <PaymentScreen
              key="pay"
              menuId={menu.data.id}
              device={device}
              draft={draft}
              onDraft={setDraft}
              onSettled={(order) => {
                setSettled(order);
                setStage('done');
              }}
              onCancel={() => setStage('cart')}
            />
          )}

          {stage === 'done' && settled !== null && (
            <DoneScreen
              key="done"
              order={settled}
              identity={identity}
              profile={profile}
              device={device}
              onFinish={resetToMenu}
            />
          )}

          <NudgeSheet kind={nudge} tree={menu.data} onDismiss={dismissNudge} />
        </>
      )}

      <Sheet
        open={idlePrompt}
        onClose={() => setIdlePrompt(false)}
        title="idle.title"
        description="idle.body"
        descriptionValues={{ seconds: Math.max(0, idleSeconds) }}
        dismissible={false}
      >
        <div className="flex flex-col gap-3 sm:flex-row-reverse">
          <ActionLabel
            k="idle.continue"
            size="lg"
            className="flex-1"
            onClick={() => setIdlePrompt(false)}
          />
          <ActionLabel
            k="idle.clear"
            variant="quiet"
            size="lg"
            className="flex-1"
            onClick={() => {
              setIdlePrompt(false);
              resetToMenu();
            }}
          />
        </div>
      </Sheet>
    </div>
  );
}
