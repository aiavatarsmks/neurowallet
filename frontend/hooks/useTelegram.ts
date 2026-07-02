/**
 * hooks/useTelegram.ts
 * Thin wrapper around the Telegram Web App SDK.
 * Safe to call on web too — returns isInTelegram=false when not inside Telegram.
 */

import { useEffect, useRef } from 'react';

// Extend Window for Telegram WebApp type
declare global {
  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp;
    };
  }
}

export interface TelegramWebApp {
  initData:       string;
  initDataUnsafe: {
    user?: {
      id:         number;
      first_name: string;
      last_name?: string;
      username?:  string;
      photo_url?: string;
      language_code?: string;
    };
    auth_date: number;
    hash:      string;
  };
  version:        string;
  colorScheme:    'light' | 'dark';
  themeParams: {
    bg_color?:          string;
    text_color?:        string;
    hint_color?:        string;
    link_color?:        string;
    button_color?:      string;
    button_text_color?: string;
  };
  isExpanded:     boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  MainButton: {
    text:     string;
    color:    string;
    textColor: string;
    isVisible: boolean;
    isActive:  boolean;
    setText:  (text: string) => void;
    onClick:  (fn: () => void) => void;
    offClick: (fn: () => void) => void;
    show:     () => void;
    hide:     () => void;
    enable:   () => void;
    disable:  () => void;
    showProgress: (leaveActive?: boolean) => void;
    hideProgress: () => void;
  };
  BackButton: {
    isVisible: boolean;
    onClick:   (fn: () => void) => void;
    offClick:  (fn: () => void) => void;
    show:      () => void;
    hide:      () => void;
  };
  ready:         () => void;
  expand:        () => void;
  close:         () => void;
  isVersionAtLeast?: (version: string) => boolean;
  requestFullscreen?: () => void;
  exitFullscreen?:    () => void;
  disableVerticalSwipes?: () => void;
  enableVerticalSwipes?:  () => void;
  showAlert:     (message: string, callback?: () => void) => void;
  showConfirm:   (message: string, callback: (ok: boolean) => void) => void;
  showPopup:     (params: object, callback?: (id: string) => void) => void;
  HapticFeedback: {
    impactOccurred:    (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
    selectionChanged:  () => void;
  };
  setHeaderColor:      (color: string) => void;
  setBackgroundColor:  (color: string) => void;
  setBottomBarColor?:  (color: string) => void;
  enableClosingConfirmation:  () => void;
  disableClosingConfirmation: () => void;
}

function getWebApp(): TelegramWebApp | null {
  if (typeof window === 'undefined') return null;
  return window.Telegram?.WebApp ?? null;
}

/**
 * The Telegram SDK THROWS WebAppMethodUnsupported when a method exists in
 * the JS but the client version is too old — including plain browsers,
 * where the SDK reports version 6.0. Optional chaining does not protect
 * against that, and an exception inside useEffect crashes the whole React
 * tree ("Application error"). Every cosmetic/optional call goes through
 * this guard: failure is silently ignored.
 */
function safeTg(fn: (() => void) | undefined): void {
  try {
    fn?.();
  } catch {
    /* unsupported in this Telegram client version — ignore */
  }
}

function tgVersionAtLeast(wa: TelegramWebApp, version: string): boolean {
  try {
    return wa.isVersionAtLeast?.(version) ?? false;
  } catch {
    return false;
  }
}

export function useTelegram() {
  const webApp        = getWebApp();
  const isInTelegram  = !!(webApp?.initData);
  const tgUser        = webApp?.initDataUnsafe?.user ?? null;

  return {
    webApp,
    isInTelegram,
    tgUser,
    initData: webApp?.initData ?? '',

    // Lifecycle
    ready:  () => safeTg(() => webApp?.ready()),
    expand: () => safeTg(() => webApp?.expand()),
    close:  () => safeTg(() => webApp?.close()),

    // Haptics (6.1+ — throws on older clients and plain browsers)
    haptic: {
      success: () => safeTg(() => webApp?.HapticFeedback.notificationOccurred('success')),
      error:   () => safeTg(() => webApp?.HapticFeedback.notificationOccurred('error')),
      tap:     () => safeTg(() => webApp?.HapticFeedback.impactOccurred('light')),
    },

    // Alerts (6.2+)
    alert:   (msg: string) => safeTg(() => webApp?.showAlert(msg)),
    confirm: (msg: string, cb: (ok: boolean) => void) => safeTg(() => webApp?.showConfirm(msg, cb)),

    // MainButton helpers
    mainButton: {
      show:     (text: string, onClick: () => void) => safeTg(() => {
        if (!webApp) return;
        webApp.MainButton.setText(text);
        webApp.MainButton.onClick(onClick);
        webApp.MainButton.show();
        webApp.MainButton.enable();
      }),
      hide:     () => safeTg(() => webApp?.MainButton.hide()),
      loading:  () => safeTg(() => { webApp?.MainButton.showProgress(); webApp?.MainButton.disable(); }),
      done:     (text: string) => safeTg(() => { webApp?.MainButton.setText(text); webApp?.MainButton.enable(); webApp?.MainButton.hideProgress(); }),
    },

    // BackButton helpers
    backButton: {
      show: (onClick: () => void) => safeTg(() => {
        if (!webApp) return;
        webApp.BackButton.onClick(onClick);
        webApp.BackButton.show();
      }),
      hide: () => safeTg(() => webApp?.BackButton.hide()),
    },

    // Theme
    colorScheme: webApp?.colorScheme ?? 'dark',
    themeParams: webApp?.themeParams ?? {},
  };
}

// One-time initialization hook — call in _app.tsx
export function useTelegramInit() {
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;

    let cancelled = false;
    const timers: number[] = [];

    const init = (attempt = 0) => {
      if (cancelled || initialized.current) return;

      const wa = getWebApp();
      if (!wa) {
        if (attempt < 12) {
          timers.push(window.setTimeout(() => init(attempt + 1), 120));
        }
        return;
      }

      initialized.current = true;

      // Version gates (Bot API): colors 6.1+ / 7.10+, swipes 7.7+,
      // fullscreen 8.0+. Plain browsers report 6.0 — everything cosmetic
      // must degrade silently there.
      const canFullscreen = tgVersionAtLeast(wa, '8.0');

      safeTg(() => wa.ready());
      if (tgVersionAtLeast(wa, '6.1')) {
        safeTg(() => wa.setHeaderColor('#080C09'));
        safeTg(() => wa.setBackgroundColor('#080C09'));
      }
      if (tgVersionAtLeast(wa, '7.10')) safeTg(() => wa.setBottomBarColor?.('#080C09'));
      if (tgVersionAtLeast(wa, '7.7'))  safeTg(() => wa.disableVerticalSwipes?.());
      safeTg(() => wa.expand());
      if (canFullscreen) safeTg(() => wa.requestFullscreen?.());

      // iOS Telegram can apply the first expand before layout is stable.
      timers.push(window.setTimeout(() => safeTg(() => wa.expand()), 80));
      timers.push(window.setTimeout(() => safeTg(() => wa.expand()), 350));
      if (canFullscreen) {
        timers.push(window.setTimeout(() => safeTg(() => wa.requestFullscreen?.()), 500));
      }
    };

    init();

    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);
}
